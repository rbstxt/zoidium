"use strict";

// Magic Looks — tool catalog. All 29 Looks tools with their parameter
// schema, defaults (transcribed from the reference panels), color wheels
// and custom control kinds. Pure data + defaults; no DOM.

var Looks = Looks || {};

(function (Looks) {
  function num(key, label, def, opts) {
    opts = opts || {};
    return {
      kind: "number", key: key, label: label, def: def,
      min: opts.min, max: opts.max,
      step: opts.step === undefined ? 0.01 : opts.step,
      decimals: opts.decimals === undefined ? 3 : opts.decimals,
      percent: !!opts.percent,
      fraction: !!opts.fraction,
      signed: !!opts.signed,
    };
  }
  function toggle(key, label, def) {
    return { kind: "toggle", key: key, label: label, def: def ? 1 : 0 };
  }
  function choice(key, label, def, options) {
    return { kind: "choice", key: key, label: label, def: def, options: options };
  }
  function section(label) {
    return { kind: "section", label: label };
  }
  function wheel(key, label, r, g, b) {
    return { key: key, label: label, rgb: [r, g, b] };
  }

  var TOOLS = [
    {
      id: "color-contrast", name: "Color Contrast", group: "color", pfx: "cc", thumb: { kind: "wheel" },
      params: [
        num("pivot", "Pivot:", 0.18, { min: 0, max: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Contrast"),
      ],
      wheels: [wheel("contrast", "Contrast", 1, 1, 1)],
    },
    {
      id: "hsl-colors", name: "HSL Colors", group: "color", pfx: "hsl", thumb: { kind: "wheel" },
      params: [section("Hue/Saturation"), section("Hue/Lightness")],
      custom: "hsl",
    },
    {
      id: "color-ranges", name: "Color Ranges", group: "color", pfx: "cr", thumb: { kind: "dots3" },
      params: [
        num("strength", "Strength:", 1, { percent: true, fraction: true, min: 0, max: 2, step: 0.01, decimals: 1 }),
        num("threshold", "Threshold", 0, {}),
        num("highlight", "Highlight:", 0.15, { min: 0, max: 1 }),
        num("midtone", "Midtone:", 0.2, { min: 0, max: 1 }),
        num("shadow", "Shadow:", 0.3, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        section("Highlight"),
      ],
      wheels: [wheel("highlight", "Highlight", 1, 1, 1)],
      extraWheels: [
        { section: "Midtone", wheels: [wheel("midtone", "Midtone", 1, 1, 1)] },
        { section: "Shadow", wheels: [wheel("shadow", "Shadow", 1, 1, 1)] },
      ],
    },
    {
      id: "crush", name: "Crush", group: "color", pfx: "cru", thumb: { kind: "letter", text: "C" },
      params: [
        num("gamma", "Gamma:", 1, { min: 0.1, max: 5, step: 0.05, decimals: 2 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "contrast", name: "Contrast", group: "color", pfx: "con", thumb: { kind: "contrast" },
      params: [
        num("contrast", "Contrast:", 0, { signed: true, min: -1, max: 2, step: 0.005 }),
        num("pivot", "Pivot:", 0.18, { min: 0, max: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "color-reversal", name: "Color Reversal", group: "color", pfx: "crev", thumb: { kind: "hsplit" },
      params: [
        num("strength", "Strength:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "three-strip", name: "3-Strip Process", group: "color", pfx: "strip", thumb: { kind: "thirds" },
      params: [
        num("strength", "Strength:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, step: 0.01, decimals: 2 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "lift-gamma-gain", name: "Lift-Gamma-Gain", group: "color", pfx: "lgg", thumb: { kind: "splitdisc" },
      params: [
        num("gammaSpace", "Gamma Space:", 2.2, { min: 1, max: 3, step: 0.05, decimals: 2 }),
        num("strength", "Strength:", 1, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Lift"),
      ],
      wheels: [wheel("lift", "Lift", 1, 1, 1)],
      extraWheels: [
        { section: "Gamma", wheels: [wheel("gamma", "Gamma", 1, 1, 1)] },
        { section: "Gain", wheels: [wheel("gain", "Gain", 1, 1, 1)] },
      ],
    },
    {
      id: "ranged-saturation", name: "Ranged Saturation", group: "color", pfx: "rsat", thumb: { kind: "bars3" },
      params: [
        num("satHighlight", "Saturation Highlight:", 1, { percent: true, fraction: true, min: 0, max: 2, step: 0.01, decimals: 1 }),
        num("satMidtone", "Midtone:", 1, { percent: true, fraction: true, min: 0, max: 2, step: 0.01, decimals: 1 }),
        num("satShadow", "Shadow:", 1, { percent: true, fraction: true, min: 0, max: 2, step: 0.01, decimals: 1 }),
        section("Threshold"),
        num("thresholdHighlight", "Highlight:", 0.15, { min: 0, max: 1 }),
        num("thresholdMidtone", "Midtone:", 0.05, { min: 0, max: 1 }),
        num("thresholdShadow", "Shadow:", 0.3, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Component Balance"),
      ],
      wheels: [wheel("balance", "Component Balance", 1, 1, 1)],
    },
    {
      id: "warm-cool", name: "Warm/Cool", group: "color", pfx: "wc", thumb: { kind: "grad2d" },
      params: [
        num("warmCool", "Warm/Cool:", 0, { signed: true, min: -1, max: 1 }),
        num("tint", "Tint:", 0, { signed: true, min: -1, max: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
      custom: "warmcool",
    },
    {
      id: "four-way", name: "4-Way Color", group: "color", pfx: "fw4", thumb: { kind: "diamond" },
      params: [
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        num("contrast", "Contrast:", 0, { signed: true, min: -1, max: 2, step: 0.005 }),
        num("strength", "Strength:", 1, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
      ],
      custom: "fourway",
    },
    {
      id: "mojo", name: "Mojo II", group: "color", pfx: "mojo", thumb: { kind: "letter", text: "M" },
      params: [
        num("mojo", "Mojo:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("tint", "Tint:", 0, { percent: true, fraction: true, min: -1, max: 1, step: 0.01, decimals: 1 }),
        num("punch", "Punch:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("bleach", "Bleach:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("fade", "Fade:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("blueSqueeze", "Blue Squeeze:", 0.25, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("skinSqueeze", "Skin Squeeze:", 0.25, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        section("Exposure"),
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        num("coolWarm", "Cool/Warm:", 0, { percent: true, fraction: true, min: -1, max: 1, step: 0.01, decimals: 1 }),
        num("greenMagenta", "Green/Magenta:", 0, { percent: true, fraction: true, min: -1, max: 1, step: 0.01, decimals: 1 }),
        num("skinYellowPink", "Skin Yellow/Pink:", 0, { percent: true, fraction: true, min: -1, max: 1, step: 0.01, decimals: 1 }),
        section("Strength"),
        num("strength", "Strength:", 1, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
      ],
    },
    {
      id: "auto-shoulder", name: "Auto Shoulder", group: "color", pfx: "ash", thumb: { kind: "smini" },
      params: [
        num("strength", "Strength:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
      ],
    },
    {
      id: "curves", name: "Curves", group: "color", pfx: "curv", thumb: { kind: "diagonal" },
      params: [],
      custom: "curves",
    },
    {
      id: "s-curve", name: "S Curve", group: "color", pfx: "scv", thumb: { kind: "sbezier" },
      params: [choice("log", "Log:", "Off", ["Off", "On"])],
      custom: "scurve",
    },
    {
      id: "lut", name: "LUT", group: "color", pfx: "lut", thumb: { kind: "cube" },
      params: [],
      custom: "lut",
    },
    {
      id: "lightflex", name: "Lightflex", group: "light", pfx: "lfl", thumb: { kind: "letter", text: "L" },
      params: [
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "deflare", name: "Deflare", group: "light", pfx: "dfl", thumb: { kind: "letter", text: "F" },
      params: [
        num("size", "Size:", 0.5, { percent: true, fraction: true, min: 0, max: 2, step: 0.005, decimals: 1 }),
        num("strength", "Strength:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.005, decimals: 2 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "vignette", name: "Vignette", group: "light", pfx: "vig", thumb: { kind: "radial" },
      params: [
        num("centerX", "Center X:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, decimals: 0 }),
        num("centerY", "Center Y:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, decimals: 0 }),
        num("radius", "Radius:", 1, { min: 0, max: 3 }),
        num("aspect", "Aspect:", 1, { min: 0.1, max: 3 }),
        num("spread", "Spread:", 1, { min: 0, max: 3 }),
        num("falloff", "Falloff:", 0.5, { min: 0, max: 1 }),
        num("strength", "Strength:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "haze-flare", name: "Haze/Flare", group: "light", pfx: "haze", thumb: { kind: "hstreak" },
      params: [
        num("spillage", "Spillage:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("softness", "Softness:", 0.1, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("reach", "Reach:", 0.5, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        num("reflectionExposure", "Reflection Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        toggle("reflection", "Reflection:", 1),
        num("matteBoxSize", "Matte Box Size:", 0.5, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("matteBoxShade", "Matte Box Shade:", 0.75, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        section("Tint Color"),
      ],
      wheels: [wheel("tint", "Tint Color", 1, 1, 1)],
    },
    {
      id: "pop", name: "Pop", group: "light", pfx: "pop", thumb: { kind: "dot", size: 8 },
      params: [
        num("pop", "Pop:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, decimals: 0 }),
        num("size", "Size:", 1, { percent: true, fraction: true, min: 0, max: 3, step: 0.01, decimals: 1 }),
        num("preserveDetail", "Preserve Detail:", 0.3, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
      ],
    },
    {
      id: "diffusion", name: "Diffusion", group: "light", pfx: "dif", thumb: { kind: "softdot" },
      params: [
        num("size", "Size:", 0.3, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("grade", "Grade:", 3, { min: 0, max: 10, step: 0.05, decimals: 2 }),
        num("glow", "Glow:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("highlightsOnly", "Highlights Only:", 0.75, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
        num("highlightBias", "Highlight Bias:", 0, { min: -2, max: 2 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "star-filter", name: "Star Filter", group: "light", pfx: "star", thumb: { kind: "star" },
      params: [
        num("size", "Size:", 0.1, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 2 }),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("threshold", "Threshold:", 0.9, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        num("thresholdSoftness", "Threshold Softness:", 0.2, { min: 0, max: 1 }),
        section("Angle"),
      ],
      custom: "angledial",
      wheels: [],
      extraWheels: [{ section: "Color", wheels: [wheel("color", "Color", 1, 1, 1)] }],
    },
    {
      id: "anamorphic-flare", name: "Anamorphic Flare", group: "light", pfx: "ana", thumb: { kind: "hstreak" },
      params: [
        num("size", "Size:", 2, { percent: true, fraction: true, min: 0, max: 5, step: 0.01, decimals: 2 }),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("threshold", "Threshold:", 0.9, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        num("thresholdSoftness", "Threshold Softness:", 0.2, { min: 0, max: 1 }),
        toggle("reflection", "Reflection:", 0),
        num("reflectionBoost", "Reflection Boost:", -2, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "lens-distortion", name: "Lens Distortion", group: "lens", pfx: "lens", thumb: { kind: "circle" },
      params: [
        num("distortion", "Distortion:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, step: 0.005, decimals: 1 }),
        num("flatten", "Flatten:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.01, decimals: 1 }),
      ],
    },
    {
      id: "shutter-streak", name: "Shutter Streak", group: "lens", pfx: "shut", thumb: { kind: "hstreak" },
      params: [
        num("size", "Size:", 0.75, { percent: true, fraction: true, min: 0, max: 2, step: 0.005, decimals: 2 }),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("falloff", "Falloff:", 0, { min: 0, max: 1, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "edge-softness", name: "Edge Softness", group: "lens", pfx: "edge", thumb: { kind: "circle", dashed: true },
      params: [
        num("blurSize", "Blur Size:", 0, { percent: true, fraction: true, min: 0, max: 0.5, step: 0.0025, decimals: 2 }),
        num("quality", "Quality:", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        section(""),
        num("centerX", "Center X:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, decimals: 0 }),
        num("centerY", "Center Y:", 0, { percent: true, fraction: true, signed: true, min: -1, max: 1, decimals: 0 }),
        num("radius", "Radius:", 1, { min: 0, max: 3 }),
        num("aspect", "Aspect:", 1, { min: 0.1, max: 3 }),
        num("spread", "Spread:", 0.5, { min: 0, max: 1 }),
      ],
    },
    {
      id: "chromatic-aberration", name: "Chromatic Aberration", group: "lens", pfx: "ca", thumb: { kind: "rgblines" },
      params: [
        num("redCyan", "Red/Cyan:", 0, { signed: true, min: -5, max: 5 }),
        num("greenMagenta", "Green/Magenta:", 0, { signed: true, min: -5, max: 5 }),
        num("blueYellow", "Blue/Yellow:", 0, { signed: true, min: -5, max: 5 }),
      ],
    },
    {
      id: "telecine-net", name: "Telecine Net", group: "lens", pfx: "tele", thumb: { kind: "grid" },
      params: [
        num("size", "Size:", 0.05, { percent: true, fraction: true, min: 0, max: 0.5, step: 0.0025, decimals: 2 }),
        num("strength", "Strength:", 0, { percent: true, fraction: true, min: 0, max: 1, step: 0.005, decimals: 1 }),
        num("exposure", "Exposure Compensation:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
      ],
    },
  ];

  var GROUPS = [
    { id: "color", name: "Color" },
    { id: "light", name: "Light" },
    { id: "lens", name: "Lens" },
  ];

  // Eight HSL anchor hues with display names, matching the reference table.
  var HSL_HUES = [
    { name: "red", hue: 0 },
    { name: "orange", hue: 30 },
    { name: "yellow", hue: 60 },
    { name: "green", hue: 120 },
    { name: "cyan", hue: 180 },
    { name: "blue", hue: 240 },
    { name: "purple", hue: 270 },
    { name: "magenta", hue: 300 },
  ];

  // Factory default state for one tool: numbers, wheel dots + rgb, customs.
  function defaultToolState(tool) {
    var st = { p: {}, w: {}, x: {} };
    (tool.params || []).forEach(function (prm) {
      if (prm.kind === "number" || prm.kind === "toggle") st.p[prm.key] = prm.def;
      // OPTION properties carry indices; the catalog default is the label.
      else if (prm.kind === "choice") st.p[prm.key] = Math.max(0, prm.options.indexOf(prm.def));
    });
    function addWheel(w) {
      st.w[w.key] = { rgb: w.rgb.slice(), dot: Looks.color.tintToDot(w.rgb[0], w.rgb[1], w.rgb[2]) };
    }
    (tool.wheels || []).forEach(addWheel);
    (tool.extraWheels || []).forEach(function (grp) {
      (grp.wheels || []).forEach(addWheel);
    });
    if (tool.custom === "hsl") {
      st.x.hsl = HSL_HUES.map(function () { return { sat: 0, light: 0 }; });
    } else if (tool.custom === "curves") {
      st.x.curves = {
        channel: "RGB",
        channels: {
          RGB: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        },
        selected: 1,
      };
    } else if (tool.custom === "scurve") {
      st.x.scurve = {
        black: 0, white: 1, contrast: 1, midpoint: 0.5, brightness: 0.5,
        p0: { x: 0, y: 0 }, c1: { x: 0.333, y: 0.333 }, c2: { x: 0.667, y: 0.667 }, p3: { x: 1, y: 1 },
      };
    } else if (tool.custom === "fourway") {
      st.x.fourway = { preview: 0 };
    } else if (tool.custom === "warmcool") {
      st.x.warmcool = { x: 0, y: 0 };
    } else if (tool.custom === "angledial") {
      st.x.angle = 45;
    } else if (tool.custom === "lut") {
      st.x.lut = {
        name: "None", strength: 1,
        gamma: "Same As Input",
        gammaOptions: ["Same As Input", "Input", "Output"],
      };
    }
    return st;
  }

  function defaultState() {
    var tools = {};
    var on = {};
    TOOLS.forEach(function (t) {
      tools[t.id] = defaultToolState(t);
      on[t.id] = 1;
    });
    return { v: 1, preset: "None", enabled: 1, on: on, tools: tools };
  }

  function cap(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // 4-way wheel slots (fixed order for properties + shader uniforms).
  var FOURWAY_SLOTS = ["shadows", "midtones", "highlights", "global"];

  // Canonical catalog-key -> effect-property-key map. The setup shell and
  // the effect file both derive from this; tests assert they agree.
  function propMap() {
    var map = {};
    TOOLS.forEach(function (t) {
      var e = { enable: t.pfx + "Enable", params: {}, wheels: {}, custom: {} };
      (t.params || []).forEach(function (p) {
        if (p.kind === "number" || p.kind === "toggle" || p.kind === "choice") {
          e.params[p.key] = t.pfx + cap(p.key);
        }
      });
      function addWheel(w) {
        e.wheels[w.key] = [
          t.pfx + cap(w.key) + "R",
          t.pfx + cap(w.key) + "G",
          t.pfx + cap(w.key) + "B",
        ];
      }
      (t.wheels || []).forEach(addWheel);
      (t.extraWheels || []).forEach(function (grp) {
        (grp.wheels || []).forEach(addWheel);
      });
      if (t.custom === "hsl") {
        e.custom.hsl = {
          sat: HSL_HUES.map(function (_, i) { return t.pfx + "Sat" + i; }),
          light: HSL_HUES.map(function (_, i) { return t.pfx + "Light" + i; }),
        };
      } else if (t.custom === "curves") {
        e.custom.curvesJson = t.pfx + "CurvesJson";
      } else if (t.custom === "scurve") {
        e.custom.scurveJson = t.pfx + "ScurveJson";
      } else if (t.custom === "fourway") {
        e.custom.fourwayPreview = t.pfx + "Preview";
        e.custom.fourway = {};
        FOURWAY_SLOTS.forEach(function (slot) {
          e.custom.fourway[slot] = [
            t.pfx + cap(slot) + "R",
            t.pfx + cap(slot) + "G",
            t.pfx + cap(slot) + "B",
          ];
        });
      } else if (t.custom === "angledial") {
        e.custom.angle = t.pfx + "Angle";
      } else if (t.custom === "lut") {
        e.custom.lutName = t.pfx + "Name";
        e.custom.lutStrength = t.pfx + "Strength";
        e.custom.lutGamma = t.pfx + "Gamma";
      }
      map[t.id] = e;
    });
    return map;
  }

  function lkNum(PZ, name, value, min, max, step, decimals) {
    var def = {
      dynamic: true,
      name: name,
      type: PZ.property.type.NUMBER,
      value: value,
      step: step === undefined ? 0.01 : step,
      decimals: decimals === undefined ? 3 : decimals,
    };
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
    return def;
  }

  function lkOpt(PZ, name, value, items) {
    return {
      dynamic: true,
      name: name,
      type: PZ.property.type.OPTION,
      value: value,
      items: items,
    };
  }

  function lkText(PZ, name, value) {
    return { dynamic: true, name: name, type: PZ.property.type.TEXT, value: value };
  }

  // Effect property definitions generated from the catalog: the single
  // source of truth shared by the effect file and the setup shell.
  function buildPropertyDefinitions(PZ) {
    var defs = {
      enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
        buttons: [{ name: "Magic Looks Setup", title: "Open the Magic Looks setup window", action: "magicLooksSetup" }],
      },
    };
    TOOLS.forEach(function (t) {
      defs[t.pfx + "Enable"] = lkOpt(PZ, t.name + " Enable", 1, "off;on");
      (t.params || []).forEach(function (p) {
        if (p.kind === "section") return;
        var key = t.pfx + cap(p.key);
        var label = t.name + " " + String(p.label || p.key).replace(/:$/, "");
        if (p.kind === "number") {
          defs[key] = lkNum(PZ, label, p.def, p.min, p.max, p.step, p.decimals);
        } else if (p.kind === "toggle") {
          defs[key] = lkOpt(PZ, label, p.def, "off;on");
        } else if (p.kind === "choice") {
          defs[key] = lkOpt(PZ, label, Math.max(0, p.options.indexOf(p.def)), p.options.join(";"));
        }
      });
      function addWheel(w) {
        var base = t.pfx + cap(w.key);
        var channels = ["R", "G", "B"];
        channels.forEach(function (s, i) {
          defs[base + s] = lkNum(PZ, t.name + " " + w.label + " " + s, w.rgb[i], 0, 4, 0.005, 3);
        });
      }
      (t.wheels || []).forEach(addWheel);
      (t.extraWheels || []).forEach(function (grp) {
        (grp.wheels || []).forEach(addWheel);
      });
      if (t.custom === "hsl") {
        HSL_HUES.forEach(function (h, i) {
          defs[t.pfx + "Sat" + i] = lkNum(PZ, t.name + " " + h.name + " saturation", 0, -1, 1, 0.001, 3);
          defs[t.pfx + "Light" + i] = lkNum(PZ, t.name + " " + h.name + " lightness", 0, -1, 1, 0.001, 3);
        });
      } else if (t.custom === "curves") {
        defs[t.pfx + "CurvesJson"] = lkText(PZ, t.name + " curves", JSON.stringify(defaultToolState(t).x.curves.channels));
      } else if (t.custom === "scurve") {
        var s = defaultToolState(t).x.scurve;
        defs[t.pfx + "ScurveJson"] = lkText(PZ, t.name + " shape", JSON.stringify({
          black: s.black, white: s.white, p0: s.p0, c1: s.c1, c2: s.c2, p3: s.p3,
        }));
      } else if (t.custom === "fourway") {
        defs[t.pfx + "Preview"] = lkOpt(PZ, t.name + " Ranges Preview", 0, "off;on");
        FOURWAY_SLOTS.forEach(function (slot) {
          ["R", "G", "B"].forEach(function (ch) {
            defs[t.pfx + cap(slot) + ch] = lkNum(PZ, t.name + " " + slot + " " + ch, 1, 0, 4, 0.005, 3);
          });
        });
      } else if (t.custom === "angledial") {
        defs[t.pfx + "Angle"] = lkNum(PZ, t.name + " Angle", 45, -180, 180, 0.05, 2);
      } else if (t.custom === "lut") {
        defs[t.pfx + "Name"] = lkText(PZ, t.name + " file", "None");
        defs[t.pfx + "Strength"] = lkNum(PZ, t.name + " Strength", 1, 0, 1, 0.01, 2);
        defs[t.pfx + "Gamma"] = lkOpt(PZ, t.name + " Gamma", 0, ["Same As Input", "Input", "Output"].join(";"));
      }
    });
    return defs;
  }

  Looks.tools = {
    TOOLS: TOOLS,
    GROUPS: GROUPS,
    HSL_HUES: HSL_HUES,
    FOURWAY_SLOTS: FOURWAY_SLOTS,
    defaultToolState: defaultToolState,
    defaultState: defaultState,
    propMap: propMap,
    buildPropertyDefinitions: buildPropertyDefinitions,
    byId: function (id) {
      for (var i = 0; i < TOOLS.length; i++) {
        if (TOOLS[i].id === id) return TOOLS[i];
      }
      return null;
    },
  };
})(Looks);
