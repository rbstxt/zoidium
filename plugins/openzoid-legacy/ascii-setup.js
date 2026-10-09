"use strict";

// OpenZoid Legacy — ASCII Setup window.
//
// SaaS-style fullscreen editor for the ASCII character-cell effect: live
// preview (reuses the main viewport), preset looks, and collapsible
// control groups. Red color theme; Inter type comes from the bundled
// tracery-font.css asset shared with the Tracery setup.

const STYLE_ID = "zoidium-ascii-setup-style";
const STYLE_URL = "./plugins/openzoid-legacy/ascii-setup.css";

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
  const CM = state.editor;
  if (CM && CM.asciiWindow) return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

function installData(CM) {
  if (CM.asciiPresets) return;
  CM.asciiPresets = {
    redmatrix: {
      label: "Red Matrix",
      values: {
        blockSize: 23, contrast: 1, brightness: 0, fontFamily: 0, charSize: 18,
        charset: 0, colorMode: 0,
        randomCharacters: 0, randomScale: 0, noiseIntensity: 0,
        sineEnable: 0, noiseEnable: 0, scrollEnable: 0,
        glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
      },
      colors: { background: [0.03, 0.03, 0.04] },
      bands: {
        black: { fill: "@", color: [1, 0.16, 0.16] },
        white: { fill: "#", color: [1, 0.35, 0.35] },
        grey: { fill: "+", color: [0.75, 0.2, 0.2] },
        alpha: { fill: " ", color: [1, 1, 1] },
      },
    },
    mono: {
      label: "Mono Paper",
      values: {
        blockSize: 18, contrast: 1.1, brightness: 0.05, fontFamily: 1, charSize: 16,
        charset: 0, colorMode: 0,
        randomCharacters: 0, randomScale: 0, noiseIntensity: 0,
        sineEnable: 0, noiseEnable: 0, scrollEnable: 0,
        glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
      },
      colors: { background: [0.93, 0.93, 0.92] },
      bands: {
        black: { fill: "@", color: [0.1, 0.1, 0.1] },
        white: { fill: ".", color: [0.4, 0.4, 0.4] },
        grey: { fill: "+", color: [0.25, 0.25, 0.25] },
        alpha: { fill: " ", color: [0, 0, 0] },
      },
    },
    blueprint: {
      label: "Blueprint",
      values: {
        blockSize: 26, contrast: 1, brightness: 0, fontFamily: 0, charSize: 22,
        charset: 0, colorMode: 0,
        randomCharacters: 0, randomScale: 40, noiseIntensity: 0.15,
        sineEnable: 1, sineRadial: 0, sineSpeed: 1, sineFrequency: 1, sineSize: 50, sineIntensity: 50,
        noiseEnable: 0, scrollEnable: 0,
        glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
      },
      colors: { background: [0.04, 0.08, 0.16] },
      bands: {
        black: { fill: "@", color: [0.4, 0.7, 1] },
        white: { fill: "#", color: [0.8, 0.92, 1] },
        grey: { fill: "+", color: [0.55, 0.75, 1] },
        alpha: { fill: " ", color: [1, 1, 1] },
      },
    },
    neon: {
      label: "Neon Night",
      values: {
        blockSize: 20, contrast: 1.2, brightness: -0.05, fontFamily: 3, charSize: 18,
        charset: 0, colorMode: 0,
        randomCharacters: 1, randomScale: 120, noiseIntensity: 0.2,
        sineEnable: 1, sineRadial: 1, sineSpeed: 1.5, sineFrequency: 2, sineSize: 60, sineIntensity: 70,
        noiseEnable: 1, noiseType: 2, noiseScale: 1.5, noiseSpeed: 1, noiseOctaves: 3, noisePersistence: 0.9,
        scrollEnable: 1, scrollWaves: 2, scrollSpeed: 3,
        glitchEnable: 0, glitchAmount: 60, glitchSpeed: 3,
      },
      colors: { background: [0.02, 0.02, 0.05] },
      bands: {
        black: { fill: "@", color: [1, 0.2, 0.8] },
        white: { fill: "#", color: [0, 0.9, 1] },
        grey: { fill: "*", color: [0.7, 0.4, 1] },
        alpha: { fill: " ", color: [1, 1, 1] },
      },
    },
    glitch: {
      label: "Glitch Storm",
      values: {
        blockSize: 18, contrast: 1.3, brightness: 0, fontFamily: 0, charSize: 16,
        charset: 2, colorMode: 1,
        randomCharacters: 0, randomScale: 60, noiseIntensity: 0.25,
        sineEnable: 0, noiseEnable: 1, noiseType: 3, noiseScale: 2, noiseSpeed: 2, noiseOctaves: 4, noisePersistence: 0.8,
        scrollEnable: 0, glitchEnable: 1, glitchAmount: 120, glitchSpeed: 4,
      },
      colors: { background: [0.01, 0.01, 0.02] },
      bands: {
        black: { fill: "@", color: [1, 1, 1] },
        white: { fill: "#", color: [1, 1, 1] },
        grey: { fill: "+", color: [1, 1, 1] },
        alpha: { fill: " ", color: [1, 1, 1] },
      },
    },
  };
}

function installWindow(CM) {
  if (CM.openAsciiSetup) return;

  CM.asciiEffectList = function () {
    const found = [];
    const walk = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        if (e.type === "ascii") found.push(e);
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
      CM.project.traverse(function (e) { if (e.type === "ascii") found.push(e); });
    }
    return found;
  };

  CM.addAsciiToSelection = function () {
    const selection = CM.timelineSelection;
    if (!selection || !selection.length) return null;
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const layer = clip && clip.object;
      if (layer && layer.effects) {
        const PZ = globalThis.PZ;
        const effect = PZ.effect.create("ascii");
        layer.effects.push(effect);
        effect.loading = effect.load({});
        return effect;
      }
    }
    return null;
  };

  CM.openAsciiSetup = function (effect) {
    if (CM.asciiWindow) {
      if (effect) CM.asciiWindow.setEffect(effect);
      CM.asciiWindow.refresh();
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
    const frameOffset = function (p) {
      try {
        return (p && p.frameOffset) || 0;
      } catch (_e) {
        return 0;
      }
    };
    const setProp = function (key, value) {
      const e = state.effect;
      if (!e) return;
      const p = e.properties[key];
      if (!p || typeof p.set !== "function") return;
      try {
        p.set(value, frame() - frameOffset(p));
      } catch (_err) { /* best effort */ }
    };
    const setColorProp = function (key, hex) {
      const e = state.effect;
      if (!e) return;
      const p = e.properties[key];
      if (!p || !p.objects) return;
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
      if (!m) return;
      const n = parseInt(m[1], 16);
      const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      for (let i = 0; i < 3; i++) {
        try {
          p.objects[i].set(rgb[i], frame() - frameOffset(p.objects[i]));
        } catch (_err) { /* best effort */ }
      }
    };
    const getProp = function (key) {
      const e = state.effect;
      if (!e) return undefined;
      const p = e.properties[key];
      return p ? p.get(frame()) : undefined;
    };
    const getColorHex = function (key) {
      try {
        const p = state.effect && state.effect.properties[key];
        const v = p ? p.get(frame()) : null;
        if (!Array.isArray(v)) return "#ffffff";
        const h = function (x) {
          const n = Math.max(0, Math.min(255, Math.round(Number(x) * 255)));
          return (n < 16 ? "0" : "") + n.toString(16);
        };
        return "#" + h(v[0]) + h(v[1]) + h(v[2]);
      } catch (_err) {
        return "#ffffff";
      }
    };
    const setBandProp = function (band, field, value) {
      const key = band + field;
      const e = state.effect;
      if (!e) return;
      if (field === "Color") {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
        if (!m) return;
        const n = parseInt(m[1], 16);
        const p = e.properties[key];
        if (!p || !p.objects) return;
        const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        for (let i = 0; i < 3; i++) {
          try {
            p.objects[i].set(rgb[i], frame() - frameOffset(p.objects[i]));
          } catch (_err) { /* best effort */ }
        }
        return;
      }
      if (field === "Fill" || field === "Stroke") {
        const p = e.properties[key];
        if (p && typeof p.set === "function") {
          try {
            p.set(String(value).slice(0, 2), frame() - frameOffset(p));
          } catch (_err) { /* best effort */ }
        }
        return;
      }
      setProp(key, value);
    };

    const root = make("div", "ascii-window");
    const backdrop = make("div", "ascii-backdrop");
    root.appendChild(backdrop);
    const shell = make("div", "ascii-shell");
    root.appendChild(shell);

    const preview = make("div", "ascii-preview");
    const screen = make("div", "ascii-screen");
    const placeholder = make("div", "ascii-placeholder", "No preview — open on a clip with footage.");
    screen.appendChild(placeholder);
    const transport = make("div", "ascii-transport");
    const prevButton = make("button", "", "⏮");
    const playButton = make("button", "", "▶");
    const pauseButton = make("button", "", "⏸");
    const nextButton = make("button", "", "⏭");
    const timeLabel = make("span", "ascii-time", "0000");
    transport.appendChild(prevButton);
    transport.appendChild(playButton);
    transport.appendChild(pauseButton);
    transport.appendChild(nextButton);
    transport.appendChild(timeLabel);
    preview.appendChild(screen);
    preview.appendChild(transport);
    shell.appendChild(preview);

    const panel = make("div", "ascii-panel");
    const pill = make("div", "ascii-pill", "Ascii Editor");
    panel.appendChild(pill);
    const statusEl = make("div", "ascii-status", "No ASCII effect");
    panel.appendChild(statusEl);
    const groupsEl = make("div", "ascii-groups");
    panel.appendChild(groupsEl);
    shell.appendChild(panel);

    const closeButton = make("button", "ascii-close", "✕");
    closeButton.title = "Close (Esc)";
    shell.appendChild(closeButton);

    const liveRows = [];
    const refreshRow = function (row) {
      if (!state.effect || !row.update) return;
      try {
        row.update();
      } catch (_err) { /* best effort */ }
    };

    const sliderRow = function (parent, label, spec) {
      const row = make("div", "ascii-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      const valueEl = make("span", "ascii-value", "");
      input.oninput = function () {
        setProp(spec.key, parseFloat(input.value));
        valueEl.textContent = parseFloat(input.value).toFixed(spec.decimals);
      };
      row.appendChild(input);
      row.appendChild(valueEl);
      parent.appendChild(row);
      liveRows.push({
        update: function () {
          let value = getProp(spec.key);
          if (value === undefined || !isFinite(Number(value))) value = spec.min;
          value = Number(value);
          valueEl.textContent = value.toFixed(spec.decimals);
          if (document.activeElement !== input) input.value = value;
          input.disabled = !state.effect;
        },
      });
    };

    const checkRow = function (parent, label, key) {
      const row = make("div", "ascii-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "checkbox";
      input.onchange = function () {
        setProp(key, input.checked ? 1 : 0);
      };
      row.appendChild(input);
      parent.appendChild(row);
      liveRows.push({
        update: function () {
          const v = getProp(key);
          if (document.activeElement !== input) input.checked = Number(v) === 1;
          input.disabled = !state.effect;
        },
      });
    };

    const selectRow = function (parent, label, key, items) {
      const row = make("div", "ascii-row");
      row.appendChild(make("label", "", label));
      const input = make("select");
      items.split(";").forEach(function (name, i) {
        const o = make("option", "", name);
        o.value = String(i);
        input.appendChild(o);
      });
      input.onchange = function () {
        setProp(key, parseInt(input.value, 10));
      };
      row.appendChild(input);
      parent.appendChild(row);
      liveRows.push({
        update: function () {
          const v = getProp(key);
          if (document.activeElement !== input && v !== undefined) input.value = String(Math.round(Number(v)));
          input.disabled = !state.effect;
        },
      });
    };

    const colorRow = function (parent, label, key) {
      const row = make("div", "ascii-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "color";
      input.oninput = function () {
        setColorProp(key, input.value);
      };
      row.appendChild(input);
      parent.appendChild(row);
      liveRows.push({
        update: function () {
          if (document.activeElement !== input) input.value = getColorHex(key);
          input.disabled = !state.effect;
        },
      });
    };

    const textRow = function (parent, label, key, maxLen) {
      const row = make("div", "ascii-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "text";
      input.maxLength = maxLen || 2;
      input.onchange = function () {
        const e = state.effect;
        if (!e) return;
        const p = e.properties[key];
        if (p && typeof p.set === "function") {
          try {
            p.set(input.value, frame() - frameOffset(p));
          } catch (_err) { /* best effort */ }
        }
      };
      row.appendChild(input);
      parent.appendChild(row);
      liveRows.push({
        update: function () {
          if (document.activeElement !== input) {
            try {
              const p = state.effect && state.effect.properties[key];
              input.value = p ? String(p.get(frame())) : "";
            } catch (_err) { /* best effort */ }
          }
          input.disabled = !state.effect;
        },
      });
    };

    const noteRow = function (parent, text) {
      parent.appendChild(make("div", "ascii-note", text));
    };

    const group = function (title, open) {
      const g = make("div", "ascii-group" + (open === false ? " closed" : ""));
      const head = make("div", "ascii-group-head");
      head.appendChild(make("span", "ascii-chevron", "›"));
      head.appendChild(make("span", "", title));
      const bodyEl = make("div", "ascii-group-body");
      head.onclick = function () {
        g.classList.toggle("closed");
      };
      g.appendChild(head);
      g.appendChild(bodyEl);
      groupsEl.appendChild(g);
      return bodyEl;
    };

    // ---- Presets ----
    const presetBody = group("Presets");
    const presetList = make("div", "ascii-presets");
    presetBody.appendChild(presetList);
    Object.keys(CM.asciiPresets).forEach(function (pkey) {
      const preset = CM.asciiPresets[pkey];
      const btn = make("button", "ascii-preset", preset.label);
      btn.onclick = function () {
        if (!state.effect) return;
        Object.keys(preset.values).forEach(function (k) { setProp(k, preset.values[k]); });
        const colors = preset.colors || {};
        const colorKey = { background: "backgroundColor" };
        Object.keys(colors).forEach(function (k) {
          setColorProp(colorKey[k] || k, "#" + colors[k].map(function (c) {
            const n = Math.max(0, Math.min(255, Math.round(c * 255)));
            return (n < 16 ? "0" : "") + n.toString(16);
          }).join(""));
        });
        const bands = preset.bands || {};
        Object.keys(bands).forEach(function (band) {
          const spec = bands[band];
          const e = state.effect;
          if (!e) return;
          ["Fill", "Stroke", "Color", "Opacity"].forEach(function (field) {
            if (spec[field.toLowerCase()] === undefined) return;
            setBandProp(band, field, spec[field.toLowerCase()]);
          });
        });
        refresh();
      };
      presetList.appendChild(btn);
    });
    const addButton = make("button", "ascii-add", "Add ASCII to selected clip");
    addButton.onclick = function () {
      const added = CM.addAsciiToSelection();
      if (added) {
        state.effect = added;
        if (added.loading && added.loading.then) added.loading.then(refresh);
        refresh();
      }
    };
    presetBody.appendChild(addButton);

    // ---- Settings ----
    const settingsBody = group("Settings");
    colorRow(settingsBody, "Background", "backgroundColor");
    sliderRow(settingsBody, "Block size", { key: "blockSize", min: 4, max: 64, step: 1, decimals: 0 });
    const gridNote = make("div", "ascii-note", "Grid: —");
    settingsBody.appendChild(gridNote);
    selectRow(settingsBody, "Font", "fontFamily", "consolas;courier;monospace;inter;serif");
    sliderRow(settingsBody, "Character size", { key: "charSize", min: 8, max: 64, step: 1, decimals: 0 });

    // ---- Image Processing ----
    const imageBody = group("Image Processing", false);
    sliderRow(imageBody, "Contrast", { key: "contrast", min: 0, max: 4, step: 0.01, decimals: 2 });
    sliderRow(imageBody, "Brightness", { key: "brightness", min: -1, max: 1, step: 0.01, decimals: 2 });

    // ---- Character Settings ----
    const charBody = group("Character Settings", false);
    noteRow(charBody, "8px minimum for clarity. Random overrides the mapping below.");
    checkRow(charBody, "Random characters", "randomCharacters");
    selectRow(charBody, "Character set", "charset", "standard;blocks;detailed;minimal;custom");
    textRow(charBody, "Custom chars", "customChars", 32);
    const bandNames = { black: "Black", white: "White", grey: "Grey", alpha: "Alpha" };
    Object.keys(bandNames).forEach(function (band) {
      charBody.appendChild(make("div", "ascii-band-title", bandNames[band]));
      textRow(charBody, "Fill", band + "Fill", 2);
      textRow(charBody, "Stroke", band + "Stroke", 2);
      colorRow(charBody, "Char color", band + "Color");
      sliderRow(charBody, "Opacity", { key: band + "Opacity", min: 0, max: 100, step: 1, decimals: 0 });
    });

    // ---- Color Mode ----
    const colorBody = group("Color Mode", false);
    selectRow(colorBody, "Mode", "colorMode", "band colors;footage colors;duotone;mono;invert");
    colorRow(colorBody, "Duotone dark", "duotoneDark");
    colorRow(colorBody, "Duotone light", "duotoneLight");
    colorRow(colorBody, "Mono color", "monoColor");

    // ---- Effects ----
    const fxBody = group("Effects", false);
    sliderRow(fxBody, "Random scale", { key: "randomScale", min: 0, max: 300, step: 1, decimals: 0 });
    sliderRow(fxBody, "Noise intensity", { key: "noiseIntensity", min: 0, max: 1, step: 0.01, decimals: 2 });

    // ---- Sine Wave Motion ----
    const sineBody = group("Sine Wave Motion", false);
    checkRow(sineBody, "Enable sine waves", "sineEnable");
    checkRow(sineBody, "Radial effects", "sineRadial");
    sliderRow(sineBody, "Speed", { key: "sineSpeed", min: 0, max: 6, step: 0.1, decimals: 1 });
    sliderRow(sineBody, "Frequency", { key: "sineFrequency", min: 0.1, max: 8, step: 0.1, decimals: 1 });
    sliderRow(sineBody, "Size", { key: "sineSize", min: 0, max: 100, step: 1, decimals: 0 });
    sliderRow(sineBody, "Intensity", { key: "sineIntensity", min: 0, max: 100, step: 1, decimals: 0 });

    // ---- Advanced Noise ----
    const noiseBody = group("Advanced Noise", false);
    checkRow(noiseBody, "Enable advanced noise", "noiseEnable");
    selectRow(noiseBody, "Noise type", "noiseType", "perlin;simplex;fractal;turbulence");
    sliderRow(noiseBody, "Scale", { key: "noiseScale", min: 0.1, max: 8, step: 0.1, decimals: 1 });
    sliderRow(noiseBody, "Speed", { key: "noiseSpeed", min: 0, max: 6, step: 0.1, decimals: 1 });
    sliderRow(noiseBody, "Octaves", { key: "noiseOctaves", min: 1, max: 8, step: 1, decimals: 0 });
    sliderRow(noiseBody, "Persistence", { key: "noisePersistence", min: 0, max: 1, step: 0.01, decimals: 2 });

    // ---- Scroll ----
    const scrollBody = group("Scroll", false);
    checkRow(scrollBody, "Enable scroll", "scrollEnable");
    sliderRow(scrollBody, "Wave count", { key: "scrollWaves", min: 1, max: 6, step: 1, decimals: 0 });
    sliderRow(scrollBody, "Speed", { key: "scrollSpeed", min: 0, max: 6, step: 0.1, decimals: 1 });

    // ---- Glitch ----
    const glitchBody = group("Glitch", false);
    checkRow(glitchBody, "Glitch cuts", "glitchEnable");
    sliderRow(glitchBody, "Amount", { key: "glitchAmount", min: 0, max: 400, step: 1, decimals: 0 });
    sliderRow(glitchBody, "Speed", { key: "glitchSpeed", min: 0, max: 6, step: 0.1, decimals: 1 });

    const refresh = function () {
      const has = !!state.effect;
      let status = has ? "ASCII effect active" : "No ASCII effect — add one above";
      try {
        if (has && state.effect.pass) {
          const sw = state.effect.pass.sampleWidth;
          const sh = state.effect.pass.sampleHeight;
          if (sw && sh) status += " · Grid: " + sw + "x" + sh + " blocks";
          gridNote.textContent = sw && sh ? "Grid: " + sw + "x" + sh + " blocks" : "Grid: —";
        }
      } catch (_err) { /* best effort */ }
      statusEl.textContent = status;
      for (const row of liveRows) {
        refreshRow(row);
      }
      const time = CM.playback ? CM.playback.currentFrame : 0;
      timeLabel.textContent = String(Math.max(0, Math.round(time))).padStart(4, "0");
    };

    playButton.onclick = function () { if (CM.playback) CM.playback.speed = 1; };
    pauseButton.onclick = function () { if (CM.playback) { CM.playback.speed = 0; } };
    prevButton.onclick = function () {
      if (CM.playback) { CM.playback.speed = 0; CM.playback.currentFrame = Math.max(0, frame() - 1); }
    };
    nextButton.onclick = function () {
      if (CM.playback) { CM.playback.speed = 0; CM.playback.currentFrame = frame() + 1; }
    };

    document.body.appendChild(root);

    if (state.viewport && state.viewport.el) {
      state.viewportParent = state.viewport.el.parentElement;
      state.viewportStyle = state.viewport.el.getAttribute("style");
      state.wasEdit = state.viewport.edit;
      state.viewport.edit = false;
      screen.appendChild(state.viewport.el);
      placeholder.remove();
      requestAnimationFrame(function () { if (state.viewport) state.viewport.resize(); });
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
      CM.asciiWindow = null;
    };
    const onResize = function () { if (state.viewport) state.viewport.resize(); };
    const onKeydown = function (e) { if (e.key === "Escape") close(); };
    closeButton.onclick = close;
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeydown);

    if (!state.effect) {
      const found = CM.asciiEffectList();
      if (found.length) state.effect = found[0];
    }
    refresh();
    state.interval = setInterval(refresh, 500);
    CM.asciiWindow = {
      refresh: refresh,
      close: close,
      setEffect: function (e) { state.effect = e; refresh(); },
    };
  };
}

function routeSetupAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  if (action === "asciiSetup" && typeof editor.openAsciiSetup === "function") {
    editor.openAsciiSetup(target && target.parentObject);
    return true;
  }
  if (action === "vhsSetup" && typeof editor.openVhsSetup === "function") {
    editor.openVhsSetup(target && target.parentObject);
    return true;
  }
  if (action === "datamoshSetup" && typeof editor.openDatamoshSetup === "function") {
    editor.openDatamoshSetup(target && target.parentObject);
    return true;
  }
  if (action === "tracerySetup" && typeof editor.openTracerySetup === "function") {
    editor.openTracerySetup(target && target.parentObject);
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
  controls.runPropertyAction.__openzoidLegacyCompat = true;
  return controls;
}

function wrapDispatcher(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.runPropertyAction !== "function") return;
  if (state.installedWrapper) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__asciiDead) {
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
    state.installedWrapper.__asciiDead = true;
    const controls = PZ && PZ.ui && PZ.ui.controls;
    if (controls && controls.runPropertyAction === state.installedWrapper) {
      controls.runPropertyAction = controls.runPropertyAction.__openzoidLegacyOriginal || controls.runPropertyAction;
    }
    state.installedWrapper = null;
  }
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!PZ) throw new Error("ASCII Setup needs the CM3 runtime.");
    if (!CM) throw new Error("ASCII Setup needs the active editor instance.");
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    state.editor = CM;
    state.getAsset = getAsset;
    installStyle(getAsset);
    installData(CM);
    installWindow(CM);
    ensureDispatcher(PZ);
    wrapDispatcher(PZ);
    try {
      if (document && document.fonts && document.fonts.load) {
        document.fonts.load('600 20px Inter');
      }
    } catch (_err) { /* font is decorative */ }
    state.active = true;
  },
  deactivate() {
    try {
      const PZ = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || null;
      const CM = state.editor;
      if (CM && CM.asciiWindow && typeof CM.asciiWindow.close === "function") {
        try { CM.asciiWindow.close(); } catch (_error) { /* best effort */ }
      }
      if (PZ) {
        try { unpatchDispatcher(PZ); } catch (_error) { /* best effort */ }
      }
      uninstallStyle();
    } finally {
      state.active = false;
      state.editor = null;
      state.getAsset = null;
    }
  },
};
