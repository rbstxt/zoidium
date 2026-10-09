"use strict";

// Magic Looks — tool catalog. The 29 Looks tools with their parameter
// schema, neutral defaults, wheel and custom control kinds, the default tool
// chain, and the look presets. Pure data + defaults; no DOM.
//
// Defaults are identity: a freshly added effect renders the source unchanged.
// Color Contrast is the one tool shipped switched off, because its fixed
// contrast amount is part of its character.

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
  // Percent-style fields: stored as fractions, shown as percentages.
  function pct(key, label, def, min, max, decimals) {
    return num(key, label, def, {
      percent: true, fraction: true, min: min, max: max,
      step: 0.01, decimals: decimals === undefined ? 1 : decimals,
    });
  }
  function signedPct(key, label, def, min, max, decimals) {
    return num(key, label, def, {
      percent: true, fraction: true, signed: true, min: min, max: max,
      step: 0.01, decimals: decimals === undefined ? 1 : decimals,
    });
  }
  function exposure() {
    return num("exposure", "Exposure Compensation:", 0, {
      signed: true, min: -5, max: 5, step: 0.05, decimals: 2,
    });
  }

  // Catalog order is the shader dispatch index (see looks-grade.glsl).
  var TOOLS = [
    {
      id: "color-contrast", name: "Color Contrast", group: "color", pfx: "cc",
      off: true,
      params: [
        num("pivot", "Pivot:", 0.18, { min: 0, max: 1 }),
        exposure(),
        section("Contrast"),
      ],
      wheels: [wheel("contrast", "Contrast", 1, 1, 1)],
    },
    {
      id: "hsl-colors", name: "HSL Colors", group: "color", pfx: "hsl",
      params: [section("Hue/Saturation"), section("Hue/Lightness")],
      custom: "hsl",
    },
    {
      id: "color-ranges", name: "Color Ranges", group: "color", pfx: "cr",
      params: [
        pct("strength", "Strength:", 1, 0, 2),
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
      id: "crush", name: "Crush", group: "color", pfx: "cru",
      params: [
        num("gamma", "Gamma:", 1, { min: 0.1, max: 5, step: 0.05, decimals: 2 }),
        exposure(),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "contrast", name: "Contrast", group: "color", pfx: "con",
      params: [
        num("contrast", "Contrast:", 0, { signed: true, min: -1, max: 2, step: 0.005 }),
        num("pivot", "Pivot:", 0.18, { min: 0, max: 1 }),
        exposure(),
      ],
    },
    {
      id: "color-reversal", name: "Color Reversal", group: "color", pfx: "crev",
      params: [pct("strength", "Strength:", 0, 0, 1), exposure()],
    },
    {
      id: "three-strip", name: "3-Strip Process", group: "color", pfx: "strip",
      params: [signedPct("strength", "Strength:", 0, -1, 1, 2), exposure()],
    },
    {
      id: "lift-gamma-gain", name: "Lift-Gamma-Gain", group: "color", pfx: "lgg",
      params: [
        num("gammaSpace", "Gamma Space:", 2.2, { min: 1, max: 3, step: 0.05, decimals: 2 }),
        pct("strength", "Strength:", 1, 0, 1),
        exposure(),
        section("Lift"),
      ],
      wheels: [wheel("lift", "Lift", 1, 1, 1)],
      extraWheels: [
        { section: "Gamma", wheels: [wheel("gamma", "Gamma", 1, 1, 1)] },
        { section: "Gain", wheels: [wheel("gain", "Gain", 1, 1, 1)] },
      ],
    },
    {
      id: "ranged-saturation", name: "Ranged Saturation", group: "color", pfx: "rsat",
      params: [
        pct("satHighlight", "Saturation Highlight:", 1, 0, 2),
        pct("satMidtone", "Midtone:", 1, 0, 2),
        pct("satShadow", "Shadow:", 1, 0, 2),
        section("Threshold"),
        num("thresholdHighlight", "Highlight:", 0.15, { min: 0, max: 1 }),
        num("thresholdMidtone", "Midtone:", 0.05, { min: 0, max: 1 }),
        num("thresholdShadow", "Shadow:", 0.3, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        exposure(),
        section("Component Balance"),
      ],
      wheels: [wheel("balance", "Component Balance", 1, 1, 1)],
    },
    {
      id: "warm-cool", name: "Warm/Cool", group: "color", pfx: "wc",
      params: [
        num("warmCool", "Warm/Cool:", 0, { signed: true, min: -1, max: 1 }),
        num("tint", "Tint:", 0, { signed: true, min: -1, max: 1 }),
        exposure(),
      ],
    },
    {
      id: "four-way", name: "4-Way Color", group: "color", pfx: "fw4",
      params: [
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        num("contrast", "Contrast:", 0, { signed: true, min: -1, max: 2, step: 0.005 }),
        pct("strength", "Strength:", 1, 0, 1),
      ],
      custom: "fourway",
    },
    {
      id: "mojo", name: "Mojo II", group: "color", pfx: "mojo",
      params: [
        pct("mojo", "Mojo:", 0, 0, 1),
        pct("punch", "Punch:", 0, 0, 1),
        pct("bleach", "Bleach:", 0, 0, 1),
        pct("fade", "Fade:", 0, 0, 1),
        pct("blueSqueeze", "Blue Squeeze:", 0.25, 0, 1),
        pct("skinSqueeze", "Skin Squeeze:", 0.25, 0, 1),
        section("Exposure"),
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        signedPct("coolWarm", "Cool/Warm:", 0, -1, 1),
        signedPct("greenMagenta", "Green/Magenta:", 0, -1, 1),
        signedPct("skinYellowPink", "Skin Yellow/Pink:", 0, -1, 1),
        section("Strength"),
        pct("strength", "Strength:", 1, 0, 1),
      ],
    },
    {
      id: "auto-shoulder", name: "Auto Shoulder", group: "color", pfx: "ash",
      params: [pct("strength", "Strength:", 0, 0, 1)],
    },
    {
      id: "curves", name: "Curves", group: "color", pfx: "curv",
      params: [],
      custom: "curves",
    },
    {
      id: "s-curve", name: "S Curve", group: "color", pfx: "scv",
      params: [],
      custom: "scurve",
    },
    {
      id: "lut", name: "LUT", group: "color", pfx: "lut",
      params: [],
      custom: "lut",
    },
    {
      id: "lightflex", name: "Lightflex", group: "light", pfx: "lfl",
      params: [
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        exposure(),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "deflare", name: "Deflare", group: "light", pfx: "dfl",
      params: [
        pct("strength", "Strength:", 0, 0, 1, 2),
        exposure(),
      ],
    },
    {
      id: "vignette", name: "Vignette", group: "light", pfx: "vig",
      params: [
        signedPct("centerX", "Center X:", 0, -1, 1, 0),
        signedPct("centerY", "Center Y:", 0, -1, 1, 0),
        num("radius", "Radius:", 1, { min: 0, max: 3 }),
        num("aspect", "Aspect:", 1, { min: 0.1, max: 3 }),
        num("spread", "Spread:", 1, { min: 0, max: 3 }),
        num("falloff", "Falloff:", 0.5, { min: 0, max: 1 }),
        pct("strength", "Strength:", 0, 0, 1),
        exposure(),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "haze-flare", name: "Haze/Flare", group: "light", pfx: "haze",
      params: [
        pct("spillage", "Spillage:", 0, 0, 1),
        pct("softness", "Softness:", 0.1, 0, 1),
        pct("reach", "Reach:", 0.5, 0, 1),
        num("exposure", "Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        num("reflectionExposure", "Reflection Exposure:", 0, { signed: true, min: -5, max: 5, step: 0.05, decimals: 2 }),
        toggle("reflection", "Reflection:", 1),
        pct("matteBoxSize", "Matte Box Size:", 0.5, 0, 1),
        pct("matteBoxShade", "Matte Box Shade:", 0.75, 0, 1),
        section("Tint Color"),
      ],
      wheels: [wheel("tint", "Tint Color", 1, 1, 1)],
    },
    {
      id: "pop", name: "Pop", group: "light", pfx: "pop",
      params: [
        signedPct("pop", "Pop:", 0, -1, 1, 0),
        pct("size", "Size:", 1, 0, 3),
        pct("preserveDetail", "Preserve Detail:", 0.3, 0, 1),
      ],
    },
    {
      id: "diffusion", name: "Diffusion", group: "light", pfx: "dif",
      params: [
        pct("size", "Size:", 0.3, 0, 1),
        num("grade", "Grade:", 3, { min: 0, max: 10, step: 0.05, decimals: 2 }),
        pct("glow", "Glow:", 0, 0, 1),
        pct("highlightsOnly", "Highlights Only:", 0.75, 0, 1),
        num("highlightBias", "Highlight Bias:", 0, { min: -2, max: 2 }),
        exposure(),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "star-filter", name: "Star Filter", group: "light", pfx: "star",
      params: [
        pct("size", "Size:", 0.1, 0, 1, 2),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("threshold", "Threshold:", 0.9, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        section("Angle"),
        num("angle", "Angle:", 45, { min: -180, max: 180, step: 0.05, decimals: 2 }),
      ],
      wheels: [],
      extraWheels: [{ section: "Color", wheels: [wheel("color", "Color", 1, 1, 1)] }],
    },
    {
      id: "anamorphic-flare", name: "Anamorphic Flare", group: "light", pfx: "ana",
      params: [
        pct("size", "Size:", 2, 0, 5, 2),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("threshold", "Threshold:", 0.9, { min: 0, max: 1 }),
        toggle("showThreshold", "Show Threshold:", 0),
        toggle("reflection", "Reflection:", 0),
        num("reflectionBoost", "Reflection Boost:", -2, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        section("Color"),
      ],
      wheels: [wheel("color", "Color", 1, 1, 1)],
    },
    {
      id: "lens-distortion", name: "Lens Distortion", group: "lens", pfx: "lens",
      params: [
        signedPct("distortion", "Distortion:", 0, -1, 1, 1),
        pct("flatten", "Flatten:", 0, 0, 1),
      ],
    },
    {
      id: "shutter-streak", name: "Shutter Streak", group: "lens", pfx: "shut",
      params: [
        pct("size", "Size:", 0.75, 0, 2, 2),
        num("boost", "Boost:", 0, { signed: true, min: -10, max: 10, step: 0.05, decimals: 2 }),
        num("falloff", "Falloff:", 0, { min: 0, max: 1, step: 0.05, decimals: 2 }),
      ],
    },
    {
      id: "edge-softness", name: "Edge Softness", group: "lens", pfx: "edge",
      params: [
        pct("blurSize", "Blur Size:", 0, 0, 0.5, 2),
        num("quality", "Quality:", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        section(""),
        signedPct("centerX", "Center X:", 0, -1, 1, 0),
        signedPct("centerY", "Center Y:", 0, -1, 1, 0),
        num("radius", "Radius:", 1, { min: 0, max: 3 }),
        num("aspect", "Aspect:", 1, { min: 0.1, max: 3 }),
        num("spread", "Spread:", 0.5, { min: 0, max: 1 }),
      ],
    },
    {
      id: "chromatic-aberration", name: "Chromatic Aberration", group: "lens", pfx: "ca",
      params: [
        num("redCyan", "Red/Cyan:", 0, { signed: true, min: -5, max: 5 }),
        num("greenMagenta", "Green/Magenta:", 0, { signed: true, min: -5, max: 5 }),
        num("blueYellow", "Blue/Yellow:", 0, { signed: true, min: -5, max: 5 }),
      ],
    },
    {
      id: "telecine-net", name: "Telecine Net", group: "lens", pfx: "tele",
      params: [
        pct("size", "Size:", 0.05, 0, 0.5, 2),
        pct("strength", "Strength:", 0, 0, 1, 2),
        exposure(),
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

  // 4-way wheel slots (fixed order for properties + shader uniforms).
  var FOURWAY_SLOTS = ["shadows", "midtones", "highlights", "global"];

  // Lens Distortion is a geometric resample and always runs before the
  // chain; every other tool is reorderable.
  var PINNED_TOOL = "lens-distortion";
  var CHAIN_KEY = "chainOrder";
  var ENABLED_KEY = "enabled";
  var MAX_CHAIN = 29;

  function byId(id) {
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === id) return TOOLS[i];
    }
    return null;
  }

  function indexOfTool(id) {
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === id) return i;
    }
    return -1;
  }

  function enabledDefault(tool) {
    return tool.off ? 0 : 1;
  }

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
        channels: {
          RGB: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        },
      };
    } else if (tool.custom === "scurve") {
      st.x.scurve = defaultScurve();
    } else if (tool.custom === "fourway") {
      st.x.fourway = { preview: 0 };
      FOURWAY_SLOTS.forEach(function (slot) {
        addWheel({ key: slot, rgb: [1, 1, 1] });
      });
    } else if (tool.custom === "lut") {
      st.x.lut = {
        name: "None", strength: 1,
        gamma: "Same As Input",
        gammaOptions: ["Same As Input", "Input", "Output"],
      };
    }
    return st;
  }

  // S-curve shape. Endpoints sit on the diagonal and the handles are placed
  // on it too, so the default curve is the identity.
  function defaultScurve() {
    return {
      black: 0, white: 1, contrast: 1, midpoint: 0.5, brightness: 0.5,
      p0: { x: 0, y: 0 }, c1: { x: 0.22, y: 0.22 }, c2: { x: 0.78, y: 0.78 }, p3: { x: 1, y: 1 },
    };
  }

  // Default chain = the fixed Looks pipeline that Davidium projects were
  // rendered with, so legacy projects keep their look.
  var DEFAULT_CHAIN = [
    "lens-distortion", "lift-gamma-gain", "contrast", "color-contrast", "crush",
    "color-ranges", "ranged-saturation", "mojo", "three-strip", "color-reversal",
    "auto-shoulder", "hsl-colors", "warm-cool", "four-way", "curves", "s-curve",
    "lut", "lightflex", "deflare", "vignette", "haze-flare", "pop", "diffusion",
    "star-filter", "anamorphic-flare", "edge-softness", "chromatic-aberration",
    "shutter-streak", "telecine-net",
  ];

  function defaultChain() {
    return DEFAULT_CHAIN.slice();
  }

  function defaultState() {
    var tools = {};
    var on = {};
    TOOLS.forEach(function (t) {
      tools[t.id] = defaultToolState(t);
      on[t.id] = enabledDefault(t);
    });
    return { v: 2, preset: "None", enabled: 1, chain: defaultChain(), on: on, tools: tools };
  }

  function cap(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Canonical catalog-key -> effect-property-key map. The setup window and
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
  // source of truth shared by the effect file and the setup window.
  function buildPropertyDefinitions(PZ) {
    var defs = {
      enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
        // Rendered by the setup window renderer in looks-setup.js.
        magicLooksSetup: { name: "Setup", title: "Open the Magic Looks setup window" },
      },
    };
    defs[CHAIN_KEY] = lkText(PZ, "Tool chain order", JSON.stringify(defaultChain()));
    TOOLS.forEach(function (t) {
      defs[t.pfx + "Enable"] = lkOpt(PZ, t.name + " Enable", enabledDefault(t), "off;on");
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
        ["R", "G", "B"].forEach(function (s, i) {
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
        defs[t.pfx + "ScurveJson"] = lkText(PZ, t.name + " shape", JSON.stringify(defaultScurve()));
      } else if (t.custom === "fourway") {
        defs[t.pfx + "Preview"] = lkOpt(PZ, t.name + " Ranges Preview", 0, "off;on");
        FOURWAY_SLOTS.forEach(function (slot) {
          ["R", "G", "B"].forEach(function (ch) {
            defs[t.pfx + cap(slot) + ch] = lkNum(PZ, t.name + " " + slot + " " + ch, 1, 0, 4, 0.005, 3);
          });
        });
      } else if (t.custom === "lut") {
        defs[t.pfx + "Name"] = lkText(PZ, t.name + " file", "None");
        defs[t.pfx + "Strength"] = lkNum(PZ, t.name + " Strength", 1, 0, 1, 0.01, 2);
        defs[t.pfx + "Gamma"] = lkOpt(PZ, t.name + " Gamma", 0, ["Same As Input", "Input", "Output"].join(";"));
      }
    });
    return defs;
  }

  // ---------- chain helpers (pure) ----------

  // Parses the stored chain text. Unknown and duplicate ids are dropped; a
  // missing or malformed value falls back to the default chain, which is also
  // what legacy projects without the property get.
  function parseChain(text) {
    var list = null;
    try {
      var parsed = JSON.parse(String(text == null ? "" : text));
      if (Array.isArray(parsed)) list = parsed;
    } catch (_err) { list = null; }
    if (!list) return defaultChain();
    var seen = {};
    var out = [];
    list.forEach(function (id) {
      if (typeof id !== "string" || seen[id] || indexOfTool(id) < 0) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function serializeChain(list) {
    return JSON.stringify(list.slice(0, MAX_CHAIN));
  }

  // Look presets. Each preset names the tool values it sets on top of the
  // neutral defaults; applying one resets the other tool values but keeps the
  // chain order.
  var PRESETS = [
    {
      id: "blockbuster", name: "Blockbuster", group: "Cinematic",
      tools: {
        "contrast": { p: { contrast: 0.25 } },
        "lift-gamma-gain": { w: { gain: [1.12, 1.04, 0.92] } },
        "vignette": { p: { strength: 0.5 } },
        "four-way": { w: { shadows: [0.92, 1.02, 1.08], highlights: [1.08, 1.0, 0.9] } },
      },
    },
    {
      id: "teal-orange", name: "Teal & Orange", group: "Cinematic",
      tools: {
        "contrast": { p: { contrast: 0.1 } },
        "four-way": { w: { shadows: [0.85, 1.0, 1.1], highlights: [1.12, 1.02, 0.9] } },
      },
    },
    {
      id: "noir", name: "Noir", group: "Monochrome",
      tools: {
        "contrast": { p: { contrast: 0.5, pivot: 0.16 } },
        "ranged-saturation": { p: { satHighlight: 0, satMidtone: 0, satShadow: 0 } },
        "crush": { p: { gamma: 2.8 } },
      },
    },
    {
      id: "daylight", name: "Daylight", group: "Warm",
      tools: {
        "warm-cool": { p: { warmCool: 0.2, tint: 0.02 } },
        "pop": { p: { pop: 0.2 } },
        "diffusion": { p: { glow: 0.2 } },
      },
    },
    {
      id: "faded-film", name: "Faded Film", group: "Film",
      tools: {
        "contrast": { p: { contrast: -0.1 } },
        "mojo": { p: { mojo: 0.4, fade: 0.3, bleach: 0.2 } },
      },
    },
    {
      id: "bleach-bypass", name: "Bleach Bypass", group: "Film",
      tools: {
        "mojo": { p: { mojo: 0.5, bleach: 0.6, punch: 0.1 } },
      },
    },
  ];

  Looks.tools = {
    TOOLS: TOOLS,
    GROUPS: GROUPS,
    HSL_HUES: HSL_HUES,
    FOURWAY_SLOTS: FOURWAY_SLOTS,
    PINNED_TOOL: PINNED_TOOL,
    CHAIN_KEY: CHAIN_KEY,
    ENABLED_KEY: ENABLED_KEY,
    MAX_CHAIN: MAX_CHAIN,
    PRESETS: PRESETS,
    defaultToolState: defaultToolState,
    defaultScurve: defaultScurve,
    defaultState: defaultState,
    defaultChain: defaultChain,
    parseChain: parseChain,
    serializeChain: serializeChain,
    enabledDefault: enabledDefault,
    propMap: propMap,
    buildPropertyDefinitions: buildPropertyDefinitions,
    indexOf: indexOfTool,
    byId: byId,
  };
})(Looks);
