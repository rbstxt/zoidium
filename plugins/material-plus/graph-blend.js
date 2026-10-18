"use strict";

// Entries are append-only: existing saved blend-mode indices are public data.
const names = ["soft light", "dodge", "burn", "linear light", "divide", "exclusion", "hue", "saturation", "color", "value"];
function blend(a, b, mode) {
    switch (mode) {
        case 9: return b <= .5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * ((a <= .25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a);
        case 10: return b >= 1 ? 1 : Math.min(1, a / (1 - b));
        case 11: return b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b);
        case 12: return a + 2 * b - 1;
        case 13: return Math.abs(b) < 1e-12 ? 0 : a / b;
        case 14: return a + b - 2 * a * b;
        default: return b;
    }
}
// Scratch arrays are supplied by the caller, outside its pixel loop.
function hsv(r, g, b, out) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    out[0] = h / 6; out[1] = max ? d / max : 0; out[2] = max;
    return out;
}
function rgb(h, s, v, out) {
    h = (h - Math.floor(h)) * 6;
    const sector = Math.floor(h), f = h - sector, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    out[0] = sector === 0 || sector === 5 ? v : sector === 1 ? q : sector === 4 ? t : p;
    out[1] = sector === 1 || sector === 2 ? v : sector === 0 ? t : sector === 3 ? q : p;
    out[2] = sector === 3 || sector === 4 ? v : sector === 2 ? t : sector === 5 ? q : p;
    return out;
}
function blendColor(ar, ag, ab, br, bg, bb, mode, a, b, result) {
    hsv(ar, ag, ab, a); hsv(br, bg, bb, b);
    return rgb(mode === 15 || mode === 17 ? b[0] : a[0], mode === 16 || mode === 17 ? b[1] : a[1], mode === 18 ? b[2] : a[2], result);
}
module.exports = { names, blend, hsv, rgb, blendColor };
