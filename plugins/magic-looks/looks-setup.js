"use strict";

// Magic Looks — Looks-style color setup window.
//
// SaaS fullscreen editor hosting all 29 Looks tools with the reference
// panel design (italic serif titles, orange underline, preset row, editable
// readouts, shared color-wheel palette) plus the pack motion language:
// the panel re-rises on every tool switch and wheels tween on every set.
// UI-first: tool state is fully interactive and serializable (export/import
// a look as JSON) but does not grade footage yet.

const STYLE_ID = "zoidium-looks-setup-style";
const FONT_STYLE_ID = "zoidium-looks-font-style";
const STYLE_URL = "./plugins/magic-looks/looks-setup.css";
const FONT_URL = "./plugins/magic-looks/inter-font.css";

const SOURCE_ORDER = ["looks-color.js", "looks-tools.js", "looks-widgets.js"];

const state = {
  active: false,
  editor: null,
  effect: null,
  getAsset: null,
  windowEl: null,
  Looks: null,
  look: null,
  activeTool: "color-contrast",
  widgets: [],
  onKey: null,
  installedWrapper: null,
  viewport: null,
  viewportParent: null,
  viewportStyle: null,
  wasEdit: null,
  refreshTimer: null,
  pushing: false,
  pushQueued: false,
  pushTimer: null,
};

function loadSources(getAsset) {
  const Looks = {};
  for (const file of SOURCE_ORDER) {
    const source = getAsset ? getAsset("text", "./plugins/magic-looks/" + file) : undefined;
    if (typeof source !== "string") {
      throw new Error("Magic Looks is missing its bundled source: " + file);
    }
    new Function("Looks", source)(Looks);
  }
  if (!Looks.color || !Looks.tools || !Looks.widgets) {
    throw new Error("Magic Looks sources did not define their namespaces.");
  }
  return Looks;
}

function installStyle(getAsset, id, url) {
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const bundled = getAsset ? getAsset("text", url) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
}

function installFont(getAsset) {
  installStyle(getAsset, FONT_STYLE_ID, FONT_URL);
  try {
    if (document.fonts && typeof document.fonts.load === "function") {
      document.fonts.load("700 21px Georgia");
      document.fonts.load("700 14px Inter");
      document.fonts.load("400 12px Inter");
    }
  } catch (_err) { /* font is decorative */ }
}

function uninstallStyles() {
  if (typeof document === "undefined") return;
  for (const id of [STYLE_ID, FONT_STYLE_ID]) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function fmtParam(schema, value) {
  const C = state.Looks.color;
  if (schema.kind === "toggle") return value ? "On" : "Off";
  // OPTION properties carry indices; the catalog default is the label.
  if (schema.kind === "choice") return String((schema.options || [])[value] || value);
  return C.fmtNum(value, schema.decimals, schema);
}

function defaultLookState() {
  return state.Looks.tools.defaultState();
}

function isTweaked(tool) {
  const fresh = state.Looks.tools.defaultToolState(tool);
  return JSON.stringify(state.look.tools[tool.id]) !== JSON.stringify(fresh);
}

// ---------- global look presets (applied across tools) ----------

const LOOK_PRESETS = {
  None: null,
  Blockbuster: {
    "contrast": { p: { contrast: 0.25 } },
    "lift-gamma-gain": { w: { gain: { rgb: [1.12, 1.04, 0.92] } } },
    "vignette": { p: { strength: 0.5 } },
    "four-way": { w: { shadows: { rgb: [0.92, 1.02, 1.08] }, highlights: { rgb: [1.08, 1.0, 0.9] } } },
  },
  Noir: {
    "contrast": { p: { contrast: 0.5, pivot: 0.16 } },
    "ranged-saturation": { p: { satHighlight: 0, satMidtone: 0, satShadow: 0 } },
    "crush": { p: { gamma: 2.8 } },
  },
  Daylight: {
    "warm-cool": { p: { warmCool: 0.2, tint: 0.02 } },
    "pop": { p: { pop: 0.2 } },
    "diffusion": { p: { glow: 0.2 } },
  },
};

function applyLookPreset(name) {
  const C = state.Looks.color;
  state.look.preset = name;
  const preset = LOOK_PRESETS[name];
  if (!preset) return;
  for (const toolId of Object.keys(preset)) {
    const tool = state.Looks.tools.byId(toolId);
    if (!tool) continue;
    const patch = preset[toolId];
    const st = state.look.tools[toolId];
    if (patch.p) {
      for (const k of Object.keys(patch.p)) {
        if (st.p[k] !== undefined) st.p[k] = patch.p[k];
      }
    }
    if (patch.w) {
      for (const k of Object.keys(patch.w)) {
        if (st.w[k] && patch.w[k].rgb) {
          st.w[k].rgb = patch.w[k].rgb.slice();
          st.w[k].dot = C.tintToDot(st.w[k].rgb[0], st.w[k].rgb[1], st.w[k].rgb[2]);
        }
      }
    }
  }
}

// ---------- panel builders ----------

function disposeWidgets() {
  for (const w of state.widgets) {
    try { w.destroy(); } catch (_err) { /* best effort */ }
  }
  state.widgets = [];
}

function track(widget) {
  state.widgets.push(widget);
  return widget;
}

function editableValue(parent, get, set, schema) {
  const span = make("span", "lk-pval", fmtParam(schema, get()));
  span.title = "Click to edit";
  span.onclick = function (e) {
    e.stopPropagation();
    if (span.querySelector("input")) return;
    const input = document.createElement("input");
    input.value = fmtParam(schema, get());
    span.textContent = "";
    span.appendChild(input);
    input.focus();
    try { input.select(); } catch (_err) {}
    function commit() {
      const parsed = state.Looks.color.parseNum(input.value, schema);
      if (parsed !== null) set(parsed);
      refreshPanel();
    }
    input.onkeydown = function (ev) {
      if (ev.key === "Enter") commit();
      else if (ev.key === "Escape") refreshPanel();
      ev.stopPropagation();
    };
    input.onblur = commit;
  };
  parent.appendChild(span);
  return span;
}

function buildParamRow(panel, tool, prm, toolState, onSet) {
  if (prm.kind === "section") {
    if (prm.label) panel.appendChild(make("div", "lk-section", prm.label));
    return;
  }
  if (prm.kind === "toggle") {
    const row = make("div", "lk-prow");
    row.appendChild(make("span", "lk-plabel", prm.label));
    const btn = make("button", "lk-toggle" + (toolState.p[prm.key] ? " on" : ""), toolState.p[prm.key] ? "On" : "Off");
    btn.onclick = function () {
      toolState.p[prm.key] = toolState.p[prm.key] ? 0 : 1;
      refreshPanel();
    };
    row.appendChild(btn);
    panel.appendChild(row);
    return;
  }
  if (prm.kind === "choice") {
    const row = make("div", "lk-prow");
    row.appendChild(make("span", "lk-plabel", prm.label));
    const sel = make("select", "lk-select");
    (prm.options || []).forEach(function (opt, i) {
      const o = make("option", "", opt);
      o.value = String(i);
      if (i === toolState.p[prm.key]) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      toolState.p[prm.key] = Number(sel.value) || 0;
      if (onSet) onSet(prm.key);
      refreshPanel();
    };
    row.appendChild(sel);
    panel.appendChild(row);
    return;
  }
  const row = make("div", "lk-prow");
  row.appendChild(make("span", "lk-plabel", prm.label));
  editableValue(row, function () { return toolState.p[prm.key]; }, function (v) {
    toolState.p[prm.key] = v;
    if (onSet) onSet(prm.key);
  }, prm);
  panel.appendChild(row);
}

function rgbReadout(parent, getRgb, setRgb) {
  const C = state.Looks.color;
  const box = make("div", "lk-rgb");
  const cells = {};
  ["R", "G", "B"].forEach(function (k, i) {
    const row = make("div", "lk-rgb-row");
    row.appendChild(make("span", "lk-rgb-k", k));
    const v = make("span", "lk-rgb-v", getRgb()[i].toFixed(3));
    v.title = "Click to edit";
    v.onclick = function (e) {
      e.stopPropagation();
      if (v.querySelector("input")) return;
      const input = document.createElement("input");
      input.value = getRgb()[i].toFixed(3);
      v.textContent = "";
      v.appendChild(input);
      input.focus();
      try { input.select(); } catch (_err) {}
      function commit() {
        const parsed = C.parseNum(input.value, { min: 0, max: 4 });
        if (parsed !== null) {
          const rgb = getRgb().slice();
          rgb[i] = Math.round(parsed * 1000) / 1000;
          setRgb(rgb);
        }
        refreshPanel();
      }
      input.onkeydown = function (ev) {
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") refreshPanel();
        ev.stopPropagation();
      };
      input.onblur = commit;
    };
    row.appendChild(v);
    cells[k] = v;
    box.appendChild(row);
  });
  parent.appendChild(box);
  return cells;
}

function buildWheelRow(panel, toolState, wdef) {
  const C = state.Looks.color;
  const row = make("div", "lk-wheelrow");
  const holder = make("div", "");
  row.appendChild(holder);
  const wheel = track(new state.Looks.widgets.ColorWheel(holder, {
    size: 190,
    initial: toolState.w[wdef.key].dot,
  }));
  const getRgb = function () { return toolState.w[wdef.key].rgb; };
  rgbReadout(row, getRgb, function (rgb) {
    toolState.w[wdef.key].rgb = rgb;
    toolState.w[wdef.key].dot = C.tintToDot(rgb[0], rgb[1], rgb[2]);
    wheel.set(toolState.w[wdef.key].dot);
  });
  wheel.onInput(function (dot, rgb) {
    toolState.w[wdef.key].dot = { angle: Math.round(dot.angle * 10) / 10, radius: Math.round(dot.radius * 1000) / 1000 };
    toolState.w[wdef.key].rgb = [rgb[0], rgb[1], rgb[2]].map(function (v) { return Math.round(v * 1000) / 1000; });
    refreshReadoutsOnly(panel, toolState, wdef);
  });
  panel.appendChild(row);
}

// Lightweight readout refresh while dragging (no full rebuild).
function refreshReadoutsOnly(panel, toolState, wdef) {
  const rgb = toolState.w[wdef.key].rgb;
  const cells = panel.querySelectorAll(".lk-wheelrow .lk-rgb-v");
  const vals = [rgb[0].toFixed(3), rgb[1].toFixed(3), rgb[2].toFixed(3)];
  for (let i = 0; i < cells.length && i < 3; i++) {
    if (!cells[i].querySelector("input")) cells[i].textContent = vals[i];
  }
  paintTweakFlags();
  schedulePush();
}

function buildCustom(panel, tool, toolState) {
  const W = state.Looks.widgets;
  const C = state.Looks.color;
  if (tool.custom === "hsl") {
    const holder = make("div", "");
    panel.appendChild(holder);
    const hsl = track(new W.HSLWheels(holder, { values: toolState.x.hsl }));
    // Section titles between the wheels + table, like the reference.
    const kids = Array.prototype.slice.call(holder.children);
    if (kids[0]) holder.insertBefore(make("div", "lk-section", "Hue/Saturation"), kids[0]);
    if (kids[1]) holder.insertBefore(make("div", "lk-section", "Hue/Lightness"), kids[1]);
    hsl.onInput(function (vals) {
      toolState.x.hsl = vals;
      paintTweakFlags();
      schedulePush();
    });
  } else if (tool.custom === "curves") {
    const holder = make("div", "");
    panel.appendChild(holder);
    const pad = track(new W.CurvesPad(holder, { state: toolState.x.curves }));
    pad.onInput(function () { paintTweakFlags(); schedulePush(); });
    panel.appendChild(make("div", "lk-chan-note", "Double-click adds a point, right-click removes one."));
  } else if (tool.custom === "scurve") {
    const holder = make("div", "");
    panel.appendChild(holder);
    const pad = track(new W.SCurvePad(holder, { state: toolState.x.scurve }));
    const rows = make("div", "");
    panel.appendChild(rows);
    function paintRows() {
      rows.innerHTML = "";
      const s = toolState.x.scurve;
      const defs = [
        ["Black Point:", s.black, 3, function (v) { s.black = v; s.p0.y = C.clamp(v, 0, 1); pad.set(s); }],
        ["White Point:", s.white, 3, function (v) { s.white = v; s.p3.y = C.clamp(v, 0, 1); pad.set(s); }],
        ["Contrast:", s.contrast, 3, function (v) { s.contrast = v; reshapeFromParams(); }],
        ["Midpoint:", s.midpoint, 3, function (v) { s.midpoint = v; reshapeFromParams(); }],
        ["Brightness:", s.brightness, 3, function (v) { s.brightness = v; reshapeFromParams(); }],
      ];
      defs.forEach(function (d) {
        const row = make("div", "lk-prow");
        row.appendChild(make("span", "lk-plabel", d[0]));
        editableValue(row, (function (v) { return function () { return v; }; })(d[1]), d[3], { kind: "number", decimals: d[2] });
        rows.appendChild(row);
      });
    }
    function reshapeFromParams() {
      const s = toolState.x.scurve;
      const m = C.clamp(s.midpoint, 0.05, 0.95);
      const k = C.clamp(s.contrast, 0.2, 4);
      const b = (C.clamp(s.brightness, 0, 1) - 0.5) * 0.5;
      s.c1 = { x: C.clamp(m - 0.28, 0, 1), y: C.clamp(m - 0.28 * k * 0.45 + b, 0, 1) };
      s.c2 = { x: C.clamp(m + 0.28, 0, 1), y: C.clamp(m + 0.28 * k * 0.45 + b, 0, 1) };
      s.p0 = { x: 0, y: C.clamp(s.black, 0, 1) };
      s.p3 = { x: 1, y: C.clamp(s.white, 0, 1) };
      pad.set(s);
      paintRows();
      paintTweakFlags();
      schedulePush();
    }
    pad.onInput(function () {
      paintRows();
      paintTweakFlags();
      schedulePush();
    });
    paintRows();
  } else if (tool.custom === "fourway") {
    const fw = toolState.x.fourway;
    for (const k of ["shadows", "midtones", "highlights", "global"]) {
      if (!fw[k]) fw[k] = { rgb: [1, 1, 1], dot: { angle: 0, radius: 0 } };
    }
    const grid = make("div", "lk-fourway");
    panel.appendChild(grid);
    const defs = [
      ["Midtones", "midtones", "Sat: 100.0%", true],
      ["Shadows", "shadows", "Sat: 100.0%", false],
      ["Highlights", "highlights", "Sat: 100.0%", false],
      ["Global", "global", "Sat: 100.0%", true],
    ];
    const wheelRefs = {};
    defs.forEach(function (d) {
      const col = make("div", "lk-four-col" + (d[3] ? " mid" : ""));
      col.appendChild(make("div", "lk-four-name", d[0]));
      const holder = make("div", "");
      col.appendChild(holder);
      const wheel = track(new W.ColorWheel(holder, { size: 118, initial: fw[d[1]].dot }));
      wheelRefs[d[1]] = wheel;
      wheel.onInput(function (dot, rgb) {
        fw[d[1]] = {
          dot: { angle: Math.round(dot.angle * 10) / 10, radius: Math.round(dot.radius * 1000) / 1000 },
          rgb: rgb.map(function (v) { return Math.round(v * 1000) / 1000; }),
        };
        paintTweakFlags();
        schedulePush();
      });
      col.appendChild(make("div", "lk-four-sat", d[2]));
      grid.appendChild(col);
    });
    const rangesRow = make("div", "lk-prow");
    rangesRow.appendChild(make("span", "lk-plabel", "Ranges"));
    const prevWrap = make("span", "lk-plabel", "Preview:");
    prevWrap.style.flex = "0 0 auto";
    rangesRow.appendChild(prevWrap);
    const prev = make("button", "lk-toggle" + (fw.preview ? " on" : ""), fw.preview ? "On" : "Off");
    prev.onclick = function () {
      fw.preview = fw.preview ? 0 : 1;
      refreshPanel();
    };
    rangesRow.appendChild(prev);
    panel.appendChild(rangesRow);
    const gholder = make("div", "");
    panel.appendChild(gholder);
    track(new W.RangesGraph(gholder, {}));
  } else if (tool.custom === "warmcool") {
    const holder = make("div", "");
    holder.style.textAlign = "center";
    panel.appendChild(holder);
    const pad = track(new W.WarmCoolPad(holder, {
      x: toolState.x.warmcool.x,
      y: toolState.x.warmcool.y,
    }));
    pad.onInput(function (p) {
      toolState.p.warmCool = Math.round(p.x * 1000) / 1000;
      toolState.p.tint = Math.round(p.y * 1000) / 1000;
      toolState.x.warmcool = { x: p.x, y: p.y };
      refreshPanel();
    });
    toolState._padLive = pad;
  } else if (tool.custom === "angledial") {
    const holder = make("div", "");
    panel.appendChild(holder);
    const dial = track(new W.AngleDial(holder, { angle: toolState.x.angle }));
    dial.onInput(function (a) {
      toolState.x.angle = a;
      paintTweakFlags();
      schedulePush();
    });
  } else if (tool.custom === "lut") {
    const lut = toolState.x.lut;
    const row = make("div", "lk-prow");
    row.appendChild(make("span", "lk-plabel", "LUT:"));
    const nameRow = make("div", "lk-lut-row");
    nameRow.appendChild(make("span", "lk-lut-name", lut.name));
    const x = make("button", "lk-lut-x", "✕");
    x.title = "Clear LUT";
    x.onclick = function () {
      lut.name = "None";
      refreshPanel();
    };
    nameRow.appendChild(x);
    panel.appendChild(nameRow);
    buildParamRow(panel, tool, { kind: "number", key: "__strength", label: "Strength:", def: 1, min: 0, max: 1, step: 0.01, decimals: 1, percent: true, fraction: true },
      { p: { __strength: lut.strength } });
    // Route the generic strength row back into lut state.
    const strengthCells = panel.querySelectorAll(".lk-pval");
    const last = strengthCells[strengthCells.length - 1];
    if (last) {
      last.onclick = function (e) {
        e.stopPropagation();
        if (last.querySelector("input")) return;
        const input = document.createElement("input");
        input.value = state.Looks.color.fmtNum(lut.strength, 1, { percent: true, fraction: true });
        last.textContent = "";
        last.appendChild(input);
        input.focus();
        try { input.select(); } catch (_err) {}
        function commit() {
          const parsed = state.Looks.color.parseNum(input.value, { percent: true, fraction: true });
          if (parsed !== null) lut.strength = parsed;
          refreshPanel();
        }
        input.onkeydown = function (ev) {
          if (ev.key === "Enter") commit();
          else if (ev.key === "Escape") refreshPanel();
          ev.stopPropagation();
        };
        input.onblur = commit;
      };
    }
    buildParamRow(panel, tool, { kind: "choice", key: "__gamma", label: "LUT Gamma:", def: lut.gamma, options: lut.gammaOptions },
      { p: { __gamma: lut.gamma } });
    const sels = panel.querySelectorAll("select.lk-select");
    const gsel = sels[sels.length - 1];
    if (gsel) {
      gsel.onchange = function () {
        lut.gamma = gsel.value;
        refreshPanel();
      };
    }
  }
}

function paintTweakFlags() {
  if (!state.windowEl) return;
  const items = state.windowEl.querySelectorAll(".lk-tool");
  Array.prototype.forEach.call(items, function (el) {
    const tool = state.Looks.tools.byId(el.getAttribute("data-tool"));
    if (!tool) return;
    let flag = el.querySelector(".lk-tool-tweaked");
    if (isTweaked(tool)) {
      if (!flag) {
        flag = make("span", "lk-tool-tweaked", "●");
        el.appendChild(flag);
      }
    } else if (flag) {
      flag.remove();
    }
  });
}

function refreshPanel() {
  if (!state.windowEl) return;
  disposeWidgets();
  const inner = state.windowEl.querySelector(".lk-panel-inner");
  inner.innerHTML = "";
  buildPanel(inner);
  paintTweakFlags();
  refreshChain();
  schedulePush();
}

function buildPanel(inner) {
  const Looks = state.Looks;
  const tool = Looks.tools.byId(state.activeTool) || Looks.tools.TOOLS[0];
  const toolState = state.look.tools[tool.id];

  const head = make("div", "lk-toolhead");
  head.appendChild(make("h2", "lk-tool-title", tool.name));
  const reset = make("button", "lk-reset", "↻");
  reset.title = "Reset " + tool.name;
  reset.onclick = function () {
    state.look.tools[tool.id] = Looks.tools.defaultToolState(tool);
    // Drop any live widget handles (warm/cool pad etc).
    refreshPanel();
  };
  head.appendChild(reset);
  inner.appendChild(head);

  // Preset row (per-tool factory presets: None only for now; Custom shown
  // automatically once the tool differs from defaults).
  const prow = make("div", "lk-preset-row");
  prow.appendChild(make("span", "lk-preset-label", "Preset:"));
  const sel = make("select", "lk-select");
  const none = make("option", "", "None");
  none.value = "None";
  sel.appendChild(none);
  if (isTweaked(tool)) {
    const custom = make("option", "", "Custom");
    custom.value = "Custom";
    custom.selected = true;
    sel.appendChild(custom);
  } else {
    none.selected = true;
  }
  sel.onchange = function () {
    if (sel.value === "None") {
      state.look.tools[tool.id] = Looks.tools.defaultToolState(tool);
      refreshPanel();
    }
  };
  prow.appendChild(sel);
  inner.appendChild(prow);

  // Params in catalog order; wheels render at their section breaks.
  // Warm/Cool numbers also move the pad dot (params -> pad direction; the
  // pad -> params direction is wired in buildCustom).
  const syncPad = tool.custom === "warmcool" ? function () {
    const t = state.look.tools[tool.id];
    t.x.warmcool = { x: t.p.warmCool, y: t.p.tint };
    if (t._padLive) {
      try { t._padLive.set(t.x.warmcool); } catch (_err) { /* rebuilt below */ }
    }
  } : null;
  let wheelQueue = (tool.wheels || []).slice();
  const extraGroups = (tool.extraWheels || []).slice();
  for (const prm of tool.params || []) {
    if (prm.kind === "section" && wheelQueue.length) {
      inner.appendChild(make("div", "lk-section", prm.label));
      const wdef = wheelQueue.shift();
      buildWheelRow(inner, toolState, wdef);
      continue;
    }
    buildParamRow(inner, tool, prm, toolState, syncPad);
  }
  for (const wdef of wheelQueue) {
    buildWheelRow(inner, toolState, wdef);
  }
  for (const grp of extraGroups) {
    if (grp.section) inner.appendChild(make("div", "lk-section", grp.section));
    for (const wdef of grp.wheels || []) {
      buildWheelRow(inner, toolState, wdef);
    }
  }
  buildCustom(inner, tool, toolState);

  const foot = make("div", "lk-foot");
  foot.appendChild(make("span", "lk-foot-dot"));
  foot.appendChild(make("span", "",
    state.effect
      ? "Bound to the Magic Looks effect — edits grade the preview live"
      : "Not bound — add the Magic Looks effect to a clip to grade footage"));
  inner.appendChild(foot);
}

function buildSidebar(side) {
  const Looks = state.Looks;
  const search = make("input", "lk-search");
  search.placeholder = "Search tools…";
  search.oninput = function () {
    const q = search.value.trim().toLowerCase();
    Array.prototype.forEach.call(side.querySelectorAll(".lk-tool"), function (el) {
      const tool = Looks.tools.byId(el.getAttribute("data-tool"));
      el.classList.toggle("hidden", !!q && tool.name.toLowerCase().indexOf(q) === -1);
    });
  };
  side.appendChild(search);
  for (const grp of Looks.tools.GROUPS) {
    side.appendChild(make("div", "lk-group-name", grp.name));
    const wrap = make("div", "lk-group");
    for (const tool of Looks.tools.TOOLS) {
      if (tool.group !== grp.id) continue;
      const btn = make("button", "lk-tool" + (tool.id === state.activeTool ? " active" : ""), tool.name);
      btn.setAttribute("data-tool", tool.id);
      btn.prepend(make("span", "lk-tool-dot"));
      btn.onclick = function () {
        selectTool(tool.id);
      };
      wrap.appendChild(btn);
    }
    side.appendChild(wrap);
  }
}

function exportLook() {
  const blob = new Blob([JSON.stringify(state.look, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "magic-looks-look.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    try { URL.revokeObjectURL(a.href); } catch (_err) {}
    a.remove();
  }, 1000);
}

function importLook(file) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(String(reader.result || ""));
      if (!data || typeof data !== "object" || !data.tools) throw new Error("bad look");
      const fresh = defaultLookState();
      for (const id of Object.keys(fresh.tools)) {
        if (data.tools[id]) {
          // Merge over defaults so missing keys stay valid.
          const merged = fresh.tools[id];
          const src = data.tools[id];
          if (src.p) for (const k of Object.keys(src.p)) if (merged.p[k] !== undefined) merged.p[k] = src.p[k];
          if (src.w) for (const k of Object.keys(src.w)) if (merged.w[k] && src.w[k].rgb) {
            merged.w[k].rgb = src.w[k].rgb.slice(0, 3).map(Number);
            merged.w[k].dot = state.Looks.color.tintToDot(merged.w[k].rgb[0], merged.w[k].rgb[1], merged.w[k].rgb[2]);
          }
          if (src.x) fresh.tools[id].x = src.x;
        }
      }
      state.look = fresh;
      state.look.preset = "None";
      syncLookSelect();
      refreshPanel();
    } catch (_err) {
      try { alert("That file is not a Magic Looks look."); } catch (_e) {}
    }
  };
  reader.readAsText(file);
}

function syncLookSelect() {
  if (!state.windowEl) return;
  const sel = state.windowEl.querySelector(".lk-head-select");
  if (sel) sel.value = state.look.preset || "None";
}

// ---------- tool chain strip (LOOKS | Input | slots | TOOLS) ----------

// Forward-compatible enable sync: updates local state now, and writes the
// effect property once the setup is bound to a live effect instance.
function syncToolEnable(id) {
  paintTweakFlags();
  refreshChain();
  schedulePush();
}

function syncChainBypass() {
  refreshChain();
  schedulePush();
}

function currentFrame() {
  const CM = state.editor;
  return CM && CM.playback ? CM.playback.currentFrame : 0;
}

function frameOffsetOf(p) {
  return (p && p.frameOffset) || 0;
}

function getEffectProp(key) {
  const e = state.effect;
  if (!e) return undefined;
  const p = e.properties[key];
  if (!p) return undefined;
  try {
    return p.get(currentFrame());
  } catch (_err) {
    return undefined;
  }
}

function getEffectText(key) {
  const v = getEffectProp(key);
  return typeof v === "string" ? v : undefined;
}

function setEffectProp(key, value) {
  const e = state.effect;
  if (!e) return false;
  const p = e.properties[key];
  if (!p || typeof p.set !== "function") return false;
  try {
    p.set(value, currentFrame() - frameOffsetOf(p));
    return true;
  } catch (_err) {
    return false;
  }
}

// ---------- live-effect binding ----------

function findLooks() {
  const CM = state.editor;
  const found = [];
  const walk = function (list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i];
      if (!fx) continue;
      if (fx.type === "looks") {
        found.push(fx);
        continue;
      }
      if (fx.effects) walk(fx.effects);
    }
  };
  const selection = CM && CM.timelineSelection;
  if (selection) {
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const layer = clip && (clip.object || clip);
      if (layer && layer.effects) walk(layer.effects);
    }
  }
  if (!found.length && CM && CM.project) {
    CM.project.traverse(function (e) { if (e.type === "looks") found.push(e); });
  }
  return found;
}

function pullFromEffect() {
  const Looks = state.Looks;
  if (!state.effect || !state.look) return;
  const map = Looks.tools.propMap();
  try {
    const gl = getEffectProp("enabled");
    if (gl !== undefined) state.look.enabled = gl ? 1 : 0;
    for (const tool of Looks.tools.TOOLS) {
      const rec = map[tool.id];
      const st = state.look.tools[tool.id];
      if (!st) continue;
      const en = getEffectProp(rec.enable);
      if (en !== undefined) state.look.on[tool.id] = en ? 1 : 0;
      const schemas = {};
      for (const p of tool.params || []) schemas[p.key] = p;
      for (const k of Object.keys(rec.params)) {
        const v = getEffectProp(rec.params[k]);
        if (v === undefined) continue;
        const schema = schemas[k];
        if (!schema) continue;
        if (schema.kind === "number") {
          const n = Number(v);
          if (isFinite(n)) st.p[k] = n;
        } else {
          st.p[k] = Math.round(Number(v)) || 0;
        }
      }
      for (const k of Object.keys(rec.wheels)) {
        const t = rec.wheels[k];
        const rgb = [getEffectProp(t[0]), getEffectProp(t[1]), getEffectProp(t[2])];
        if (rgb.every((v) => v !== undefined && isFinite(Number(v)))) {
          st.w[k].rgb = rgb.map(Number);
          st.w[k].dot = Looks.color.tintToDot(st.w[k].rgb[0], st.w[k].rgb[1], st.w[k].rgb[2]);
        }
      }
      const cx = rec.custom;
      if (cx.hsl) {
        cx.hsl.sat.forEach((key, i) => {
          const v = getEffectProp(key);
          if (v !== undefined && isFinite(Number(v))) st.x.hsl[i].sat = Number(v);
        });
        cx.hsl.light.forEach((key, i) => {
          const v = getEffectProp(key);
          if (v !== undefined && isFinite(Number(v))) st.x.hsl[i].light = Number(v);
        });
      }
      if (cx.curvesJson) {
        const s = getEffectText(cx.curvesJson);
        if (s) {
          try {
            const ch = JSON.parse(s);
            if (ch && ch.Red && ch.Green && ch.Blue) st.x.curves.channels = ch;
          } catch (_e) { /* keep local curves */ }
        }
      }
      if (cx.scurveJson) {
        const s = getEffectText(cx.scurveJson);
        if (s) {
          try {
            const sh = JSON.parse(s);
            // Shape + range travel; contrast/midpoint/brightness stay as
            // local display shaping until the user edits them again.
            for (const k of ["black", "white", "p0", "c1", "c2", "p3"]) {
              if (sh[k] !== undefined) st.x.scurve[k] = sh[k];
            }
          } catch (_e2) { /* keep local shape */ }
        }
      }
      if (cx.fourway) {
        const pv = getEffectProp(cx.fourwayPreview);
        if (pv !== undefined) st.x.fourway.preview = pv ? 1 : 0;
        for (const slot of Object.keys(cx.fourway)) {
          const t = cx.fourway[slot];
          const rgb = [getEffectProp(t[0]), getEffectProp(t[1]), getEffectProp(t[2])];
          if (rgb.every((v) => v !== undefined && isFinite(Number(v)))) {
            st.x.fourway[slot] = {
              rgb: rgb.map(Number),
              dot: Looks.color.tintToDot(rgb[0], rgb[1], rgb[2]),
            };
          }
        }
      }
      if (cx.angle) {
        const v = getEffectProp(cx.angle);
        if (v !== undefined && isFinite(Number(v))) st.x.angle = Number(v);
      }
      if (cx.lutName) {
        const nm = getEffectText(cx.lutName);
        if (nm) st.x.lut.name = nm;
        const ss = getEffectProp(cx.lutStrength);
        if (ss !== undefined && isFinite(Number(ss))) st.x.lut.strength = Number(ss);
        const gi = getEffectProp(cx.lutGamma);
        if (gi !== undefined) {
          const idx = Math.round(Number(gi)) || 0;
          st.x.lut.gamma = st.x.lut.gammaOptions[idx] || st.x.lut.gamma;
        }
      }
    }
  } catch (_err) { /* partial pull still leaves a usable panel */ }
}

function pushFullState() {
  const Looks = state.Looks;
  if (!state.effect || !state.look) return;
  const map = Looks.tools.propMap();
  setEffectProp("enabled", state.look.enabled === false ? 0 : 1);
  for (const tool of Looks.tools.TOOLS) {
    const rec = map[tool.id];
    const st = state.look.tools[tool.id];
    if (!st) continue;
    setEffectProp(rec.enable, state.look.on[tool.id] ? 1 : 0);
    for (const k of Object.keys(rec.params)) {
      setEffectProp(rec.params[k], st.p[k]);
    }
    for (const k of Object.keys(rec.wheels)) {
      const t = rec.wheels[k];
      const rgb = (st.w[k] && st.w[k].rgb) || [1, 1, 1];
      setEffectProp(t[0], rgb[0]);
      setEffectProp(t[1], rgb[1]);
      setEffectProp(t[2], rgb[2]);
    }
    const cx = rec.custom;
    if (cx.hsl) {
      cx.hsl.sat.forEach((key, i) => setEffectProp(key, st.x.hsl[i].sat));
      cx.hsl.light.forEach((key, i) => setEffectProp(key, st.x.hsl[i].light));
    }
    if (cx.curvesJson && st.x.curves) {
      setEffectProp(cx.curvesJson, JSON.stringify(st.x.curves.channels));
    }
    if (cx.scurveJson && st.x.scurve) {
      const s = st.x.scurve;
      setEffectProp(cx.scurveJson, JSON.stringify({
        black: s.black, white: s.white, p0: s.p0, c1: s.c1, c2: s.c2, p3: s.p3,
      }));
    }
    if (cx.fourway) {
      setEffectProp(cx.fourwayPreview, st.x.fourway.preview ? 1 : 0);
      for (const slot of Object.keys(cx.fourway)) {
        const t = cx.fourway[slot];
        const fw = st.x.fourway[slot] || { rgb: [1, 1, 1] };
        const rgb = fw.rgb || fw;
        setEffectProp(t[0], rgb[0]);
        setEffectProp(t[1], rgb[1]);
        setEffectProp(t[2], rgb[2]);
      }
    }
    if (cx.angle) setEffectProp(cx.angle, st.x.angle);
    if (cx.lutName && st.x.lut) {
      setEffectProp(cx.lutName, st.x.lut.name);
      setEffectProp(cx.lutStrength, st.x.lut.strength);
      setEffectProp(cx.lutGamma, Math.max(0, st.x.lut.gammaOptions.indexOf(st.x.lut.gamma)));
    }
  }
}

// Coarse debounced write-through: every panel mutation already funnels
// through refreshPanel, so one hook covers all controls.
function schedulePush() {
  if (!state.effect || !state.windowEl) return;
  if (state.pushTimer) return;
  state.pushTimer = setTimeout(function () {
    state.pushTimer = null;
    if (!state.effect || !state.windowEl || state.pushing) return;
    state.pushing = true;
    try {
      pushFullState();
    } catch (_err) { /* best effort */ }
    finally {
      state.pushing = false;
    }
  }, 150);
}

function routeSetupAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  if (action === "magicLooksSetup" && typeof editor.openMagicLooks === "function") {
    editor.openMagicLooks(target && target.parentObject);
    return true;
  }
  return false;
}

function ensureDispatcher(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls) {
    throw new Error("Setup windows need PZ.ui.controls from the CM3 runtime.");
  }
  if (typeof controls.runPropertyAction === "function") return controls;
  controls.runPropertyAction = function (list, target, action, el) {
    routeSetupAction(action, list, target);
  };
  controls.runPropertyAction.__magicLooksCompat = true;
  return controls;
}

function wrapDispatcher(PZ) {
  // Chain above whatever dispatcher is installed (ours, a sibling's, or
  // upstream's): route magicLooksSetup here, delegate the rest.
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.runPropertyAction !== "function") return;
  if (state.installedWrapper) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__magicLooksDead) {
      return original.call(this, list, target, action, el);
    }
    if (routeSetupAction(action, list, target)) return;
    return original.call(this, list, target, action, el);
  };
  patched.__magicLooksOriginal = original;
  controls.runPropertyAction = patched;
  state.installedWrapper = patched;
}

function unpatchDispatcher(PZ) {
  if (state.installedWrapper) {
    state.installedWrapper.__magicLooksDead = true;
    const controls = PZ && PZ.ui && PZ.ui.controls;
    if (controls && controls.runPropertyAction === state.installedWrapper) {
      controls.runPropertyAction = controls.runPropertyAction.__magicLooksOriginal || controls.runPropertyAction;
    }
    state.installedWrapper = null;
  }
}

function buildChain(strip) {
  const Looks = state.Looks;
  strip.innerHTML = "";
  strip.appendChild(make("div", "lk-chain-looks", "LOOKS"));

  // Input slot: click toggles the whole-chain bypass.
  const input = make("button", "lk-slot lk-slot-input", "");
  input.title = "Input · Output - Rec.709 (click to bypass the chain)";
  const ibox = make("div", "lk-thumbbox");
  const icanvas = document.createElement("canvas");
  ibox.appendChild(icanvas);
  try { Looks.widgets.paintChainThumb(icanvas, { kind: "input" }); } catch (_err) {}
  input.appendChild(ibox);
  input.appendChild(make("div", "lk-slot-name", "Input"));
  input.appendChild(make("div", "lk-slot-sub", "Output - Rec.709"));
  input.onclick = function () {
    state.look.enabled = state.look.enabled === false ? 1 : 0;
    syncChainBypass();
  };
  strip.appendChild(input);
  strip.appendChild(make("div", "lk-sep"));

  for (const tool of Looks.tools.TOOLS) {
    const slot = make("button", "lk-slot", "");
    slot.setAttribute("data-tool", tool.id);
    slot.title = tool.name + " (click to edit, badge to bypass)";
    const box = make("div", "lk-thumbbox");
    const canvas = document.createElement("canvas");
    box.appendChild(canvas);
    try { Looks.widgets.paintChainThumb(canvas, tool.thumb || { kind: "dot" }); } catch (_err) {}
    const badge = make("div", "lk-badge", "⊘");
    badge.title = "Bypass " + tool.name;
    badge.onclick = function (e) {
      e.stopPropagation();
      state.look.on[tool.id] = state.look.on[tool.id] ? 0 : 1;
      syncToolEnable(tool.id);
    };
    box.appendChild(badge);
    slot.appendChild(box);
    slot.appendChild(make("div", "lk-slot-name", tool.name));
    slot.onclick = function () {
      selectTool(tool.id);
    };
    strip.appendChild(slot);
  }
  strip.appendChild(make("div", "lk-sep"));
  const add = make("button", "lk-slot lk-slot-add", "");
  add.title = "All tools are in the chain — search them";
  add.appendChild(make("div", "lk-add-plus", "+"));
  add.appendChild(make("div", "lk-slot-name", "TOOLS"));
  add.onclick = function () {
    const search = state.windowEl && state.windowEl.querySelector(".lk-search");
    if (search) search.focus();
  };
  strip.appendChild(add);
  const cap = make("div", "lk-chain-tools", "TOOLS");
  strip.appendChild(cap);
  refreshChain();
}

function refreshChain() {
  if (!state.windowEl) return;
  const strip = state.windowEl.querySelector(".lk-chain");
  if (!strip) return;
  const bypassed = state.look.enabled === false;
  strip.classList.toggle("bypassed", bypassed);
  const input = strip.querySelector(".lk-slot-input");
  if (input) input.classList.toggle("off", bypassed);
  Array.prototype.forEach.call(strip.querySelectorAll(".lk-slot[data-tool]"), function (el) {
    const id = el.getAttribute("data-tool");
    el.classList.toggle("active", id === state.activeTool);
    el.classList.toggle("off", !state.look.on[id]);
  });
}

function selectTool(id) {
  if (!state.windowEl || state.activeTool === id) return;
  state.activeTool = id;
  const side = state.windowEl.querySelector(".lk-side");
  if (side) {
    Array.prototype.forEach.call(side.querySelectorAll(".lk-tool"), function (x) {
      x.classList.toggle("active", x.getAttribute("data-tool") === id);
    });
  }
  const inner = state.windowEl.querySelector(".lk-panel-inner");
  inner.classList.remove("swap");
  void inner.offsetWidth;
  refreshPanel();
  inner.classList.add("swap");
  refreshChain();
}

function openWindow() {
  closeWindow();
  disposeWidgets();
  const Looks = state.Looks;

  const root = make("div", "lk-window");
  const header = make("div", "lk-header");
  header.appendChild(make("div", "lk-head-title", "Magic Looks"));
  const group = make("div", "lk-head-group");
  group.appendChild(make("span", "lk-head-label", "Look:"));
  const lookSel = make("select", "lk-head-select");
  for (const name of Object.keys(LOOK_PRESETS)) {
    const o = make("option", "", name);
    o.value = name;
    lookSel.appendChild(o);
  }
  lookSel.value = state.look.preset || "None";
  lookSel.onchange = function () {
    applyLookPreset(lookSel.value);
    refreshPanel();
  };
  group.appendChild(lookSel);
  const exp = make("button", "lk-head-btn", "Export");
  exp.onclick = exportLook;
  group.appendChild(exp);
  const imp = make("button", "lk-head-btn", "Import");
  imp.onclick = function () {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = function () {
      if (input.files && input.files[0]) importLook(input.files[0]);
    };
    input.click();
  };
  group.appendChild(imp);
  const close = make("button", "lk-close", "✕");
  close.title = "Close (Esc)";
  close.onclick = closeWindow;
  group.appendChild(close);
  header.appendChild(group);
  root.appendChild(header);

  const chain = make("div", "lk-chain");
  buildChain(chain);
  root.appendChild(chain);

  const body = make("div", "lk-body");
  const side = make("div", "lk-side");
  buildSidebar(side);
  body.appendChild(side);

  // Render preview: the main viewport transplanted into the setup, like
  // the VHS/Datamosh windows. It shows the project with the bound Magic
  // Looks effect applied; unbound it shows the placeholder.
  const prev = make("div", "lk-preview");
  const screen = make("div", "lk-screen");
  screen.appendChild(make("div", "lk-screen-placeholder", "no preview"));
  prev.appendChild(screen);
  const bar = make("div", "lk-preview-bar");
  const statusEl = make("div", "lk-status", "No Looks effect");
  bar.appendChild(statusEl);
  const frameEl = make("span", "lk-time", "0000");
  bar.appendChild(frameEl);
  const addBtn = make("button", "lk-mini-btn", "Add Looks");
  addBtn.title = "Add the Magic Looks effect to the selected clip";
  addBtn.onclick = function () {
    const CM = state.editor;
    const fx = CM && CM.addLooksToSelection ? CM.addLooksToSelection() : null;
    if (fx) {
      state.effect = fx;
      pullFromEffect();
      refreshPanel();
    }
    refreshPreviewBar();
  };
  bar.appendChild(addBtn);
  const bypassBtn = make("button", "lk-mini-btn", "Bypass");
  bypassBtn.title = "Bypass the whole chain";
  bypassBtn.onclick = function () {
    state.look.enabled = state.look.enabled === false ? 1 : 0;
    syncChainBypass();
    refreshPreviewBar();
  };
  bar.appendChild(bypassBtn);
  prev.appendChild(bar);
  body.appendChild(prev);

  const panel = make("div", "lk-panel");
  const inner = make("div", "lk-panel-inner swap");
  panel.appendChild(inner);
  body.appendChild(panel);
  root.appendChild(body);
  document.body.appendChild(root);
  state.windowEl = root;
  buildPanel(inner);
  paintTweakFlags();

  // Transplant the main viewport into the preview screen.
  state.viewport = (state.editor && state.editor.mainViewport) || null;
  if (state.viewport && state.viewport.el) {
    state.viewportParent = state.viewport.el.parentElement;
    state.viewportStyle = state.viewport.el.getAttribute("style");
    state.wasEdit = state.viewport.edit;
    state.viewport.edit = false;
    screen.appendChild(state.viewport.el);
    const ph = screen.querySelector(".lk-screen-placeholder");
    if (ph) ph.remove();
    requestAnimationFrame(function () {
      if (state.viewport) state.viewport.resize();
    });
  }

  function refreshPreviewBar() {
    if (statusEl) {
      statusEl.textContent = state.effect ? "Magic Looks effect bound" : "No Looks effect";
      statusEl.classList.toggle("bound", !!state.effect);
    }
    if (frameEl) {
      frameEl.textContent = String(Math.max(0, Math.round(currentFrame()))).padStart(4, "0");
    }
    if (addBtn) addBtn.style.display = state.effect ? "none" : "";
    if (bypassBtn) {
      bypassBtn.classList.toggle("on", state.look && state.look.enabled === false);
      bypassBtn.textContent = state.look && state.look.enabled === false ? "Engage" : "Bypass";
    }
    if (state.viewport) state.viewport.resize();
  }
  state.refreshPreviewBar = refreshPreviewBar;
  refreshPreviewBar();
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshPreviewBar, 250);
  window.addEventListener("resize", state.refreshPreviewBar);

  state.onKey = function (e) {
    if (e.key === "Escape") closeWindow();
  };
  document.addEventListener("keydown", state.onKey);
}

function closeWindow() {
  disposeWidgets();
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  if (state.refreshPreviewBar && typeof window !== "undefined") {
    window.removeEventListener("resize", state.refreshPreviewBar);
    state.refreshPreviewBar = null;
  }
  // Restore the transplanted viewport to its host layout.
  if (state.viewport && state.viewportParent) {
    try {
      state.viewport.el.setAttribute("style", state.viewportStyle || "");
      state.viewportParent.appendChild(state.viewport.el);
      state.viewport.edit = state.wasEdit;
      state.viewport.resize();
    } catch (_err) { /* best effort */ }
  }
  state.viewport = null;
  state.viewportParent = null;
  if (state.onKey && typeof document !== "undefined") {
    document.removeEventListener("keydown", state.onKey);
    state.onKey = null;
  }
  if (state.windowEl) {
    state.windowEl.remove();
    state.windowEl = null;
  }
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!CM) throw new Error("Magic Looks needs the active editor instance.");
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    state.editor = CM;
    state.getAsset = getAsset;
    state.Looks = loadSources(getAsset);
    installStyle(getAsset, STYLE_ID, STYLE_URL);
    installFont(getAsset);
    state.look = defaultLookState();
    if (PZ) {
      ensureDispatcher(PZ);
      wrapDispatcher(PZ);
    }
    if (!CM.findLooksEffects) {
      CM.findLooksEffects = function () {
        return findLooks();
      };
    }
    if (!CM.addLooksToSelection) {
      CM.addLooksToSelection = function () {
        const selection = CM.timelineSelection;
        if (!selection || !selection.length) return null;
        for (let i = 0; i < selection.length; i++) {
          const clip = selection[i];
          const layer = clip && clip.object;
          if (layer && layer.effects) {
            const runtime = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
            if (!runtime || typeof runtime.effect.create !== "function") return null;
            const effect = runtime.effect.create("looks");
            layer.effects.push(effect);
            effect.loading = effect.load({});
            return effect;
          }
        }
        return null;
      };
    }
    CM.openMagicLooks = function (effect) {
      state.effect = effect || findLooks()[0] || null;
      if (state.effect) pullFromEffect();
      openWindow();
    };
    openWindow();
    state.active = true;
  },
  deactivate() {
    try {
      closeWindow();
      const PZ = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || null;
      const CM = state.editor;
      if (PZ) {
        try { unpatchDispatcher(PZ); } catch (_error) { /* best effort */ }
      }
      if (CM) {
        for (const key of ["openMagicLooks", "addLooksToSelection", "findLooksEffects"]) {
          if (CM[key]) {
            try { delete CM[key]; } catch (_error) { /* best effort */ }
          }
        }
      }
      uninstallStyles();
    } finally {
      state.active = false;
      state.editor = null;
      state.effect = null;
      state.getAsset = null;
      state.Looks = null;
      state.look = null;
    }
  },
};
