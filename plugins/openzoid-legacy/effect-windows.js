"use strict";

// OpenZoid Legacy — ASCII and Tracery setup windows.
//
// The "Setup" property buttons of the ASCII and Tracery effects open floating
// windows (docs/plugin-ui.md) above the editor. Controls are generated from the
// effect's property definitions. Every edit is written through CM3 property
// operations inside one history operation, so undo and redo work. A drag
// previews live and commits once on release. The main viewport is the live
// preview; the windows keep no render state and do not borrow any viewport.
// The property-button renderer that shows these buttons is installed by
// vhs-setup.js in this same pack.

const SYNC_INTERVAL_MS = 300;

// Window layouts. Each group is a section; keys are effect property ids.
const ASCII_LAYOUT = [
  { title: "Presets", presets: true },
  { title: "Grid", keys: ["blockSize", "charSize", "fontFamily"] },
  { title: "Image", keys: ["backgroundColor", "contrast", "brightness"] },
  {
    title: "Characters",
    keys: ["charset", "customChars", "randomCharacters"],
  },
  {
    title: "Bands",
    collapsed: true,
    keys: [
      "blackFill", "blackStroke", "blackColor", "blackOpacity",
      "whiteFill", "whiteStroke", "whiteColor", "whiteOpacity",
      "greyFill", "greyStroke", "greyColor", "greyOpacity",
      "alphaFill", "alphaStroke", "alphaColor", "alphaOpacity",
    ],
  },
  { title: "Color mode", keys: ["colorMode", "duotoneDark", "duotoneLight", "monoColor"] },
  { title: "Random", collapsed: true, keys: ["randomScale", "noiseIntensity"] },
  {
    title: "Sine waves",
    collapsed: true,
    keys: ["sineEnable", "sineRadial", "sineSpeed", "sineFrequency", "sineSize", "sineIntensity"],
  },
  {
    title: "Advanced noise",
    collapsed: true,
    keys: ["noiseEnable", "noiseType", "noiseScale", "noiseSpeed", "noiseOctaves", "noisePersistence"],
  },
  { title: "Scroll", collapsed: true, keys: ["scrollEnable", "scrollWaves", "scrollSpeed"] },
  { title: "Glitch", collapsed: true, keys: ["glitchEnable", "glitchAmount", "glitchSpeed"] },
];

const TRACERY_LAYOUT = [
  { title: "Presets", presets: true },
  {
    title: "Detection",
    keys: ["detectEnable", "detectionQuality", "keyColor", "threshold", "blurStrength", "showMask", "alphaLayer"],
  },
  {
    title: "Boxes",
    keys: ["boxEnable", "boxShape", "boxColor", "boxOpacity", "boxLineWidth", "boxFill", "boxFillColor", "boxFillOpacity"],
  },
  {
    title: "Markers",
    keys: ["markerShape", "markerSize", "markerColor", "markerOpacity", "markerRotation", "markerSides", "markerFilled"],
  },
  { title: "Grid", collapsed: true, keys: ["gridEnable", "gridMode", "gridDivisions", "gridColor", "gridOpacity"] },
  {
    title: "Connections",
    collapsed: true,
    keys: [
      "linesEnable", "lineType", "lineColor", "lineOpacity", "lineThickness",
      "splineTension", "splineContinuity", "splineBias", "showHandles", "lineCorner",
      "dashEnable", "dashLength", "dashGap", "arrowEnable", "arrowColor", "arrowOpacity",
      "arrowSize", "arrowAngle", "arrowPosition", "arrowFilled",
    ],
  },
  { title: "Labels", collapsed: true, keys: ["labelsEnable", "labelMode", "labelFontSize", "labelColor", "labelOpacity"] },
  { title: "Points", points: true },
];

const ASCII_PRESETS = [
  {
    label: "Red Matrix",
    values: {
      blockSize: 23, contrast: 1, brightness: 0, fontFamily: 0, charSize: 18,
      charset: 0, colorMode: 0, randomCharacters: 0, randomScale: 0, noiseIntensity: 0,
      sineEnable: 0, noiseEnable: 0, scrollEnable: 0, glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
    },
    background: [0.03, 0.03, 0.04],
    bands: {
      black: { fill: "@", color: [1, 0.16, 0.16] },
      white: { fill: "#", color: [1, 0.35, 0.35] },
      grey: { fill: "+", color: [0.75, 0.2, 0.2] },
      alpha: { fill: " ", color: [1, 1, 1] },
    },
  },
  {
    label: "Mono Paper",
    values: {
      blockSize: 18, contrast: 1.1, brightness: 0.05, fontFamily: 1, charSize: 16,
      charset: 0, colorMode: 0, randomCharacters: 0, randomScale: 0, noiseIntensity: 0,
      sineEnable: 0, noiseEnable: 0, scrollEnable: 0, glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
    },
    background: [0.93, 0.93, 0.92],
    bands: {
      black: { fill: "@", color: [0.1, 0.1, 0.1] },
      white: { fill: ".", color: [0.4, 0.4, 0.4] },
      grey: { fill: "+", color: [0.25, 0.25, 0.25] },
      alpha: { fill: " ", color: [0, 0, 0] },
    },
  },
  {
    label: "Blueprint",
    values: {
      blockSize: 26, contrast: 1, brightness: 0, fontFamily: 0, charSize: 22,
      charset: 0, colorMode: 0, randomCharacters: 0, randomScale: 40, noiseIntensity: 0.15,
      sineEnable: 1, sineRadial: 0, sineSpeed: 1, sineFrequency: 1, sineSize: 50, sineIntensity: 50,
      noiseEnable: 0, scrollEnable: 0, glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
    },
    background: [0.04, 0.08, 0.16],
    bands: {
      black: { fill: "@", color: [0.4, 0.7, 1] },
      white: { fill: "#", color: [0.8, 0.92, 1] },
      grey: { fill: "+", color: [0.55, 0.75, 1] },
      alpha: { fill: " ", color: [1, 1, 1] },
    },
  },
  {
    label: "Neon Night",
    values: {
      blockSize: 20, contrast: 1.2, brightness: -0.05, fontFamily: 1, charSize: 18,
      charset: 0, colorMode: 0, randomCharacters: 1, randomScale: 120, noiseIntensity: 0.2,
      sineEnable: 1, sineRadial: 1, sineSpeed: 1.5, sineFrequency: 2, sineSize: 60, sineIntensity: 70,
      noiseEnable: 1, noiseType: 2, noiseScale: 1.5, noiseSpeed: 1, noiseOctaves: 3, noisePersistence: 0.9,
      scrollEnable: 1, scrollWaves: 2, scrollSpeed: 3, glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
    },
    background: [0.02, 0.02, 0.05],
    bands: {
      black: { fill: "@", color: [1, 0.2, 0.8] },
      white: { fill: "#", color: [0, 0.9, 1] },
      grey: { fill: "*", color: [0.7, 0.4, 1] },
      alpha: { fill: " ", color: [1, 1, 1] },
    },
  },
  {
    label: "Glitch Storm",
    values: {
      blockSize: 18, contrast: 1.3, brightness: 0, fontFamily: 0, charSize: 16,
      charset: 2, colorMode: 1, randomCharacters: 0, randomScale: 60, noiseIntensity: 0.25,
      sineEnable: 0, noiseEnable: 1, noiseType: 3, noiseScale: 2, noiseSpeed: 2, noiseOctaves: 4, noisePersistence: 0.8,
      scrollEnable: 0, glitchEnable: 1, glitchAmount: 120, glitchSpeed: 4,
    },
    background: [0.01, 0.01, 0.02],
    bands: {
      black: { fill: "@", color: [1, 1, 1] },
      white: { fill: "#", color: [1, 1, 1] },
      grey: { fill: "+", color: [1, 1, 1] },
      alpha: { fill: " ", color: [1, 1, 1] },
    },
  },
];

const TRACERY_PRESETS = [
  {
    label: "Surveillance",
    values: {
      boxEnable: 1, boxShape: 0, boxLineWidth: 2, boxFill: 0,
      markerShape: 0, markerSize: 14, markerFilled: 1,
      gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 3.6,
      splineTension: 0, showHandles: 0, dashEnable: 0, arrowEnable: 0,
      labelsEnable: 1, labelMode: 0, labelFontSize: 20,
    },
    colors: { line: [1, 1, 1], marker: [1, 0.15, 0.15], box: [1, 1, 1], label: [1, 1, 1] },
    points: [
      { enable: 1, x: 30, y: 35, size: 130, dx: 150, dy: -80 },
      { enable: 1, x: 70, y: 60, size: 110, dx: -260, dy: 70 },
    ],
  },
  {
    label: "Blueprint",
    values: {
      boxEnable: 1, boxShape: 2, boxLineWidth: 1.5, boxFill: 0,
      markerShape: 3, markerSize: 10, markerFilled: 0,
      gridEnable: 1, gridMode: 0, gridDivisions: 8, gridOpacity: 0.3,
      linesEnable: 1, lineType: 1, lineThickness: 2, dashEnable: 0, arrowEnable: 0,
      labelsEnable: 1, labelMode: 1, labelFontSize: 18,
    },
    colors: { line: [0.4, 0.7, 1], marker: [0.4, 0.7, 1], box: [0.75, 0.85, 1], label: [0.85, 0.92, 1] },
    points: [
      { enable: 1, x: 35, y: 40, size: 150, dx: 170, dy: -90 },
      { enable: 1, x: 65, y: 55, size: 120, dx: -280, dy: 80 },
    ],
  },
  {
    label: "Neon Callout",
    values: {
      boxEnable: 1, boxShape: 0, boxLineWidth: 3, boxFill: 0,
      markerShape: 0, markerSize: 18, markerFilled: 1,
      gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 4,
      splineTension: 0.3, dashEnable: 1, dashLength: 12, dashGap: 6,
      arrowEnable: 1, arrowSize: 23, arrowPosition: 0.7, arrowFilled: 1,
      labelsEnable: 1, labelMode: 0, labelFontSize: 22,
    },
    colors: { line: [1, 0.2, 0.8], marker: [1, 0.2, 0.8], box: [1, 0.4, 0.9], label: [1, 1, 1] },
    points: [{ enable: 1, x: 40, y: 45, size: 140, dx: 180, dy: -100 }],
  },
  {
    label: "Minimal",
    values: {
      boxEnable: 1, boxShape: 0, boxLineWidth: 1.5, boxFill: 0,
      markerShape: 0, markerSize: 8, markerFilled: 1,
      gridEnable: 0, linesEnable: 0, dashEnable: 0, arrowEnable: 0,
      labelsEnable: 1, labelMode: 3, labelFontSize: 18,
    },
    colors: { line: [1, 1, 1], marker: [1, 1, 1], box: [1, 1, 1], label: [1, 1, 1] },
    points: [{ enable: 1, x: 50, y: 50, size: 120, dx: 160, dy: -80 }],
  },
  {
    // Detection-only: points 2 to 6 are switched off, Point 1 stays visible
    // (kept as placed, or put at the frame centre when it is off).
    label: "Key Track",
    clearPoints: true,
    values: {
      detectEnable: 1, threshold: 50, showMask: 0, blurStrength: 5,
      alphaLayer: 0, detectionQuality: 2,
      boxEnable: 1, boxShape: 0, boxLineWidth: 2, boxFill: 0,
      markerShape: 0, markerSize: 12, markerFilled: 1,
      gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 2.5,
      splineTension: 0, dashEnable: 1, dashLength: 8, dashGap: 5,
      arrowEnable: 0, labelsEnable: 1, labelMode: 0, labelFontSize: 20,
    },
    colors: { line: [1, 1, 1], marker: [1, 0.15, 0.15], box: [1, 1, 1], label: [1, 1, 1] },
    points: [],
  },
];

// Flattens a preset into { propertyKey: value } so it applies as one edit.
function asciiAssignments(preset) {
  const out = Object.assign({}, preset.values);
  if (preset.background) out.backgroundColor = preset.background;
  for (const band of Object.keys(preset.bands || {})) {
    out[band + "Fill"] = preset.bands[band].fill;
    out[band + "Color"] = preset.bands[band].color;
  }
  return out;
}

// `read(key)` returns the current value of a property (used to keep a point the
// user placed when a preset only switches other points off).
function traceryAssignments(preset, read) {
  const out = Object.assign({}, preset.values);
  const colorKeys = { line: "lineColor", marker: "markerColor", box: "boxColor", label: "labelColor" };
  for (const name of Object.keys(colorKeys)) {
    if (preset.colors && preset.colors[name]) out[colorKeys[name]] = preset.colors[name];
  }
  if (preset.clearPoints) {
    for (let n = 2; n <= 6; n++) out["point" + n + "Enable"] = 0;
    if (!read || Number(read("point1Enable")) !== 1) {
      out.point1Enable = 1;
      out.point1X = 50;
      out.point1Y = 50;
    }
  }
  (preset.points || []).forEach(function (pt, index) {
    const n = index + 1;
    out["point" + n + "Enable"] = pt.enable ? 1 : 0;
    out["point" + n + "X"] = pt.x;
    out["point" + n + "Y"] = pt.y;
    out["point" + n + "Size"] = pt.size;
    out["point" + n + "LabelDX"] = pt.dx;
    out["point" + n + "LabelDY"] = pt.dy;
  });
  return out;
}

const SPECS = {
  asciiSetup: {
    kind: "ascii",
    title: "ASCII Setup",
    persistKey: "ascii-setup",
    width: 360,
    height: 560,
    layout: ASCII_LAYOUT,
    presets: ASCII_PRESETS,
    presetList: true,
    assignments: asciiAssignments,
  },
  tracerySetup: {
    kind: "tracery",
    title: "Tracery Setup",
    persistKey: "tracery-setup",
    width: 360,
    height: 620,
    layout: TRACERY_LAYOUT,
    presets: TRACERY_PRESETS,
    assignments: traceryAssignments,
  },
};

// Stable per-effect window ids: reopening an effect's setup focuses its window.
const effectIds = new WeakMap();
let nextEffectId = 1;
function effectWindowKey(effect) {
  if (!effectIds.has(effect)) effectIds.set(effect, nextEffectId++);
  return effectIds.get(effect);
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return "#ffffff";
  return "#" + rgb.slice(0, 3).map(function (channel) {
    const n = Math.max(0, Math.min(255, Math.round(Number(channel) * 255)));
    return (n < 16 ? "0" : "") + n.toString(16);
  }).join("");
}

// Reads and writes effect properties through CM3's property operations so
// that every committed edit is a native history step.
function createBridge(context, effect) {
  const editor = context.editor;
  const ops = new context.PZ.ui.properties(editor);
  const gestures = new Map();
  const property = function (key) {
    return effect.properties[key] || null;
  };
  const frameOf = function (p) {
    return editor.playback.currentFrame - (p.frameOffset || 0);
  };
  const snapshot = function (value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  };
  const read = function (key) {
    const p = property(key);
    return p ? snapshot(p.get(frameOf(p))) : undefined;
  };
  const inOperation = function (fn) {
    editor.history.startOperation();
    try {
      fn();
    } finally {
      editor.history.finishOperation();
    }
  };
  return {
    read,
    // Live preview during a drag: updates the project without a history step.
    preview(key, value) {
      const p = property(key);
      if (!p) return;
      const frame = frameOf(p);
      if (!gestures.has(key)) gestures.set(key, snapshot(p.get(frame)));
      p.set(value, frame);
    },
    // One history step per user edit. A preceding drag supplies the start value.
    commit(key, value) {
      const p = property(key);
      const before = gestures.has(key) ? gestures.get(key) : read(key);
      gestures.delete(key);
      if (!p || JSON.stringify(before) === JSON.stringify(value)) return;
      inOperation(function () {
        ops.setValue({ property: p.getAddress(), frame: frameOf(p), value, oldValue: before });
      });
    },
    // A preset is one history step containing every assignment.
    apply(assignments) {
      inOperation(function () {
        for (const key of Object.keys(assignments)) {
          const p = property(key);
          if (!p) continue;
          ops.setValue({ property: p.getAddress(), frame: frameOf(p), value: assignments[key] });
        }
      });
    },
  };
}

function controlValue(binding, value) {
  if (binding.kind === "color") return rgbToHex(value);
  if (binding.kind === "checkbox") return Number(value) === 1;
  if (binding.kind === "select") return String(Math.round(Number(value)));
  return value;
}

// Creates one control for a property key. Control kind follows the property
// type; OPTION "off;on" properties render as checkboxes.
function bindControl(build, key) {
  const def = build.effect.propertyDefinitions && build.effect.propertyDefinitions[key];
  if (!def) return null;
  const { controls, bridge, PZ } = build;
  const types = PZ.property.type;
  const label = def.name || key;
  const value = bridge.read(key);
  let kind;
  let control;
  if (def.type === types.COLOR) {
    kind = "color";
    control = controls.color({
      label,
      value: rgbToHex(value),
      onInput(hex) { const rgb = hexToRgb(hex); if (rgb) bridge.preview(key, rgb); },
      onChange(hex) { const rgb = hexToRgb(hex); if (rgb) bridge.commit(key, rgb); },
    });
  } else if (def.type === types.TEXT) {
    kind = "text";
    control = controls.text({
      label,
      value: value == null ? "" : String(value),
      onChange(text) { bridge.commit(key, String(text)); },
    });
  } else if (def.type === types.OPTION && def.items === "off;on") {
    kind = "checkbox";
    control = controls.checkbox({
      label,
      value: Number(value) === 1,
      onChange(on) { bridge.commit(key, on ? 1 : 0); },
    });
  } else if (def.type === types.OPTION) {
    kind = "select";
    control = controls.select({
      label,
      value: String(Math.round(Number(value))),
      options: String(def.items).split(";").map(function (name, index) {
        return { value: index, label: name };
      }),
      onChange(choice) { bridge.commit(key, Number(choice)); },
    });
  } else {
    kind = "slider";
    control = controls.slider({
      label,
      value: Number(value),
      min: def.min,
      max: def.max,
      step: def.step,
      onInput(next) { bridge.preview(key, next); },
      onChange(next) { bridge.commit(key, next); },
    });
  }
  const binding = { key, kind, control, last: null };
  build.bindings.push(binding);
  return control.element;
}

// Converts a client point over the main viewport into percent coordinates of
// the layer frame (0-100, origin top-left). The compositor camera is orthographic
// over the sequence, and the layer's composite quad carries its position, scale
// and rotation, so the inverse of the quad's world transform gives the position
// in the layer's own unit square.
function roundPercent(value) {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

// The layer that owns an effect: the nearest ancestor with a composite quad.
function layerOfEffect(effect) {
  let owner = effect && effect.parent;
  for (let depth = 0; owner && depth < 8; depth++) {
    if (owner.composite && owner.composite.quad) return owner;
    owner = owner.parent;
  }
  return null;
}

function layerPercentAt(viewport, layer, clientX, clientY) {
  const canvas = viewport && viewport.canvas;
  const quad = layer && layer.composite && layer.composite.quad;
  const camera = viewport && viewport.compositor && viewport.compositor.camera;
  if (!canvas || !quad || !quad.matrixWorld || !camera) return null;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  const wx = camera.left + fx * (camera.right - camera.left);
  const wy = camera.top - fy * (camera.top - camera.bottom);
  // Column-major 2D affine part of the quad's world matrix: a, b, c, d and translation.
  const m = quad.matrixWorld.elements;
  const det = m[0] * m[5] - m[1] * m[4];
  if (!det) return null;
  const dx = wx - m[12];
  const dy = wy - m[13];
  const lx = (m[5] * dx - m[4] * dy) / det;
  const ly = (-m[1] * dx + m[0] * dy) / det;
  return { x: roundPercent((lx + 0.5) * 100), y: roundPercent((0.5 - ly) * 100) };
}

// One-shot point placement. While armed, the next primary press on the main
// viewport sets the point and its X/Y/Enable land in one history step. The press
// and its follow-up mouse events are swallowed so CM3 does not also select or
// orbit; the swallow ends at the click or after a short timeout. Escape, a second
// Place button, closing the window or disabling the plugin cancels, and every
// listener added here is removed by disarmPlacement.
const PLACEMENT_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "keydown"];
const PLACEMENT_SWALLOW_MS = 800;

function disarmPlacement(build) {
  const placement = build.placement;
  if (!placement) return;
  build.placement = null;
  clearTimeout(placement.timer);
  for (const type of PLACEMENT_EVENTS) window.removeEventListener(type, placement.handler, true);
  placement.canvas.style.cursor = placement.cursor;
  if (build.win && typeof build.win.setSubtitle === "function") build.win.setSubtitle("");
}

function armPlacement(build, index) {
  disarmPlacement(build);
  const viewport = build.context.editor.mainViewport;
  const canvas = viewport && viewport.canvas;
  if (!canvas) {
    if (build.win) build.win.setSubtitle("No preview is available to click.");
    return;
  }
  const placement = { canvas, cursor: canvas.style.cursor, armed: true, timer: null };
  const pointKey = "point" + index;
  placement.handler = function (event) {
    if (event.type === "keydown") {
      if (placement.armed && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        disarmPlacement(build);
      }
      return;
    }
    if (event.target !== canvas) return;
    if (placement.armed && event.type === "pointerdown" && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      placement.armed = false;
      const at = layerPercentAt(viewport, layerOfEffect(build.effect), event.clientX, event.clientY);
      if (at) {
        build.bridge.apply({
          [pointKey + "Enable"]: 1,
          [pointKey + "X"]: at.x,
          [pointKey + "Y"]: at.y,
        });
        syncBindings(build);
      }
      if (build.win) build.win.setSubtitle("");
      canvas.style.cursor = placement.cursor;
      placement.timer = setTimeout(function () { disarmPlacement(build); }, PLACEMENT_SWALLOW_MS);
      return;
    }
    if (placement.armed && event.button !== undefined && event.button !== 0) return;
    if (!placement.armed) {
      // Swallow the rest of the click that placed the point.
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "click") disarmPlacement(build);
    }
  };
  build.placement = placement;
  canvas.style.cursor = "crosshair";
  if (build.win) build.win.setSubtitle("Click the preview to place P" + index + " (Esc cancels)");
  for (const type of PLACEMENT_EVENTS) window.addEventListener(type, placement.handler, true);
}

function buildPresetRow(build) {
  const { spec, bridge, controls } = build;
  const applyPreset = function (preset) {
    bridge.apply(spec.assignments(preset, bridge.read));
    syncBindings(build);
  };
  // ASCII looks are listed one per row so every name stays fully visible.
  if (spec.presetList) {
    const list = controls.list({
      items: spec.presets.map(function (preset, index) {
        return { id: index, title: preset.label };
      }),
      onSelect(index) { applyPreset(spec.presets[index]); },
    });
    return list.element;
  }
  const row = controls.buttonRow(spec.presets.map(function (preset) {
    return {
      title: preset.label,
      onClick() { applyPreset(preset); },
    };
  }));
  return row.element;
}

function buildGroup(build, group) {
  const section = build.controls.section({ title: group.title, collapsed: !!group.collapsed });
  if (group.presets) {
    section.body.appendChild(buildPresetRow(build));
  } else if (group.points) {
    // One row per point: its on/off checkbox and a compact Place button. The
    // detail tabs below keep the numeric fields.
    for (let n = 1; n <= 6; n++) {
      const toggle = bindControl(build, "point" + n + "Enable");
      const place = build.controls.button({
        title: "Place",
        hint: "Click the preview to set point " + n,
        onClick() { armPlacement(build, n); },
      }).element;
      if (!toggle || !toggle.ownerDocument) {
        if (toggle) section.body.appendChild(toggle);
        section.body.appendChild(place);
        continue;
      }
      const line = toggle.ownerDocument.createElement("div");
      line.style.cssText = "display: flex; align-items: center; border-bottom: 1px solid #242424;";
      toggle.style.flex = "1 1 auto";
      toggle.style.borderBottom = "0";
      place.style.cssText = "flex: 0 0 auto; width: auto; margin: 0 8px 0 0; padding: 2px 12px;";
      line.appendChild(toggle);
      line.appendChild(place);
      section.body.appendChild(line);
    }
    const tabs = [];
    for (let n = 1; n <= 6; n++) {
      tabs.push({
        id: "p" + n,
        title: "P" + n,
        render(panel) {
          const keys = ["Enable", "X", "Y", "Size", "Label", "LabelDX", "LabelDY"];
          for (const suffix of keys) {
            const element = bindControl(build, "point" + n + suffix);
            if (element) panel.appendChild(element);
          }
        },
      });
    }
    section.body.appendChild(build.controls.tabs({ tabs }).element);
  } else {
    for (const key of group.keys) {
      const element = bindControl(build, key);
      if (element) section.body.appendChild(element);
    }
  }
  return section.element;
}

// Refreshes controls whose property changed outside the window (undo, keyframes,
// other panels). Unchanged values are skipped so an active drag is not reset.
function syncBindings(build) {
  for (const binding of build.bindings) {
    const value = build.bridge.read(binding.key);
    const text = JSON.stringify(value);
    if (text === binding.last) continue;
    binding.last = text;
    binding.control.set(controlValue(binding, value));
  }
}

function mountWindow(context, spec, effect, body, win) {
  const build = {
    context,
    spec,
    effect,
    win,
    PZ: context.PZ,
    controls: context.ui.controls,
    bridge: createBridge(context, effect),
    bindings: [],
    placement: null,
  };
  for (const group of spec.layout) body.appendChild(buildGroup(build, group));
  syncBindings(build);
  const timer = setInterval(function () { syncBindings(build); }, SYNC_INTERVAL_MS);
  return function cleanup() {
    clearInterval(timer);
    disarmPlacement(build);
  };
}

function openSetupWindow(context, spec, effect) {
  const win = context.ui.openWindow({
    id: spec.kind + ":" + effectWindowKey(effect),
    title: spec.title,
    persistKey: spec.persistKey,
    width: spec.width,
    height: spec.height,
    mount(body, openedWindow) {
      return mountWindow(context, spec, effect, body, openedWindow || win);
    },
    isValid: function () { return effect.parent != null; },
    footer: [{ title: "Done", variant: "primary", onClick: function () { win.close(); } }],
  });
  return win;
}

// The button action's dispatcher is wrapped, not replaced, so other packs'
// property actions keep working. A disabled wrapper stays in the chain as a
// pass-through, so a later wrapper is never orphaned.
function installDispatcher(controls, route) {
  const previous = controls.runPropertyAction;
  const wrapper = function (list, target, action) {
    if (!wrapper.__dead && route(action, target)) return undefined;
    return typeof previous === "function" ? previous.apply(this, arguments) : undefined;
  };
  wrapper.__dead = false;
  controls.runPropertyAction = wrapper;
  return { controls, wrapper, previous };
}

function removeDispatcher(install) {
  install.wrapper.__dead = true;
  if (install.controls.runPropertyAction === install.wrapper) {
    install.controls.runPropertyAction = install.previous;
  }
}

const state = { active: false, dispatcher: null };

module.exports = {
  layerPercentAt,
  activate(context) {
    if (state.active) return;
    const PZ = context.PZ;
    if (!PZ || !PZ.ui || !PZ.ui.controls || !PZ.ui.properties) {
      throw new Error("ASCII and Tracery setup windows need the CM3 runtime.");
    }
    if (!context.ui || typeof context.ui.openWindow !== "function") {
      throw new Error("ASCII and Tracery setup windows need the plugin UI.");
    }
    state.dispatcher = installDispatcher(PZ.ui.controls, function (action, target) {
      const spec = Object.prototype.hasOwnProperty.call(SPECS, action) ? SPECS[action] : null;
      const effect = target && target.parentObject;
      if (!spec || !effect) return false;
      openSetupWindow(context, spec, effect);
      return true;
    });
    state.active = true;
  },
  deactivate() {
    if (!state.active) return;
    if (state.dispatcher) removeDispatcher(state.dispatcher);
    state.dispatcher = null;
    state.active = false;
  },
};
