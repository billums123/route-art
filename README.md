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

1. **Overlay** — drop in a PNG/SVG/JPG. Move, scale, rotate and fade it over the
   map (streets, light, dark, or satellite) so you can eyeball a fit.
2. **Centerline** — the logo is thresholded to a binary mask, thinned to a
   1-pixel skeleton (Zhang-Suen), traced into polylines, and simplified. Corner
   spurs from thinning get pruned and the remaining chains spliced back together.
3. **Auto-match** — pulls the walkable street network for the current view from
   OpenStreetMap (Overpass), then searches for the best placement of the logo:
   - The road network is rasterised into a **distance-to-nearest-road field**.
     Scoring a candidate placement is then just a few hundred grid lookups, so
     hundreds of thousands of position × rotation × scale combinations are
     testable in about a second.
   - The best few candidates are refined by hill climbing, then **actually
     routed**: skeleton points snap to real junctions and A\* connects them.
   - Candidates are scored on how far the route strays from the drawing, how
     much of the drawing it covers, and how much detour it racks up.
4. **Export** — GPX track, ready for a watch.

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
  and falls back to mirrors. If it keeps failing, wait a minute.
- Routing for manually drawn points uses [BRouter](https://brouter.de).
  Auto-matched routes are routed locally against the downloaded graph, so
  applying a match doesn't re-request anything.
- State (including the logo and the route) persists in `localStorage`.
