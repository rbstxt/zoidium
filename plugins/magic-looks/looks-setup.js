"use strict";

// Magic Looks — setup window.
//
// A floating window (zoidium/ui-kit.js) opened from the "Setup" button on the
// effect's property list. Nothing opens on plugin enable. The window edits the
// effect's own properties: live drags write for preview, and each finished edit
// is committed once through the editor history so undo/redo works.
//
// Activation touches only this module's state: it patches the property-list
// renderer to add the button (restored on disable) and installs one stylesheet
// while a window is open (removed when the last window closes).

const STYLE_ID = "zoidium-looks-setup-style";
const STYLE_URL = "./plugins/magic-looks/looks-setup.css";
const SOURCE_ORDER = ["looks-color.js", "looks-tools.js", "looks-widgets.js"];
const SNAPSHOT_MS = 400;

const state = {
  active: false,
  Looks: null,
  PZ: null,
  editor: null,
  ui: null,
  getAsset: null,
  patchedCreate: null,
  originalCreate: null,
  styleUsers: 0,
  ops: null,
  openWindows: new Set(),
  windowIds: new WeakMap(),
  nextWindowId: 1,
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
  if (!Looks.color || !Looks.tools || !Looks.widgets || !Looks.grade) {
    throw new Error("Magic Looks sources did not define their namespaces.");
  }
  return Looks;
}

function acquireStyle() {
  state.styleUsers += 1;
  if (state.styleUsers > 1 || typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const css = state.getAsset ? state.getAsset("text", STYLE_URL) : undefined;
  if (typeof css !== "string") return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function releaseStyle() {
  state.styleUsers = Math.max(0, state.styleUsers - 1);
  if (state.styleUsers > 0 || typeof document === "undefined") return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function round(v) {
  return Math.round(Number(v) * 1e6) / 1e6;
}

function cloneValue(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function currentEditorFrame() {
  const CM = state.editor;
  return CM && CM.playback ? CM.playback.currentFrame : 0;
}

function propOf(effect, key) {
  return effect && effect.properties ? effect.properties[key] || null : null;
}

function frameOf(prop) {
  return currentEditorFrame() - (prop.frameOffset || 0);
}

function readProp(effect, key) {
  const p = propOf(effect, key);
  if (!p) return undefined;
  try {
    return p.get(frameOf(p));
  } catch (_err) {
    return undefined;
  }
}

function readNum(effect, key, fallback) {
  const v = Number(readProp(effect, key));
  return isFinite(v) ? v : fallback;
}

function effectInProject(effect) {
  return !!(effect && effect.parent && (!("parentProject" in effect) ||
    effect.parentProject === (state.editor && state.editor.project)));
}

// Edit session for one effect: live writes for preview, one undoable commit
// per finished edit.
function createSession(effect) {
  const pending = new Map();
  const session = {
    onCommit: null,
    live(key, value) {
      if (!effectInProject(effect)) return;
      const p = propOf(effect, key);
      if (!p) return;
      if (!pending.has(key)) pending.set(key, { old: cloneValue(readProp(effect, key)) });
      try { p.set(value, frameOf(p)); } catch (_err) { /* property rejected the value */ }
    },
    commit(writes) {
      const CM = state.editor;
      const ops = state.ops;
      if (!CM || !ops || !effectInProject(effect)) return false;
      const entries = [];
      for (const w of writes) {
        const p = propOf(effect, w.key);
        if (!p) { pending.delete(w.key); continue; }
        const pend = pending.get(w.key);
        pending.delete(w.key);
        const old = pend ? pend.old : cloneValue(readProp(effect, w.key));
        if (JSON.stringify(old) === JSON.stringify(w.value)) continue;
        entries.push({ p: p, value: w.value, old: old });
      }
      if (!entries.length) return false;
      CM.history.startOperation();
      try {
        for (const en of entries) {
          ops.setValue({
            property: en.p.getAddress(),
            frame: frameOf(en.p),
            value: en.value,
            oldValue: en.old,
          });
        }
      } finally {
        CM.history.finishOperation();
      }
      if (session.onCommit) session.onCommit();
      return true;
    },
    // Commits any live preview that was not committed (window closed mid-drag).
    flush() {
      const writes = Array.from(pending.keys()).map(function (key) {
        return { key: key, value: readProp(effect, key) };
      });
      if (writes.length) session.commit(writes);
    },
  };
  return session;
}

// ---------- look presets and resets (all undoable through the session) ----------

function toolKeys(effect) {
  const Looks = state.Looks;
  const keep = {};
  keep[Looks.tools.ENABLED_KEY] = true;
  keep[Looks.tools.CHAIN_KEY] = true;
  return Object.keys(effect.propertyDefinitions || {}).filter(function (key) { return !keep[key]; });
}

// Writes that put every tool value back to its definition default.
function resetWrites(effect) {
  const defs = effect.propertyDefinitions || {};
  return toolKeys(effect).map(function (key) {
    return { key: key, value: defs[key] ? cloneValue(defs[key].value) : undefined };
  });
}

function presetWrites(effect, preset) {
  const Looks = state.Looks;
  const map = Looks.tools.propMap();
  const writes = resetWrites(effect);
  const byKey = {};
  writes.forEach(function (w) { byKey[w.key] = w; });
  const setKey = function (key, value) {
    if (byKey[key]) byKey[key].value = value;
  };
  Object.keys(preset.tools).forEach(function (toolId) {
    const rec = map[toolId];
    const patch = preset.tools[toolId];
    if (!rec || !patch) return;
    Object.keys(patch.p || {}).forEach(function (k) {
      if (rec.params[k]) setKey(rec.params[k], patch.p[k]);
    });
    Object.keys(patch.w || {}).forEach(function (k) {
      const triple = rec.wheels[k] || (rec.custom.fourway && rec.custom.fourway[k]);
      const rgb = patch.w[k];
      if (triple && rgb) {
        setKey(triple[0], rgb[0]);
        setKey(triple[1], rgb[1]);
        setKey(triple[2], rgb[2]);
      }
    });
  });
  return writes;
}

// ---------- chain helpers ----------

function readChain(effect) {
  return state.Looks.tools.parseChain(readProp(effect, state.Looks.tools.CHAIN_KEY));
}

function chainWrite(list) {
  return { key: state.Looks.tools.CHAIN_KEY, value: state.Looks.tools.serializeChain(list) };
}

function toolEnableKey(toolId) {
  return state.Looks.tools.propMap()[toolId].enable;
}

// ---------- window contents ----------

function numberValue(v, scale) {
  return round(Number(v) * scale);
}

// Scrubbable number or slider for a numeric catalog param.
function buildNumber(effect, session, prm, key, afterCommit) {
  const C = state.ui.controls;
  const pct = !!(prm.percent && prm.fraction);
  const scale = pct ? 100 : 1;
  const label = String(prm.label || key).replace(/:$/, "");
  const value = readNum(effect, key, Number(prm.def) || 0);
  const hasRange = isFinite(prm.min) && isFinite(prm.max);
  const options = {
    label: label,
    value: numberValue(value, scale),
    min: isFinite(prm.min) ? numberValue(prm.min, scale) : undefined,
    max: isFinite(prm.max) ? numberValue(prm.max, scale) : undefined,
    step: prm.step * scale,
    unit: pct ? "%" : undefined,
    onInput: function (v) { session.live(key, round(v / scale)); },
    onChange: function (v) {
      session.commit([{ key: key, value: round(v / scale) }]);
      afterCommit();
    },
  };
  if (hasRange) return C.slider(options);
  return C.number(options);
}

function buildToggle(effect, session, prm, key, afterCommit) {
  return state.ui.controls.checkbox({
    label: String(prm.label || key).replace(/:$/, ""),
    value: readNum(effect, key, prm.def) === 1,
    onChange: function (on) {
      session.commit([{ key: key, value: on ? 1 : 0 }]);
      afterCommit();
    },
  });
}

function buildChoice(effect, session, prm, key, afterCommit) {
  const options = (prm.options || []).map(function (label, i) {
    return { value: String(i), label: label };
  });
  return state.ui.controls.select({
    label: String(prm.label || key).replace(/:$/, ""),
    value: String(Math.max(0, Math.round(readNum(effect, key, 0)))),
    options: options,
    onChange: function (v) {
      session.commit([{ key: key, value: Number(v) || 0 }]);
      afterCommit();
    },
  });
}

// Color wheel plus RGB readouts for one wheel triple (R, G, B prop keys).
function buildWheel(effect, session, triple, label, widgets, afterCommit) {
  const C = state.Looks.color;
  const W = state.Looks.widgets;
  const ctl = state.ui.controls;
  const wrap = make("div", "lk-wheel-block");
  const holder = make("div", "lk-wheel-holder");
  wrap.appendChild(holder);
  const readRgb = function () {
    return triple.map(function (k) { return readNum(effect, k, 1); });
  };
  const rgb0 = readRgb();
  const wheel = new W.ColorWheel(holder, {
    size: 168,
    initial: C.tintToDot(rgb0[0], rgb0[1], rgb0[2]),
  });
  widgets.push(wheel);
  const readouts = [];
  const names = ["R", "G", "B"];
  const readoutsBox = make("div", "lk-readouts");
  names.forEach(function (name, i) {
    const row = ctl.number({
      label: label + " " + name,
      value: rgb0[i],
      min: 0,
      max: 4,
      step: 0.005,
      onInput: function (v) { session.live(triple[i], round(v)); },
      onChange: function (v) {
        session.commit([{ key: triple[i], value: round(v) }]);
        afterCommit();
      },
    });
    readouts.push(row);
    readoutsBox.appendChild(row.element);
  });
  wrap.appendChild(readoutsBox);
  wheel.onInput(function (dot, rgb) {
    triple.forEach(function (k, i) { session.live(k, round(rgb[i])); });
    readouts.forEach(function (row, i) { row.set(round(rgb[i])); });
  });
  wheel.onCommit(function (dot, rgb) {
    session.commit(triple.map(function (k, i) { return { key: k, value: round(rgb[i]) }; }));
    afterCommit();
  });
  return wrap;
}

function buildParams(effect, session, tool, body, afterCommit) {
  const ctl = state.ui.controls;
  const rec = state.Looks.tools.propMap()[tool.id];
  let current = body;
  for (const prm of tool.params || []) {
    if (prm.kind === "section") {
      if (prm.label) {
        const sec = ctl.section({ title: prm.label });
        body.appendChild(sec.element);
        current = sec.body;
      }
      continue;
    }
    const key = rec.params[prm.key];
    if (!key) continue;
    let row = null;
    if (prm.kind === "number") row = buildNumber(effect, session, prm, key, afterCommit);
    else if (prm.kind === "toggle") row = buildToggle(effect, session, prm, key, afterCommit);
    else if (prm.kind === "choice") row = buildChoice(effect, session, prm, key, afterCommit);
    if (row) current.appendChild(row.element);
  }
}

function buildWheels(effect, session, tool, body, widgets, afterCommit) {
  const rec = state.Looks.tools.propMap()[tool.id];
  const groups = [];
  (tool.wheels || []).forEach(function (w) { groups.push({ title: w.label, wheel: w }); });
  (tool.extraWheels || []).forEach(function (grp) {
    (grp.wheels || []).forEach(function (w) {
      groups.push({ title: grp.section || w.label, wheel: w });
    });
  });
  groups.forEach(function (g) {
    const triple = rec.wheels[g.wheel.key];
    if (!triple) return;
    const sec = state.ui.controls.section({ title: g.title });
    sec.body.appendChild(buildWheel(effect, session, triple, g.title, widgets, afterCommit));
    body.appendChild(sec.element);
  });
}

function buildHsl(effect, session, tool, body, afterCommit) {
  const ctl = state.ui.controls;
  const rec = state.Looks.tools.propMap()[tool.id];
  const hues = state.Looks.tools.HSL_HUES;
  const groups = [
    { title: "Hue/Saturation", keys: rec.custom.hsl.sat },
    { title: "Hue/Lightness", keys: rec.custom.hsl.light },
  ];
  groups.forEach(function (g) {
    const sec = ctl.section({ title: g.title });
    g.keys.forEach(function (key, i) {
      sec.body.appendChild(ctl.slider({
        label: hues[i].name,
        value: readNum(effect, key, 0),
        min: -1, max: 1, step: 0.01,
        onInput: function (v) { session.live(key, round(v)); },
        onChange: function (v) {
          session.commit([{ key: key, value: round(v) }]);
          afterCommit();
        },
      }).element);
    });
    body.appendChild(sec.element);
  });
}

function buildCurves(effect, session, tool, body, widgets, afterCommit, view) {
  const ctl = state.ui.controls;
  const W = state.Looks.widgets;
  const rec = state.Looks.tools.propMap()[tool.id];
  const key = rec.custom.curvesJson;
  const channels = readCurves(effect, key);
  const channelNames = ["RGB", "Red", "Green", "Blue"];
  const sel = ctl.select({
    label: "Channel",
    value: view.curveChannel,
    options: channelNames.map(function (n) { return { value: n, label: n }; }),
    onChange: function (v) {
      view.curveChannel = v;
      pad.setChannel(v);
    },
  });
  body.appendChild(sel.element);
  const pad = new W.CurvesPad(body, { channels: channels, channel: view.curveChannel, width: 300, height: 200 });
  widgets.push(pad);
  pad.onInput(function (chs) { session.live(key, JSON.stringify(chs)); });
  pad.onCommit(function (chs) {
    session.commit([{ key: key, value: JSON.stringify(chs) }]);
    afterCommit();
  });
  body.appendChild(ctl.buttonRow([{
    title: "Reset curves",
    onClick: function () {
      session.commit([{ key: key, value: JSON.stringify(state.Looks.tools.defaultToolState(tool).x.curves.channels) }]);
      afterCommit();
    },
  }]).element);
  body.appendChild(ctl.note("Click adds a point, drag moves it, right-click removes it.").element);
}

function readCurves(effect, key) {
  const raw = readProp(effect, key);
  try {
    const parsed = JSON.parse(String(raw || ""));
    if (parsed && parsed.Red && parsed.Green && parsed.Blue) {
      return { RGB: parsed.RGB || [{ x: 0, y: 0 }, { x: 1, y: 1 }], Red: parsed.Red, Green: parsed.Green, Blue: parsed.Blue };
    }
  } catch (_err) { /* identity below */ }
  return { RGB: [{ x: 0, y: 0 }, { x: 1, y: 1 }], Red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }], Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
}

function readScurve(effect, key) {
  const def = state.Looks.tools.defaultScurve();
  let shape = null;
  try { shape = JSON.parse(String(readProp(effect, key) || "")); } catch (_err) { shape = null; }
  if (!shape || typeof shape !== "object") return def;
  return Object.assign(def, shape);
}

// S-curve controls edit numbers; the handle geometry is rederived from them.
function reshapeScurve(s) {
  const C = state.Looks.color;
  const m = C.clamp(s.midpoint, 0.05, 0.95);
  const k = C.clamp(s.contrast, 0.2, 4);
  const b = (C.clamp(s.brightness, 0, 1) - 0.5) * 0.5;
  const c1x = C.clamp(m - 0.28, 0, 1);
  const c2x = C.clamp(m + 0.28, 0, 1);
  s.c1 = { x: c1x, y: C.clamp(m + (c1x - m) * k + b, 0, 1) };
  s.c2 = { x: c2x, y: C.clamp(m + (c2x - m) * k + b, 0, 1) };
  s.p0 = { x: 0, y: C.clamp(s.black, 0, 1) };
  s.p3 = { x: 1, y: C.clamp(s.white, 0, 1) };
  return s;
}

function buildScurve(effect, session, tool, body, afterCommit) {
  const ctl = state.ui.controls;
  const rec = state.Looks.tools.propMap()[tool.id];
  const key = rec.custom.scurveJson;
  const defs = [
    { k: "black", label: "Black Point", min: 0, max: 1, step: 0.005 },
    { k: "white", label: "White Point", min: 0, max: 1, step: 0.005 },
    { k: "contrast", label: "Contrast", min: 0.2, max: 4, step: 0.01 },
    { k: "midpoint", label: "Midpoint", min: 0.05, max: 0.95, step: 0.005 },
    { k: "brightness", label: "Brightness", min: 0, max: 1, step: 0.005 },
  ];
  const shape = readScurve(effect, key);
  defs.forEach(function (d) {
    body.appendChild(ctl.slider({
      label: d.label,
      value: Number(shape[d.k]) || 0,
      min: d.min, max: d.max, step: d.step,
      onInput: function (v) {
        shape[d.k] = round(v);
        session.live(key, JSON.stringify(reshapeScurve(shape)));
      },
      onChange: function (v) {
        shape[d.k] = round(v);
        session.commit([{ key: key, value: JSON.stringify(reshapeScurve(shape)) }]);
        afterCommit();
      },
    }).element);
  });
}

function buildFourway(effect, session, tool, body, widgets, afterCommit) {
  const ctl = state.ui.controls;
  const rec = state.Looks.tools.propMap()[tool.id];
  const previewKey = rec.custom.fourwayPreview;
  body.appendChild(ctl.checkbox({
    label: "Ranges Preview",
    value: readNum(effect, previewKey, 0) === 1,
    onChange: function (on) {
      session.commit([{ key: previewKey, value: on ? 1 : 0 }]);
      afterCommit();
    },
  }).element);
  const grid = make("div", "lk-fourway");
  [["Shadows", "shadows"], ["Highlights", "highlights"], ["Midtones", "midtones"], ["Global", "global"]]
    .forEach(function (pair) {
      const cell = make("div", "lk-four-cell");
      cell.appendChild(make("div", "lk-four-name", pair[0]));
      cell.appendChild(buildWheel(effect, session, rec.custom.fourway[pair[1]], pair[0], widgets, afterCommit));
      grid.appendChild(cell);
    });
  body.appendChild(grid);
}

function buildLut(effect, session, tool, body, afterCommit) {
  const ctl = state.ui.controls;
  const rec = state.Looks.tools.propMap()[tool.id];
  const names = ["None", "Hot", "Cold", "Noir"];
  body.appendChild(ctl.select({
    label: "LUT",
    value: String(readProp(effect, rec.custom.lutName) || "None"),
    options: names.map(function (n) { return { value: n, label: n }; }),
    onChange: function (v) {
      session.commit([{ key: rec.custom.lutName, value: v }]);
      afterCommit();
    },
  }).element);
  body.appendChild(ctl.slider({
    label: "Strength",
    value: readNum(effect, rec.custom.lutStrength, 1),
    min: 0, max: 1, step: 0.01,
    onInput: function (v) { session.live(rec.custom.lutStrength, round(v)); },
    onChange: function (v) {
      session.commit([{ key: rec.custom.lutStrength, value: round(v) }]);
      afterCommit();
    },
  }).element);
  const gammaOptions = ["Same As Input", "Input", "Output"];
  body.appendChild(ctl.select({
    label: "LUT Gamma",
    value: String(Math.max(0, Math.round(readNum(effect, rec.custom.lutGamma, 0)))),
    options: gammaOptions.map(function (g, i) { return { value: String(i), label: g }; }),
    onChange: function (v) {
      session.commit([{ key: rec.custom.lutGamma, value: Number(v) || 0 }]);
      afterCommit();
    },
  }).element);
}

// Window body. Returns a cleanup that destroys widgets and listeners.
function buildBody(body, effect, session, view) {
  const Looks = state.Looks;
  const ctl = state.ui.controls;
  const root = make("div", "lk-root");
  body.appendChild(root);
  let widgets = [];
  let busy = false;
  let lastSig = "";
  let disposed = false;

  function destroyWidgets() {
    widgets.forEach(function (w) { if (w && w.destroy) w.destroy(); });
    widgets = [];
  }

  function historySig() {
    const h = state.editor && state.editor.history;
    if (!h || !h.undoStack || !h.redoStack) return "";
    return h.undoStack.length + "/" + h.redoStack.length;
  }

  session.onCommit = function () { lastSig = historySig(); };

  function afterCommit() {
    rebuild();
  }

  function section(title, collapsed) {
    return ctl.section({ title: title, collapsed: !!collapsed });
  }

  function lookSection() {
    const sec = section("Look");
    const filter = view.filter;
    const groups = [];
    Looks.tools.PRESETS.forEach(function (p) {
      if (groups.indexOf(p.group) < 0) groups.push(p.group);
    });
    const listBox = make("div");
    function renderList() {
      const items = Looks.tools.PRESETS.filter(function (p) {
        if (filter.group !== "All" && p.group !== filter.group) return false;
        if (filter.text && p.name.toLowerCase().indexOf(filter.text) < 0) return false;
        return true;
      }).map(function (p) { return { id: p.id, title: p.name, detail: p.group }; });
      listBox.textContent = "";
      const list = ctl.list({
        items: items,
        value: view.look,
        emptyText: "No looks match.",
        onSelect: function (id) {
          const preset = Looks.tools.PRESETS.filter(function (p) { return p.id === id; })[0];
          if (!preset) return;
          view.look = id;
          session.commit(presetWrites(effect, preset));
          afterCommit();
        },
      });
      listBox.appendChild(list.element);
    }
    sec.body.appendChild(ctl.text({
      label: "Filter",
      placeholder: "Search looks",
      value: filter.text,
      onInput: function (v) {
        filter.text = String(v || "").trim().toLowerCase();
        renderList();
      },
    }).element);
    sec.body.appendChild(ctl.select({
      label: "Group",
      value: filter.group,
      options: [{ value: "All", label: "All" }].concat(groups.map(function (g) { return { value: g, label: g }; })),
      onChange: function (v) {
        filter.group = v;
        renderList();
      },
    }).element);
    sec.body.appendChild(listBox);
    renderList();
    sec.body.appendChild(ctl.buttonRow([{
      title: "Clear look",
      hint: "Reset every tool to its neutral default (the chain order is kept)",
      onClick: function () {
        view.look = null;
        session.commit(resetWrites(effect));
        afterCommit();
      },
    }]).element);
    return sec.element;
  }

  function chainSection() {
    const sec = section("Tool Chain");
    const chain = readChain(effect);
    const toolsById = Looks.tools.byId;
    const items = chain.map(function (id, i) {
      const tool = toolsById(id);
      const on = readNum(effect, toolEnableKey(id), Looks.tools.enabledDefault(tool)) === 1;
      return { id: id, title: (i + 1) + ". " + tool.name, detail: on ? "On" : "Off" };
    });
    sec.body.appendChild(ctl.list({
      items: items,
      value: view.selectedTool,
      emptyText: "The chain is empty. Add a tool below.",
      onSelect: function (id) {
        view.selectedTool = id;
        rebuild();
      },
    }).element);

    const idx = chain.indexOf(view.selectedTool);
    const pinned = Looks.tools.PINNED_TOOL;
    const canMove = idx >= 0 && view.selectedTool !== pinned;
    const above = idx > 0 ? chain[idx - 1] : null;
    const below = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
    function swap(a, b) {
      const next = chain.slice();
      next[a] = chain[b];
      next[b] = chain[a];
      return next;
    }
    const buttons = [];
    buttons.push({
      title: "Up",
      hint: "Move the selected tool earlier in the chain",
      onClick: function () {
        if (!canMove || !above || above === pinned) return;
        session.commit([chainWrite(swap(idx - 1, idx))]);
        afterCommit();
      },
    });
    buttons.push({
      title: "Down",
      hint: "Move the selected tool later in the chain",
      onClick: function () {
        if (!canMove || !below) return;
        session.commit([chainWrite(swap(idx, idx + 1))]);
        afterCommit();
      },
    });
    const selOn = idx >= 0 && readNum(effect, toolEnableKey(view.selectedTool), 1) === 1;
    buttons.push({
      title: selOn ? "Disable" : "Enable",
      hint: "Toggle the selected tool without removing it",
      onClick: function () {
        if (!view.selectedTool) return;
        const key = toolEnableKey(view.selectedTool);
        session.commit([{ key: key, value: selOn ? 0 : 1 }]);
        afterCommit();
      },
    });
    buttons.push({
      title: "Remove",
      hint: "Take the selected tool out of the chain (its values are kept)",
      variant: "danger",
      onClick: function () {
        if (idx < 0 || view.selectedTool === pinned) return;
        const next = chain.slice();
        next.splice(idx, 1);
        view.selectedTool = next[Math.min(idx, next.length - 1)] || null;
        session.commit([chainWrite(next)]);
        afterCommit();
      },
    });
    sec.body.appendChild(ctl.buttonRow(buttons).element);

    const inChain = {};
    chain.forEach(function (id) { inChain[id] = true; });
    const available = Looks.tools.TOOLS.filter(function (t) { return !inChain[t.id]; });
    if (available.length && chain.length < Looks.tools.MAX_CHAIN) {
      sec.body.appendChild(ctl.select({
        label: "Add tool",
        value: "",
        options: [{ value: "", label: "Choose a tool…" }].concat(available.map(function (t) {
          return { value: t.id, label: t.name };
        })),
        onChange: function (id) {
          if (!id) return;
          view.selectedTool = id;
          session.commit([chainWrite(chain.concat([id]))]);
          afterCommit();
        },
      }).element);
    }
    sec.body.appendChild(ctl.note("Lens Distortion always runs first and cannot be moved.").element);
    return sec.element;
  }

  function toolSection() {
    const sec = section("Parameters");
    const chain = readChain(effect);
    let tool = view.selectedTool ? Looks.tools.byId(view.selectedTool) : null;
    if (!tool) tool = Looks.tools.byId(chain[0] || Looks.tools.TOOLS[0].id);
    if (!tool) return sec.element;
    view.selectedTool = tool.id;
    sec.setCollapsed(false);
    const head = make("div", "lk-tool-head");
    head.appendChild(make("span", "lk-tool-name", tool.name));
    if (chain.indexOf(tool.id) < 0) {
      head.appendChild(make("span", "lk-tool-note", "Not in chain"));
    }
    sec.body.appendChild(head);
    sec.body.appendChild(ctl.buttonRow([{
      title: "Reset " + tool.name,
      hint: "Reset this tool's values to neutral",
      onClick: function () {
        const writes = resetWrites(effect).filter(function (w) {
          return toolKeysOf(tool).indexOf(w.key) >= 0;
        });
        session.commit(writes);
        afterCommit();
      },
    }]).element);
    sec.body.appendChild(ctl.checkbox({
      label: "Enabled",
      value: readNum(effect, toolEnableKey(tool.id), Looks.tools.enabledDefault(tool)) === 1,
      onChange: function (on) {
        session.commit([{ key: toolEnableKey(tool.id), value: on ? 1 : 0 }]);
        afterCommit();
      },
    }).element);
    if (tool.custom === "hsl") buildHsl(effect, session, tool, sec.body, afterCommit);
    else buildParams(effect, session, tool, sec.body, afterCommit);
    if (tool.custom === "curves") buildCurves(effect, session, tool, sec.body, widgets, afterCommit, view);
    else if (tool.custom === "scurve") buildScurve(effect, session, tool, sec.body, afterCommit);
    else if (tool.custom === "fourway") buildFourway(effect, session, tool, sec.body, widgets, afterCommit);
    else if (tool.custom === "lut") buildLut(effect, session, tool, sec.body, afterCommit);
    buildWheels(effect, session, tool, sec.body, widgets, afterCommit);
    return sec.element;
  }

  function toolKeysOf(tool) {
    const rec = Looks.tools.propMap()[tool.id];
    const keys = [rec.enable].concat(Object.keys(rec.params).map(function (k) { return rec.params[k]; }));
    Object.keys(rec.wheels).forEach(function (k) { keys.push.apply(keys, rec.wheels[k]); });
    if (rec.custom.hsl) keys.push.apply(keys, rec.custom.hsl.sat.concat(rec.custom.hsl.light));
    if (rec.custom.curvesJson) keys.push(rec.custom.curvesJson);
    if (rec.custom.scurveJson) keys.push(rec.custom.scurveJson);
    if (rec.custom.fourwayPreview) keys.push(rec.custom.fourwayPreview);
    if (rec.custom.fourway) {
      Object.keys(rec.custom.fourway).forEach(function (s) { keys.push.apply(keys, rec.custom.fourway[s]); });
    }
    if (rec.custom.lutName) keys.push(rec.custom.lutName, rec.custom.lutStrength, rec.custom.lutGamma);
    return keys;
  }

  function rebuild() {
    if (disposed) return;
    // Rebuilding controls must not move the user's scroll or drop a typed
    // field's focus. Remember the control's position within this tool panel.
    const fields = Array.from(root.querySelectorAll("input, select, textarea, button"));
    const active = document.activeElement;
    const focusIndex = fields.indexOf(active);
    const focusTool = root.dataset.tool;
    const selection = active && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd] : null;
    const scrollers = [body].concat(Array.from(root.querySelectorAll("*")));
    const scroll = scrollers.map(function (el) { return [el.scrollLeft || 0, el.scrollTop || 0]; });
    destroyWidgets();
    root.textContent = "";
    root.appendChild(lookSection());
    root.appendChild(chainSection());
    root.appendChild(toolSection());
    root.dataset.tool = view.selectedTool || "";
    if (focusIndex >= 0 && focusTool === root.dataset.tool) {
      const field = root.querySelectorAll("input, select, textarea, button")[focusIndex];
      if (field && typeof field.focus === "function") {
        field.focus({ preventScroll: true });
        if (selection && typeof field.setSelectionRange === "function") {
          try { field.setSelectionRange(selection[0], selection[1]); } catch (_err) { /* numeric input */ }
        }
      }
    }
    const nextScrollers = [body].concat(Array.from(root.querySelectorAll("*")));
    scroll.forEach(function (pos, i) {
      if (!nextScrollers[i]) return;
      nextScrollers[i].scrollLeft = pos[0];
      nextScrollers[i].scrollTop = pos[1];
    });
    lastSig = historySig();
  }

  function onDown() { busy = true; }
  function onUp() { busy = false; }
  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  // Undo/redo and external edits rebuild the contents. Our own commits update
  // lastSig in session.onCommit, so they do not trigger a rebuild.
  const timer = setInterval(function () {
    if (busy || disposed) return;
    if (historySig() !== lastSig) rebuild();
  }, SNAPSHOT_MS);

  rebuild();

  return function cleanup() {
    disposed = true;
    clearInterval(timer);
    destroyWidgets();
    root.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    session.onCommit = null;
  };
}

function windowIdFor(effect) {
  let id = state.windowIds.get(effect);
  if (!id) {
    id = "setup:" + state.nextWindowId++;
    state.windowIds.set(effect, id);
  }
  return id;
}

// Opens (or refocuses) the setup window for one effect instance.
function openSetup(effect) {
  if (!effectInProject(effect) || !state.ui || !state.Looks) return null;
  const id = windowIdFor(effect);
  if (state.ui.getWindow(id)) {
    const existing = state.ui.getWindow(id);
    existing.focus();
    return existing;
  }
  const session = createSession(effect);
  const view = { look: null, selectedTool: state.Looks.tools.defaultChain()[1], curveChannel: "RGB", filter: { text: "", group: "All" } };
  let win = null;
  acquireStyle();
  try {
    win = state.ui.openWindow({
      id: id,
      title: "Magic Looks",
      subtitle: "Color grade",
      persistKey: "looks-setup",
      width: 360,
      height: 620,
      minWidth: 300,
      minHeight: 260,
      mount: function (body) {
        return buildBody(body, effect, session, view);
      },
      isValid: function () { return effectInProject(effect); },
      onClose: function () {
        session.flush();
        if (win) state.openWindows.delete(win);
        releaseStyle();
      },
      footer: [{
        title: "Done",
        variant: "primary",
        onClick: function () { if (win) win.close(); },
      }],
    });
  } catch (error) {
    releaseStyle();
    throw error;
  }
  if (!win) { releaseStyle(); return null; }
  state.openWindows.add(win);
  return win;
}

// Button rendered on the effect's Enabled row (definition key magicLooksSetup).
function installPropertyButton(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.createControls !== "function") {
    throw new Error("Magic Looks needs PZ.ui.controls.createControls from the CM3 runtime.");
  }
  const original = controls.createControls;
  const patched = function (row, prop, hide) {
    const out = original.call(this, row, prop, hide);
    try {
      if (patched.__magicLooksDead) return out;
      const def = prop && prop.definition;
      const host = row && row.children && row.children[1];
      if (def && def.magicLooksSetup && host && typeof host.querySelector === "function" &&
          !host.querySelector(".lk-open-button")) {
        const btn = make("button", "proprow propbutton noselect lk-open-button", def.magicLooksSetup.name || "Setup");
        btn.title = def.magicLooksSetup.title || "Open the Magic Looks setup window";
        btn.onmousedown = function (ev) { ev.stopPropagation(); };
        btn.onclick = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const effect = prop.parentObject;
          openSetup(effect);
        };
        host.appendChild(btn);
      }
    } catch (_err) { /* never break property rendering */ }
    return out;
  };
  patched.__magicLooksDead = false;
  controls.createControls = patched;
  state.patchedCreate = patched;
  state.originalCreate = original;
}

function removePropertyButton(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  const patched = state.patchedCreate;
  if (!patched) return;
  patched.__magicLooksDead = true;
  if (controls && controls.createControls === patched) {
    controls.createControls = state.originalCreate;
  }
  state.patchedCreate = null;
  state.originalCreate = null;
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!PZ) throw new Error("Magic Looks needs the CM3 runtime.");
    if (!CM) throw new Error("Magic Looks needs the active editor instance.");
    if (!context.ui) throw new Error("Magic Looks needs the plugin window API.");
    try {
      state.getAsset = typeof context.getAsset === "function" ? context.getAsset.bind(context) : null;
      state.Looks = loadSources(state.getAsset);
      state.PZ = PZ;
      state.editor = CM;
      state.ui = context.ui;
      state.ops = new PZ.ui.properties(CM);
      if (context.lifecycle && typeof context.lifecycle.onDispose === "function") {
        context.lifecycle.onDispose(function () { module.exports.deactivate(); });
      }
      installPropertyButton(PZ);
      state.active = true;
    } catch (error) {
      removePropertyButton(PZ);
      state.ops = null;
      state.editor = null;
      state.ui = null;
      state.Looks = null;
      throw error;
    }
  },
  deactivate() {
    if (!state.active) return;
    try {
      // Close our windows while the editor is still bound so pending live
      // edits are committed; context.ui would close the rest afterwards.
      Array.from(state.openWindows).forEach(function (win) {
        try { win.close(); } catch (_err) { /* best effort */ }
      });
      state.openWindows.clear();
      removePropertyButton(state.PZ);
      if (typeof document !== "undefined") {
        if (typeof document.querySelectorAll === "function") {
          document.querySelectorAll(".lk-open-button").forEach(function (button) { button.remove(); });
        }
        const el = document.getElementById(STYLE_ID);
        if (el) el.remove();
      }
    } finally {
      state.styleUsers = 0;
      state.active = false;
      state.PZ = null;
      state.editor = null;
      state.ui = null;
      state.ops = null;
      state.getAsset = null;
      state.Looks = null;
    }
  },
};
