/* matcher.js — fits a skeletonised logo onto a real road network.
   Exposes window.Matcher. The heavy lifting runs in a Blob worker so the map stays responsive. */
(function (global) {
  "use strict";

  var WORKER_SRC = [
"'use strict';",
"var G = null;   // graph in local metres",
"var F = null;   // distance-to-road field",
"",
"function post(o){ self.postMessage(o); }",
"",
"/* ------------------------------------------------------------ geometry */",
"function projSetup(lat0, lon0){",
"  return { lat0: lat0, lon0: lon0,",
"           mPerLat: 110574.0,",
"           mPerLon: 111320.0 * Math.cos(lat0 * Math.PI / 180) };",
"}",
"",
"/* ------------------------------------------------------- distance field */",
"function dt1d(f, n, d, v, z){",
"  var k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;",
"  for (var q = 1; q < n; q++){",
"    var s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);",
"    while (s <= z[k]){ k--; s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]); }",
"    k++; v[k] = q; z[k] = s; z[k+1] = Infinity;",
"  }",
"  k = 0;",
"  for (var q2 = 0; q2 < n; q2++){",
"    while (z[k+1] < q2) k++;",
"    d[q2] = (q2 - v[k]) * (q2 - v[k]) + f[v[k]];",
"  }",
"}",
"",
"function buildField(cell){",
"  var minX = G.minX - 300, minY = G.minY - 300;",
"  var gw = Math.ceil((G.maxX - G.minX + 600) / cell);",
"  var gh = Math.ceil((G.maxY - G.minY + 600) / cell);",
"  var INF = 1e12;",
"  var grid = new Float64Array(gw * gh);",
"  var i;",
"  for (i = 0; i < grid.length; i++) grid[i] = INF;",
"",
"  // stamp every road segment into the grid",
"  var off = G.off, tgt = G.tgt, X = G.x, Y = G.y;",
"  for (var a = 0; a < G.n; a++){",
"    for (var e = off[a]; e < off[a+1]; e++){",
"      var b = tgt[e];",
"      if (b < a) continue;",
"      var x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b];",
"      var dx = x1 - x0, dy = y1 - y0;",
"      var len = Math.sqrt(dx*dx + dy*dy);",
"      var steps = Math.max(1, Math.ceil(len / (cell * 0.5)));",
"      for (var s = 0; s <= steps; s++){",
"        var t = s / steps;",
"        var gx = Math.floor((x0 + dx*t - minX) / cell);",
"        var gy = Math.floor((y0 + dy*t - minY) / cell);",
"        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;",
"        grid[gy*gw + gx] = 0;",
"      }",
"    }",
"  }",
"",
"  // exact squared EDT, Felzenszwalb: columns then rows",
"  var maxDim = Math.max(gw, gh);",
"  var f = new Float64Array(maxDim), d = new Float64Array(maxDim);",
"  var v = new Int32Array(maxDim), z = new Float64Array(maxDim + 1);",
"  var x, y;",
"  for (x = 0; x < gw; x++){",
"    for (y = 0; y < gh; y++) f[y] = grid[y*gw + x];",
"    dt1d(f, gh, d, v, z);",
"    for (y = 0; y < gh; y++) grid[y*gw + x] = d[y];",
"  }",
"  for (y = 0; y < gh; y++){",
"    for (x = 0; x < gw; x++) f[x] = grid[y*gw + x];",
"    dt1d(f, gw, d, v, z);",
"    for (x = 0; x < gw; x++) grid[y*gw + x] = d[x];",
"  }",
"",
"  var field = new Float32Array(gw * gh);",
"  for (i = 0; i < field.length; i++) field[i] = Math.sqrt(grid[i]) * cell;",
"  return { field: field, gw: gw, gh: gh, cell: cell, minX: minX, minY: minY };",
"}",
"",
"function sampleField(x, y){",
"  var gx = ((x - F.minX) / F.cell) | 0;",
"  var gy = ((y - F.minY) / F.cell) | 0;",
"  if (gx < 0 || gy < 0 || gx >= F.gw || gy >= F.gh) return 9999;",
"  return F.field[gy * F.gw + gx];",
"}",
"",
"/* ------------------------------------------------------------ spatial hash */",
"function buildHash(cell){",
"  var map = new Map();",
"  for (var i = 0; i < G.n; i++){",
"    var k = ((G.x[i] / cell) | 0) + ':' + ((G.y[i] / cell) | 0);",
"    var arr = map.get(k);",
"    if (!arr) { arr = []; map.set(k, arr); }",
"    arr.push(i);",
"  }",
"  return { map: map, cell: cell };",
"}",
"",
"function nearestNode(H, x, y, maxDist, minDeg){",
"  var cx = (x / H.cell) | 0, cy = (y / H.cell) | 0;",
"  var best = -1, bestD = maxDist * maxDist;",
"  var rings = Math.max(1, Math.ceil(maxDist / H.cell));",
"  for (var r = 0; r <= rings; r++){",
"    for (var dx = -r; dx <= r; dx++){",
"      for (var dy = -r; dy <= r; dy++){",
"        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;",
"        var arr = H.map.get((cx+dx) + ':' + (cy+dy));",
"        if (!arr) continue;",
"        for (var i = 0; i < arr.length; i++){",
"          var n = arr[i];",
"          if (G.off[n+1] - G.off[n] < minDeg) continue;",
"          var ex = G.x[n] - x, ey = G.y[n] - y;",
"          var d2 = ex*ex + ey*ey;",
"          if (d2 < bestD){ bestD = d2; best = n; }",
"        }",
"      }",
"    }",
"    if (best >= 0 && r >= 1) break;",
"  }",
"  return best;",
"}",
"",
"/* Anchor on real junctions where possible. Snapping mid-block, or onto a",
"   cul-de-sac, makes the route detour down it and straight back out — those",
"   are the little dead-end spurs that stop a route reading as the logo. */",
"function snapAnchor(H, x, y, maxDist){",
"  var j = nearestNode(H, x, y, maxDist, 3);",
"  if (j >= 0) return j;",
"  var t = nearestNode(H, x, y, maxDist, 2);",
"  if (t >= 0) return t;",
"  return nearestNode(H, x, y, maxDist, 1);",
"}",
"",
"/* ------------------------------------------------------------- routing */",
"function Heap(){ this.a = []; }",
"Heap.prototype.push = function(node, pri){",
"  var a = this.a; a.push([pri, node]);",
"  var i = a.length - 1;",
"  while (i > 0){ var p = (i-1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }",
"};",
"Heap.prototype.pop = function(){",
"  var a = this.a; if (!a.length) return null;",
"  var top = a[0], last = a.pop();",
"  if (a.length){ a[0] = last; var i = 0;",
"    for(;;){ var l = 2*i+1, r = l+1, m = i;",
"      if (l < a.length && a[l][0] < a[m][0]) m = l;",
"      if (r < a.length && a[r][0] < a[m][0]) m = r;",
"      if (m === i) break; var t = a[m]; a[m] = a[i]; a[i] = t; i = m; } }",
"  return top;",
"};",
"",
"var _dist = null, _prev = null, _stamp = null, _closed = null, _epoch = 0;",
"function shortestPath(src, dst, maxNodes){",
"  if (!_dist){ _dist = new Float64Array(G.n); _prev = new Int32Array(G.n);",
"               _stamp = new Int32Array(G.n); _closed = new Int32Array(G.n); }",
"  _epoch++;",
"  var h = new Heap();",
"  _dist[src] = 0; _prev[src] = -1; _stamp[src] = _epoch;",
"  h.push(src, 0);",
"  var explored = 0;",
"  var tx = G.x[dst], ty = G.y[dst];",
"  while (true){",
"    var top = h.pop();",
"    if (!top) return null;",
"    var u = top[1];",
"    // the heap priority carries the A* heuristic, so settle on a closed-set stamp",
"    if (_closed[u] === _epoch) continue;",
"    _closed[u] = _epoch;",
"    if (u === dst) break;",
"    if (++explored > maxNodes) return null;",
"    for (var e = G.off[u]; e < G.off[u+1]; e++){",
"      var v2 = G.tgt[e];",
"      var nd = _dist[u] + G.w[e];",
"      if (_stamp[v2] !== _epoch || nd < _dist[v2]){",
"        _stamp[v2] = _epoch; _dist[v2] = nd; _prev[v2] = u;",
"        var hx = G.x[v2] - tx, hy = G.y[v2] - ty;",
"        h.push(v2, nd + Math.sqrt(hx*hx + hy*hy));",
"      }",
"    }",
"  }",
"  var path = [], c = dst, guard = 0;",
"  while (c !== -1 && guard++ < 200000){ path.push(c); if (c === src) break; c = _prev[c]; }",
"  path.reverse();",
"  return { path: path, dist: _dist[dst] };",
"}",
"",
"/* ------------------------------------------------- open ground (parks) */",
"var P = null;   // clearance field: metres from the nearest edge of open ground",
"",
"/* Scanline-fill the polygons, then run the same distance transform inverted, so",
"   every cell records how far it is from the nearest edge. A drawing fits wherever",
"   the clearance beats its own radius — no routing involved, the shape is traced",
"   exactly as drawn. */",
"function buildInsideField(polys, cell){",
"  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i, j, k;",
"  for (i = 0; i < polys.length; i++){",
"    var pp = polys[i].pts;",
"    for (j = 0; j < pp.length; j++){",
"      if (pp[j][0] < minX) minX = pp[j][0]; if (pp[j][0] > maxX) maxX = pp[j][0];",
"      if (pp[j][1] < minY) minY = pp[j][1]; if (pp[j][1] > maxY) maxY = pp[j][1];",
"    }",
"  }",
"  if (!isFinite(minX)) return null;",
"  minX -= cell * 2; minY -= cell * 2; maxX += cell * 2; maxY += cell * 2;",
"  var gw = Math.max(2, Math.ceil((maxX - minX) / cell));",
"  var gh = Math.max(2, Math.ceil((maxY - minY) / cell));",
"  var owner = new Int32Array(gw * gh).fill(-1);",
"  var grid = new Float64Array(gw * gh);",
"  var INF = 1e12;",
"",
"  for (i = 0; i < polys.length; i++){",
"    var pts = polys[i].pts;",
"    if (pts.length < 3) continue;",
"    var pMinY = Infinity, pMaxY = -Infinity;",
"    for (j = 0; j < pts.length; j++){",
"      if (pts[j][1] < pMinY) pMinY = pts[j][1];",
"      if (pts[j][1] > pMaxY) pMaxY = pts[j][1];",
"    }",
"    var y0 = Math.max(0, Math.floor((pMinY - minY) / cell));",
"    var y1 = Math.min(gh - 1, Math.ceil((pMaxY - minY) / cell));",
"    var xs = [];",
"    for (var gy = y0; gy <= y1; gy++){",
"      var wy = minY + (gy + 0.5) * cell;",
"      xs.length = 0;",
"      for (k = 0; k < pts.length; k++){",
"        var a = pts[k], b = pts[(k + 1) % pts.length];",
"        if ((a[1] <= wy && b[1] > wy) || (b[1] <= wy && a[1] > wy)){",
"          xs.push(a[0] + (wy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));",
"        }",
"      }",
"      if (xs.length < 2) continue;",
"      xs.sort(function(m,n){ return m - n; });",
"      for (k = 0; k + 1 < xs.length; k += 2){",
"        var gx0 = Math.max(0, Math.ceil((xs[k] - minX) / cell - 0.5));",
"        var gx1 = Math.min(gw - 1, Math.floor((xs[k+1] - minX) / cell - 0.5));",
"        for (var gx = gx0; gx <= gx1; gx++) owner[gy * gw + gx] = i;",
"      }",
"    }",
"  }",
"",
"  for (i = 0; i < grid.length; i++) grid[i] = owner[i] >= 0 ? INF : 0;",
"",
"  var maxDim = Math.max(gw, gh);",
"  var f = new Float64Array(maxDim), d = new Float64Array(maxDim);",
"  var v = new Int32Array(maxDim), z = new Float64Array(maxDim + 1);",
"  var x, y;",
"  for (x = 0; x < gw; x++){",
"    for (y = 0; y < gh; y++) f[y] = grid[y*gw + x];",
"    dt1d(f, gh, d, v, z);",
"    for (y = 0; y < gh; y++) grid[y*gw + x] = d[y];",
"  }",
"  for (y = 0; y < gh; y++){",
"    for (x = 0; x < gw; x++) f[x] = grid[y*gw + x];",
"    dt1d(f, gw, d, v, z);",
"    for (x = 0; x < gw; x++) grid[y*gw + x] = d[x];",
"  }",
"  var field = new Float32Array(gw * gh);",
"  for (i = 0; i < field.length; i++) field[i] = Math.sqrt(grid[i]) * cell;",
"  return { field: field, owner: owner, gw: gw, gh: gh, cell: cell, minX: minX, minY: minY };",
"}",
"",
"function clearanceAt(x, y){",
"  var gx = ((x - P.minX) / P.cell) | 0;",
"  var gy = ((y - P.minY) / P.cell) | 0;",
"  if (gx < 0 || gy < 0 || gx >= P.gw || gy >= P.gh) return 0;",
"  return P.field[gy * P.gw + gx];",
"}",
"",
"function ownerAt(x, y){",
"  var gx = ((x - P.minX) / P.cell) | 0;",
"  var gy = ((y - P.minY) / P.cell) | 0;",
"  if (gx < 0 || gy < 0 || gx >= P.gw || gy >= P.gh) return -1;",
"  return P.owner[gy * P.gw + gx];",
"}",
"",
"/* ---------------------------------------------------------- shape utils */",
"function resample(runs, spacing){",
"  var out = [];",
"  for (var r = 0; r < runs.length; r++){",
"    var pts = runs[r];",
"    if (pts.length < 2){ if (pts.length) out.push({ p: pts[0], run: r, first: true }); continue; }",
"    var acc = 0, first = true;",
"    out.push({ p: pts[0], run: r, first: true });",
"    for (var i = 1; i < pts.length; i++){",
"      var ax = pts[i-1][0], ay = pts[i-1][1], bx = pts[i][0], by = pts[i][1];",
"      var seg = Math.hypot(bx-ax, by-ay);",
"      var pos = spacing - acc;",
"      while (pos <= seg){",
"        var t = pos / seg;",
"        out.push({ p: [ax + (bx-ax)*t, ay + (by-ay)*t], run: r, first: false });",
"        pos += spacing;",
"      }",
"      acc = (acc + seg) % spacing;",
"    }",
"    out.push({ p: pts[pts.length-1], run: r, first: false });",
"  }",
"  return out;",
"}",
"",
"function place(u, v, S, cosT, sinT, cx, cy){",
"  var e = S * u, n = S * v;",
"  return [cx + e * cosT + n * sinT, cy - e * sinT + n * cosT];",
"}",
"",
"function segDist(px, py, ax, ay, bx, by){",
"  var dx = bx-ax, dy = by-ay, L2 = dx*dx + dy*dy;",
"  var t = L2 ? ((px-ax)*dx + (py-ay)*dy) / L2 : 0;",
"  t = t < 0 ? 0 : (t > 1 ? 1 : t);",
"  var qx = ax + t*dx, qy = ay + t*dy;",
"  return Math.hypot(px-qx, py-qy);",
"}",
"",
"function polyDist(px, py, poly){",
"  var best = Infinity;",
"  for (var i = 1; i < poly.length; i++){",
"    var d = segDist(px, py, poly[i-1][0], poly[i-1][1], poly[i][0], poly[i][1]);",
"    if (d < best) best = d;",
"  }",
"  return best;",
"}",
"",
"/* ---------------------------------------------------------------- main */",
"self.onmessage = function(ev){",
"  var m = ev.data;",
"",
"  if (m.cmd === 'setGraph'){",
"    var proj = projSetup(m.lat0, m.lon0);",
"    var n = m.lat.length;",
"    var x = new Float64Array(n), y = new Float64Array(n);",
"    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;",
"    for (var i = 0; i < n; i++){",
"      x[i] = (m.lon[i] - proj.lon0) * proj.mPerLon;",
"      y[i] = (m.lat[i] - proj.lat0) * proj.mPerLat;",
"      if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];",
"      if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];",
"    }",
"    // CSR adjacency from the undirected edge list",
"    var ea = m.ea, eb = m.eb, m2 = ea.length;",
"    var deg = new Int32Array(n);",
"    for (var k = 0; k < m2; k++){ deg[ea[k]]++; deg[eb[k]]++; }",
"    var off = new Int32Array(n + 1);",
"    for (var j = 0; j < n; j++) off[j+1] = off[j] + deg[j];",
"    var cursor = off.slice(0, n);",
"    var tgt = new Int32Array(m2 * 2), w = new Float32Array(m2 * 2);",
"    for (var k2 = 0; k2 < m2; k2++){",
"      var a = ea[k2], b = eb[k2];",
"      var d = Math.hypot(x[a]-x[b], y[a]-y[b]);",
"      tgt[cursor[a]] = b; w[cursor[a]++] = d;",
"      tgt[cursor[b]] = a; w[cursor[b]++] = d;",
"    }",
"    G = { n: n, x: x, y: y, off: off, tgt: tgt, w: w,",
"          minX: minX, minY: minY, maxX: maxX, maxY: maxY, P: proj };",
"    post({ type: 'progress', pct: 0.2, stage: 'Building distance field' });",
"    var span = Math.max(maxX - minX, maxY - minY);",
"    var cell = Math.max(6, span / 1100);",
"    F = buildField(cell);",
"    G.hash = buildHash(120);",
"    post({ type: 'graphReady', nodes: n, edges: m2, cell: cell, gw: F.gw, gh: F.gh,",
"           spanX: maxX - minX, spanY: maxY - minY });",
"    return;",
"  }",
"",
"  if (m.cmd === 'setPolys'){",
"    var Pj = projSetup(m.lat0, m.lon0);",
"    var polys = [];",
"    for (var pi2 = 0; pi2 < m.polys.length; pi2++){",
"      var src = m.polys[pi2];",
"      var pts = [];",
"      for (var q3 = 0; q3 < src.pts.length; q3++){",
"        pts.push([(src.pts[q3][1] - Pj.lon0) * Pj.mPerLon,",
"                  (src.pts[q3][0] - Pj.lat0) * Pj.mPerLat]);",
"      }",
"      polys.push({ pts: pts, name: src.name, kind: src.kind });",
"    }",
"    post({ type:'progress', pct: 0.3, stage: 'Mapping the open ground' });",
"    P = buildInsideField(polys, 5);",
"    if (!P){ post({ type:'error', message:'No open ground found in that box.' }); return; }",
"    G = { P: Pj, polys: polys };",
"    var deepest = 0;",
"    for (var f2 = 0; f2 < P.field.length; f2++) if (P.field[f2] > deepest) deepest = P.field[f2];",
"    post({ type:'polysReady', count: polys.length, cell: P.cell,",
"           gw: P.gw, gh: P.gh, widest: Math.round(deepest * 2) });",
"    return;",
"  }",
"",
"  if (m.cmd === 'searchOpen'){",
"    if (!P || !G || !G.polys){ post({ type:'error', message:'No open ground loaded.' }); return; }",
"    var t1 = Date.now();",
"    var runsO = m.runs, optsO = m.opts;",
"",
"    var shapeLenO = 0, rr3, ii3;",
"    for (rr3 = 0; rr3 < runsO.length; rr3++)",
"      for (ii3 = 1; ii3 < runsO[rr3].length; ii3++)",
"        shapeLenO += Math.hypot(runsO[rr3][ii3][0]-runsO[rr3][ii3-1][0],",
"                                runsO[rr3][ii3][1]-runsO[rr3][ii3-1][1]);",
"    if (shapeLenO <= 0){ post({ type:'error', message:'The skeleton is empty.' }); return; }",
"",
"    var sampO = resample(runsO, shapeLenO / 120).map(function(s3){ return s3.p; });",
"    var radiusUnits = 0;",
"    for (var s4 = 0; s4 < sampO.length; s4++){",
"      var rr4 = Math.hypot(sampO[s4][0], sampO[s4][1]);",
"      if (rr4 > radiusUnits) radiusUnits = rr4;",
"    }",
"",
"    // On open ground the route IS the drawing, so its length is exactly the",
"    // shape length at that size — no detour to allow for.",
"    var sHiO = optsO.maxMeters / shapeLenO;",
"    var sLoO = optsO.minMeters / shapeLenO;",
"    var margin = optsO.margin === undefined ? 8 : optsO.margin;",
"    var steps = 9;",
"    var found = [];",
"    var seen = {};",
"",
"    for (var si2 = 0; si2 < steps; si2++){",
"      // largest first: a bigger drawing is a better drawing",
"      var S2 = sHiO - (sHiO - sLoO) * (si2 / (steps - 1));",
"      var needR = S2 * radiusUnits + margin;",
"      var stride = Math.max(1, Math.round(needR / (P.cell * 3)));",
"      for (var gy2 = 0; gy2 < P.gh; gy2 += stride){",
"        for (var gx2 = 0; gx2 < P.gw; gx2 += stride){",
"          if (P.field[gy2 * P.gw + gx2] < needR) continue;      // can't possibly fit",
"          var cx2 = P.minX + (gx2 + 0.5) * P.cell;",
"          var cy2 = P.minY + (gy2 + 0.5) * P.cell;",
"          for (var ri2 = 0; ri2 < optsO.rotations.length; ri2++){",
"            var th3 = optsO.rotations[ri2] * Math.PI / 180;",
"            var cos3 = Math.cos(th3), sin3 = Math.sin(th3);",
"            var worst = Infinity;",
"            for (var k4 = 0; k4 < sampO.length; k4++){",
"              var pl = place(sampO[k4][0], sampO[k4][1], S2, cos3, sin3, cx2, cy2);",
"              var cl = clearanceAt(pl[0], pl[1]);",
"              if (cl < worst) worst = cl;",
"              if (worst < margin) break;",
"            }",
"            if (worst < margin) continue;",
"            var own = ownerAt(cx2, cy2);",
"            var key2 = own + ':' + Math.round(cx2 / 200) + ':' + Math.round(cy2 / 200);",
"            if (seen[key2]) continue;",
"            seen[key2] = 1;",
"            found.push({ cx: cx2, cy: cy2, S: S2, rot: optsO.rotations[ri2],",
"                         clear: worst, owner: own });",
"            break;",
"          }",
"        }",
"      }",
"      if (found.length >= 8) break;",
"    }",
"",
"    // biggest drawing first, then the one with the most room to spare",
"    found.sort(function(a,b){ return (b.S - a.S) || (b.clear - a.clear); });",
"",
"    var outRes = [];",
"    for (var fi = 0; fi < Math.min(found.length, 8); fi++){",
"      var F2 = found[fi];",
"      var th4 = F2.rot * Math.PI / 180, cos4 = Math.cos(th4), sin4 = Math.sin(th4);",
"      var geo = [], flags = [], len2 = 0, prev = null;",
"      for (var r5 = 0; r5 < runsO.length; r5++){",
"        for (var p5 = 0; p5 < runsO[r5].length; p5++){",
"          var pm2 = place(runsO[r5][p5][0], runsO[r5][p5][1], F2.S, cos4, sin4, F2.cx, F2.cy);",
"          if (prev) len2 += Math.hypot(pm2[0]-prev[0], pm2[1]-prev[1]);",
"          geo.push(pm2);",
"          flags.push(p5 === 0 && r5 > 0);      // the hop between separate strokes",
"          prev = pm2;",
"        }",
"      }",
"      var Pp = G.P;",
"      function toLL2(pt){ return [Pp.lat0 + pt[1] / Pp.mPerLat, Pp.lon0 + pt[0] / Pp.mPerLon]; }",
"      var namer = G.polys[F2.owner];",
"      outRes.push({",
"        openGround: true,",
"        place: namer ? (namer.name || namer.kind) : 'open ground',",
"        score: 0, coverage: 0, fidelity: 0, p90: 0,",
"        spanMeters: F2.S * radiusUnits * 2,",
"        strayFraction: 0, lengthRatio: 1, detail: 999, spacing: 0,",
"        inRange: len2 >= optsO.minMeters && len2 <= optsO.maxMeters,",
"        lengthMeters: len2, connectorMeters: 0, failedSegments: 0,",
"        clearance: Math.round(F2.clear),",
"        rotation: ((F2.rot % 360) + 540) % 360 - 180,",
"        widthMeters: F2.S,",
"        center: toLL2([F2.cx, F2.cy]),",
"        geometry: geo.map(toLL2),",
"        connectorFlags: flags,",
"        anchors: geo.map(toLL2),",
"        anchorIndices: null",
"      });",
"    }",
"    post({ type:'results', results: outRes, ms: Date.now() - t1, shapeLen: shapeLenO,",
"           openGround: true });",
"    return;",
"  }",
"",
"  if (m.cmd === 'search'){",
"    if (!G){ post({ type: 'error', message: 'No road network loaded.' }); return; }",
"    var t0 = Date.now();",
"    var runs = m.runs;                       // arrays of [u,v] in shape units",
"    var opts = m.opts;",
"",
"    // shape length in shape units (contiguous runs only)",
"    var shapeLen = 0, rr, ii;",
"    for (rr = 0; rr < runs.length; rr++)",
"      for (ii = 1; ii < runs[rr].length; ii++)",
"        shapeLen += Math.hypot(runs[rr][ii][0]-runs[rr][ii-1][0], runs[rr][ii][1]-runs[rr][ii-1][1]);",
"    if (shapeLen <= 0){ post({ type:'error', message:'The skeleton is empty — adjust the threshold.' }); return; }",
"",
"    // how wide the drawing is in its own units, so every error can be judged",
"    // against the logo's size rather than against a fixed number of metres",
"    var sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity;",
"    for (rr = 0; rr < runs.length; rr++){",
"      for (ii = 0; ii < runs[rr].length; ii++){",
"        var uu = runs[rr][ii][0], vv = runs[rr][ii][1];",
"        if (uu < sxMin) sxMin = uu; if (uu > sxMax) sxMax = uu;",
"        if (vv < syMin) syMin = vv; if (vv > syMax) syMax = vv;",
"      }",
"    }",
"    var spanUnits = Math.max(sxMax - sxMin, syMax - syMin) || 1;",
"",
"    // coarse samples, evenly spaced in shape units",
"    var nSample = opts.samples || 140;",
"    var coarse = resample(runs, shapeLen / nSample).map(function(s){ return s.p; });",
"",
"    // Candidate sizes come from the distance range the user asked for. How much",
"    // longer the route runs than the drawing depends entirely on the street mesh",
"    // — measured detours run anywhere from 1.05x on a fine grid to over 2x on a",
"    // coarse one — so span that whole interval rather than assuming a figure, and",
"    // let the measured length of the finished routes do the filtering.",
"    var DETOUR_LO = 1.05, DETOUR_HI = 2.3;",
"    var sLo = opts.minMeters / (shapeLen * DETOUR_HI);",
"    var sHi = opts.maxMeters / (shapeLen * DETOUR_LO);",
"    if (!(sHi > sLo)) sHi = sLo * 1.2;",
"    var sSteps = Math.max(5, (opts.scaleSteps | 0) + 2);",
"    var scales = [];",
"    for (var si = 0; si < sSteps; si++)",
"      scales.push(sLo * Math.pow(sHi / sLo, si / (sSteps - 1)));",
"",
"    var rots = opts.rotations;",
"    var step = opts.gridStep;",
"    var pad = 0;",
"    var xs = [], ys = [];",
"    for (var X = G.minX + pad; X <= G.maxX - pad; X += step) xs.push(X);",
"    for (var Y = G.minY + pad; Y <= G.maxY - pad; Y += step) ys.push(Y);",
"",
"    var bucketSize = Math.max(step * 2, 250);",
"    var buckets = new Map();",
"    var totalOuter = scales.length * rots.length;",
"    var done = 0;",
"",
"    for (var s2 = 0; s2 < scales.length; s2++){",
"      var S = scales[s2];",
"      // reject placements whose footprint cannot fit the loaded area",
"      for (var r2 = 0; r2 < rots.length; r2++){",
"        var th = rots[r2] * Math.PI / 180;",
"        var cosT = Math.cos(th), sinT = Math.sin(th);",
"        // pre-rotate the samples once",
"        var px = new Float64Array(coarse.length), py = new Float64Array(coarse.length);",
"        for (var c = 0; c < coarse.length; c++){",
"          var e2 = S * coarse[c][0], n2 = S * coarse[c][1];",
"          px[c] = e2 * cosT + n2 * sinT;",
"          py[c] = -e2 * sinT + n2 * cosT;",
"        }",
"        for (var xi = 0; xi < xs.length; xi++){",
"          for (var yi = 0; yi < ys.length; yi++){",
"            var cx = xs[xi], cy = ys[yi];",
"            var sum = 0, cnt = coarse.length, lim = cnt * 220;",
"            for (var c2 = 0; c2 < cnt; c2++){",
"              sum += sampleField(cx + px[c2], cy + py[c2]);",
"              if (sum > lim) { sum = Infinity; break; }",
"            }",
"            if (!isFinite(sum)) continue;",
"            var cost = sum / cnt;",
"            // Bucket per size as well as per position. The coarse cost is biased",
"            // towards smaller drawings, so bucketing on position alone threw away",
"            // every large candidate before it was ever routed and measured.",
"            var bk = s2 + ':' + ((cx / bucketSize) | 0) + ':' + ((cy / bucketSize) | 0);",
"            var cur = buckets.get(bk);",
"            if (!cur || cost < cur.cost)",
"              buckets.set(bk, { cost: cost, cx: cx, cy: cy, S: S, rot: rots[r2], si: s2 });",
"          }",
"        }",
"        done++;",
"        post({ type: 'progress', pct: 0.05 + 0.55 * (done / totalOuter), stage: 'Scanning placements' });",
"      }",
"    }",
"",
"    // Refine the best few of every size, so the honest routed score — not the",
"    // size-biased coarse proxy — decides which drawing size wins.",
"    var byScale = new Map();",
"    buckets.forEach(function(v){",
"      var arr = byScale.get(v.si);",
"      if (!arr) { arr = []; byScale.set(v.si, arr); }",
"      arr.push(v);",
"    });",
"    var perScale = Math.max(2, Math.ceil((opts.refine || 12) / Math.max(1, scales.length)));",
"    var cands = [];",
"    byScale.forEach(function(arr){",
"      arr.sort(function(a,b){ return a.cost - b.cost; });",
"      for (var ci2 = 0; ci2 < Math.min(perScale, arr.length); ci2++) cands.push(arr[ci2]);",
"    });",
"    if (!cands.length){ post({ type:'results', results: [], ms: Date.now()-t0 }); return; }",
"",
"    /* ---- refine each candidate by hill climbing on the same cheap cost ---- */",
"    function coarseCost(cx, cy, S, rotDeg){",
"      var th = rotDeg * Math.PI / 180, cosT = Math.cos(th), sinT = Math.sin(th);",
"      var sum = 0;",
"      for (var c = 0; c < coarse.length; c++){",
"        var p = place(coarse[c][0], coarse[c][1], S, cosT, sinT, cx, cy);",
"        sum += sampleField(p[0], p[1]);",
"      }",
"      return sum / coarse.length;",
"    }",
"",
"    for (var ci = 0; ci < cands.length; ci++){",
"      var cd = cands[ci];",
"      var dStep = step * 0.6, rStep = 4, kStep = 0.06;",
"      for (var iter = 0; iter < 26; iter++){",
"        var improved = false;",
"        var moves = [",
"          [dStep,0,0,0],[-dStep,0,0,0],[0,dStep,0,0],[0,-dStep,0,0],",
"          [0,0,rStep,0],[0,0,-rStep,0],[0,0,0,kStep],[0,0,0,-kStep]",
"        ];",
"        for (var mi = 0; mi < moves.length; mi++){",
"          var mv = moves[mi];",
"          var nS = cd.S * (1 + mv[3]);",
"          var nc = coarseCost(cd.cx + mv[0], cd.cy + mv[1], nS, cd.rot + mv[2]);",
"          if (nc < cd.cost - 1e-6){",
"            cd.cost = nc; cd.cx += mv[0]; cd.cy += mv[1]; cd.rot += mv[2]; cd.S = nS;",
"            improved = true;",
"          }",
"        }",
"        if (!improved){ dStep *= 0.55; rStep *= 0.55; kStep *= 0.55; }",
"        if (dStep < 3) break;",
"      }",
"      post({ type:'progress', pct: 0.6 + 0.15*(ci/cands.length), stage:'Refining placements' });",
"    }",
"",
"    /* ---- snap + route + honest score ---- */",
"    var results = [];",
"    var anchorSpacingShape = shapeLen / Math.max(8, opts.anchors || 26);",
"",
"    for (var k3 = 0; k3 < cands.length; k3++){",
"      var C = cands[k3];",
"      var th2 = C.rot * Math.PI / 180, cosT2 = Math.cos(th2), sinT2 = Math.sin(th2);",
"      var anchorsShape = resample(runs, anchorSpacingShape);",
"      var placedShape = [];",
"      var shapePoly = [];",
"      var runPolys = [];",
"      for (var rr2 = 0; rr2 < runs.length; rr2++){",
"        var rp = [];",
"        for (var pi = 0; pi < runs[rr2].length; pi++)",
"          rp.push(place(runs[rr2][pi][0], runs[rr2][pi][1], C.S, cosT2, sinT2, C.cx, C.cy));",
"        runPolys.push(rp);",
"      }",
"",
"      var anchorNodes = [], anchorMeta = [];",
"      for (var ai = 0; ai < anchorsShape.length; ai++){",
"        var A = anchorsShape[ai];",
"        var pm = place(A.p[0], A.p[1], C.S, cosT2, sinT2, C.cx, C.cy);",
"        placedShape.push(pm);",
"        var nd = snapAnchor(G.hash, pm[0], pm[1], opts.maxSnap || 220);",
"        if (nd < 0) continue;",
"        if (anchorNodes.length && anchorNodes[anchorNodes.length-1] === nd) continue;",
"        anchorNodes.push(nd);",
"        anchorMeta.push({ run: A.run, first: A.first });",
"      }",
"      if (anchorNodes.length < 3) continue;",
"",
"      var geom = [], routeLen = 0, failed = 0, connectorLen = 0;",
"      var segsMeta = [], anchorIdx = [0];",
"      for (var q = 1; q < anchorNodes.length; q++){",
"        var sp = shortestPath(anchorNodes[q-1], anchorNodes[q], 60000);",
"        var isConnector = anchorMeta[q].run !== anchorMeta[q-1].run;",
"        if (!sp){ failed++; continue; }",
"        routeLen += sp.dist;",
"        if (isConnector) connectorLen += sp.dist;",
"        for (var pp = (geom.length ? 1 : 0); pp < sp.path.length; pp++){",
"          var nid = sp.path[pp];",
"          geom.push([G.x[nid], G.y[nid]]);",
"          segsMeta.push(isConnector);",
"        }",
"        anchorIdx.push(geom.length - 1);",
"      }",
"      if (geom.length < 3) continue;",
"",
"      // how far each point of the route sits from the drawing. The mean alone",
"      // hides a bad tail, so keep the distribution and judge on p90 as well.",
"      var devs = new Float64Array(geom.length);",
"      var fid = 0;",
"      for (var g = 0; g < geom.length; g++){",
"        var bestd = Infinity;",
"        for (var rp2 = 0; rp2 < runPolys.length; rp2++){",
"          var dd = polyDist(geom[g][0], geom[g][1], runPolys[rp2]);",
"          if (dd < bestd) bestd = dd;",
"        }",
"        devs[g] = bestd; fid += bestd;",
"      }",
"      fid /= geom.length;",
"      var sortedDev = Array.prototype.slice.call(devs).sort(function(a,b){ return a - b; });",
"      var p90 = sortedDev[Math.floor(0.9 * (sortedDev.length - 1))];",
"",
"      // fraction of the run that isn't drawing the logo at all",
"      var span = C.S * spanUnits;",
"      var tol = Math.max(15, Math.min(120, span * 0.025));",
"      var strayLen = 0;",
"      for (var sg = 1; sg < geom.length; sg++){",
"        var segLen = Math.hypot(geom[sg][0] - geom[sg-1][0], geom[sg][1] - geom[sg-1][1]);",
"        if ((devs[sg] + devs[sg-1]) * 0.5 > tol) strayLen += segLen;",
"      }",
"      var strayFrac = routeLen > 0 ? strayLen / routeLen : 1;",
"",
"      // How fine is the street mesh here? On a grid the mean distance to the",
"      // nearest road is about a quarter of the block spacing. If the logo is",
"      // only a few blocks across, no placement can make it legible.",
"      var mf = 0, mfN = 0;",
"      for (var bx = -5; bx <= 5; bx++){",
"        for (var by = -5; by <= 5; by++){",
"          mf += sampleField(C.cx + (bx / 10) * span, C.cy + (by / 10) * span); mfN++;",
"        }",
"      }",
"      var spacing = mfN ? (mf / mfN) * 4 : 0;",
"      var detail = spacing > 0 ? span / spacing : 0;",
"",
"      // coverage: how much of the drawing the route actually traces",
"      var cov = 0;",
"      for (var cs = 0; cs < placedShape.length; cs++)",
"        cov += polyDist(placedShape[cs][0], placedShape[cs][1], geom);",
"      cov /= Math.max(1, placedShape.length);",
"",
"      var idealLen = shapeLen * C.S;",
"      var lengthRatio = routeLen / Math.max(1, idealLen);",
"      // Errors as a fraction of the logo's own size, so a 40 m wobble counts as",
"      // disastrous on a 700 m logo and trivial on a 5 km one.",
"      var relErr = span > 0 ? (cov + fid * 0.6 + p90 * 0.8) / span : 1;",
"      var score = relErr * 1000",
"                + strayFrac * 500",
"                + Math.max(0, lengthRatio - 1.15) * 300",
"                + failed * 60",
"                + (connectorLen / Math.max(1, routeLen)) * 250;",
"",
"      var P2 = G.P;",
"      function toLL(p){ return [P2.lat0 + p[1] / P2.mPerLat, P2.lon0 + p[0] / P2.mPerLon]; }",
"",
"      results.push({",
"        score: score, coverage: cov, fidelity: fid, lengthRatio: lengthRatio,",
"        p90: p90, spanMeters: span, strayFraction: strayFrac,",
"        detail: detail, spacing: spacing,",
"        inRange: routeLen >= opts.minMeters && routeLen <= opts.maxMeters,",
"        lengthMeters: routeLen, connectorMeters: connectorLen, failedSegments: failed,",
"        rotation: ((C.rot % 360) + 540) % 360 - 180,",
"        widthMeters: C.S,",
"        center: toLL([C.cx, C.cy]),",
"        geometry: geom.map(toLL),",
"        connectorFlags: segsMeta,",
"        anchors: anchorNodes.map(function(nd2){ return toLL([G.x[nd2], G.y[nd2]]); }),",
"        anchorIndices: failed === 0 ? anchorIdx : null",
"      });",
"      post({ type:'progress', pct: 0.75 + 0.25*(k3/cands.length), stage:'Routing candidates' });",
"    }",
"",
"    // routes inside the requested range first, best-fitting shape within that",
"    results.sort(function(a,b){",
"      if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;",
"      return a.score - b.score;",
"    });",
"    post({ type:'results', results: results.slice(0, 8), ms: Date.now() - t0, shapeLen: shapeLen,",
"           diag: { candidates: cands.length, buckets: buckets.size, scales: scales.length,",
"                   rotations: rots.length, grid: xs.length + 'x' + ys.length,",
"                   bestCoarse: cands.length ? Math.round(cands[0].cost) : null,",
"                   sizeRange: [Math.round(sLo), Math.round(sHi)] } });",
"    return;",
"  }",
"};"
  ].join("\n");

  var blobUrl = null;
  function workerUrl() {
    if (!blobUrl) blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: "application/javascript" }));
    return blobUrl;
  }

  /* -------------------------------------------------------- OSM plumbing */

  /* Surfaces the user can mix and match. Everything is fetched in one go and
     filtered locally, so changing the mix costs nothing and never re-queries
     Overpass — which matters, because it rate-limits hard. */
  var CATEGORIES = [
    { key: "mainRoads",   label: "Main roads",  hint: "primary, secondary, tertiary",
      tags: ["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"] },
    { key: "residential", label: "Residential", hint: "neighbourhood streets",
      tags: ["residential", "living_street", "unclassified"] },
    { key: "service",     label: "Alleys",      hint: "service roads, parking aisles",
      tags: ["service"] },
    { key: "footpaths",   label: "Footpaths",   hint: "sidewalks, plazas",
      tags: ["footway", "pedestrian"] },
    { key: "trails",      label: "Trails",      hint: "dirt paths, tracks",
      tags: ["path", "track", "bridleway"] },
    { key: "cycleways",   label: "Bike paths",  hint: "dedicated cycleways",
      tags: ["cycleway"] }
  ];

  var PRESETS = {
    walkable: ["residential", "footpaths", "trails", "cycleways", "service"],
    roads:    ["mainRoads", "residential", "service"],
    quiet:    ["residential", "footpaths", "cycleways"],
    all:      CATEGORIES.map(function (c) { return c.key; })
  };

  var TAG_TO_CAT = {};
  CATEGORIES.forEach(function (c, i) {
    c.tags.forEach(function (t) { TAG_TO_CAT[t] = i; });
  });
  var UNION_RE = CATEGORIES.reduce(function (acc, c) { return acc.concat(c.tags); }, []).join("|");

  /* Full-planet Overpass instances only. Region-limited mirrors (overpass.osm.ch,
     for one) answer 200 with an empty result outside their coverage, which looks
     exactly like "there are no streets here" — worse than an outright failure. */
  /* Full-planet instances that answer a browser. Two deliberate exclusions:
     overpass.osm.ch is Switzerland-only and returns 200 with an empty result
     elsewhere, which reads as "no streets here"; kumi.systems and private.coffee
     serve their error pages WITHOUT CORS headers, so from a browser they can
     only ever fail — and each attempt costs a red console error and a wait. */
  var ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ];

  var chosenEndpoint = null;      // a server known to be answering, this session

  function postOverpass(url, body, timeoutMs) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (err) {
      clearTimeout(timer);
      throw new Error(err && err.name === "AbortError" ? "timed out" : (err.message || "network error"));
    });
  }

  /* Ask every instance for a couple of ways near the middle of the search box and
     take the first that actually answers with data. One rate-limited or wedged
     server then costs nothing instead of stalling the whole download — and a
     mirror that lacks this part of the world is ruled out at the same time. */
  function pickEndpoint(bounds, onNote) {
    if (chosenEndpoint) return Promise.resolve(chosenEndpoint);
    var lat = (bounds.getSouth() + bounds.getNorth()) / 2;
    var lon = (bounds.getWest() + bounds.getEast()) / 2;
    var d = 0.02;
    var q = "[out:json][timeout:20];way[\"highway\"](" +
            (lat - d).toFixed(4) + "," + (lon - d).toFixed(4) + "," +
            (lat + d).toFixed(4) + "," + (lon + d).toFixed(4) + ");out ids qt 3;";
    var body = "data=" + encodeURIComponent(q);
    if (onNote) onNote("Finding a server that's answering…");

    return new Promise(function (resolve) {
      var pending = ENDPOINTS.length, settled = false;
      function lose() { if (--pending === 0 && !settled) { settled = true; resolve(null); } }
      ENDPOINTS.forEach(function (url) {
        postOverpass(url, body, 12000).then(function (j) {
          if (settled) return;
          if (j && j.elements && j.elements.length) { settled = true; chosenEndpoint = url; resolve(url); }
          else lose();
        }, lose);
      });
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* --------------------------------------------------------- area maths */

  function areaKm2(b) {
    var latMid = (b.getSouth() + b.getNorth()) / 2;
    var w = (b.getEast() - b.getWest()) * 111.32 * Math.cos(latMid * Math.PI / 180);
    var h = (b.getNorth() - b.getSouth()) * 110.574;
    return Math.abs(w * h);
  }

  /* Overpass copes with far more per request than it has spare slots per minute,
     so the win is fewer, larger requests. One 84 km² untagged query measured
     16.6 MB in 6 seconds; the same area split into tiles spent minutes queueing.
     Tagged queries carry ~3x the bytes per km², so they get smaller tiles. */
  /* Big single requests are efficient against a healthy server and a bad bet
     against a loaded one — a ~17 MB ask is where the free mirrors start timing
     out. Keep each request modest enough to land first time. */
  /* Sized so the first attempt lands even on the slower mirror, whose gateway
     gives up around 30s of work: measured there, 20 km² narrow returns 4.3 MB in
     3s while 40 km² times out. The main instance is far quicker; anything that
     does fail gets halved and retried. */
  var TILE_KM2_TAGGED = 20;
  var TILE_KM2_NARROW = 30;
  var MAX_KM2 = 160;

  function tileSizeFor(cats) { return (cats && cats.length) ? TILE_KM2_NARROW : TILE_KM2_TAGGED; }

  function rectKm2(t) {
    var latMid = (t.south + t.north) / 2;
    return Math.abs((t.east - t.west) * 111.32 * Math.cos(latMid * Math.PI / 180) *
                    (t.north - t.south) * 110.574);
  }

  /* Halve a tile along its longer side. */
  function halveTile(t) {
    var latMid = (t.south + t.north) / 2;
    var wKm = (t.east - t.west) * 111.32 * Math.cos(latMid * Math.PI / 180);
    var hKm = (t.north - t.south) * 110.574;
    if (wKm >= hKm) {
      var midLon = (t.west + t.east) / 2;
      return [{ south: t.south, north: t.north, west: t.west, east: midLon },
              { south: t.south, north: t.north, west: midLon, east: t.east }];
    }
    var midLat = (t.south + t.north) / 2;
    return [{ south: t.south, north: midLat, west: t.west, east: t.east },
            { south: midLat, north: t.north, west: t.west, east: t.east }];
  }

  /* One Overpass request can't return a large region, so cut it into tiles that
     each come back comfortably and stitch the results together. */
  function splitBounds(b, maxKm2) {
    var latMid = (b.getSouth() + b.getNorth()) / 2;
    var wKm = (b.getEast() - b.getWest()) * 111.32 * Math.cos(latMid * Math.PI / 180);
    var hKm = (b.getNorth() - b.getSouth()) * 110.574;
    var need = Math.max(1, Math.ceil((wKm * hKm) / maxKm2));
    var nx = Math.max(1, Math.round(Math.sqrt(need * (wKm / Math.max(0.001, hKm)))));
    var ny = Math.max(1, Math.ceil(need / nx));
    var dLat = (b.getNorth() - b.getSouth()) / ny;
    var dLon = (b.getEast() - b.getWest()) / nx;
    var out = [];
    for (var iy = 0; iy < ny; iy++) {
      for (var ix = 0; ix < nx; ix++) {
        out.push({
          south: b.getSouth() + iy * dLat, north: b.getSouth() + (iy + 1) * dLat,
          west: b.getWest() + ix * dLon,  east: b.getWest() + (ix + 1) * dLon
        });
      }
    }
    return out;
  }

  /* The public Overpass servers shed load with 429/504 all the time. Retry with
     backoff, then fall through to the mirrors before giving up. */
  /* Only the selected surfaces, when the caller asks for it. Way tags cost ~40%
     extra, which is worth paying on a small area to make the surface toggles free,
     but not worth it when hauling down a large region. */
  function queryFor(tile, cats) {
    var re = UNION_RE, tags = "out body qt;>;out skel qt;";
    if (cats && cats.length) {
      var list = [];
      CATEGORIES.forEach(function (c) {
        if (cats.indexOf(c.key) >= 0) list = list.concat(c.tags);
      });
      if (list.length) { re = list.join("|"); tags = "(._;>;);out skel qt;"; }
    }
    return "[out:json][timeout:120];way[\"highway\"~\"^(" + re + ")$\"][\"area\"!~\"yes\"]" +
           "(" + tile.south.toFixed(5) + "," + tile.west.toFixed(5) + "," +
           tile.north.toFixed(5) + "," + tile.east.toFixed(5) + ");" + tags;
  }

  var rotate = 0;

  function fetchTile(body, onNote, label) {

    // Overpass allots a couple of query slots per client and answers 504 once
    // they're spent, so hammering one server just burns its next slot. Lead with
    // whichever instance answered the probe, then try the others, then wait.
    var ordered = ENDPOINTS.slice();
    if (chosenEndpoint) {
      ordered = [chosenEndpoint].concat(ordered.filter(function (u) { return u !== chosenEndpoint; }));
    }
    // Rotate which server leads each tile: slots are per client per server, so
    // sending every tile to the same one is the fastest way to get throttled.
    var lead = rotate % ordered.length;
    var attempts = [];
    for (var k = 0; k < ordered.length; k++) {
      attempts.push({ url: ordered[(lead + k) % ordered.length], wait: k ? 800 : 0 });
    }
    attempts.push({ url: ordered[lead], wait: 15000 });
    attempts.push({ url: ordered[(lead + 1) % ordered.length], wait: 30000 });

    var lastErr = "unknown error";

    function attempt(i) {
      if (i >= attempts.length) {
        throw new Error(lastErr + " — every Overpass mirror is busy or rate-limiting. " +
                        "Wait a minute and try again, or shrink the search area.");
      }
      var a = attempts[i];
      var host = a.url.split("/")[2];
      if (onNote) {
        onNote(label + (a.wait > 2000
          ? "servers busy, waiting " + Math.round(a.wait / 1000) + "s…"
          : "asking " + host + (i ? " (try " + (i + 1) + ")" : "") + "…"));
      }
      return sleep(a.wait)
        .then(function () { return postOverpass(a.url, body, 90000); })
        .then(function (j) {
          chosenEndpoint = a.url;          // remember what worked
          return j;
        })
        .catch(function (err) {
          lastErr = err.message;
          return attempt(i + 1);
        });
    }
    return Promise.resolve().then(function () { return attempt(0); });
  }

  function fetchNetwork(bounds, onNote, cats) {
    var tiles = splitBounds(bounds, tileSizeFor(cats));
    var acc = newAccumulator();
    var i = 0;

    /* Servers differ in how much they'll chew through before their gateway gives
       up — the main instance answers 84 km² in seconds where a mirror times out.
       Rather than guess a size that suits the slowest, ask for a sensible one and
       halve anything that fails, which tunes itself to whoever is answering. */
    function runTile(t, label, depth) {
      var body = "data=" + encodeURIComponent(queryFor(t, cats));
      return fetchTile(body, onNote, label).then(function (json) {
        accumulate(acc, json);
      }, function (err) {
        if (depth >= 3 || rectKm2(t) < 5) throw err;
        var halves = halveTile(t);
        if (onNote) onNote(label + "too big for the server — splitting it…");
        return runTile(halves[0], label, depth + 1)
          .then(function () { return runTile(halves[1], label, depth + 1); });
      });
    }

    function next() {
      if (i >= tiles.length) return Promise.resolve(finishAccumulator(acc, cats));
      var t = tiles[i++];
      rotate = i - 1;
      var label = tiles.length > 1 ? "Area " + i + " of " + tiles.length + " — " : "";
      return runTile(t, label, 0).then(next);
    }
    return pickEndpoint(bounds, onNote).then(next);
  }

  /* Parse the Overpass payload once into node coords plus ways tagged by
     category. Selecting a different surface mix is then a local re-index. */
  function newAccumulator() {
    return { lat: [], lon: [], byId: new Map(), ways: [], wayIds: new Set(),
             counts: new Array(CATEGORIES.length).fill(0) };
  }

  /* Tiles overlap at their shared edges and repeat the ways that straddle them,
     so both nodes and ways are keyed on their OSM id. */
  function accumulate(acc, osm) {
    var els = osm.elements || [];
    var i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== "node" || acc.byId.has(el.id)) continue;
      acc.byId.set(el.id, acc.lat.length);
      acc.lat.push(el.lat); acc.lon.push(el.lon);
    }
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== "way" || !el.nodes || acc.wayIds.has(el.id)) continue;
      var cat;
      if (el.tags && el.tags.highway !== undefined) {
        cat = TAG_TO_CAT[el.tags.highway];
      } else {
        cat = 0;                       // skel responses carry no tags to sort by
      }
      if (cat === undefined) continue;
      var refs = [];
      for (var k = 0; k < el.nodes.length; k++) {
        var ix = acc.byId.get(el.nodes[k]);
        if (ix !== undefined) refs.push(ix);
      }
      if (refs.length < 2) continue;
      acc.wayIds.add(el.id);
      acc.ways.push({ cat: cat, n: refs });
      acc.counts[cat]++;
    }
  }

  function finishAccumulator(acc, cats) {
    return {
      lat: Float64Array.from(acc.lat), lon: Float64Array.from(acc.lon),
      ways: acc.ways, counts: acc.counts, nodeCount: acc.lat.length,
      // when the fetch was narrowed, the payload has no tags and can't be re-filtered
      fixedCats: cats && cats.length ? cats.slice().sort() : null
    };
  }

  /* Open ground you can actually run across. Cemeteries are deliberately absent;
     golf courses are included but usually private, which is why every result
     names the place it found so you can judge it. */
  var OPEN_LEISURE = "park|pitch|golf_course|recreation_ground|common|garden|sports_centre|track|dog_park";
  var OPEN_LANDUSE = "grass|recreation_ground|meadow|village_green|greenfield";

  function openSpaceQuery(tile) {
    var bb = tile.south.toFixed(5) + "," + tile.west.toFixed(5) + "," +
             tile.north.toFixed(5) + "," + tile.east.toFixed(5);
    return "[out:json][timeout:120];(" +
      "way[\"leisure\"~\"^(" + OPEN_LEISURE + ")$\"](" + bb + ");" +
      "way[\"landuse\"~\"^(" + OPEN_LANDUSE + ")$\"](" + bb + ");" +
      ");out geom qt;";
  }

  function fetchOpenSpace(bounds, onNote, minAreaM2) {
    var tiles = splitBounds(bounds, 60);
    var polys = [];
    var i = 0;

    function absorb(json) {
      var els = (json && json.elements) || [];
      for (var k = 0; k < els.length; k++) {
        var el = els[k];
        if (!el.geometry || el.geometry.length < 4) continue;
        var pts = el.geometry.map(function (g) { return [g.lat, g.lon]; });
        var t = el.tags || {};
        polys.push({
          id: el.id,
          name: t.name || "",
          kind: t.leisure || t.landuse || "open ground",
          pts: pts
        });
      }
    }

    function next() {
      if (i >= tiles.length) {
        var seenIds = {};
        var out = polys.filter(function (p2) {
          if (seenIds[p2.id]) return false;
          seenIds[p2.id] = 1;
          return polygonAreaM2(p2.pts) >= (minAreaM2 || 0);
        });
        out.sort(function (a, b) { return polygonAreaM2(b.pts) - polygonAreaM2(a.pts); });
        return Promise.resolve(out);
      }
      var t = tiles[i++];
      rotate = i - 1;
      var label = tiles.length > 1 ? "Area " + i + " of " + tiles.length + " — " : "";
      var body = "data=" + encodeURIComponent(openSpaceQuery(t));
      return fetchTile(body, onNote, label).then(function (json) {
        absorb(json);
        return next();
      });
    }
    return pickEndpoint(bounds, onNote).then(next);
  }

  function polygonAreaM2(pts) {
    if (pts.length < 3) return 0;
    var lat0 = 0, i;
    for (i = 0; i < pts.length; i++) lat0 += pts[i][0];
    lat0 /= pts.length;
    var mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110574;
    var s2 = 0;
    for (i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s2 += (a[1] * mx) * (b[0] * my) - (b[1] * mx) * (a[0] * my);
    }
    return Math.abs(s2) / 2;
  }

  function parseNetwork(osm) {
    var els = osm.elements || [];
    var lat = [], lon = [], byId = new Map();
    var i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== "node") continue;
      byId.set(el.id, lat.length);
      lat.push(el.lat); lon.push(el.lon);
    }
    var ways = [], counts = new Array(CATEGORIES.length).fill(0);
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== "way" || !el.nodes || !el.tags) continue;
      var cat = TAG_TO_CAT[el.tags.highway];
      if (cat === undefined) continue;
      var refs = [];
      for (var k = 0; k < el.nodes.length; k++) {
        var ix = byId.get(el.nodes[k]);
        if (ix !== undefined) refs.push(ix);
      }
      if (refs.length < 2) continue;
      ways.push({ cat: cat, n: refs });
      counts[cat]++;
    }
    return {
      lat: Float64Array.from(lat), lon: Float64Array.from(lon),
      ways: ways, counts: counts, nodeCount: lat.length
    };
  }

  /* Build a routable graph from the parsed network, keeping only the selected
     surfaces and re-indexing so no orphan nodes survive to be snapped to. */
  function graphFor(raw, selectedKeys) {
    var allow = new Array(CATEGORIES.length).fill(false);
    if (raw.fixedCats) {
      allow.fill(true);            // payload already contains only what was asked for
    } else {
      selectedKeys.forEach(function (key) {
        CATEGORIES.forEach(function (c, i) { if (c.key === key) allow[i] = true; });
      });
    }

    var remap = new Int32Array(raw.nodeCount).fill(-1);
    var lat = [], lon = [], ea = [], eb = [];
    function idx(i) {
      if (remap[i] < 0) { remap[i] = lat.length; lat.push(raw.lat[i]); lon.push(raw.lon[i]); }
      return remap[i];
    }
    for (var w = 0; w < raw.ways.length; w++) {
      var way = raw.ways[w];
      if (!allow[way.cat]) continue;
      for (var k = 1; k < way.n.length; k++) {
        var a = idx(way.n[k - 1]), b = idx(way.n[k]);
        if (a === b) continue;
        ea.push(a); eb.push(b);
      }
    }
    return {
      lat: Float64Array.from(lat), lon: Float64Array.from(lon),
      ea: Int32Array.from(ea), eb: Int32Array.from(eb)
    };
  }

  /* ---------------------------------------------------------------- api */

  function Matcher() {
    this.worker = null;
    this.ready = false;
    this.info = null;
  }

  Matcher.prototype._spawn = function () {
    if (this.worker) this.worker.terminate();
    this.worker = new Worker(workerUrl());
    return this.worker;
  };

  Matcher.prototype.loadGraph = function (graph, lat0, lon0, onProgress) {
    var self_ = this;
    var w = this._spawn();
    this.ready = false;
    return new Promise(function (resolve, reject) {
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === "progress" && onProgress) onProgress(m);
        if (m.type === "graphReady") { self_.ready = true; self_.info = m; resolve(m); }
        if (m.type === "error") reject(new Error(m.message));
      };
      w.onerror = function (e) { reject(new Error(e.message || "worker failed")); };
      w.postMessage({
        cmd: "setGraph", lat0: lat0, lon0: lon0,
        lat: graph.lat, lon: graph.lon, ea: graph.ea, eb: graph.eb
      });
    });
  };

  Matcher.prototype.loadPolys = function (polys, lat0, lon0, onProgress) {
    var self_ = this;
    var w = this._spawn();
    this.ready = false;
    return new Promise(function (resolve, reject) {
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === "progress" && onProgress) onProgress(m);
        if (m.type === "polysReady") { self_.ready = true; self_.info = m; resolve(m); }
        if (m.type === "error") reject(new Error(m.message));
      };
      w.onerror = function (e) { reject(new Error(e.message || "worker failed")); };
      w.postMessage({ cmd: "setPolys", lat0: lat0, lon0: lon0, polys: polys });
    });
  };

  Matcher.prototype.searchOpen = function (runs, opts, onProgress) {
    var w = this.worker;
    if (!w || !this.ready) return Promise.reject(new Error("Load the open ground first."));
    return new Promise(function (resolve, reject) {
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === "progress" && onProgress) onProgress(m);
        if (m.type === "results") resolve(m);
        if (m.type === "error") reject(new Error(m.message));
      };
      w.postMessage({ cmd: "searchOpen", runs: runs, opts: opts });
    });
  };

  Matcher.prototype.search = function (runs, opts, onProgress) {
    var w = this.worker;
    if (!w || !this.ready) return Promise.reject(new Error("Load a road network first."));
    return new Promise(function (resolve, reject) {
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === "progress" && onProgress) onProgress(m);
        if (m.type === "results") resolve(m);
        if (m.type === "error") reject(new Error(m.message));
      };
      w.postMessage({ cmd: "search", runs: runs, opts: opts });
    });
  };

  global.Matcher = {
    __workerSrc: WORKER_SRC,
    create: function () { return new Matcher(); },
    fetchNetwork: fetchNetwork,
    fetchOpenSpace: fetchOpenSpace,
    polygonAreaM2: polygonAreaM2,
    graphFor: graphFor,
    areaKm2: areaKm2,
    tileCount: function (b, cats) { return splitBounds(b, tileSizeFor(cats)).length; },
    MAX_KM2: MAX_KM2,
    NARROW_ABOVE_KM2: 30,
    endpoints: ENDPOINTS,
    resetEndpoint: function () { chosenEndpoint = null; },
    CATEGORIES: CATEGORIES,
    PRESETS: PRESETS
  };
})(window);
