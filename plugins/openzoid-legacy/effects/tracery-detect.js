// Tracery key-color region detection (split from tracery.js).
// Connected-component labeling over a match-strength buffer. Pure:
// unit-tested in isolation.

// Connected-component labeling over a match-strength buffer (0..255,
// row-major, length w*h). Cells at/above threshold become regions with
// centroid, bounding box, and area. Returns at most maxRegions,
// largest first. Pure: unit-tested in isolation.
function trDetectRegions(data, w, h, threshold01, minArea, maxRegions) {
    var th = Math.max(0, Math.min(1, threshold01));
    var min = Math.max(1, Math.round(minArea));
    var max = Math.max(1, Math.round(maxRegions));
    var labels = new Int32Array(w * h);
    var parent = [0];
    var nextId = 0;
    var find = function (a) {
        var root = a;
        while (parent[root] !== root) root = parent[root];
        while (parent[a] !== root) {
            var t = parent[a];
            parent[a] = root;
            a = t;
        }
        return root;
    };
    var x, y, idx;
    for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
            idx = y * w + x;
            // Zero strength never matches: with no key color present,
            // no tracery appears regardless of threshold.
            if (data[idx] <= 0 || data[idx] / 255 < th) continue;
            var left = x > 0 ? labels[idx - 1] : 0;
            var up = y > 0 ? labels[idx - w] : 0;
            if (left) left = find(left);
            if (up) up = find(up);
            if (!left && !up) {
                nextId++;
                parent[nextId] = nextId;
                labels[idx] = nextId;
            } else if (left && !up) {
                labels[idx] = left;
            } else if (!left && up) {
                labels[idx] = up;
            } else if (left === up) {
                labels[idx] = left;
            } else {
                var keep = left < up ? left : up;
                parent[left < up ? up : left] = keep;
                labels[idx] = keep;
            }
        }
    }
    var stats = {};
    for (idx = 0; idx < w * h; idx++) {
        var lb = labels[idx];
        if (!lb) continue;
        var rep = find(lb);
        var s = stats[rep];
        if (!s) {
            s = stats[rep] = { count: 0, sumX: 0, sumY: 0, minX: w, maxX: -1, minY: h, maxY: -1 };
        }
        x = idx % w;
        y = (idx / w) | 0;
        s.count++;
        s.sumX += x;
        s.sumY += y;
        if (x < s.minX) s.minX = x;
        if (x > s.maxX) s.maxX = x;
        if (y < s.minY) s.minY = y;
        if (y > s.maxY) s.maxY = y;
    }
    var kept = [];
    for (var k in stats) {
        if (Object.prototype.hasOwnProperty.call(stats, k) && stats[k].count >= min) {
            kept.push(stats[k]);
        }
    }
    kept.sort(function (a, b) { return b.count - a.count; });
    var out = [];
    for (var i = 0; i < kept.length && i < max; i++) {
        var g = kept[i];
        out.push({
            cx: g.sumX / g.count,
            cy: g.sumY / g.count,
            minX: g.minX,
            maxX: g.maxX,
            minY: g.minY,
            maxY: g.maxY,
            area: g.count,
        });
    }
    return out;
}

module.exports = { trDetectRegions };

