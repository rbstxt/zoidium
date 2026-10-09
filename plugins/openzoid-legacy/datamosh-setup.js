"use strict";

// OpenZoid Legacy — Datamosh Setup window.
//
// Installs the OpenZoid Datamosh editor window on the active editor:
// algorithm catalogue, preset data, slider/info catalogues, effect
// discovery, the fullscreen window itself, the "datamoshSetup"
// property-button action, styles (shared with VHS Setup), and the logo.
// Ported from the OpenZoid clipmaker bootstrap.

const STYLE_ID = "zoidium-vhs-setup-style";
const STYLE_URL = "./plugins/openzoid-legacy/vhs-setup.css";
const FONT_STYLE_ID = "zoidium-vhs-font-style";
const FONT_URL = "./plugins/openzoid-legacy/tracery-font.css";
const LOGO_URL = "./plugins/openzoid-legacy/datamosh-logo.jpg";

const state = {
  active: false,
  editor: null,
  getAsset: null,
  installedWrapper: null,
};

function installStyle(getAsset) {
  if (document.getElementById(STYLE_ID)) return;
  const bundled = getAsset ? getAsset("text", STYLE_URL) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
}

function uninstallStyle() {
  // The VHS Setup module owns the shared stylesheet when both packs run;
  // only remove it when no setup window needs it anymore.
  const CM = state.editor;
  const vhsOpen = CM && CM.vhsWindow;
  if (!vhsOpen) {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }
}

// Inter type for the SaaS theme comes from the bundled tracery-font.css
// asset, installed under the same element id the VHS Setup module uses so
// the two setups share one copy while either window is open.
function installFont(getAsset) {
  if (document.getElementById(FONT_STYLE_ID)) return;
  const bundled = getAsset ? getAsset("text", FONT_URL) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
  try {
    if (document.fonts && typeof document.fonts.load === "function") {
      document.fonts.load("700 14px Inter");
      document.fonts.load("400 12px Inter");
    }
  } catch (_err) { /* font is decorative */ }
}

function uninstallFont() {
  const CM = state.editor;
  const vhsOpen = CM && CM.vhsWindow;
  const datamoshOpen = CM && CM.datamoshWindow;
  if (!vhsOpen && !datamoshOpen) {
    const el = document.getElementById(FONT_STYLE_ID);
    if (el) el.remove();
  }
}

function installData(CM) {
  if (CM.datamoshPresets) return;
  CM.datamoshAlgos = [
    "Default", "Multiply", "Add to x and y", "Move vertical", "Move horizontal",
    "Zoom 1", "Zoom 2", "Zoom sin", "Shear", "Experimental",
    "Swap", "Random", "Random Blocks 1", "Random Blocks 2", "Random Blocks 3", "Random Blocks 4",
    "Spatial", "Multiply by X", "Multiply by X no Y", "Multiply by Y", "Multiply by Y no X",
    "Multiply by inverse X", "Multiply by inverse X no Y", "Multiply by inverse Y", "Multiply by inverse Y no X",
    "Multiply by X&Y", "Multiply by inverse X&Y", "Multiply by X & inverse Y", "Multiply by Y & inverse X",
    "Average", "Average X and Y", "Average previous 3", "Average previous 5", "Average previous 10", "Average previous 15",
    "Average 1 neighbors", "Average 2 neighbors", "Average 3 neighbors", "Average 4 neighbors",
    "Add previous 3", "Add previous 5", "Add previous 10",
    "Mirror X", "Mirror Y", "Mirror left", "Mirror right", "Mirror top", "Mirror bottom",
    "Sweep", "Sweep horizontal", "Sweep horizontal opposite", "Sweep vertical", "Sweep vertical opposite",
    "Sin and cos", "Middle sin X", "Middle sin X no Y", "Middle sin Y", "Middle sin Y no X",
    "Outside sin X", "Outside sin X no Y", "Outside sin Y", "Outside sin Y no X",
    "Outside half sin X", "Outside half sin X no Y", "Outside half sin Y", "Outside half sin Y no X",
    "Oscillate sin X", "Oscillate sin X no Y", "Oscillate sin Y", "Oscillate sin Y no X", "Oscillate sin X&Y",
    "Right horizontal sin tapered V1", "Left horizontal sin tapered V1", "Horizontal sin tapered V1",
    "Right horizontal sin tapered V2", "Left horizontal sin tapered V2", "Horizontal sin tapered V2", "Horizontal sin tapered V3",
    "Cos X & sin Y", "Sin X & cos Y"
  ];

  CM.datamoshPresets = {
    clean: {
      label: "Clean Pass",
      values: { amount: 1, intensity: 0.25, acceleration: 0.2, blend: 0.5, threshold: 0.25, blockSize: 12, algorithm: 0, hold: 0, speed: 1 },
    },
    logo: {
      label: "Logo Mosh · Blocky",
      values: { amount: 1, intensity: 0.85, acceleration: 0.45, blend: 0.85, threshold: 0.08, blockSize: 14, algorithm: 12, hold: 0.2, speed: 1 },
    },
    classic: {
      label: "Classic Mosh",
      values: { amount: 1, intensity: 0.7, acceleration: 0.35, blend: 0.8, threshold: 0.12, blockSize: 12, algorithm: 11, hold: 0.15, speed: 1 },
    },
    iframe: {
      label: "I-Frame Kill · Soupy",
      values: { amount: 1, intensity: 1.2, acceleration: 0.7, blend: 0.95, threshold: 0.05, blockSize: 10, algorithm: 11, hold: 0.55, speed: 0.8 },
    },
    swap: {
      label: "Swap Motion",
      values: { amount: 1, intensity: 0.9, acceleration: 0.4, blend: 0.85, threshold: 0.1, blockSize: 12, algorithm: 10, hold: 0.2, speed: 1.2 },
    },
    sweep: {
      label: "Sweep Horizontal",
      values: { amount: 1, intensity: 1.0, acceleration: 0.3, blend: 0.85, threshold: 0.08, blockSize: 8, algorithm: 49, hold: 0.15, speed: 1.5 },
    },
    sinmelt: {
      label: "Sin Melt",
      values: { amount: 1, intensity: 1.1, acceleration: 0.5, blend: 0.9, threshold: 0.06, blockSize: 10, algorithm: 53, hold: 0.25, speed: 1.2 },
    },
    mirror: {
      label: "Mirror Glitch",
      values: { amount: 1, intensity: 0.8, acceleration: 0.3, blend: 0.8, threshold: 0.1, blockSize: 16, algorithm: 42, hold: 0.15, speed: 1 },
    },
    zoom: {
      label: "Zoom Smear",
      values: { amount: 1, intensity: 1.0, acceleration: 0.55, blend: 0.9, threshold: 0.08, blockSize: 12, algorithm: 5, hold: 0.2, speed: 1 },
    },
    trail: {
      label: "Average Trail x10",
      values: { amount: 1, intensity: 0.6, acceleration: 0.6, blend: 0.9, threshold: 0.1, blockSize: 12, algorithm: 33, hold: 0.1, speed: 1 },
    },
  };

  CM.datamoshClean = CM.datamoshPresets.clean.values;

  CM.datamoshSliders = [
    { key: "amount", name: "Amount", min: 0, max: 1, step: 0.01, decimals: 2, group: "Master" },
    { key: "speed", name: "Speed", min: 0, max: 5, step: 0.1, decimals: 1, group: "Master" },
    { key: "intensity", name: "Intensity", min: 0, max: 2, step: 0.01, decimals: 2, group: "Mosh" },
    { key: "acceleration", name: "Acceleration", min: 0, max: 1, step: 0.01, decimals: 2, group: "Mosh" },
    { key: "blend", name: "Blend", min: 0, max: 1, step: 0.01, decimals: 2, group: "Mosh" },
    { key: "threshold", name: "Threshold", min: 0, max: 1, step: 0.01, decimals: 2, group: "Mosh" },
    { key: "blockSize", name: "Block Size", min: 2, max: 64, step: 1, decimals: 0, group: "Mosh" },
    { key: "hold", name: "Remove Frames (Hold)", min: 0, max: 1, step: 0.01, decimals: 2, group: "Mosh" },
  ];

  CM.datamoshInfos = [
    { key: "remove", name: "Remove Frames", hint: "Hold = I-frame deletion. Frozen P-chain, sticky pixels." },
    { key: "hijack", name: "Hijack Motion", hint: "Algorithm + Intensity + Block Size = your vectors." },
    { key: "swap", name: "Swap Motion", hint: "Algorithm 'Swap' steals axes. Use moving footage." },
    { key: "map", name: "Mosh Maps", hint: "Stack a Mask effect above Datamosh as the intensity map." },
    { key: "render", name: "True Mosh Render", hint: "Export > Device render > True datamosh: Full video or At clip cuts. Byte-exact I-frame kills." },
  ];
}

function installWindow(CM, logoUrl) {
  if (CM.openDatamoshSetup) return;

  CM.datamoshEffectList = function () {
    const found = [];
    const walk = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        if (e.type === "datamosh") found.push(e);
        if (e.objects) walk(e.objects);
      }
    };
    const selection = CM.timelineSelection;
    if (selection) {
      for (let i = 0; i < selection.length; i++) {
        const clip = selection[i];
        const layer = clip && (clip.object || clip);
        if (layer && layer.effects) walk(layer.effects);
      }
    }
    if (!found.length && CM.project) {
      CM.project.traverse(function (e) { if (e.type === "datamosh") found.push(e); });
    }
    return found;
  };

  CM.addDatamoshToSelection = function () {
    const selection = CM.timelineSelection;
    if (!selection || !selection.length) return null;
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const layer = clip && clip.object;
      if (layer && layer.effects) {
        const PZ = globalThis.PZ;
        const effect = PZ.effect.create("datamosh");
        layer.effects.push(effect);
        effect.loading = effect.load({});
        return effect;
      }
    }
    return null;
  };

  CM.openDatamoshSetup = function (effect) {
    if (CM.datamoshWindow) {
      if (effect) CM.datamoshWindow.setEffect(effect);
      CM.datamoshWindow.refresh();
      return;
    }
    const state = {
      effect: effect || null,
      interval: null,
      viewport: CM.mainViewport || null,
      viewportParent: null,
      viewportStyle: null,
      wasEdit: null,
    };
    const make = function (tag, cls, text) {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const frame = function () { return CM.playback ? CM.playback.currentFrame : 0; };
    const setProp = function (key, value) {
      const e = state.effect;
      if (!e) return;
      const p = e.properties[key];
      if (!p) return;
      value = Number(value);
      if (!isFinite(value)) return;
      if (key === "algorithm" || key === "blockSize") value = Math.round(value);
      p.set(value, frame() - p.frameOffset);
    };
    const getProp = function (key) {
      const e = state.effect;
      if (!e) return undefined;
      const p = e.properties[key];
      return p ? p.get(frame()) : undefined;
    };
    const approx = function (a, b) { return Math.abs(Number(a) - Number(b)) < 0.015; };
    const isPreset = function (preset) {
      if (!state.effect) return false;
      const vals = preset.values;
      return Object.keys(vals).every(function (k) {
        const cur = getProp(k);
        return cur !== undefined && approx(cur, vals[k]);
      });
    };

    const root = make("div", "vhs-window");
    const titlebar = make("div", "vhs-titlebar");
    titlebar.style.background = "linear-gradient(180deg, #0e2b2b, #0a1d1d)";
    titlebar.style.borderBottom = "2px solid #2ee6d6";
    const titleLeft = make("div", "vhs-title-left");
    titleLeft.appendChild(make("div", "vhs-title", "DATAMOSH SETUP"));
    const subtitle = make("div", "vhs-subtitle", "I-frames · Motion vectors · 80 algos");
    subtitle.style.color = "#2ee6d6";
    titleLeft.appendChild(subtitle);
    titlebar.appendChild(titleLeft);
    const liveBadge = make("div", "vhs-live", "● LIVE");
    titlebar.appendChild(liveBadge);
    const statusEl = make("div", "vhs-status", "No Datamosh effect");
    titlebar.appendChild(statusEl);
    const closeButton = make("button", "vhs-close", "✕");
    closeButton.title = "Close (Esc)";
    titlebar.appendChild(closeButton);
    const body = make("div", "vhs-body");
    const sidebar = make("div", "vhs-sidebar");
    const main = make("div", "vhs-main");
    const screen = make("div", "vhs-screen");
    const placeholder = make("div", "vhs-screen-placeholder", "{ screen / render to put }");
    screen.appendChild(placeholder);
    const controls = make("div", "vhs-controls");

    const logo = make("div", "vhs-logo");
    logo.style.border = "3px solid #2ee6d6";
    logo.style.background = "#000";
    const logoImg = make("img", "vhs-logo-cover");
    logoImg.src = logoUrl;
    logoImg.alt = "DATAMOSH";
    logo.appendChild(logoImg);
    logo.style.height = "86px";
    sidebar.appendChild(logo);

    const emptyEl = make("div", "vhs-empty", "No Datamosh effect found. Select a clip and add one below.");
    sidebar.appendChild(emptyEl);

    const section = function (title, sub) {
      const s = make("div", "vhs-section");
      s.appendChild(make("div", "vhs-section-title", title));
      if (sub) s.appendChild(make("div", "vhs-section-sub", sub));
      return s;
    };

    sidebar.appendChild(section("Presets", "One-click moshes (Logo Mosh = your blocky look)"));
    const presetList = make("div", "vhs-presets");
    const presetItems = [];
    Object.keys(CM.datamoshPresets).forEach(function (pkey) {
      const preset = CM.datamoshPresets[pkey];
      const btn = make("button", "vhs-preset", preset.label);
      btn.title = "Apply preset: " + preset.label;
      btn.onclick = function () {
        if (!state.effect) return;
        Object.keys(preset.values).forEach(function (k) { setProp(k, preset.values[k]); });
        refresh();
      };
      presetList.appendChild(btn);
      presetItems.push({ el: btn, key: pkey, preset: preset });
    });
    sidebar.appendChild(presetList);

    sidebar.appendChild(section("How to mosh", "Remove · Hijack · Swap · Maps"));
    const ul = make("ul", "vhs-list vhs-info-list");
    CM.datamoshInfos.forEach(function (item) {
      const li = make("li", "vhs-item vhs-info");
      const wrap = make("div", "vhs-info-wrap");
      wrap.appendChild(make("div", "vhs-name", item.name));
      wrap.appendChild(make("div", "vhs-hint", item.hint));
      li.appendChild(wrap);
      ul.appendChild(li);
    });
    sidebar.appendChild(ul);

    sidebar.appendChild(section("Algorithms", "80 presets — pick in the panel below"));
    const algoHint = make("div", "vhs-hint", "Default · Multiply · Zoom · Shear · Swap · Random Blocks 1-4 · Multiply by X/Y · Average previous 3/5/10/15 · Mirror · Sweep · Sin/Cos · Oscillate · Tapered V1/V2/V3. Full list lives in the Algorithm dropdown.");
    algoHint.style.padding = "0 8px";
    sidebar.appendChild(algoHint);

    // ---- sliders + algorithm dropdown (main panel) ----
    const sliderRows = [];
    let algoSelect = null;
    let algoValueEl = null;
    const groups = ["Master", "Mosh", "Algorithm"];
    const groupHint = {
      "Master": "Overall mix + vector clock",
      "Mosh": "Intensity · Acceleration · Blend · Threshold · Blocks · Hold",
      "Algorithm": "80 motion-vector presets",
    };
    groups.forEach(function (gname) {
      const gdiv = make("div", "vhs-group");
      const head = make("div", "vhs-group-head");
      head.appendChild(make("div", "vhs-group-title", gname));
      head.appendChild(make("div", "vhs-group-sub", groupHint[gname] || ""));
      gdiv.appendChild(head);
      if (gname === "Algorithm") {
        const row = make("div", "vhs-slider");
        const labWrap = make("div", "vhs-label-wrap");
        labWrap.appendChild(make("label", "", "Algorithm"));
        labWrap.appendChild(make("div", "vhs-hint", "Motion-vector math (Datamosh 2 list)"));
        row.appendChild(labWrap);
        const sel = make("select");
        sel.style.flex = "1";
        sel.style.minWidth = "0";
        sel.style.background = "#141a24";
        sel.style.color = "#e8eef5";
        sel.style.border = "1px solid #43536a";
        sel.style.borderRadius = "6px";
        sel.style.padding = "6px 8px";
        sel.style.fontFamily = "inherit";
        sel.style.fontSize = "12px";
        CM.datamoshAlgos.forEach(function (name, idx) {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = String(idx).padStart(2, "0") + " · " + name;
          sel.appendChild(opt);
        });
        sel.onchange = function () {
          setProp("algorithm", parseInt(sel.value, 10));
          if (algoValueEl) algoValueEl.textContent = sel.value;
          refreshPresetState();
        };
        row.appendChild(sel);
        algoValueEl = make("span", "vhs-value", "");
        row.appendChild(algoValueEl);
        gdiv.appendChild(row);
        algoSelect = sel;
      } else {
        const specs = CM.datamoshSliders.filter(function (sp) { return sp.group === gname; });
        specs.forEach(function (spec) {
          const row = make("div", "vhs-slider");
          const labWrap = make("div", "vhs-label-wrap");
          labWrap.appendChild(make("label", "", spec.name));
          row.appendChild(labWrap);
          const input = make("input");
          input.type = "range";
          input.min = spec.min;
          input.max = spec.max;
          input.step = spec.step;
          input.dataset.key = spec.key;
          const valueEl = make("span", "vhs-value", "");
          input.oninput = function () {
            setProp(spec.key, parseFloat(input.value));
            valueEl.textContent = parseFloat(input.value).toFixed(spec.decimals);
            refreshPresetState();
          };
          row.appendChild(input);
          row.appendChild(valueEl);
          gdiv.appendChild(row);
          sliderRows.push({ spec: spec, input: input, valueEl: valueEl });
        });
      }
      controls.appendChild(gdiv);
    });

    const statusRow = make("div", "vhs-status-row");
    const statusDot = make("span", "vhs-dot", "");
    const statusText = make("span", "vhs-status-text", "No Datamosh effect");
    statusRow.appendChild(statusDot);
    statusRow.appendChild(statusText);
    controls.appendChild(statusRow);

    const buttonRow = make("div", "vhs-buttons");
    const cleanButton = make("button", "", "Clean Pass");
    cleanButton.title = "Reset to gentle preset";
    cleanButton.onclick = function () {
      if (!state.effect) return;
      Object.keys(CM.datamoshClean).forEach(function (k) { setProp(k, CM.datamoshClean[k]); });
      refresh();
    };
    const moshButton = make("button", "vhs-glitch-btn", "Mosh!");
    moshButton.title = "Random soupy mosh burst";
    moshButton.style.background = "#2ee6d6";
    moshButton.style.borderColor = "#2ee6d6";
    moshButton.style.color = "#0a1d1d";
    moshButton.onclick = function () {
      if (!state.effect) return;
      const random = function (a, b) { return a + Math.random() * (b - a); };
      const pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
      setProp("amount", 1);
      setProp("intensity", random(0.6, 1.6));
      setProp("acceleration", random(0.2, 0.8));
      setProp("blend", random(0.6, 1));
      setProp("threshold", random(0.03, 0.2));
      setProp("blockSize", pick([6, 8, 10, 12, 14, 16, 20]));
      setProp("algorithm", pick([10, 11, 12, 13, 14, 15, 5, 8, 49, 53, 66, 70, 42, 33]));
      setProp("hold", Math.random() < 0.5 ? random(0.2, 0.6) : random(0, 0.2));
      setProp("speed", random(0.6, 1.8));
      refresh();
    };
    const killButton = make("button", "", "Remove Frame");
    killButton.title = "BLAMO: kill the I-frame (hold spike)";
    killButton.onclick = function () {
      if (!state.effect) return;
      setProp("hold", 1);
      setProp("intensity", Math.max(Number(getProp("intensity")) || 0.8, 1.0));
      refresh();
      setTimeout(function () { if (state.effect) { setProp("hold", 0.15); refresh(); } }, 350);
    };
    const addButton = make("button", "", "Add Datamosh to selected clip");
    addButton.onclick = function () {
      const added = CM.addDatamoshToSelection();
      if (added) {
        state.effect = added;
        if (added.loading && added.loading.then) added.loading.then(refresh);
        refresh();
      } else {
        emptyEl.textContent = "Select a clip first, then add the Datamosh effect.";
      }
    };
    buttonRow.appendChild(cleanButton);
    buttonRow.appendChild(moshButton);
    buttonRow.appendChild(killButton);
    buttonRow.appendChild(addButton);
    controls.appendChild(buttonRow);

    const refreshPresetState = function () {
      presetItems.forEach(function (item) {
        item.el.classList.toggle("active", isPreset(item.preset));
      });
    };

    const refresh = function () {
      const has = !!state.effect;
      emptyEl.style.display = has ? "none" : "";
      sliderRows.forEach(function (row) {
        let value = has ? getProp(row.spec.key) : undefined;
        if (value === undefined || !isFinite(Number(value))) value = row.spec.min;
        value = Number(value);
        row.valueEl.textContent = value.toFixed(row.spec.decimals);
        if (document.activeElement !== row.input) row.input.value = value;
        row.input.disabled = !has;
      });
      if (algoSelect) {
        let av = has ? getProp("algorithm") : undefined;
        if (av === undefined || !isFinite(Number(av))) av = 11;
        av = Math.max(0, Math.min(CM.datamoshAlgos.length - 1, Math.round(Number(av))));
        if (document.activeElement !== algoSelect) algoSelect.value = String(av);
        algoSelect.disabled = !has;
        if (algoValueEl) algoValueEl.textContent = String(av).padStart(2, "0");
      }
      refreshPresetState();
      let label = "No Datamosh effect";
      if (has) {
        const active = presetItems.filter(function (it) { return isPreset(it.preset); });
        if (active.length) label = active[0].preset.label;
        else {
          const ai = Math.max(0, Math.min(CM.datamoshAlgos.length - 1, Math.round(Number(getProp("algorithm")) || 0)));
          label = "Custom · " + CM.datamoshAlgos[ai];
        }
      }
      statusEl.textContent = label;
      statusText.textContent = has ? ("Active · " + label) : "No Datamosh effect — add one below";
      statusDot.classList.toggle("on", has);
      liveBadge.classList.toggle("on", has);
    };

    main.appendChild(screen);
    main.appendChild(controls);
    body.appendChild(sidebar);
    body.appendChild(main);
    root.appendChild(titlebar);
    root.appendChild(body);
    document.body.appendChild(root);

    if (state.viewport && state.viewport.el) {
      state.viewportParent = state.viewport.el.parentElement;
      state.viewportStyle = state.viewport.el.getAttribute("style");
      state.wasEdit = state.viewport.edit;
      state.viewport.edit = false;
      screen.appendChild(state.viewport.el);
      placeholder.remove();
      requestAnimationFrame(function () { state.viewport.resize(); });
    }

    const close = function () {
      if (state.interval) { clearInterval(state.interval); state.interval = null; }
      if (state.viewport && state.viewportParent) {
        state.viewport.el.setAttribute("style", state.viewportStyle || "");
        state.viewportParent.appendChild(state.viewport.el);
        state.viewport.edit = state.wasEdit;
        state.viewport.resize();
      }
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeydown);
      root.remove();
      CM.datamoshWindow = null;
    };
    const onResize = function () { if (state.viewport) state.viewport.resize(); };
    const onKeydown = function (e) { if (e.key === "Escape") close(); };
    closeButton.onclick = close;
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeydown);

    if (!state.effect) {
      const found = CM.datamoshEffectList();
      if (found.length) state.effect = found[0];
    }
    refresh();
    state.interval = setInterval(refresh, 250);
    CM.datamoshWindow = {
      refresh: refresh,
      close: close,
      setEffect: function (e) { state.effect = e; refresh(); },
    };
  };
}

function routeSetupAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  if (action === "vhsSetup" && typeof editor.openVhsSetup === "function") {
    editor.openVhsSetup(target && target.parentObject);
    return true;
  }
  if (action === "datamoshSetup" && typeof editor.openDatamoshSetup === "function") {
    editor.openDatamoshSetup(target && target.parentObject);
    return true;
  }
  return false;
}

// Upstream CM3 has neither the property-button dispatcher nor the button
// renderer (both are OpenZoid additions), so this pack ships compatible
// versions. They are additive and inert without our effects: buttons only
// render for property definitions that declare them, and the dispatcher
// only routes the two setup actions.
function ensureDispatcher(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls) {
    throw new Error("Setup windows need PZ.ui.controls from the CM3 runtime.");
  }
  if (typeof controls.runPropertyAction === "function") return controls;
  controls.runPropertyAction = function (list, target, action, el) {
    routeSetupAction(action, list, target);
  };
  controls.runPropertyAction.__openzoidLegacyCompat = true;
  return controls;
}

function wrapDispatcher(PZ) {
  // An OpenZoid-style runtime ships its own dispatcher with extra cases:
  // wrap it so our actions route first and everything else delegates.
  // The compat dispatcher installed above already covers both actions.
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.runPropertyAction !== "function") return;
  if (controls.runPropertyAction.__openzoidLegacyCompat) return;
  if (state.installedWrapper) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__openzoidLegacyDead) {
      return original.call(this, list, target, action, el);
    }
    if (routeSetupAction(action, list, target)) return;
    return original.call(this, list, target, action, el);
  };
  patched.__openzoidLegacyOriginal = original;
  controls.runPropertyAction = patched;
  state.installedWrapper = patched;
}

function unpatchDispatcher(PZ) {
  if (state.installedWrapper) {
    state.installedWrapper.__openzoidLegacyDead = true;
    const controls = PZ && PZ.ui && PZ.ui.controls;
    if (controls && controls.runPropertyAction === state.installedWrapper) {
      controls.runPropertyAction = controls.runPropertyAction.__openzoidLegacyOriginal || controls.runPropertyAction;
    }
    state.installedWrapper = null;
  }
}

function buildActionButtons(buttonDefs) {
  const wrap = document.createElement("div");
  wrap.className = "vhs-setup-buttons";
  wrap.style = "display: flex; gap: 3px; margin-top: 3px; flex-wrap: wrap;";
  buttonDefs.forEach(function (spec) {
    const n = document.createElement("button");
    n.classList.add("propbutton", "noselect");
    n.style = "font-size: 10px; padding: 1px 6px;";
    n.innerText = spec.name;
    n.title = spec.title || spec.name;
    n.onmousedown = (ev) => ev.stopPropagation();
    n.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest("li");
      const list = li && li.parentElement ? li.parentElement.pz_controls : null;
      if (!list) return;
      const live = globalThis.PZ;
      const dispatch = live && live.ui && live.ui.controls && live.ui.controls.runPropertyAction;
      if (typeof dispatch === "function") {
        dispatch.call(live.ui.controls, list, li.pz_object, spec.action, ev.currentTarget);
      }
    };
    wrap.appendChild(n);
  });
  return wrap;
}

function ensureButtonsRenderer(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.createControls !== "function") return;
  if (controls.createControls.__openzoidLegacyButtons) {
    controls.createControls.__openzoidLegacyRefs =
      (controls.createControls.__openzoidLegacyRefs || 1) + 1;
    return;
  }
  const original = controls.createControls;
  // Mirrors the OpenZoid block: e is the row element whose children[1] holds
  // the generated input, t is the property. Buttons append after the input.
  const patched = function (e, t, i) {
    const out = original.call(this, e, t, i);
    try {
      if (patched.__openzoidLegacyDead) return out;
      const def = t && t.definition;
      const host = e && e.children && e.children[1];
      if (def && Array.isArray(def.buttons) && def.buttons.length && host &&
          typeof host.querySelector === "function" &&
          !host.querySelector("div.vhs-setup-buttons")) {
        host.appendChild(buildActionButtons(def.buttons));
      }
    } catch (_err) { /* never break property rendering */ }
    return out;
  };
  patched.__openzoidLegacyButtons = true;
  patched.__openzoidLegacyRefs = 1;
  patched.__openzoidLegacyOriginal = original;
  controls.createControls = patched;
}

function releaseButtonsRenderer(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  const current = controls && controls.createControls;
  if (!current || !current.__openzoidLegacyButtons) return;
  current.__openzoidLegacyRefs = Math.max(0, (current.__openzoidLegacyRefs || 1) - 1);
  if (current.__openzoidLegacyRefs === 0) {
    current.__openzoidLegacyDead = true;
    if (controls.createControls === current && current.__openzoidLegacyOriginal) {
      controls.createControls = current.__openzoidLegacyOriginal;
    }
  }
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!PZ) throw new Error("Datamosh Setup needs the CM3 runtime.");
    if (!CM) throw new Error("Datamosh Setup needs the active editor instance.");
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    state.editor = CM;
    state.getAsset = getAsset;
    installStyle(getAsset);
    installFont(getAsset);
    installData(CM);
    const logo = (getAsset && getAsset("text", LOGO_URL)) || "./assets/datamosh-logo.jpg";
    installWindow(CM, logo);
    ensureDispatcher(PZ);
    wrapDispatcher(PZ);
    ensureButtonsRenderer(PZ);
    state.active = true;
  },
  deactivate() {
    try {
      const PZ = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || null;
      const CM = state.editor;
      if (CM && CM.datamoshWindow && typeof CM.datamoshWindow.close === "function") {
        try { CM.datamoshWindow.close(); } catch (_error) { /* best effort */ }
      }
      if (PZ) {
        try { unpatchDispatcher(PZ); } catch (_error) { /* best effort */ }
        try { releaseButtonsRenderer(PZ); } catch (_error) { /* best effort */ }
      }
      uninstallStyle();
      uninstallFont();
    } finally {
      state.active = false;
      state.editor = null;
      state.getAsset = null;
    }
  },
};
