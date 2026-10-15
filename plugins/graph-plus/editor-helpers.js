"use strict";

module.exports = function (PZ) {
const { g2doc } = require("./pointer.js");
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function curveColor(name) {
  var h = 0;
  try { h = (47 * PZ.stringHash(name || "")) % 360; } catch (e) { h = 200; }
  if (h < 0) h += 360;
  return "hsl(" + h + ",70%,62%)";
}
/* ---- toolbar icons: themed strokes and key rings
   NOTE: every shape carries inline style fill/stroke because CSS rules
   (e.g. `.elevator svg{fill:...}`) override SVG presentation attributes. ---- */
var G2_BLUE = "var(--zui-accent)", G2_LINE = "var(--zui-text-bright)", G2_DARK = "var(--zui-bg-input)";
function g2key(x, y, r) {
  return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + G2_DARK + '" stroke="' + G2_BLUE +
    '" stroke-width="1.8" style="fill:' + G2_DARK + ';stroke:' + G2_BLUE + '"/>';
}
function g2wrap(inner, vb) {
  return '<svg viewBox="' + (vb || "0 0 28 16") + '" width="28" height="16" style="display:block;fill:none;stroke:' + G2_LINE + '">' + inner + "</svg>";
}
/* interpolation icons matching the 5 user designs */
function interpIcon(kind) {
  var L = 'stroke="' + G2_LINE + '" stroke-width="2" stroke-linecap="round" fill="none" style="fill:none;stroke:' + G2_LINE + ';stroke-width:2;stroke-linecap:round"';
  if (kind === "linear") return g2wrap('<line x1="6" y1="12" x2="22" y2="4" ' + L + "/>" + g2key(5, 13, 3) + g2key(23, 3, 3));
  if (kind === "hold") return g2wrap('<line x1="7" y1="8" x2="21" y2="8" ' + L + "/>" + g2key(5, 8, 3) + g2key(14, 8, 3) + g2key(23, 8, 3));
  if (kind === "out") return g2wrap('<polyline points="6,12 14,5 22,5" ' + L + ' stroke-linejoin="round"/>' + g2key(5, 13, 3) + g2key(14, 5, 3) + g2key(23, 5, 3));
  if (kind === "in") return g2wrap('<path d="M6 13 C 13 13, 17 10, 22 4" ' + L + "/>" + g2key(5, 13, 3) + g2key(23, 3, 3));
  if (kind === "step") return g2wrap('<polyline points="6,11 18,11 18,4 22,4" ' + L + ' stroke-linejoin="round"/>' + g2key(5, 11, 3) + g2key(23, 3, 3));
  return "";
}
/* big toolbar tile artwork (user design): white curve + open circle ends on dark tile */
function tileIcon(kind) {
  var L = 'stroke="var(--zui-text-bright)" stroke-width="2" fill="none" style="fill:none;stroke:var(--zui-text-bright);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"';
  function dot(x, y) {
    return '<circle cx="' + x + '" cy="' + y + '" r="2.7" fill="var(--zui-bg-input)" stroke="var(--zui-text-bright)" stroke-width="1.7" style="fill:var(--zui-bg-input);stroke:var(--zui-text-bright);stroke-width:1.7"/>';
  }
  var inner = "";
  if (kind === "linear") inner = '<line x1="8" y1="24" x2="36" y2="8" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  else if (kind === "step") inner = '<polyline points="6,25 24,25 24,7 30,7" ' + L + "/>" + dot(6, 25) + dot(30, 7);
  else if (kind === "ease") inner = '<path d="M6 25 C 17 25, 24 21, 38 7" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  else if (kind === "break") inner = '<polyline points="6,25 19,12 27,17 38,7" ' + L + "/>" + dot(6, 25) + dot(19, 12) + dot(38, 7);
  else if (kind === "auto") inner = '<line x1="8" y1="16" x2="36" y2="16" ' + L + "/>" + dot(6, 16) + dot(22, 16) + dot(38, 16);
  else if (kind === "custom") inner = '<line x1="8" y1="24" x2="36" y2="8" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  return '<svg viewBox="0 0 44 32" width="50" height="36" style="display:block;fill:none;stroke:var(--zui-text-bright)">' + inner + "</svg>";
}
/* small diagonal thumbnail artwork for the "Custom easings" item (user design) */
function customEaseIcon() {
  var L = 'stroke="var(--zui-text-strong)" stroke-width="2.4" fill="none" style="fill:none;stroke:var(--zui-text-strong);stroke-width:2.4;stroke-linecap:round"';
  return '<svg viewBox="0 0 44 26" width="44" height="26" style="display:block;fill:none;stroke:var(--zui-text-strong)">' +
    '<line x1="9" y1="21" x2="35" y2="5" ' + L + "/>" +
    '<circle cx="7" cy="23" r="2.2" fill="var(--zui-border)" stroke="var(--zui-text-strong)" stroke-width="1.5" style="fill:var(--zui-border);stroke:var(--zui-text-strong)"/>' +
    '<circle cx="37" cy="3" r="2.2" fill="var(--zui-border)" stroke="var(--zui-text-strong)" stroke-width="1.5" style="fill:var(--zui-border);stroke:var(--zui-text-strong)"/>' +
    "</svg>";
}
/* small 14px tool glyphs, white strokes */
function toolIcon(name) {
  var s = 'fill="none" stroke="var(--zui-text-bright)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="fill:none;stroke:var(--zui-text-bright);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"';
  var inner = "";
  if (name === "pan") inner = '<path d="M8 1.5v13M1.5 8h13" ' + s + "/>";
  else if (name === "fit") inner = '<path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" ' + s + "/>";
  else if (name === "sel") inner = '<rect x="2" y="2" width="12" height="12" rx="1" ' + s + ' stroke-dasharray="2.5 2"/>';
  else if (name === "marquee") inner = '<rect x="2" y="2.5" width="10.5" height="10.5" rx="1" ' + s + ' stroke-dasharray="3 2"/><circle cx="12.5" cy="13" r="1.5" fill="var(--zui-text-bright)" style="fill:var(--zui-text-bright)"/>';
  else if (name === "frame") inner = '<rect x="3" y="3" width="10" height="10" rx="1" ' + s + '/><circle cx="8" cy="8" r="1.3" fill="var(--zui-text-bright)" style="fill:var(--zui-text-bright)"/>';
  else if (name === "norm") inner = '<path d="M2 12.5h12M2 8h8M2 3.5h12" ' + s + "/>";
  else if (name === "snap") inner = '<path d="M4.5 1.5v5.5a3.5 3.5 0 0 0 7 0V1.5M4.5 1.5h2.6v4.6H4.5zM8.9 1.5h2.6v4.6H8.9zM8 10.5v3.5" ' + s + "/>";
  else if (name === "key") inner = '<rect x="4.8" y="4.8" width="6.4" height="6.4" transform="rotate(45 8 8)" ' + s + "/>";
  else if (name === "del") inner = '<path d="M2.5 4.5h11M6 4.5V2.5h4v2M4.5 4.5l.8 9h5.4l.8-9" ' + s + "/>";
  else if (name === "bez") inner = '<path d="M2 12.5C6 12.5 6 3.5 14 3.5" ' + s + '/><circle cx="2" cy="12.5" r="1.6" fill="var(--zui-text-bright)" style="fill:var(--zui-text-bright)"/><circle cx="14" cy="3.5" r="1.6" fill="var(--zui-text-bright)" style="fill:var(--zui-text-bright)"/>';
  else if (name === "link") inner = '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" ' + s + "/>";
  else if (name === "flat") inner = '<path d="M2 8h12" ' + s + "/>";
  else if (name === "copy") inner = '<rect x="5" y="5" width="9" height="9" rx="1" ' + s + '/><path d="M11 5V2.5H2.5V11H5" ' + s + "/>";
  else if (name === "paste") inner = '<rect x="3" y="3.5" width="10" height="10.5" rx="1" ' + s + '/><path d="M6 3.5V1.8h4v1.7" ' + s + "/>";
  else if (name === "tag") inner = '<path d="M2.5 2.5H8l5.5 5.5-5.5 5.5L2.5 8z" ' + s + '/><circle cx="6" cy="6" r="1.2" fill="var(--zui-text-bright)" style="fill:var(--zui-text-bright)"/>';
  return '<svg viewBox="0 0 16 16" width="14" height="14" style="display:block;fill:none;stroke:var(--zui-text-bright);padding:0">' + inner + "</svg>";
}
/* focus for keyboard shortcuts WITHOUT scrolling the panel (scroll-jump hid the toolbar) */
function focusNoScroll(el) {
  try {
    if (el && el.focus) {
      var doc = g2doc(el);
      try {
        if (doc && doc.activeElement === el) return;
      } catch (e0) {}
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  } catch (e) { /* A detached node needs no focus. */ }
}
// Object and property names come from the project file; escape them before
// they reach innerHTML.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function displayName(prop) {
  try {
    if (prop.properties && prop.properties.name) return prop.properties.name.get();
  } catch (e) {}
  try {
    if (prop.definition && prop.definition.name) return prop.definition.name;
  } catch (e) {}
  return "Property";
}
function scaleFactorOf(prop) {
  try {
    if (prop.definition && prop.definition.scaleFactor) return prop.definition.scaleFactor;
  } catch (e) {}
  return 1;
}
function addrString(prop) {
  try { return JSON.stringify(prop.getAddress()); } catch (e) { return displayName(prop); }
}
function currentFrame(editor) {
  try { return editor.playback.currentFrame | 0; } catch (e) { return 0; }
}
function totalFrames(editor) {
  try {
    if (editor.playback && editor.playback.totalFrames) return editor.playback.totalFrames;
    if (editor.sequence && editor.sequence.length) return editor.sequence.length;
  } catch (e) {}
  return 180;
}

return { clamp, curveColor, interpIcon, tileIcon, customEaseIcon, toolIcon, focusNoScroll, escapeHtml, displayName, scaleFactorOf, addrString, currentFrame, totalFrames };
};
