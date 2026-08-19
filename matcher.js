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
"function nearestNode(H, x, y, maxDist){",
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
"    var P = projSetup(m.lat0, m.lon0);",
"    var n = m.lat.length;",
"    var x = new Float64Array(n), y = new Float64Array(n);",
"    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;",
"    for (var i = 0; i < n; i++){",
"      x[i] = (m.lon[i] - P.lon0) * P.mPerLon;",
"      y[i] = (m.lat[i] - P.lat0) * P.mPerLat;",
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
"          minX: minX, minY: minY, maxX: maxX, maxY: maxY, P: P };",
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
"    // coarse samples, evenly spaced in shape units",
"    var nSample = opts.samples || 140;",
"    var coarse = resample(runs, shapeLen / nSample).map(function(s){ return s.p; });",
"",
"    // candidate scales from the target distance",
"    var detour = 1.22;",
"    var S0 = opts.targetMeters / (shapeLen * detour);",
"    var scales = [];",
"    var sMin = opts.scaleMin, sMax = opts.scaleMax, sSteps = opts.scaleSteps;",
"    for (var si = 0; si < sSteps; si++)",
"      scales.push(S0 * (sMin + (sMax - sMin) * (sSteps === 1 ? 0.5 : si/(sSteps-1))));",
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
"            var bk = ((cx / bucketSize) | 0) + ':' + ((cy / bucketSize) | 0);",
"            var cur = buckets.get(bk);",
"            if (!cur || cost < cur.cost)",
"              buckets.set(bk, { cost: cost, cx: cx, cy: cy, S: S, rot: rots[r2] });",
"          }",
"        }",
"        done++;",
"        post({ type: 'progress', pct: 0.05 + 0.55 * (done / totalOuter), stage: 'Scanning placements' });",
"      }",
"    }",
"",
"    var cands = Array.from(buckets.values()).sort(function(a,b){ return a.cost - b.cost; })",
"                 .slice(0, opts.refine || 12);",
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
"        var nd = nearestNode(G.hash, pm[0], pm[1], opts.maxSnap || 220);",
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
"      // fidelity: how far the route strays from the drawing",
"      var fid = 0;",
"      for (var g = 0; g < geom.length; g++){",
"        var bestd = Infinity;",
"        for (var rp2 = 0; rp2 < runPolys.length; rp2++){",
"          var dd = polyDist(geom[g][0], geom[g][1], runPolys[rp2]);",
"          if (dd < bestd) bestd = dd;",
"        }",
"        fid += bestd;",
"      }",
"      fid /= geom.length;",
"",
"      // coverage: how much of the drawing the route actually traces",
"      var cov = 0;",
"      for (var cs = 0; cs < placedShape.length; cs++)",
"        cov += polyDist(placedShape[cs][0], placedShape[cs][1], geom);",
"      cov /= Math.max(1, placedShape.length);",
"",
"      var idealLen = shapeLen * C.S;",
"      var lengthRatio = routeLen / Math.max(1, idealLen);",
"      var score = cov * 1.0 + fid * 0.6",
"                + Math.max(0, lengthRatio - 1.2) * 400",
"                + failed * 60",
"                + (connectorLen / Math.max(1, routeLen)) * 250;",
"",
"      var P2 = G.P;",
"      function toLL(p){ return [P2.lat0 + p[1] / P2.mPerLat, P2.lon0 + p[0] / P2.mPerLon]; }",
"",
"      results.push({",
"        score: score, coverage: cov, fidelity: fid, lengthRatio: lengthRatio,",
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
"    results.sort(function(a,b){ return a.score - b.score; });",
"    post({ type:'results', results: results.slice(0, 6), ms: Date.now() - t0, shapeLen: shapeLen,",
"           diag: { candidates: cands.length, buckets: buckets.size, scales: scales.length,",
"                   rotations: rots.length, grid: xs.length + 'x' + ys.length,",
"                   bestCoarse: cands.length ? Math.round(cands[0].cost) : null,",
"                   scaleMetres: Math.round(S0) } });",
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

  var HIGHWAY_SETS = {
    foot: "residential|living_street|unclassified|tertiary|tertiary_link|secondary|secondary_link|service|footway|path|cycleway|pedestrian|track|steps|primary|primary_link",
    road: "residential|living_street|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|service",
    quiet: "residential|living_street|unclassified|footway|path|cycleway|pedestrian|track"
  };

  var ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* The public Overpass servers shed load with 429/504 all the time. Retry with
     backoff, then fall through to the mirrors before giving up. */
  function fetchNetwork(bounds, kind, onNote) {
    var s = bounds.getSouth().toFixed(5), w = bounds.getWest().toFixed(5),
        n = bounds.getNorth().toFixed(5), e = bounds.getEast().toFixed(5);
    var re = HIGHWAY_SETS[kind] || HIGHWAY_SETS.foot;
    var q = "[out:json][timeout:90];way[\"highway\"~\"^(" + re + ")$\"][\"area\"!~\"yes\"]" +
            "(" + s + "," + w + "," + n + "," + e + ");(._;>;);out skel qt;";
    var body = "data=" + encodeURIComponent(q);

    // Overpass allots a couple of query slots per client and answers 504 once
    // they're spent, so hammering it just burns the next slot too. Back off hard.
    var attempts = [
      { url: ENDPOINTS[0], wait: 0 },
      { url: ENDPOINTS[1], wait: 1000 },
      { url: ENDPOINTS[0], wait: 15000 },
      { url: ENDPOINTS[2], wait: 1000 },
      { url: ENDPOINTS[0], wait: 35000 }
    ];

    var lastErr = "unknown error";

    function attempt(i) {
      if (i >= attempts.length) {
        throw new Error(lastErr + " — every Overpass mirror is busy or rate-limiting. " +
                        "Wait a minute and try again, or shrink the view.");
      }
      var a = attempts[i];
      var host = a.url.split("/")[2];
      if (onNote) {
        onNote(a.wait > 2000
          ? "Servers are busy — waiting " + Math.round(a.wait / 1000) + "s before retrying " + host + "…"
          : "Asking " + host + (i ? " (attempt " + (i + 1) + ")" : "") + "…");
      }
      return sleep(a.wait)
        .then(function () {
          return fetch(a.url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body
          });
        })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) { return buildGraphArrays(j); })
        .catch(function (err) {
          lastErr = err.message;
          return attempt(i + 1);
        });
    }
    return Promise.resolve().then(function () { return attempt(0); });
  }

  function buildGraphArrays(osm) {
    var els = osm.elements || [];
    var latById = new Map(), lonById = new Map();
    var i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type === "node") { latById.set(el.id, el.lat); lonById.set(el.id, el.lon); }
    }
    var index = new Map();
    var lat = [], lon = [], ea = [], eb = [];
    function idx(id) {
      var v = index.get(id);
      if (v !== undefined) return v;
      if (!latById.has(id)) return -1;
      v = lat.length;
      index.set(id, v);
      lat.push(latById.get(id)); lon.push(lonById.get(id));
      return v;
    }
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== "way" || !el.nodes) continue;
      for (var k = 1; k < el.nodes.length; k++) {
        var a = idx(el.nodes[k - 1]), b = idx(el.nodes[k]);
        if (a < 0 || b < 0 || a === b) continue;
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
    endpoints: ENDPOINTS,
    HIGHWAY_SETS: HIGHWAY_SETS
  };
})(window);
