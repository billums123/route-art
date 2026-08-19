/* skeleton.js — logo image -> 1px centerline -> ordered polylines.
   Exposes window.Skeleton. No dependencies. */
(function (global) {
  "use strict";

  var MAX_DIM = 420;   // thinning resolution; plenty for a logo, keeps it fast

  /* ------------------------------------------------------------ rasterise */

  function toMask(img, opts) {
    var scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(8, Math.round(img.naturalWidth * scale));
    var h = Math.max(8, Math.round(img.naturalHeight * scale));

    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;

    // Pad by 1px so the thinning kernel never needs bounds checks.
    var pw = w + 2, ph = h + 2;
    var mask = new Uint8Array(pw * ph);
    var lum = new Float32Array(w * h);
    var alpha = new Uint8Array(w * h);
    var i, x, y, o;

    var anyTransparent = false;
    for (i = 0; i < w * h; i++) {
      o = i * 4;
      alpha[i] = data[o + 3];
      if (data[o + 3] < 250) anyTransparent = true;
      lum[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    }

    var thr = opts.threshold;          // 0..1
    var invert = opts.invert;

    function isInk(i) {
      if (anyTransparent && alpha[i] < 100) return false;
      var l = lum[i];
      return invert ? (l > thr) : (l < thr);
    }

    var ink = 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (isInk(i)) { mask[(y + 1) * pw + (x + 1)] = 1; ink++; }
      }
    }

    return { mask: mask, w: pw, h: ph, srcW: w, srcH: h, inkRatio: ink / (w * h), hasAlpha: anyTransparent };
  }

  /* Guess whether the artwork is light-on-dark, so the default "just works". */
  function autoInvert(img) {
    var scale = Math.min(1, 64 / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(4, Math.round(img.naturalWidth * scale));
    var h = Math.max(4, Math.round(img.naturalHeight * scale));
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    var darkOpaque = 0, opaque = 0;
    for (var i = 0; i < w * h; i++) {
      if (d[i * 4 + 3] < 100) continue;
      opaque++;
      var l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      if (l < 0.5) darkOpaque++;
    }
    if (!opaque) return false;
    // If most of the opaque artwork is bright, the strokes are probably the bright part.
    return (darkOpaque / opaque) < 0.35;
  }

  /* --------------------------------------------------------- despeckling */

  function removeSmallBlobs(mask, w, h, minPixels) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var offs = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
    var comp = [];
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || seen[s]) continue;
      var top = 0, n = 0;
      stack[top++] = s; seen[s] = 1;
      comp.length = 0;
      while (top) {
        var p = stack[--top];
        comp.push(p); n++;
        for (var k = 0; k < 8; k++) {
          var q = p + offs[k];
          if (q < 0 || q >= w * h || !mask[q] || seen[q]) continue;
          seen[q] = 1; stack[top++] = q;
        }
      }
      if (n < minPixels) for (var c = 0; c < comp.length; c++) mask[comp[c]] = 0;
    }
  }

  /* ------------------------------------------------ Zhang-Suen thinning */

  function thin(mask, w, h) {
    var changed = true, guard = 0;
    var toRemove = [];
    while (changed && guard++ < 200) {
      changed = false;
      for (var step = 0; step < 2; step++) {
        toRemove.length = 0;
        for (var y = 1; y < h - 1; y++) {
          var row = y * w;
          for (var x = 1; x < w - 1; x++) {
            var i = row + x;
            if (!mask[i]) continue;
            var p2 = mask[i - w], p3 = mask[i - w + 1], p4 = mask[i + 1], p5 = mask[i + w + 1],
                p6 = mask[i + w], p7 = mask[i + w - 1], p8 = mask[i - 1], p9 = mask[i - w - 1];
            var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            var A = 0;
            if (p2 === 0 && p3 === 1) A++;
            if (p3 === 0 && p4 === 1) A++;
            if (p4 === 0 && p5 === 1) A++;
            if (p5 === 0 && p6 === 1) A++;
            if (p6 === 0 && p7 === 1) A++;
            if (p7 === 0 && p8 === 1) A++;
            if (p8 === 0 && p9 === 1) A++;
            if (p9 === 0 && p2 === 1) A++;
            if (A !== 1) continue;
            if (step === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }
            toRemove.push(i);
          }
        }
        if (toRemove.length) {
          changed = true;
          for (var r = 0; r < toRemove.length; r++) mask[toRemove[r]] = 0;
        }
      }
    }
  }

  /* ------------------------------------------------------------- tracing */

  /* An 8-connected skeleton links a pixel to a diagonal neighbour even when an
     orthogonal pixel already joins the two. Counting those redundant links makes
     every staircase corner look like a junction and shatters diagonal strokes,
     so drop a diagonal whenever the corresponding orthogonal link exists. */
  function neighbours(mask, w, i, out) {
    var n = 0;
    var up = i - w, dn = i + w, lf = i - 1, rt = i + 1;
    var u = mask[up], d = mask[dn], l = mask[lf], r = mask[rt];
    if (u) out[n++] = up;
    if (d) out[n++] = dn;
    if (l) out[n++] = lf;
    if (r) out[n++] = rt;
    if (mask[up - 1] && !u && !l) out[n++] = up - 1;
    if (mask[up + 1] && !u && !r) out[n++] = up + 1;
    if (mask[dn - 1] && !d && !l) out[n++] = dn - 1;
    if (mask[dn + 1] && !d && !r) out[n++] = dn + 1;
    return n;
  }

  function trace(mask, w, h) {
    var deg = new Uint8Array(w * h);
    var nbuf = new Int32Array(8);
    var i, k, q;

    for (i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      deg[i] = neighbours(mask, w, i, nbuf);
    }

    var used = new Set();
    function edgeKey(a, b) { return a < b ? a + ":" + b : b + ":" + a; }

    var paths = [];

    var wbuf = new Int32Array(8);

    function walk(start, first) {
      var path = [start], prev = start, cur = first;
      used.add(edgeKey(prev, cur));
      path.push(cur);
      var guard = 0;
      while (deg[cur] === 2 && guard++ < 100000) {
        var cnt = neighbours(mask, w, cur, wbuf);
        var next = -1;
        for (var k2 = 0; k2 < cnt; k2++) {
          var n = wbuf[k2];
          if (n === prev || used.has(edgeKey(cur, n))) continue;
          next = n; break;
        }
        if (next < 0) break;
        used.add(edgeKey(cur, next));
        path.push(next);
        prev = cur; cur = next;
      }
      paths.push(path);
    }

    var sbuf = new Int32Array(8);

    // Start from endpoints and junctions.
    for (i = 0; i < w * h; i++) {
      if (!mask[i] || deg[i] === 2 || deg[i] === 0) continue;
      var c1 = neighbours(mask, w, i, sbuf);
      for (k = 0; k < c1; k++) {
        q = sbuf[k];
        if (used.has(edgeKey(i, q))) continue;
        walk(i, q);
      }
    }
    // Anything left is a closed loop with no endpoint.
    for (i = 0; i < w * h; i++) {
      if (!mask[i] || deg[i] === 0) continue;
      var c2 = neighbours(mask, w, i, sbuf);
      for (k = 0; k < c2; k++) {
        q = sbuf[k];
        if (used.has(edgeKey(i, q))) continue;
        walk(i, q);
      }
    }

    return paths.map(function (p) {
      return p.map(function (idx) { return [idx % w, Math.floor(idx / w)]; });
    });
  }

  /* ----------------------------------------------------------- simplify */

  function perpDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var maxD = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var d = perpDist(pts[i], pts[a], pts[b]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
  }

  function polyLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  /* Thinning leaves short spurs at corners and stroke ends. Drop the stubby ones,
     then splice what's left back into long continuous chains. */
  function pruneAndMerge(paths, pruneLen, bridgeLen) {
    var edges = paths.map(function (p) { return { pts: p, dead: false }; });
    function key(pt) { return pt[0] + "," + pt[1]; }

    function adjacency() {
      var adj = new Map();
      edges.forEach(function (e, i) {
        if (e.dead) return;
        var ks = [key(e.pts[0]), key(e.pts[e.pts.length - 1])];
        ks.forEach(function (k) {
          var a = adj.get(k);
          if (!a) { a = []; adj.set(k, a); }
          a.push(i);
        });
      });
      return adj;
    }

    var changed = true, guard = 0;
    while (changed && guard++ < 60) {
      changed = false;
      var adj = adjacency();
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (e.dead) continue;
        var k0 = key(e.pts[0]), k1 = key(e.pts[e.pts.length - 1]);
        if (k0 === k1) continue;                       // closed loop, keep
        var d0 = (adj.get(k0) || []).length, d1 = (adj.get(k1) || []).length;
        var dangling = (d0 === 1 || d1 === 1);
        var rooted = (d0 > 1 || d1 > 1);
        if (dangling && rooted && polyLen(e.pts) < pruneLen) { e.dead = true; changed = true; }
      }
    }

    /* Where two strokes cross, the ink is one thick blob, and thinning splits that
       crossing into two Y-junctions joined by a short stub. Contract those stubs so
       the strokes meet at a single point, the way they do in the artwork. */
    changed = true; guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      var adjB = adjacency();
      for (var b = 0; b < edges.length; b++) {
        var eb = edges[b];
        if (eb.dead) continue;
        var ka = key(eb.pts[0]), kb = key(eb.pts[eb.pts.length - 1]);
        if (ka === kb) continue;
        var da = (adjB.get(ka) || []).length, db = (adjB.get(kb) || []).length;
        if (da < 3 || db < 3) continue;                  // both ends must be junctions
        if (polyLen(eb.pts) > bridgeLen) continue;
        var pA = eb.pts[0], pB = eb.pts[eb.pts.length - 1];
        var M = [Math.round((pA[0] + pB[0]) / 2), Math.round((pA[1] + pB[1]) / 2)];
        eb.dead = true;
        for (var f = 0; f < edges.length; f++) {
          var ef = edges[f];
          if (ef.dead) continue;
          var last = ef.pts.length - 1;
          if (key(ef.pts[0]) === ka || key(ef.pts[0]) === kb) ef.pts[0] = M.slice();
          if (key(ef.pts[last]) === ka || key(ef.pts[last]) === kb) ef.pts[last] = M.slice();
        }
        changed = true;
        break;
      }
    }

    changed = true; guard = 0;
    while (changed && guard++ < 2000) {
      changed = false;
      var adj2 = adjacency();
      var it = adj2.entries();
      for (var step = it.next(); !step.done; step = it.next()) {
        var k = step.value[0], list = step.value[1];
        if (list.length !== 2) continue;
        var i0 = list[0], i1 = list[1];
        if (i0 === i1) continue;
        var A = edges[i0], B = edges[i1];
        if (A.dead || B.dead) continue;
        var a = A.pts.slice(), b = B.pts.slice();
        if (key(a[a.length - 1]) !== k) a.reverse();
        if (key(b[0]) !== k) b.reverse();
        if (key(a[a.length - 1]) !== k || key(b[0]) !== k) continue;
        A.pts = a.concat(b.slice(1));
        B.dead = true;
        changed = true;
        break;
      }
    }

    return edges.filter(function (e) { return !e.dead; }).map(function (e) { return e.pts; });
  }

  /* ---------------------------------------------------------------- api */

  /* opts: {threshold 0..1, invert bool, minStroke px, simplify px, despeckle px} */
  function fromImage(img, opts) {
    opts = opts || {};
    var o = {
      threshold: opts.threshold !== undefined ? opts.threshold : 0.5,
      invert: opts.invert !== undefined ? opts.invert : false,
      minStroke: opts.minStroke !== undefined ? opts.minStroke : 12,
      simplify: opts.simplify !== undefined ? opts.simplify : 1.6,
      despeckle: opts.despeckle !== undefined ? opts.despeckle : 24,
      prune: opts.prune !== undefined ? opts.prune : 14,
      merge: opts.merge          // undefined or negative sizes it from the artwork
    };

    var r = toMask(img, o);
    if (o.despeckle > 0) removeSmallBlobs(r.mask, r.w, r.h, o.despeckle);

    var inkArea = 0;
    for (var m = 0; m < r.mask.length; m++) if (r.mask[m]) inkArea++;

    thin(r.mask, r.w, r.h);

    var raw = trace(r.mask, r.w, r.h);

    // A filled stroke of length L and width W covers L*W pixels, so dividing the ink
    // area by the skeleton length recovers the pen thickness the logo was drawn with.
    var skelLen = 0;
    for (var q = 0; q < raw.length; q++) skelLen += polyLen(raw[q]);
    var strokeWidth = skelLen > 0 ? inkArea / skelLen : 0;

    var bridge = (o.merge === undefined || o.merge === null || o.merge < 0)
      ? strokeWidth * 1.5
      : o.merge;

    raw = pruneAndMerge(raw, o.prune, bridge);
    var strokes = [];
    for (var i = 0; i < raw.length; i++) {
      if (polyLen(raw[i]) < o.minStroke) continue;
      var s = rdp(raw[i], o.simplify);
      // undo the 1px pad, express in source-image pixels
      strokes.push(s.map(function (p) { return [p[0] - 1, p[1] - 1]; }));
    }

    // Longest strokes first — helps traversal ordering and any capping.
    strokes.sort(function (a, b) { return polyLen(b) - polyLen(a); });

    var totalLen = 0;
    for (var k = 0; k < strokes.length; k++) totalLen += polyLen(strokes[k]);

    return {
      strokes: strokes,
      width: r.srcW,
      height: r.srcH,
      inkRatio: r.inkRatio,
      strokeWidth: strokeWidth,
      mergeUsed: bridge,
      totalLength: totalLen,          // in source-image pixels
      pointCount: strokes.reduce(function (n, s2) { return n + s2.length; }, 0)
    };
  }

  /* Render the skeleton to a canvas for the sidebar preview. */
  function preview(skel, canvas, bgImage) {
    var pad = 4;
    var scale = Math.min((canvas.width - pad * 2) / skel.width, (canvas.height - pad * 2) / skel.height);
    var ox = (canvas.width - skel.width * scale) / 2;
    var oy = (canvas.height - skel.height * scale) / 2;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgImage) {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(bgImage, ox, oy, skel.width * scale, skel.height * scale);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#ff2d55";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = ctx.lineCap = "round";
    skel.strokes.forEach(function (s) {
      ctx.beginPath();
      s.forEach(function (p, i) {
        var X = ox + p[0] * scale, Y = oy + p[1] * scale;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();
    });
  }

  /* ---- drawing order: cover every stroke with as little doubling-back as
     possible (the route-inspection / Chinese-postman problem).

     A logo is a graph: strokes are edges, their endpoints are nodes. A route can
     only cover it in one continuous run if at most two nodes have an odd number
     of strokes meeting them. Where more are odd, we duplicate the cheapest
     connecting strokes — which on the ground means running a leg twice, so the
     drawing still comes out right instead of being cut across by a jump. */

  function componentsOf(edges, nodeCount) {
    var parent = [], i;
    for (i = 0; i < nodeCount; i++) parent.push(i);
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    edges.forEach(function (e) { union(e.a, e.b); });
    var groups = new Map();
    edges.forEach(function (e, idx) {
      var r = find(e.a);
      var g = groups.get(r);
      if (!g) { g = []; groups.set(r, g); }
      g.push(idx);
    });
    return Array.from(groups.values());
  }

  /* all-pairs shortest paths over a small skeleton component, keeping the edge
     to take at each hop so we can duplicate a whole path later */
  function allPairs(nodeIds, edges, edgeIdxs) {
    var n = nodeIds.length;
    var pos = new Map();
    nodeIds.forEach(function (id, i) { pos.set(id, i); });
    var INF = Infinity;
    var d = [], nextE = [], i, j;
    for (i = 0; i < n; i++) {
      d.push(new Array(n).fill(INF));
      nextE.push(new Array(n).fill(-1));
      d[i][i] = 0;
    }
    edgeIdxs.forEach(function (ei) {
      var e = edges[ei];
      var a = pos.get(e.a), b = pos.get(e.b);
      if (a === undefined || b === undefined) return;
      if (e.len < d[a][b]) { d[a][b] = e.len; nextE[a][b] = ei; }
      if (e.len < d[b][a]) { d[b][a] = e.len; nextE[b][a] = ei; }
    });
    for (var k = 0; k < n; k++)
      for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
          if (d[i][k] + d[k][j] < d[i][j]) { d[i][j] = d[i][k] + d[k][j]; nextE[i][j] = nextE[i][k]; }
    return { d: d, nextE: nextE, pos: pos };
  }

  function pathEdges(ap, edges, from, to) {
    var out = [], guard = 0;
    var cur = from;
    while (cur !== to && guard++ < 500) {
      var ei = ap.nextE[cur][to];
      if (ei < 0) return out;
      out.push(ei);
      var e = edges[ei];
      var a = ap.pos.get(e.a), b = ap.pos.get(e.b);
      cur = (cur === a) ? b : a;
    }
    return out;
  }

  /* cheapest pairing of odd nodes, leaving `leaveOut` of them unpaired */
  function bestMatching(odd, ap) {
    var k = odd.length;
    if (k === 0) return { cost: 0, pairs: [] };
    if (k > 12) {                       // fall back to greedy on busy artwork
      var rem = odd.slice(), pairs = [], cost = 0;
      while (rem.length > 1) {
        var bi = 0, bj = 1, bd = Infinity;
        for (var i = 0; i < rem.length; i++)
          for (var j = i + 1; j < rem.length; j++)
            if (ap.d[rem[i]][rem[j]] < bd) { bd = ap.d[rem[i]][rem[j]]; bi = i; bj = j; }
        pairs.push([rem[bi], rem[bj]]); cost += bd;
        rem.splice(bj, 1); rem.splice(bi, 1);
      }
      return { cost: cost, pairs: pairs };
    }
    var full = (1 << k) - 1;
    var memo = new Float64Array(full + 1).fill(-1);
    var choice = new Int32Array(full + 1).fill(-1);
    function solve(mask) {
      if (mask === full) return 0;
      if (memo[mask] >= 0) return memo[mask];
      var i2 = 0;
      while (i2 < k && (mask & (1 << i2))) i2++;
      var best = Infinity, bestJ = -1;
      for (var j2 = i2 + 1; j2 < k; j2++) {
        if (mask & (1 << j2)) continue;
        var c = ap.d[odd[i2]][odd[j2]] + solve(mask | (1 << i2) | (1 << j2));
        if (c < best) { best = c; bestJ = j2; }
      }
      memo[mask] = best; choice[mask] = bestJ;
      return best;
    }
    var cost2 = solve(0);
    var pairs2 = [], mask2 = 0;
    while (mask2 !== full) {
      var i3 = 0;
      while (i3 < k && (mask2 & (1 << i3))) i3++;
      var j3 = choice[mask2];
      if (j3 < 0) break;
      pairs2.push([odd[i3], odd[j3]]);
      mask2 |= (1 << i3) | (1 << j3);
    }
    return { cost: cost2, pairs: pairs2 };
  }

  function hierholzer(adj, start) {
    // adj: Map nodeIdx -> array of {to, edge, used:false}
    var stack = [start], circuit = [], usedEdges = new Set();
    var edgeOf = [];
    while (stack.length) {
      var v = stack[stack.length - 1];
      var list = adj.get(v) || [];
      var picked = null;
      for (var i = 0; i < list.length; i++) {
        if (usedEdges.has(list[i].uid)) continue;
        picked = list[i]; break;
      }
      if (picked) {
        usedEdges.add(picked.uid);
        stack.push(picked.to);
        edgeOf.push(picked);
      } else {
        circuit.push({ node: stack.pop(), via: edgeOf.pop() });
      }
    }
    circuit.reverse();
    return circuit;
  }

  /* Returns one polyline per connected component, each covering every stroke. */
  function drawingRuns(strokes) {
    if (!strokes.length) return [];
    var nodes = new Map();
    function nid(pt) {
      var k = pt[0] + "," + pt[1];
      if (!nodes.has(k)) nodes.set(k, nodes.size);
      return nodes.get(k);
    }
    var edges = strokes.map(function (st) {
      return { a: nid(st[0]), b: nid(st[st.length - 1]), pts: st, len: polyLen(st) };
    });

    var comps = componentsOf(edges, nodes.size);
    var runs = [];

    comps.forEach(function (edgeIdxs) {
      var nodeSet = new Set();
      edgeIdxs.forEach(function (ei) { nodeSet.add(edges[ei].a); nodeSet.add(edges[ei].b); });
      var nodeIds = Array.from(nodeSet);
      var ap = allPairs(nodeIds, edges, edgeIdxs);

      // multigraph with duplicates, keyed by local index
      var multi = edgeIdxs.slice();

      var deg = {};
      function recount() {
        deg = {};
        multi.forEach(function (ei) {
          var e = edges[ei];
          deg[ap.pos.get(e.a)] = (deg[ap.pos.get(e.a)] || 0) + 1;
          deg[ap.pos.get(e.b)] = (deg[ap.pos.get(e.b)] || 0) + 1;
        });
      }
      recount();

      var odd = [];
      Object.keys(deg).forEach(function (k) { if (deg[k] % 2) odd.push(+k); });

      // An open run may keep two odd ends; pick the pair that is cheapest to leave.
      if (odd.length > 2) {
        var best = null;
        if (odd.length <= 12) {
          for (var i = 0; i < odd.length; i++) {
            for (var j = i + 1; j < odd.length; j++) {
              var rest = odd.filter(function (_, x) { return x !== i && x !== j; });
              var mm = bestMatching(rest, ap);
              if (!best || mm.cost < best.cost) best = mm;
            }
          }
        } else {
          best = bestMatching(odd.slice(2), ap);
        }
        if (best) {
          best.pairs.forEach(function (pr) {
            pathEdges(ap, edges, pr[0], pr[1]).forEach(function (ei) { multi.push(ei); });
          });
        }
        recount();
        odd = [];
        Object.keys(deg).forEach(function (k) { if (deg[k] % 2) odd.push(+k); });
      }

      var adj = new Map();
      multi.forEach(function (ei, uid) {
        var e = edges[ei];
        var a = ap.pos.get(e.a), b = ap.pos.get(e.b);
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push({ to: b, edge: ei, uid: uid, forward: true });
        adj.get(b).push({ to: a, edge: ei, uid: uid, forward: false });
      });

      var start = odd.length ? odd[0] : ap.pos.get(edges[edgeIdxs[0]].a);
      var circuit = hierholzer(adj, start);

      var poly = [];
      circuit.forEach(function (step) {
        if (!step.via) return;
        var pts = edges[step.via.edge].pts;
        var list = step.via.forward ? pts : pts.slice().reverse();
        if (poly.length) poly = poly.concat(list.slice(1));
        else poly = poly.concat(list);
      });
      if (poly.length > 1) runs.push(poly);
    });

    // chain components nearest-first so any real jump between them is short
    if (runs.length > 1) {
      var ordered = [runs.shift()];
      while (runs.length) {
        var cur = ordered[ordered.length - 1];
        var tail = cur[cur.length - 1];
        var bi = 0, rev = false, bd = Infinity;
        runs.forEach(function (r, i) {
          var da = Math.hypot(r[0][0] - tail[0], r[0][1] - tail[1]);
          var db = Math.hypot(r[r.length-1][0] - tail[0], r[r.length-1][1] - tail[1]);
          if (da < bd) { bd = da; bi = i; rev = false; }
          if (db < bd) { bd = db; bi = i; rev = true; }
        });
        var nxt = runs.splice(bi, 1)[0];
        ordered.push(rev ? nxt.slice().reverse() : nxt);
      }
      runs = ordered;
    }
    return runs;
  }

  /* Order strokes into one drawing sequence, nearest-endpoint-first.
     Returns {order:[{stroke, reversed}], connectors:[[from,to],...]} */
  function sequence(strokes) {
    if (!strokes.length) return { order: [], connectors: [] };
    var remaining = strokes.map(function (s, i) { return i; });
    var order = [], connectors = [];
    var curIdx = remaining.shift();
    order.push({ i: curIdx, reversed: false });
    var cur = strokes[curIdx][strokes[curIdx].length - 1];

    while (remaining.length) {
      var best = -1, bestRev = false, bestD = Infinity;
      for (var r = 0; r < remaining.length; r++) {
        var s = strokes[remaining[r]];
        var a = s[0], b = s[s.length - 1];
        var da = Math.hypot(a[0] - cur[0], a[1] - cur[1]);
        var db = Math.hypot(b[0] - cur[0], b[1] - cur[1]);
        if (da < bestD) { bestD = da; best = r; bestRev = false; }
        if (db < bestD) { bestD = db; best = r; bestRev = true; }
      }
      var idx = remaining.splice(best, 1)[0];
      var st = strokes[idx];
      var start = bestRev ? st[st.length - 1] : st[0];
      connectors.push([cur.slice(), start.slice()]);
      order.push({ i: idx, reversed: bestRev });
      cur = bestRev ? st[0] : st[st.length - 1];
    }
    return { order: order, connectors: connectors };
  }

  /* Flatten strokes (in sequence order) into one point list in shape units:
     centred on the artwork, divided by image WIDTH, y flipped so +y is north. */
  function toShapeUnits(skel) {
    var seq = sequence(skel.strokes);
    var W = skel.width, H = skel.height;
    var pts = [], breaks = [];
    seq.order.forEach(function (o) {
      var s = skel.strokes[o.i];
      var list = o.reversed ? s.slice().reverse() : s;
      if (pts.length) breaks.push(pts.length);       // index where a pen-up connector starts
      list.forEach(function (p) {
        pts.push([(p[0] - W / 2) / W, -(p[1] - H / 2) / W]);
      });
    });
    return { points: pts, breaks: breaks, aspect: W / H };
  }

  global.Skeleton = {
    fromImage: fromImage,
    autoInvert: autoInvert,
    preview: preview,
    neighbours: neighbours,
    pruneAndMerge: pruneAndMerge,
    sequence: sequence,
    drawingRuns: drawingRuns,
    toShapeUnits: toShapeUnits,
    polyLen: polyLen
  };
})(window);
