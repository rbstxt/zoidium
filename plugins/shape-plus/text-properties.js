"use strict";
const { axisLabel } = require("./text-font.js");
function definitions(PZ, number, vector, list) {
  const T = PZ.property.type;
  const choice = (...args) => ({ ...list(...args), dynamic: true });
  const font = name => ({ name, type: T.ASSET, dynamic: true, assetType: PZ.asset?.type.FONT, value: name === "Font Family" ? "/assets/fonts/2d/bebas.ttf" : null, accept: ".ttf,.otf,.woff,.woff2" });
  return {
    sourceText: { name: "Source Text", type: T.TEXT, dynamic: true, value: "Text", zoidiumControl: "shape-plus/source-text" },
    font: font("Font Family"), fallbackFont: font("Fallback Font"),
    fontStyle: { ...choice("Style", "", [""]), zoidiumControl: "shape-plus/font-style" },
    fontSize: number("Size", 100, { min: 0 }), tracking: number("Tracking", 0), leading: number("Leading", 120),
    baselineShift: number("Baseline Shift", 0), horizontalScale: number("Horizontal Scale (%)", 100), verticalScale: number("Vertical Scale (%)", 100),
    caps: choice("Caps", "normal", ["normal", "all", "small"]), position: vector("Position", [0,0]),
    alignment: choice("Alignment", "left", ["left", "center", "right", "justifyLeft", "justifyCenter", "justifyRight", "justifyAll"]),
    textMode: choice("Text Mode", "point", ["point", "box"]), boxSize: vector("Box Size", [600,400]),
    firstLineIndent: number("First-Line Indent", 0), spaceBefore: number("Space Before", 0), spaceAfter: number("Space After", 0),
  };
}
function holdValue(property, frame) {
  if (property.expression) return property.get(frame);
  const keys = property.keyframes || property.data?.keyframes;
  if (!keys?.length) return property.get(frame);
  let previous = keys[0];
  for (const key of keys) { if (key.frame > frame) break; previous = key; }
  return previous.value;
}
function axes(PZ, node, font) {
  const p = node.properties, before = node.extra?.properties || {};
  const hidden = node.hiddenAxes ||= {};
  for (const key of Object.keys(before)) if (key.startsWith("axis_") && !p[key] && !font.axes[key.slice(5)]) {
    hidden[key] = JSON.parse(JSON.stringify(before[key])); delete before[key];
  }
  for (const tag of Object.keys(font.axes)) {
    const key = "axis_" + tag, axis = font.axes[tag], name = axisLabel(tag, axis.name);
    if (!p[key]) {
      p.add(key, { name, type: PZ.property.type.NUMBER, dynamic: true, value: axis.default, min: axis.min, max: axis.max, step: 1 });
      p[key].load(hidden[key] ?? before[key]);
      delete hidden[key];
    } else Object.assign(p[key].definition, { name, min: axis.min, max: axis.max });
  }
  for (const key of Object.keys(p)) if (key.startsWith("axis_") && !font.axes[key.slice(5)]) {
    hidden[key] = JSON.parse(JSON.stringify(p[key])); delete before[key]; p.remove(key);
  }
  p.fontStyle.definition.items = [{ name: font.style, value: "" }, ...font.instances.map(instance => ({ name: instance.name, value: instance.name }))];
  p.onListChanged?.update();
}
function localFrame(property, editor, PZ) {
  const clip = property.tryGetParentOfType?.(PZ.clip);
  return editor.playback.currentFrame - (clip?.start || 0) + (clip?.offset || 0);
}
module.exports = { definitions, holdValue, axes, localFrame };
