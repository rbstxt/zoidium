// Tracery routed-connection paths (split from tracery.js).
// Pure geometry: flattening a routed connection and sampling it by arclength.

// Flatten a routed connection to screen-space polypoints for stroking,
// dashing, arrows, and hit-free arclength sampling.
function trRoutePath(type, x0, y0, x1, y1, tension, continuity, bias, corner) {
    var pts = [];
    var i, t;
    if (type === 1) {
        // PCB traces: straight run along the major axis, one 45-degree
        // diagonal corner consuming the whole minor axis, then straight.
        var dx = x1 - x0;
        var dy = y1 - y0;
        var sx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
        var sy = dy === 0 ? 0 : dy > 0 ? 1 : -1;
        var diag = Math.min(Math.abs(dx), Math.abs(dy));
        pts.push([x0, y0]);
        pts.push([x0 + sx * Math.max(0, Math.abs(dx) - diag), y0 + sy * Math.max(0, Math.abs(dy) - diag)]);
        pts.push([x1, y1]);
        return trCleanPath(pts);
    }
    if (type === 2) {
        // Smooth bend: quadratic through a tension-offset midpoint.
        var qmx = (x0 + x1) / 2 - (y1 - y0) * 0.25 * tension;
        var qmy = (y0 + y1) / 2 + (x1 - x0) * 0.25 * tension;
        for (i = 0; i <= 24; i++) {
            t = i / 24;
            var u = 1 - t;
            pts.push([u * u * x0 + 2 * u * t * qmx + t * t * x1, u * u * y0 + 2 * u * t * qmy + t * t * y1]);
        }
        return pts;
    }
    if (type === 3) {
        // Step bend: horizontal to a corner fraction, then vertical.
        var c = Math.max(0, Math.min(1, corner));
        pts.push([x0, y0]);
        pts.push([x0 + (x1 - x0) * c, y0]);
        pts.push([x0 + (x1 - x0) * c, y1]);
        pts.push([x1, y1]);
        return trCleanPath(pts);
    }
    // Spline (type 0): Kochanek-Bartels through duplicated endpoints.
    var p0 = [x0, y0];
    var p3 = [x1, y1];
    var pts4 = [p0, p0, p3, p3];
    var m1 = [
        ((1 - tension) * (1 + continuity) * (1 + bias)) / 2 * (pts4[1][0] - pts4[0][0]) +
            ((1 - tension) * (1 - continuity) * (1 - bias)) / 2 * (pts4[2][0] - pts4[1][0]),
        ((1 - tension) * (1 + continuity) * (1 + bias)) / 2 * (pts4[1][1] - pts4[0][1]) +
            ((1 - tension) * (1 - continuity) * (1 - bias)) / 2 * (pts4[2][1] - pts4[1][1]),
    ];
    var m2 = [
        ((1 - tension) * (1 - continuity) * (1 + bias)) / 2 * (pts4[2][0] - pts4[1][0]) +
            ((1 - tension) * (1 + continuity) * (1 - bias)) / 2 * (pts4[3][0] - pts4[2][0]),
        ((1 - tension) * (1 - continuity) * (1 + bias)) / 2 * (pts4[2][1] - pts4[1][1]) +
            ((1 - tension) * (1 + continuity) * (1 - bias)) / 2 * (pts4[3][1] - pts4[2][1]),
    ];
    for (i = 0; i <= 28; i++) {
        t = i / 28;
        var t2 = t * t;
        var t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1;
        var h10 = t3 - 2 * t2 + t;
        var h01 = -2 * t3 + 3 * t2;
        var h11 = t3 - t2;
        pts.push([
            h00 * p0[0] + h10 * m1[0] + h01 * p3[0] + h11 * m2[0],
            h00 * p0[1] + h10 * m1[1] + h01 * p3[1] + h11 * m2[1],
        ]);
    }
    return pts;
}

function trCleanPath(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var q = out[out.length - 1];
        if (!q || Math.abs(q[0] - p[0]) > 0.001 || Math.abs(q[1] - p[1]) > 0.001) {
            out.push(p);
        }
    }
    return out.length > 1 ? out : [pts[0], pts[0]];
}

function trPathPoint(pts, t) {
    t = Math.max(0, Math.min(1, t));
    if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], dx: 1, dy: 0 };
    var total = 0;
    var lens = [0];
    var i;
    for (i = 1; i < pts.length; i++) {
        var dx = pts[i][0] - pts[i - 1][0];
        var dy = pts[i][1] - pts[i - 1][1];
        total += Math.sqrt(dx * dx + dy * dy);
        lens.push(total);
    }
    if (total <= 0.0001) return { x: pts[0][0], y: pts[0][1], dx: 1, dy: 0 };
    var target = t * total;
    for (i = 1; i < pts.length; i++) {
        if (lens[i] >= target) {
            var span = lens[i] - lens[i - 1];
            var f = span > 0.0001 ? (target - lens[i - 1]) / span : 0;
            var sx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
            var sy = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
            var ddx = pts[i][0] - pts[i - 1][0];
            var ddy = pts[i][1] - pts[i - 1][1];
            var dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            return { x: sx, y: sy, dx: ddx / dl, dy: ddy / dl };
        }
    }
    var last = pts[pts.length - 1];
    var prev = pts[pts.length - 2];
    var ldx = last[0] - prev[0];
    var ldy = last[1] - prev[1];
    var ll = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    return { x: last[0], y: last[1], dx: ldx / ll, dy: ldy / ll };
}

module.exports = {
    trRoutePath,
    trCleanPath,
    trPathPoint,
};

