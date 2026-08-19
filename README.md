# Route Art Studio

Turn a logo into a runnable route. Overlay artwork on a map, extract its
centerline, and let it search a real street network for placements that a
run can actually trace. Exports GPX for your watch.

Everything runs in the browser. No build step, no API keys, no server of your own.

## Run it

Hosted at <https://billums123.github.io/route-art/>, or locally:

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
2. **Distance range** — you give a min and a max (miles by default). That range
   sets the sizes the search tries, and finished routes are filtered on their real
   measured length. Anything outside the range still gets listed, marked and ranked
   below.
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

### Streets, or open ground

**Trace on: Streets / Open ground.**

On *streets* the drawing is snapped to roads and paths, which is what makes a
big-city route possible — and why the shape comes out as a staircase.

On *open ground* the route is the drawing. It searches parks, playing fields,
recreation grounds and greens for somewhere the shape fits with room to spare,
then traces it exactly — no routing, no staircase, no compromise. Every result
names the space it found and how much clearance it has, e.g. *"in Liberty Park ·
0.29 mi across · 390 ft clear"*.

The trade-off is length. A 100-acre park fits a drawing about 500 m across,
which is a route of roughly one mile. Street routes run to ten or twenty. So: open
ground for a clean shape, streets for distance.

Two things worth knowing. Cemeteries are excluded deliberately; golf courses are
included but are usually private, which is exactly why results name the place —
**checking that the ground is open to you is your call, not the tool's.** And
applying an open-ground result turns road-snapping off, since snapping the points
back to streets would undo the whole point.

### The search area

The dashed purple box is what gets searched, and it's set explicitly rather than
tracking the map — so panning around, or previewing a result (which re-centres the
map), never quietly changes what's being searched.

**Drag the box to move it, drag a corner to resize it**, or use
**This view · − · + · Max**. Max snaps to the largest area that can actually be
downloaded, about 160 km², and the box is clamped so it can never ask for more
than that. Then press **Download streets**, which reports what it has and turns
into *Download streets for this box* whenever the box or the surface mix has moved
on from what's loaded. Bigger is genuinely better: it doesn't make the logo
larger, but it gives the search far more places the shape can land, and the best
placement is usually somewhere you weren't looking. Widening from one screen to
160 km² took a test route from 14% off-shape to 8%.

Two things make large areas practical:

- **Requests are sized to Overpass's real limits.** One 84 km² query measured
  16.6 MB in 6 seconds — the constraint is query *slots* (a couple per minute),
  not payload, so the tool makes few large requests rather than many small ones.
  Max is 2 requests, not 12.
- **Above ~30 km² only the surfaces you picked are downloaded.** Way tags cost
  ~40% extra and only exist to make the surface toggles free; that's a good trade
  on a small area and a bad one across a whole valley. The tool says when it has
  done this, because changing the mix then means re-downloading.

The last few downloaded areas are cached, so going back and forth is free.

### Reading the results

Every match reports two numbers, both relative to the logo's own size:

- **drifts N% of that** — how far the route strays from the drawing at the 90th
  percentile, as a fraction of the logo's width. Under ~2.5% reads cleanly.
- **N% off-shape** — how much of the run isn't tracing the logo at all.

Judging on absolute metres does not work: 45 m of wander is nothing on a 3 km
logo and ruinous on a 700 m one. The mean doesn't work either — it hides a bad
tail behind a well-behaved majority. Badges run **Strong / Fair / Rough / Barely
reads**, and if the best result is still poor the tool says so and suggests the
size that would fix it.

**The single biggest lever is drawing it bigger.** A logo spanning 15+ blocks
reads; one spanning 6 cannot, no matter how good the search is.

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
- **Close up crossings** merges the twin junctions that thinning leaves wherever
  two strokes cross, so they meet at a point instead of being joined by a short
  bridge. It sizes itself from the detected pen thickness; raise it if crossings
  still look separated, drop it to zero to leave them alone.

## Running it

Export the GPX, then load it somewhere that can navigate it:

- **Strava** — Dashboard → My Routes → Create New Route → upload the GPX
  (route upload is a subscriber feature). From there it syncs to most watches.
- **Garmin** — Garmin Connect → Training → Courses → Import → send to device
- **COROS** — COROS app → Route Library → import GPX → sync to watch
- **Apple Watch** — Apple's built-in Workout app cannot follow a GPX route.
  [WorkOutDoors](https://www.workoutdoors.net/) (one-off ~$9) is the usual
  answer: it loads GPX/TCX/FIT, draws the route on an offline vector map on the
  watch, gives turn-by-turn and off-route alerts. Komoot's watch app will also
  navigate an imported GPX with turn prompts.
- **No watch at all** — navigate on your phone. Any GPX app (Strava, Komoot,
  Gaia, OsmAnd) will show the line and your position on it, which is all this
  needs; the route is drawn on streets, so it's hard to lose.

Then run it with navigation on and let the activity upload as normal.

One distinction worth keeping straight: importing the GPX as a **route** is
planning the run. Uploading it at `strava.com/upload` creates an **activity** —
that would post a run you never did. Use My Routes, not Upload.

## Files

| File | What it is |
| --- | --- |
| `index.html` | UI, map, and app wiring |
| `skeleton.js` | Image → binary mask → thinning → traced polylines → drawing order |
| `matcher.js` | Overpass fetch, graph building, and the search worker |
| `samples/` | Test artwork |
| — | open-ground mode reuses the same distance transform, inverted: clearance from the edge of a park rather than distance to the nearest road |
| `vendor/leaflet/` | Leaflet, vendored so the page has no CDN dependency |

`window.routeArt` exposes the map, state, and `buildGpx()` for poking from the
console.

## Notes

- Overpass is free shared infrastructure with a couple of query slots per client,
  and it answers 504 — or stops answering entirely — once they're spent. Before
  the first download the tool asks every known instance for a couple of ways near
  your search box and uses the first that replies with data, so a rate-limited or
  wedged server costs nothing rather than stalling everything. All surface types
  come down in one query for the same reason.
- Only full-planet instances are in that list. Region-limited mirrors such as
  `overpass.osm.ch` answer 200 with an empty result outside their coverage, which
  is indistinguishable from "there are no streets here" — worse than failing.
- Routing for manually drawn points uses [BRouter](https://brouter.de).
  Auto-matched routes are routed locally against the downloaded graph, so
  applying a match doesn't re-request anything.
- State (including the logo and the route) persists in `localStorage`.
