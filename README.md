# Route Art Studio

Turn a logo into a runnable route. Overlay artwork on a map, extract its
centerline, and let it search a real street network for placements that a
run can actually trace. Exports GPX for your watch.

Everything runs in the browser. No build step, no API keys, no server of your own.

## Run it

```sh
./run.sh
```

That serves the folder on <http://127.0.0.1:8899> and opens it. You can also just
double-click `index.html` — `file://` works fine, all the network calls allow it.

## How it works

Drop a logo, say how far you want to run and what you're willing to run on,
press **Find routes**. Everything else is optional and tucked behind disclosure
triangles.

1. **Centerline** — the logo is thresholded to a binary mask, thinned to a
   1-pixel skeleton (Zhang-Suen), traced into polylines, and simplified. Corner
   spurs from thinning get pruned and the remaining chains spliced back together.
2. **Distance range** — you give a min and a max. That range sets the sizes the
   search tries, and finished routes are filtered on their real measured length.
   Anything outside the range still gets listed, just marked and ranked below.
3. **Surfaces** — mix and match main roads, residential streets, alleys,
   footpaths, trails and bike paths, with `Walkable` / `Roads` / `Quiet` /
   `Everything` presets as starting points. Every surface type is downloaded in
   one query and filtered locally, so changing the mix re-searches instantly and
   never re-queries Overpass.
4. **Auto-match** — searches the downloaded street network for the best
   placement of the logo:
   - The road network is rasterised into a **distance-to-nearest-road field**.
     Scoring a candidate placement is then just a few hundred grid lookups, so
     hundreds of thousands of position × rotation × scale combinations are
     testable in about a second.
   - The best few candidates are refined by hill climbing, then **actually
     routed**: skeleton points snap to real junctions and A\* connects them.
   - Candidates are scored on how far the route strays from the drawing, how
     much of the drawing it covers, and how much detour it racks up.
5. **Export** — GPX track, ready for a watch.

The dashed purple rectangle on the map is the area that's been downloaded and is
being searched. Panning inside it costs nothing; panning well outside triggers a
fresh download. The last few areas are kept, so going back and forth is free.

### Drawing order

A logo is a graph: strokes are edges, their endpoints are nodes. Covering all of
it in one continuous run is the [route inspection
problem](https://en.wikipedia.org/wiki/Chinese_postman_problem). Where more than
two nodes have an odd number of strokes meeting them, the cheapest connecting
strokes get duplicated — on the ground that means running a leg twice, which
still draws the shape correctly, rather than cutting across it with a dead leg.

## Getting a good result

- **Simple, angular logos win.** A street grid renders straight lines and right
  angles well. Tight curves come out as staircases.
- **Match the logo to the terrain.** Grid cities suit geometric marks; curvy
  suburbs and park paths suit organic ones.
- **Scale is your friend.** A 10 km route over a few square kilometres has far
  more streets to work with than a 3 km one.
- **Widen the distance range** before anything else if nothing lands in range.
  8–12 km gives the search far more room than 9.5–10.5 km.
- **Add surfaces** if results look forced. Footpaths and alleys give the search
  a much finer mesh to work with than roads alone; `Roads` alone is the blockiest.
- **Watch the connector legs.** If a result lists connectors, the route jumps
  between disconnected parts of the artwork. Fewer, longer strokes are better.
- **Ink threshold** is the first thing to adjust if the centerline looks wrong,
  then **prune corner spurs** if you get stubby branches at stroke ends.

## Running it

Export the GPX, then load it as a route/course:

- **COROS** — COROS app → Route Library → import GPX → sync to watch
- **Garmin** — Garmin Connect → Training → Courses → Import → send to device
- Run it with navigation on. The activity syncs to Strava as usual.

Strava has no GPX-to-route import, so the watch is the path in. Don't upload the
GPX to Strava directly — that would post a ride you didn't do.

## Files

| File | What it is |
| --- | --- |
| `index.html` | UI, map, and app wiring |
| `skeleton.js` | Image → binary mask → thinning → traced polylines → drawing order |
| `matcher.js` | Overpass fetch, graph building, and the search worker |
| `samples/` | Test artwork |

`window.routeArt` exposes the map, state, and `buildGpx()` for poking from the
console.

## Notes

- Overpass is a free shared service and sheds load with 504s; the fetch retries
  with a patient backoff and falls back to mirrors. If it keeps failing, wait a
  minute — hammering it just burns the next slot. All surface types come down in
  one query precisely so this happens as rarely as possible.
- Routing for manually drawn points uses [BRouter](https://brouter.de).
  Auto-matched routes are routed locally against the downloaded graph, so
  applying a match doesn't re-request anything.
- State (including the logo and the route) persists in `localStorage`.
