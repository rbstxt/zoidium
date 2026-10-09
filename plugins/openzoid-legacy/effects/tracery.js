// Tracery — motion-tracking callout overlay (boxes, markers, spline
// connection lines, arrows, labels, grid) rendered as a canvas overlay
// composited over the layer image. Points are manual track markers the
// user animates (keyframes or wiggle expressions); see effect-windows.js
// for the setup window. Output is a pure function of the properties and the
// input pixels of the current frame; no state survives between renders.

this.defaultName = "Tracery";

// Exposed for unit tests and debugging (the file otherwise only installs
// per-instance members when evaluated as an effect module).
this.traceryPaths = {
    route: trRoutePath,
    clean: trCleanPath,
    point: trPathPoint,
    css: trCss,
    draw: trDrawOverlay,
    detect: trDetectRegions,
    region: trLayerRegion,
};

function trNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

function trOption(name, value, items) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.OPTION,
        value: value,
        items: items,
    };
}

function trColor(name, r, g, b) {
    return {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: name + ".R", type: PZ.property.type.NUMBER, value: r, min: 0, max: 1 },
            { dynamic: true, name: name + ".G", type: PZ.property.type.NUMBER, value: g, min: 0, max: 1 },
            { dynamic: true, name: name + ".B", type: PZ.property.type.NUMBER, value: b, min: 0, max: 1 },
        ],
        name: name,
        type: PZ.property.type.COLOR,
    };
}

function trText(name, value) {
    return { name: name, type: PZ.property.type.TEXT, value: value };
}

function trPointDefs(n) {
    return {
        // Point 1 starts on at the frame centre, so a new effect shows a marker
        // at once. Saved projects keep the value they were saved with.
        ["point" + n + "Enable"]: trOption("Point " + n, n === 1 ? 1 : 0, "off;on"),
        ["point" + n + "X"]: trNum("Point " + n + " X [%]", 50, 0, 100, 0.1, 1),
        ["point" + n + "Y"]: trNum("Point " + n + " Y [%]", 50, 0, 100, 0.1, 1),
        ["point" + n + "Size"]: trNum("Point " + n + " size", 120, 1, 2000, 1, 0),
        ["point" + n + "Label"]: trText("Point " + n + " label", "P" + n),
        ["point" + n + "LabelDX"]: trNum("Point " + n + " label dX", 150, -2000, 2000, 1, 0),
        ["point" + n + "LabelDY"]: trNum("Point " + n + " label dY", -70, -2000, 2000, 1, 0),
    };
}

function trMerge(dst, src) {
    for (var k in src) dst[k] = src[k];
    return dst;
}

function trPointSet() {
    var defs = {};
    for (var n = 1; n <= 6; n++) trMerge(defs, trPointDefs(n));
    return defs;
}

this.propertyDefinitions = trMerge(
    {
        enabled: {
            dynamic: true,
            name: "Enabled",
            type: PZ.property.type.OPTION,
            value: 1,
            items: "off;on",
            buttons: [{ name: "Tracery Setup", title: "Open the Tracery setup window", action: "tracerySetup" }],
        },
        detectEnable: trOption("Detection", 1, "off;on"),
        keyColor: trColor("Key Color", 1, 1, 1),
        threshold: trNum("Threshold", 50, 0, 100, 0.5, 1),
        showMask: trOption("Show Mask", 0, "off;on"),
        blurStrength: trNum("Blur Strength", 5, 0, 8, 0.5, 1),
        alphaLayer: trOption("Alpha Layer", 0, "off;on"),
        detectionQuality: trOption("Detection Quality", 2, "low;medium;high;extreme"),
        boxEnable: trOption("Box", 1, "off;on"),
        boxShape: trOption("Box shape", 0, "rectangle;square;ellipse;circle"),
        boxColor: trColor("Box color", 1, 1, 1),
        boxOpacity: trNum("Box opacity", 1, 0, 1, 0.01, 2),
        boxLineWidth: trNum("Box line width", 2, 0.5, 20, 0.5, 1),
        boxFill: trOption("Box fill", 0, "none;solid;diagonal hatch;invert"),
        boxFillColor: trColor("Box fill color", 1, 1, 1),
        boxFillOpacity: trNum("Box fill opacity", 0.25, 0, 1, 0.01, 2),
        markerShape: trOption("Marker shape", 0, "dot;plus;cross;polygon"),
        markerSize: trNum("Marker size", 14, 1, 200, 1, 0),
        markerColor: trColor("Marker color", 1, 0.15, 0.15),
        markerOpacity: trNum("Marker opacity", 1, 0, 1, 0.01, 2),
        markerRotation: trNum("Marker rotation", 0, -180, 180, 1, 0),
        markerSides: trNum("Polygon sides", 5, 3, 12, 1, 0),
        markerFilled: trOption("Marker filled", 1, "off;on"),
        gridEnable: trOption("Grid", 0, "off;on"),
        gridMode: trOption("Grid mode", 0, "cartesian;edge"),
        gridDivisions: trNum("Grid divisions", 8, 1, 32, 1, 0),
        gridColor: trColor("Grid color", 1, 1, 1),
        gridOpacity: trNum("Grid opacity", 0.25, 0, 1, 0.01, 2),
        linesEnable: trOption("Connection lines", 1, "off;on"),
        lineType: trOption("Connection type", 0, "spline;pcb traces;smooth bend;step bend"),
        lineColor: trColor("Connection color", 1, 1, 1),
        lineOpacity: trNum("Connection opacity", 1, 0, 1, 0.01, 2),
        lineThickness: trNum("Connection thickness", 3.6, 0.5, 30, 0.1, 1),
        splineTension: trNum("Spline tension", 0, -1, 1, 0.01, 2),
        splineContinuity: trNum("Spline continuity", 0, -1, 1, 0.01, 2),
        splineBias: trNum("Spline bias", 0, -1, 1, 0.01, 2),
        showHandles: trOption("Spline handles", 0, "off;on"),
        lineCorner: trNum("Step corner", 0.5, 0, 1, 0.01, 2),
        dashEnable: trOption("Dash", 0, "off;on"),
        dashLength: trNum("Dash length", 10, 1, 200, 1, 0),
        dashGap: trNum("Gap length", 5, 1, 200, 1, 0),
        arrowEnable: trOption("Arrow", 0, "off;on"),
        arrowColor: trColor("Arrow color", 0.6, 0.6, 1),
        arrowOpacity: trNum("Arrow opacity", 1, 0, 1, 0.01, 2),
        arrowSize: trNum("Arrow size", 23, 1, 200, 1, 0),
        arrowAngle: trNum("Arrow angle", 0.4, 0.05, 1.5, 0.01, 2),
        arrowPosition: trNum("Arrow position", 0.7, 0, 1, 0.01, 2),
        arrowFilled: trOption("Arrow filled", 1, "off;on"),
        labelsEnable: trOption("Labels", 1, "off;on"),
        labelMode: trOption("Label display", 0, "coordinates;dimensions;area;node id;custom"),
        labelFontSize: trNum("Label size", 20, 6, 120, 1, 0),
        labelColor: trColor("Label color", 1, 1, 1),
        labelOpacity: trNum("Label opacity", 1, 0, 1, 0.01, 2),
    },
    trPointSet()
);

if (this.properties && typeof this.properties.addAll === "function") {
    this.properties.addAll(this.propertyDefinitions, this);
}

function trClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// The pass receives the whole screen buffer, but the layer occupies only the
// part given by uvScale (the compositor sets it per effect). Overlays are drawn
// in the layer's own resolution, so Point X/Y percentages and sizes refer to the
// layer frame and do not change with the preview zoom. Falls back to the buffer
// region when the layer resolution is unknown.
function trLayerRegion(w, h, uv, res) {
    var sx = uv && uv.x > 0 ? Math.min(1, uv.x) : 1;
    var sy = uv && uv.y > 0 ? Math.min(1, uv.y) : 1;
    var width = res && res[0] > 0 ? Math.round(res[0]) : Math.max(1, Math.round(w * sx));
    var height = res && res[1] > 0 ? Math.round(res[1]) : Math.max(1, Math.round(h * sy));
    return { width: width, height: height, sx: sx, sy: sy };
}

function trNum3(prop, e, fb) {
    try {
        var v = prop.get(e);
        if (Array.isArray(v) && v.length >= 3) {
            return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
        }
    } catch (err) {}
    return fb;
}

function trCss(rgb, a) {
    var r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
    var g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
    var b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

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

function trDrawOverlay(ctx, W, H, st) {
    var S = H / 1080;
    var i, k;
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    // Grid under everything.
    if (st.gridEnable) {
        ctx.save();
        ctx.strokeStyle = trCss(st.gridColor, st.gridOpacity);
        ctx.lineWidth = Math.max(1, S);
        var div = Math.max(1, Math.round(st.gridDivisions));
        if (st.gridMode === 0) {
            for (i = 1; i < div; i++) {
                var gx = (W * i) / div;
                var gy = (H * i) / div;
                ctx.beginPath();
                ctx.moveTo(gx, 0);
                ctx.lineTo(gx, H);
                ctx.moveTo(0, gy);
                ctx.lineTo(W, gy);
                ctx.stroke();
            }
        } else {
            ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
            var tick = Math.min(W, H) * 0.02;
            for (i = 1; i < div; i++) {
                var tx = (W * i) / div;
                var ty = (H * i) / div;
                ctx.beginPath();
                ctx.moveTo(tx, 0);
                ctx.lineTo(tx, tick);
                ctx.moveTo(tx, H);
                ctx.lineTo(tx, H - tick);
                ctx.moveTo(0, ty);
                ctx.lineTo(tick, ty);
                ctx.moveTo(W, ty);
                ctx.lineTo(W - tick, ty);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
    for (i = 0; i < st.points.length; i++) {
        (function (pt, idx) {
            if (!pt.enable) return;
            var cx = (pt.x / 100) * W;
            var cy = (pt.y / 100) * H;
            var bw = pt.size * 1.5 * S;
            var bh = pt.size * S;
            if (st.boxShape === 1) {
                bw = Math.max(bw, bh);
                bh = bw;
            }
            var bx = cx - bw / 2;
            var by = cy - bh / 2;
            // Box fill, then stroke.
            if (st.boxEnable && st.boxFill !== 0) {
                ctx.save();
                trTraceBox(ctx, st.boxShape, bx, by, bw, bh);
                if (st.boxFill === 3) {
                    ctx.globalCompositeOperation = "difference";
                    ctx.fillStyle = "rgba(255,255,255,1)";
                    ctx.fill();
                } else if (st.boxFill === 1) {
                    ctx.fillStyle = trCss(st.boxFillColor, st.boxFillOpacity);
                    ctx.fill();
                } else if (st.boxFill === 2) {
                    ctx.clip();
                    ctx.strokeStyle = trCss(st.boxFillColor, st.boxFillOpacity);
                    ctx.lineWidth = Math.max(1, S);
                    var step = 9 * S;
                    for (var d = -bh; d < bw + bh; d += step) {
                        ctx.beginPath();
                        ctx.moveTo(bx + d, by);
                        ctx.lineTo(bx + d + bh, by + bh);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }
            if (st.boxEnable) {
                ctx.save();
                ctx.strokeStyle = trCss(st.boxColor, st.boxOpacity);
                ctx.lineWidth = Math.max(0.5, st.boxLineWidth * S);
                trTraceBox(ctx, st.boxShape, bx, by, bw, bh);
                ctx.stroke();
                ctx.restore();
            }
            // Marker at the region center.
            trDrawMarker(ctx, cx, cy, st, S);
            // Connection line from the box edge toward the label anchor.
            var lx = cx + pt.labelDX * S;
            var ly = cy + pt.labelDY * S;
            if (st.linesEnable) {
                var edge = trBoxEdge(bx, by, bw, bh, lx, ly);
                var path = trRoutePath(
                    st.lineType, edge[0], edge[1], lx, ly,
                    st.splineTension, st.splineContinuity, st.splineBias, st.lineCorner
                );
                ctx.save();
                ctx.strokeStyle = trCss(st.lineColor, st.lineOpacity);
                ctx.lineWidth = Math.max(0.5, st.lineThickness * S);
                if (st.dashEnable) {
                    try {
                        ctx.setLineDash([Math.max(1, st.dashLength * S), Math.max(1, st.dashGap * S)]);
                    } catch (_d) {}
                }
                ctx.beginPath();
                ctx.moveTo(path[0][0], path[0][1]);
                for (k = 1; k < path.length; k++) ctx.lineTo(path[k][0], path[k][1]);
                ctx.stroke();
                ctx.restore();
                if (st.showHandles) {
                    ctx.save();
                    ctx.fillStyle = trCss(st.lineColor, st.lineOpacity);
                    ctx.fillRect(edge[0] - 2 * S, edge[1] - 2 * S, 4 * S, 4 * S);
                    ctx.fillRect(lx - 2 * S, ly - 2 * S, 4 * S, 4 * S);
                    ctx.restore();
                }
                if (st.arrowEnable) {
                    var at = trPathPoint(path, st.arrowPosition);
                    trDrawArrow(ctx, at, st, S);
                }
            }
            // Label box at the anchor.
            if (st.labelsEnable) {
                trDrawLabel(ctx, lx, ly, pt, idx, st, S, W, H);
            }
        })(st.points[i], i);
    }
}

function trTraceBox(ctx, shape, bx, by, bw, bh) {
    ctx.beginPath();
    if (shape === 2 || shape === 3) {
        var rx = shape === 3 ? Math.min(bw, bh) / 2 : bw / 2;
        var ry = shape === 3 ? Math.min(bw, bh) / 2 : bh / 2;
        ctx.ellipse(bx + bw / 2, by + bh / 2, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    } else {
        var side = shape === 1 ? Math.max(bw, bh) : bw;
        var ox = shape === 1 ? bx - (side - bw) / 2 : bx;
        var oy = shape === 1 ? by - (side - bh) / 2 : by;
        ctx.rect(ox, oy, Math.max(side, 1), Math.max(shape === 1 ? side : bh, 1));
    }
}

// Point on a box border facing (lx, ly): box edge toward the label anchor.
function trBoxEdge(bx, by, bw, bh, lx, ly) {
    var cx = bx + bw / 2;
    var cy = by + bh / 2;
    var dx = lx - cx;
    var dy = ly - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return [cx, cy];
    var tx = dx !== 0 ? (bw / 2 / Math.abs(dx)) * Math.sign(dx) : Infinity;
    var ty = dy !== 0 ? (bh / 2 / Math.abs(dy)) * Math.sign(dy) : Infinity;
    var t = Math.min(tx, ty);
    if (!isFinite(t)) t = 0;
    return [cx + dx * t, cy + dy * t];
}

function trDrawMarker(ctx, cx, cy, st, S) {
    var size = Math.max(1, st.markerSize * S);
    var rot = ((st.markerRotation || 0) * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = trCss(st.markerColor, st.markerOpacity);
    ctx.strokeStyle = trCss(st.markerColor, st.markerOpacity);
    ctx.lineWidth = Math.max(1, size * 0.18);
    var shape = st.markerShape;
    if (shape === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        if (st.markerFilled) ctx.fill();
        else ctx.stroke();
    } else if (shape === 1 || shape === 2) {
        var r = size / 2;
        ctx.beginPath();
        if (shape === 1) {
            ctx.moveTo(-r, 0);
            ctx.lineTo(r, 0);
        } else {
            ctx.moveTo(-r * 0.7, -r * 0.7);
            ctx.lineTo(r * 0.7, r * 0.7);
            ctx.moveTo(r * 0.7, -r * 0.7);
            ctx.lineTo(-r * 0.7, r * 0.7);
        }
        ctx.stroke();
    } else {
        var sides = Math.max(3, Math.min(12, Math.round(st.markerSides)));
        ctx.beginPath();
        for (var i = 0; i <= sides; i++) {
            var a = (i / sides) * Math.PI * 2 - Math.PI / 2;
            var px = Math.cos(a) * size / 2;
            var py = Math.sin(a) * size / 2;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (st.markerFilled) ctx.fill();
        else ctx.stroke();
    }
    ctx.restore();
}

function trDrawArrow(ctx, at, st, S) {
    var len = Math.max(2, st.arrowSize * S);
    var half = Math.max(0.05, Math.min(1.5, st.arrowAngle));
    // Wings spread from the tip along the reversed direction +/- half angle.
    var rdx = -at.dx;
    var rdy = -at.dy;
    var c = Math.cos(half);
    var s = Math.sin(half);
    var w1x = at.x + (rdx * c - rdy * s) * len;
    var w1y = at.y + (rdx * s + rdy * c) * len;
    var w2x = at.x + (rdx * c + rdy * s) * len;
    var w2y = at.y + (-rdx * s + rdy * c) * len;
    ctx.save();
    ctx.strokeStyle = trCss(st.arrowColor, st.arrowOpacity);
    ctx.fillStyle = trCss(st.arrowColor, st.arrowOpacity);
    ctx.lineWidth = Math.max(1, len * 0.18);
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(w1x, w1y);
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(w2x, w2y);
    ctx.stroke();
    if (st.arrowFilled) {
        ctx.beginPath();
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(w1x, w1y);
        ctx.lineTo(w2x, w2y);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function trDrawLabel(ctx, lx, ly, pt, idx, st, S, W, H) {
    var text = "P" + (idx + 1);
    if (st.labelMode === 0) {
        text = "X: " + Math.round(lx - W / 2) + "  Y: " + Math.round(H / 2 - ly);
    } else if (st.labelMode === 1) {
        text = Math.round(pt.size * 1.5 * S) + " x " + Math.round(pt.size * S);
    } else if (st.labelMode === 2) {
        text = String(Math.round(pt.size * 1.5 * S * (pt.size * S))) + " px";
    } else if (st.labelMode === 4) {
        text = pt.label || text;
    }
    var px = Math.max(8, st.labelFontSize * S);
    var font = "600 " + px + "px 'Source Code Pro', monospace";
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = "middle";
    var w = ctx.measureText(text).width;
    var pad = 8 * S;
    var bw = w + pad * 2;
    var bh = px + pad * 1.4;
    ctx.strokeStyle = trCss(st.labelColor, st.labelOpacity);
    ctx.lineWidth = Math.max(1, 1.5 * S);
    ctx.strokeRect(lx - bw / 2, ly - bh / 2, bw, bh);
    ctx.fillStyle = trCss(st.labelColor, st.labelOpacity);
    ctx.fillText(text, lx - w / 2, ly + 1);
    ctx.restore();
}

function trCollectState(props, e) {
    var st = {};
    var i, k;
    var points = [];
    for (i = 1; i <= 6; i++) {
        (function (n) {
            var on = false;
            try {
                on = props["point" + n + "Enable"].get(e) === 1;
            } catch (err) {}
            if (!on) return;
            var at = function (key, fb) {
                try {
                    var v = props[key].get(e);
                    if (typeof v === "number" && isFinite(v)) return v;
                } catch (err) {}
                return fb;
            };
            var label = "P" + n;
            try {
                var lv = props["point" + n + "Label"].get(e);
                if (typeof lv === "string" && lv) label = lv;
            } catch (err) {}
            points.push({
                enable: true,
                x: at("point" + n + "X", 50),
                y: at("point" + n + "Y", 50),
                size: Math.max(1, at("point" + n + "Size", 120)),
                label: label,
                labelDX: at("point" + n + "LabelDX", 150),
                labelDY: at("point" + n + "LabelDY", -70),
            });
        })(i);
    }
    st.points = points;
    var num = function (key, fb) {
        try {
            var v = props[key].get(e);
            if (typeof v === "number" && isFinite(v)) return v;
        } catch (err) {}
        return fb;
    };
    var opt = function (key, fb) {
        var v = num(key, fb);
        return Math.round(v);
    };
    var col = function (key, fb) {
        return trNum3(props[key], e, fb);
    };
    st.boxEnable = opt("boxEnable", 1) === 1;
    st.boxShape = opt("boxShape", 0);
    st.boxColor = col("boxColor", [1, 1, 1]);
    st.boxOpacity = trClamp01(num("boxOpacity", 1));
    st.boxLineWidth = Math.max(0.5, num("boxLineWidth", 2));
    st.boxFill = opt("boxFill", 0);
    st.boxFillColor = col("boxFillColor", [1, 1, 1]);
    st.boxFillOpacity = trClamp01(num("boxFillOpacity", 0.25));
    st.markerShape = opt("markerShape", 0);
    st.markerSize = Math.max(1, num("markerSize", 14));
    st.markerColor = col("markerColor", [1, 0.15, 0.15]);
    st.markerOpacity = trClamp01(num("markerOpacity", 1));
    st.markerRotation = num("markerRotation", 0);
    st.markerSides = Math.max(3, Math.min(12, Math.round(num("markerSides", 5))));
    st.markerFilled = opt("markerFilled", 1) === 1;
    st.gridEnable = opt("gridEnable", 0) === 1;
    st.gridMode = opt("gridMode", 0);
    st.gridDivisions = Math.max(1, Math.round(num("gridDivisions", 8)));
    st.gridColor = col("gridColor", [1, 1, 1]);
    st.gridOpacity = trClamp01(num("gridOpacity", 0.25));
    st.linesEnable = opt("linesEnable", 1) === 1;
    st.lineType = opt("lineType", 0);
    st.lineColor = col("lineColor", [1, 1, 1]);
    st.lineOpacity = trClamp01(num("lineOpacity", 1));
    st.lineThickness = Math.max(0.5, num("lineThickness", 3.6));
    st.splineTension = num("splineTension", 0);
    st.splineContinuity = num("splineContinuity", 0);
    st.splineBias = num("splineBias", 0);
    st.showHandles = opt("showHandles", 0) === 1;
    st.lineCorner = num("lineCorner", 0.5);
    st.dashEnable = opt("dashEnable", 0) === 1;
    st.dashLength = Math.max(1, num("dashLength", 10));
    st.dashGap = Math.max(1, num("dashGap", 5));
    st.arrowEnable = opt("arrowEnable", 0) === 1;
    st.arrowColor = col("arrowColor", [0.6, 0.6, 1]);
    st.arrowOpacity = trClamp01(num("arrowOpacity", 1));
    st.arrowSize = Math.max(2, num("arrowSize", 23));
    st.arrowAngle = num("arrowAngle", 0.4);
    st.arrowPosition = num("arrowPosition", 0.7);
    st.arrowFilled = opt("arrowFilled", 1) === 1;
    st.labelsEnable = opt("labelsEnable", 1) === 1;
    st.labelMode = opt("labelMode", 0);
    st.labelFontSize = Math.max(6, num("labelFontSize", 20));
    st.labelColor = col("labelColor", [1, 1, 1]);
    st.labelOpacity = trClamp01(num("labelOpacity", 1));
    st.detectEnable = opt("detectEnable", 1) === 1;
    st.keyColor = col("keyColor", [1, 1, 1]);
    st.threshold = num("threshold", 50) / 100;
    st.showMask = opt("showMask", 0) === 1;
    st.blurStrength = Math.max(0, Math.min(6, num("blurStrength", 5)));
    st.alphaLayer = opt("alphaLayer", 0) === 1;
    st.detectionQuality = Math.max(0, Math.min(3, Math.round(num("detectionQuality", 2))));
    return st;
}

// Resolves once the label font is available (see ascii.js for the rationale).
function trFontReady() {
    var fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
    return Promise.resolve(fonts.load("600 20px 'Source Code Pro'")).then(
        function () {},
        function () {}
    );
}

this.load = async function (e) {
    this.pass = new THREE.TraceryPass();
    this.pass.setSize(2, 2);
    this.properties.load(e && e.properties);
    this._fontReady = trFontReady();
    await this._fontReady;
};

this.prepare = async function () {
    if (this._fontReady) await this._fontReady;
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (this.pass && typeof this.pass.dispose === "function") {
        this.pass.dispose();
    }
    this.pass = null;
};

// The state object keeps its identity while its serialized form is
// unchanged, so the overlay canvas is redrawn only when the state changes
// (or when detection, which follows the footage, is enabled).
this.update = function (e) {
    if (!this.pass) {
        return;
    }
    var st;
    try {
        st = trCollectState(this.properties, e);
    } catch (err) {
        st = { points: [] };
    }
    var sig = JSON.stringify(st);
    if (sig !== this._overlaySignature || !this._overlayState) {
        this._overlaySignature = sig;
        this._overlayState = st;
    }
    var on = false;
    try {
        on = this.properties.enabled.get(e) === 1;
    } catch (err) {}
    // The effect sits under a small list of effects before its layer.
    var res = null;
    try {
        var owner = this.parent;
        for (var depth = 0; owner && depth < 8 && !(owner.properties && owner.properties.resolution); depth++) {
            owner = owner.parent;
        }
        if (owner) res = owner.properties.resolution.get(e);
    } catch (err) {}
    this.pass.enabled = on;
    this.pass.opacity = 1;
    this.pass.overlayState = this._overlayState;
    this.pass.layerResolution = Array.isArray(res) && res.length >= 2 ? res : null;
};

if (!THREE.TraceryPass) {
    THREE.TraceryPass = function () {
        this.enabled = true;
        this.needsSwap = true;
        this.opacity = 1;
        this.overlayState = null;
        this.drawnState = null;
        this.canvas = null;
        this.canvasTexture = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.detectTarget = null;
        this.detectPixels = null;
        this.detectWidth = 0;
        this.detectHeight = 0;
        this.layerResolution = null;
        var material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                tOverlay: { type: "t", value: null },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
                opacity: { type: "f", value: 1 },
                alphaOnly: { type: "f", value: 0 },
            },
            vertexShader: [
                "uniform vec2 uvScale;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vUv = uv;",
                "    vUvScaled = uv * uvScale;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform sampler2D tOverlay;",
                "uniform float opacity;",
                "uniform float alphaOnly;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vec4 bg = texture2D(tDiffuse, vUvScaled);",
                // The overlay covers exactly the layer frame, so it is sampled unscaled.
                "    vec4 ov = texture2D(tOverlay, vUv);",
                "    float a = clamp(ov.a * opacity, 0.0, 1.0);",
                "    vec3 rgb = mix(mix(bg.rgb, ov.rgb, a), ov.rgb, alphaOnly);",
                "    float alpha = mix(max(bg.a, a), ov.a, alphaOnly);",
                "    gl_FragColor = vec4(rgb, alpha);",
                "}",
            ].join("\n"),
        });
        material.transparent = true;
        this.material = material;
        this.uniforms = material.uniforms;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene.add(this.camera);
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), material);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        var detectMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                keyColor: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
                blurR: { type: "f", value: 0 },
                texel: { type: "v2", value: new THREE.Vector2(1 / 64, 1 / 64) },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            },
            vertexShader: [
                "varying vec2 vUv;",
                "void main() {",
                "    vUv = uv;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform vec3 keyColor;",
                "uniform float blurR;",
                "uniform vec2 texel;",
                "uniform vec2 uvScale;",
                "varying vec2 vUv;",
                "void main() {",
                "    vec3 acc = vec3(0.0);",
                "    float n = 0.0;",
                "    for (int i = -8; i <= 8; i++) {",
                "        for (int j = -8; j <= 8; j++) {",
                "            float fi = float(i);",
                "            float fj = float(j);",
                "            if (abs(fi) <= blurR && abs(fj) <= blurR) {",
                "                acc += texture2D(tDiffuse, (vUv + vec2(fi, fj) * texel) * uvScale).rgb;",
                "                n += 1.0;",
                "            }",
                "        }",
                "    }",
                "    vec3 avg = acc / max(n, 1.0);",
                "    float d = distance(avg, keyColor);",
                "    float strength = clamp(1.0 - d / 1.5, 0.0, 1.0);",
                "    gl_FragColor = vec4(strength, strength, strength, 1.0);",
                "}",
            ].join("\n"),
        });
        this.detectMaterial = detectMaterial;
        this.detectUniforms = detectMaterial.uniforms;
    };
    THREE.TraceryPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
        constructor: THREE.TraceryPass,
        setSize: function (e, t) {},
        detectSizes: function () {
            return [[64, 36], [128, 72], [192, 108], [320, 180]];
        },
        render: function (renderer, writeBuffer, readBuffer) {
            var w = readBuffer ? readBuffer.width : 0;
            var h = readBuffer ? readBuffer.height : 0;
            if (!w || !h) return;
            var region = trLayerRegion(w, h, this.uniforms.uvScale.value, this.layerResolution);
            var lw = region.width;
            var lh = region.height;
            if (!this.canvas || this.canvasWidth !== lw || this.canvasHeight !== lh) {
                this.canvas = document.createElement("canvas");
                this.canvas.width = lw;
                this.canvas.height = lh;
                this.canvasWidth = lw;
                this.canvasHeight = lh;
                if (this.canvasTexture) this.canvasTexture.dispose();
                this.canvasTexture = new THREE.CanvasTexture(this.canvas);
                // Without mipmaps a non-power-of-two canvas is uploaded at its own
                // size instead of being resampled, so thin strokes keep their position.
                this.canvasTexture.generateMipmaps = false;
                this.canvasTexture.minFilter = THREE.LinearFilter;
                this.drawnState = null;
            }
            var st = this.overlayState;
            var detect = !!(st && st.detectEnable);
            var regions = detect ? this.detectRegions(renderer, readBuffer, st, region) || [] : [];
            // Detected regions follow the footage, so detection redraws every frame.
            if (st && (detect || st !== this.drawnState)) {
                try {
                    var ctx = this.canvas.getContext("2d");
                    var drawState = st;
                    if (regions.length) {
                        var merged = [];
                        for (var m = 0; m < st.points.length; m++) merged.push(st.points[m]);
                        for (var r = 0; r < regions.length; r++) merged.push(regions[r]);
                        drawState = {};
                        for (var k in st) {
                            if (Object.prototype.hasOwnProperty.call(st, k)) {
                                drawState[k] = st[k];
                            }
                        }
                        drawState.points = merged;
                    }
                    trDrawOverlay(ctx, lw, lh, drawState);
                    this.canvasTexture.needsUpdate = true;
                    this.drawnState = st;
                } catch (err) {
                    var message = String((err && err.stack) || err).slice(0, 300);
                    if (message !== this.lastError) {
                        this.lastError = message;
                        console.error("[Zoidium] Tracery overlay failed:", message);
                    }
                }
            }
            this.uniforms.tDiffuse.value = readBuffer.texture;
            if (st && st.showMask && st.detectEnable && this.detectTarget) {
                this.uniforms.tOverlay.value = this.detectTarget.texture;
            } else {
                this.uniforms.tOverlay.value = this.canvasTexture ? this.canvasTexture : null;
            }
            this.uniforms.opacity.value = this.opacity;
            this.uniforms.alphaOnly.value = st && st.alphaLayer ? 1 : 0;
            var oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(this.scene, this.camera, writeBuffer || readBuffer, true);
            renderer.autoClear = oldAutoClear;
        },
        detectRegions: function (renderer, readBuffer, st, region) {
            var sizes = this.detectSizes();
            var q = Math.max(0, Math.min(3, st.detectionQuality || 0));
            var dw = sizes[q][0];
            var dh = sizes[q][1];
            if (!this.detectTarget || this.detectWidth !== dw || this.detectHeight !== dh) {
                if (this.detectTarget) this.detectTarget.dispose();
                this.detectTarget = new THREE.WebGLRenderTarget(dw, dh, {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: false,
                    stencilBuffer: false,
                });
                this.detectWidth = dw;
                this.detectHeight = dh;
                this.detectPixels = new Uint8Array(dw * dh * 4);
            }
            var oldMat = this.quad.material;
            this.detectUniforms.tDiffuse.value = readBuffer.texture;
            this.detectUniforms.keyColor.value.set(st.keyColor[0], st.keyColor[1], st.keyColor[2]);
            this.detectUniforms.blurR.value = Math.max(0, Math.min(8, st.blurStrength));
            this.detectUniforms.texel.value.set(1 / dw, 1 / dh);
            this.detectUniforms.uvScale.value.set(region.sx, region.sy);
            this.quad.material = this.detectMaterial;
            var oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(this.scene, this.camera, this.detectTarget, true);
            renderer.autoClear = oldAutoClear;
            this.quad.material = oldMat;
            renderer.readRenderTargetPixels(this.detectTarget, 0, 0, dw, dh, this.detectPixels);
            // Match strengths live in R; flip rows to top-down for labeling.
            var grid = new Uint8Array(dw * dh);
            for (var y = 0; y < dh; y++) {
                for (var x = 0; x < dw; x++) {
                    grid[y * dw + x] = this.detectPixels[((dh - 1 - y) * dw + x) * 4];
                }
            }
            var minArea = Math.max(4, Math.round((dw * dh) / 4000));
            var found = trDetectRegions(grid, dw, dh, st.threshold, minArea, 24);
            var S = region.height / 1080;
            var pts = [];
            for (var i = 0; i < found.length; i++) {
                (function (g, n) {
                    var bw = Math.max(8, (g.maxX - g.minX + 1) * (region.width / dw));
                    var bh = Math.max(8, (g.maxY - g.minY + 1) * (region.height / dh));
                    pts.push({
                        enable: true,
                        x: ((g.minX + g.maxX + 1) / 2 / dw) * 100,
                        y: ((g.minY + g.maxY + 1) / 2 / dh) * 100,
                        size: Math.max(bw, bh) / S,
                        label: "",
                        labelDX: (n % 3 - 1) * 180,
                        labelDY: n % 2 ? 90 : -90,
                    });
                })(found[i], i);
            }
            return pts;
        },
        dispose: function () {
            if (this.canvasTexture) this.canvasTexture.dispose();
            this.canvasTexture = null;
            this.canvas = null;
            if (this.detectTarget) this.detectTarget.dispose();
            this.detectTarget = null;
            this.detectPixels = null;
            if (this.material) this.material.dispose();
            if (this.detectMaterial) this.detectMaterial.dispose();
            if (this.quad) this.quad.geometry.dispose();
        },
    });
}
