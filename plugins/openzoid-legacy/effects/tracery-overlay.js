// Tracery canvas overlay drawing (split from tracery.js).
// Boxes, markers, connection lines, arrows, labels, grid and state capture.
// Pure drawing on a 2d context plus property reads; no state is kept.

const traceryPaths = require("./tracery-paths.js");

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
                var path = traceryPaths.trRoutePath(
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
                    var at = traceryPaths.trPathPoint(path, st.arrowPosition);
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

module.exports = {
    trClamp01,
    trLayerRegion,
    trNum3,
    trCss,
    trDrawOverlay,
    trTraceBox,
    trBoxEdge,
    trDrawMarker,
    trDrawArrow,
    trDrawLabel,
    trCollectState,
};

