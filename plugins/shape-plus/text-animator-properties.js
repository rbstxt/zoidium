"use strict";
// Native property definitions for the Text Animator contents kind. Animated
// transform properties are dynamic (keyable, expressions allowed) and gated by
// a static enabled flag each: a disabled property contributes nothing and its
// row is hidden by native-properties.js. Discrete settings (units, based on,
// mode, shape, grouping and every enabled flag) are static values, never
// tweened. Variable-axis properties are registered per font by animatorAxes()
// below, mirroring text-properties.js axes().
const { axisLabel } = require("./text-font.js");
const DEG = Math.PI / 180;
const ANIMATED_KEYS = ["anchor", "position", "scale", "skew", "skewAxis", "rotation", "tracking", "charOffset", "groupingAlignment"];
const enabledKey = key => "enabled_" + key;
function definitions(PZ, number, vector, list) {
  const T = PZ.property.type;
  const flag = name => ({ name, type: T.OPTION, value: 0, items: "off;on", visible: false });
  const choice = (name, value, items) => ({ name, type: T.LIST, value, items: items.map(item => typeof item === "string" ? { name: item, value: item } : item) });
  const result = {
    anchor: vector("Anchor Point", [0, 0]),
    position: vector("Position", [0, 0]),
    scale: vector("Scale (%)", [100, 100]),
    skew: number("Skew", 0, { scaleFactor: DEG }),
    skewAxis: number("Skew Axis", 0, { scaleFactor: DEG }),
    rotation: number("Rotation", 0, { scaleFactor: DEG }),
    tracking: number("Tracking Amount", 0),
    charOffset: number("Character Offset", 0, { decimals: 0 }),
    groupingAlignment: vector("Grouping Alignment (%)", [0, 0]),
    anchorGrouping: choice("Anchor Point Grouping", "character", [
      { name: "Character", value: "character" }, { name: "Word", value: "word" },
      { name: "Line", value: "line" }, { name: "All", value: "all" },
    ]),
    selectorUnits: choice("Units", "percentage", [
      { name: "Percentage", value: "percentage" }, { name: "Index", value: "index" },
    ]),
    selectorStart: number("Range Start", 0),
    selectorEnd: number("Range End", 100),
    selectorOffset: number("Range Offset", 0),
    selectorBasedOn: choice("Based On", "characters", [
      { name: "Characters", value: "characters" },
      { name: "Characters Excluding Spaces", value: "noSpaces" },
      { name: "Words", value: "words" }, { name: "Lines", value: "lines" },
    ]),
    selectorMode: choice("Mode", "add", [
      { name: "Add", value: "add" }, { name: "Subtract", value: "subtract" },
      { name: "Intersect", value: "intersect" }, { name: "Min", value: "min" },
      { name: "Max", value: "max" }, { name: "Difference", value: "difference" },
    ]),
    selectorAmount: number("Amount (%)", 100, { min: -100, max: 100 }),
    selectorShape: choice("Shape", "square", [
      { name: "Square", value: "square" }, { name: "Ramp Up", value: "rampUp" },
      { name: "Ramp Down", value: "rampDown" }, { name: "Triangle", value: "triangle" },
      { name: "Round", value: "round" }, { name: "Smooth", value: "smooth" },
    ]),
    selectorEaseHigh: number("Ease High (%)", 0, { min: -100, max: 100 }),
    selectorEaseLow: number("Ease Low (%)", 0, { min: -100, max: 100 }),
    selectorRandomize: { name: "Randomize Order", type: T.OPTION, value: 0, items: "off;on" },
    selectorRandomSeed: number("Random Seed", 0, { decimals: 0 }),
    wigglyOn: flag("Wiggly Selector"),
    wigglyMode: choice("Wiggly Mode", "add", [
      { name: "Add", value: "add" }, { name: "Subtract", value: "subtract" },
      { name: "Intersect", value: "intersect" }, { name: "Min", value: "min" },
      { name: "Max", value: "max" }, { name: "Difference", value: "difference" },
    ]),
    wigglyMax: number("Maximum Amount (%)", 100),
    wigglyMin: number("Minimum Amount (%)", -100),
    wigglyBasedOn: choice("Wiggly Based On", "characters", [
      { name: "Characters", value: "characters" },
      { name: "Characters Excluding Spaces", value: "noSpaces" },
      { name: "Words", value: "words" }, { name: "Lines", value: "lines" },
    ]),
    wigglesPerSecond: number("Wiggles / Second", 2, { min: 0 }),
    correlation: number("Correlation (%)", 50, { min: 0, max: 100 }),
    temporalPhase: number("Temporal Phase (degrees)", 0),
    spatialPhase: number("Spatial Phase (degrees)", 0),
    lockDimensions: { name: "Lock Dimensions", type: T.OPTION, value: 0, items: "off;on" },
    wigglySeed: number("Wiggly Random Seed", 0, { decimals: 0 }),
  };
  for (const key of ANIMATED_KEYS) result[enabledKey(key)] = flag(result[key].name);
  return result;
}
// Register one dynamic offset property per variable axis of the given fonts
// (union, first font first), preserving inactive channels in node.hiddenAxes
// exactly like text-properties.js axes() so they survive font switches and
// save/load through the animator's axisStore.
function animatorAxes(PZ, node, fonts) {
  const list = (Array.isArray(fonts) ? fonts : [fonts]).filter(Boolean);
  const tags = [];
  for (const font of list) for (const tag of Object.keys(font.axes || {})) if (!tags.includes(tag)) tags.push(tag);
  const p = node.properties, before = node.extra?.properties || {};
  const hidden = node.hiddenAxes ||= {};
  for (const key of Object.keys(before)) {
    const tag = key.startsWith("axis_") ? key.slice(5) : key.startsWith("enabled_axis_") ? key.slice(13) : null;
    if (tag && !p[key] && !tags.includes(tag)) { hidden[key] = JSON.parse(JSON.stringify(before[key])); delete before[key]; }
  }
  for (const tag of tags) {
    const key = "axis_" + tag;
    let axis = null;
    for (const font of list) if (font.axes[tag]) { axis = font.axes[tag]; break; }
    if (!p[key]) {
      const label = axisLabel(tag, axis.name);
      p.add(key, { name: label, type: PZ.property.type.NUMBER, dynamic: true, value: 0, step: 1 });
      p[key].load(hidden[key] ?? before[key]);
      delete hidden[key];
    } else p[key].definition.name = axisLabel(tag, axis.name);
    if (!p[enabledKey(key)]) {
      p.add(enabledKey(key), { name: (p[key]?.definition?.name || tag) + " enabled", type: PZ.property.type.OPTION, value: 0, items: "off;on", visible: false });
      p[enabledKey(key)].load(hidden[enabledKey(key)] ?? before[enabledKey(key)]);
      delete hidden[enabledKey(key)];
    }
  }
  for (const key of Object.keys(p)) if (key.startsWith("axis_") && !tags.includes(key.slice(5))) {
    hidden[key] = JSON.parse(JSON.stringify(p[key])); delete before[key]; p.remove(key);
    if (p[enabledKey(key)]) { hidden[enabledKey(key)] = JSON.parse(JSON.stringify(p[enabledKey(key)])); p.remove(enabledKey(key)); }
  }
  p.onListChanged?.update();
}
module.exports = { DEG, ANIMATED_KEYS, enabledKey, definitions, animatorAxes };
