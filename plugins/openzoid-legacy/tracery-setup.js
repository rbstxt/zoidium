"use strict";

// OpenZoid Legacy — Tracery Setup window.
//
// SaaS-style fullscreen editor for the Tracery tracking-callout effect:
// live preview (reuses the main viewport), preset looks, per-point
// placement (including click-to-place on the preview), and collapsible
// control groups mirroring the effect property blocks. Inter type comes
// from the bundled tracery-font.css asset.

const STYLE_ID = "zoidium-tracery-setup-style";
const FONT_STYLE_ID = "zoidium-tracery-font-style";
const STYLE_URL = "./plugins/openzoid-legacy/tracery-setup.css";
const FONT_URL = "./plugins/openzoid-legacy/tracery-font.css";

const state = {
  active: false,
  editor: null,
  getAsset: null,
  installedWrapper: null,
};

function installStyle(getAsset, id, url) {
  if (document.getElementById(id)) return;
  const bundled = getAsset ? getAsset("text", url) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
}

function uninstallStyle() {
  const CM = state.editor;
  if (CM && CM.traceryWindow) return;
  for (const id of [STYLE_ID, FONT_STYLE_ID]) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}

function installData(CM) {
  if (CM.traceryPresets) return;
  CM.traceryPresets = {
    surveillance: {
      label: "Surveillance",
      values: {
        boxEnable: 1, boxShape: 0, boxLineWidth: 2, boxFill: 0,
        markerShape: 0, markerSize: 14, markerFilled: 1,
        gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 3.6,
        splineTension: 0, showHandles: 0, dashEnable: 0,
        arrowEnable: 0, labelsEnable: 1, labelMode: 0, labelFontSize: 20,
      },
      points: [
        { enable: 1, x: 30, y: 35, size: 130, dx: 150, dy: -80 },
        { enable: 1, x: 70, y: 60, size: 110, dx: -260, dy: 70 },
      ],
    },
    blueprint: {
      label: "Blueprint",
      values: {
        boxEnable: 1, boxShape: 2, boxLineWidth: 1.5, boxFill: 0,
        markerShape: 3, markerSize: 10, markerFilled: 0,
        gridEnable: 1, gridMode: 0, gridDivisions: 8, gridOpacity: 0.3,
        linesEnable: 1, lineType: 1, lineThickness: 2,
        dashEnable: 0, arrowEnable: 0,
        labelsEnable: 1, labelMode: 1, labelFontSize: 18,
      },
      points: [
        { enable: 1, x: 35, y: 40, size: 150, dx: 170, dy: -90 },
        { enable: 1, x: 65, y: 55, size: 120, dx: -280, dy: 80 },
      ],
    },
    neon: {
      label: "Neon Callout",
      values: {
        boxEnable: 1, boxShape: 0, boxLineWidth: 3, boxFill: 0,
        markerShape: 0, markerSize: 18, markerFilled: 1,
        gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 4,
        splineTension: 0.3, dashEnable: 1, dashLength: 12, dashGap: 6,
        arrowEnable: 1, arrowSize: 23, arrowPosition: 0.7, arrowFilled: 1,
        labelsEnable: 1, labelMode: 0, labelFontSize: 22,
      },
      points: [
        { enable: 1, x: 40, y: 45, size: 140, dx: 180, dy: -100 },
      ],
    },
    minimal: {
      label: "Minimal",
      values: {
        boxEnable: 1, boxShape: 0, boxLineWidth: 1.5, boxFill: 0,
        markerShape: 0, markerSize: 8, markerFilled: 1,
        gridEnable: 0, linesEnable: 0, dashEnable: 0, arrowEnable: 0,
        labelsEnable: 1, labelMode: 3, labelFontSize: 18,
      },
      points: [{ enable: 1, x: 50, y: 50, size: 120, dx: 160, dy: -80 }],
    },
    keytrack: {
      label: "Key Track",
      values: {
        detectEnable: 1, threshold: 50, showMask: 0, blurStrength: 5,
        alphaLayer: 0, detectionQuality: 2,
        boxEnable: 1, boxShape: 0, boxLineWidth: 2, boxFill: 0,
        markerShape: 0, markerSize: 12, markerFilled: 1,
        gridEnable: 0, linesEnable: 1, lineType: 0, lineThickness: 2.5,
        splineTension: 0, dashEnable: 1, dashLength: 8, dashGap: 5,
        arrowEnable: 0, labelsEnable: 1, labelMode: 0, labelFontSize: 20,
      },
      points: [],
    },
  };
  // Key Track is detection-only: switch every manual point off.
  CM.traceryPresets.keytrack.clearPoints = true;
  CM.traceryPresetColors = {
    surveillance: { line: [1, 1, 1], marker: [1, 0.15, 0.15], box: [1, 1, 1], label: [1, 1, 1] },
    blueprint: { line: [0.4, 0.7, 1], marker: [0.4, 0.7, 1], box: [0.75, 0.85, 1], label: [0.85, 0.92, 1] },
    neon: { line: [1, 0.2, 0.8], marker: [1, 0.2, 0.8], box: [1, 0.4, 0.9], label: [1, 1, 1] },
    minimal: { line: [1, 1, 1], marker: [1, 1, 1], box: [1, 1, 1], label: [1, 1, 1] },
    keytrack: { line: [1, 1, 1], marker: [1, 0.15, 0.15], box: [1, 1, 1], label: [1, 1, 1] },
  };
  CM.traceryPresetColors = {
    surveillance: { line: [1, 1, 1], marker: [1, 0.15, 0.15], box: [1, 1, 1], label: [1, 1, 1] },
    blueprint: { line: [0.4, 0.7, 1], marker: [0.4, 0.7, 1], box: [0.75, 0.85, 1], label: [0.85, 0.92, 1] },
    neon: { line: [1, 0.2, 0.8], marker: [1, 0.2, 0.8], box: [1, 0.4, 0.9], label: [1, 1, 1] },
    minimal: { line: [1, 1, 1], marker: [1, 1, 1], box: [1, 1, 1], label: [1, 1, 1] },
  };
}

function installWindow(CM) {
  if (CM.openTracerySetup) return;

  CM.traceryEffectList = function () {
    const found = [];
    const walk = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        if (e.type === "tracery") found.push(e);
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
      CM.project.traverse(function (e) { if (e.type === "tracery") found.push(e); });
    }
    return found;
  };

  CM.addTraceryToSelection = function () {
    const selection = CM.timelineSelection;
    if (!selection || !selection.length) return null;
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const layer = clip && clip.object;
      if (layer && layer.effects) {
        const PZ = globalThis.PZ;
        const effect = PZ.effect.create("tracery");
        layer.effects.push(effect);
        effect.loading = effect.load({});
        return effect;
      }
    }
    return null;
  };

  CM.openTracerySetup = function (effect) {
    if (CM.traceryWindow) {
      if (effect) CM.traceryWindow.setEffect(effect);
      CM.traceryWindow.refresh();
      return;
    }
    const state = {
      effect: effect || null,
      interval: null,
      viewport: CM.mainViewport || null,
      viewportParent: null,
      viewportStyle: null,
      wasEdit: null,
      point: 1,
      placing: false,
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

    const root = make("div", "tracery-window");
    const backdrop = make("div", "tracery-backdrop");
    root.appendChild(backdrop);
    const shell = make("div", "tracery-shell");
    root.appendChild(shell);

    // Preview (left).
    const preview = make("div", "tracery-preview");
    const screen = make("div", "tracery-screen");
    const placeholder = make("div", "tracery-placeholder", "No preview — open on a clip with footage.");
    screen.appendChild(placeholder);
    const placer = make("div", "tracery-placer");
    placer.style.display = "none";
    placer.title = "Click to place the selected point";
    screen.appendChild(placer);
    const transport = make("div", "tracery-transport");
    const prevButton = make("button", "", "⏮");
    const playButton = make("button", "", "▶");
    const pauseButton = make("button", "", "⏸");
    const nextButton = make("button", "", "⏭");
    const timeLabel = make("span", "tracery-time", "0000");
    transport.appendChild(prevButton);
    transport.appendChild(playButton);
    transport.appendChild(pauseButton);
    transport.appendChild(nextButton);
    transport.appendChild(timeLabel);
    preview.appendChild(screen);
    preview.appendChild(transport);
    shell.appendChild(preview);

    // Panel (right).
    const panel = make("div", "tracery-panel");
    const pill = make("div", "tracery-pill", "Tracery");
    panel.appendChild(pill);
    const statusEl = make("div", "tracery-status", "No Tracery effect");
    panel.appendChild(statusEl);
    const groupsEl = make("div", "tracery-groups");
    panel.appendChild(groupsEl);
    shell.appendChild(panel);

    const closeButton = make("button", "tracery-close", "✕");
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
      const row = make("div", "tracery-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      const valueEl = make("span", "tracery-value", "");
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
      const row = make("div", "tracery-row");
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
      const row = make("div", "tracery-row");
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
      const row = make("div", "tracery-row");
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

    const textRow = function (parent, label, key) {
      const row = make("div", "tracery-row");
      row.appendChild(make("label", "", label));
      const input = make("input");
      input.type = "text";
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

    const group = function (title, open) {
      const g = make("div", "tracery-group" + (open === false ? " closed" : ""));
      const head = make("div", "tracery-group-head");
      head.appendChild(make("span", "tracery-chevron", "›"));
      head.appendChild(make("span", "", title));
      const bodyEl = make("div", "tracery-group-body");
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
    const presetList = make("div", "tracery-presets");
    presetBody.appendChild(presetList);
    Object.keys(CM.traceryPresets).forEach(function (pkey) {
      const preset = CM.traceryPresets[pkey];
      const btn = make("button", "tracery-preset", preset.label);
      btn.onclick = function () {
        if (!state.effect) return;
        Object.keys(preset.values).forEach(function (k) { setProp(k, preset.values[k]); });
        const colors = (CM.traceryPresetColors || {})[pkey] || {};
        if (preset.clearPoints) {
          for (let n = 1; n <= 6; n++) setProp("point" + n + "Enable", 0);
        }
        if (colors.line) setColorProp("lineColor", "#" + colors.line.map(function (c) {
          const n = Math.max(0, Math.min(255, Math.round(c * 255)));
          return (n < 16 ? "0" : "") + n.toString(16);
        }).join(""));
        if (colors.marker) setColorProp("markerColor", "#" + colors.marker.map(function (c) {
          const n = Math.max(0, Math.min(255, Math.round(c * 255)));
          return (n < 16 ? "0" : "") + n.toString(16);
        }).join(""));
        if (colors.box) setColorProp("boxColor", "#" + colors.box.map(function (c) {
          const n = Math.max(0, Math.min(255, Math.round(c * 255)));
          return (n < 16 ? "0" : "") + n.toString(16);
        }).join(""));
        if (colors.label) setColorProp("labelColor", "#" + colors.label.map(function (c) {
          const n = Math.max(0, Math.min(255, Math.round(c * 255)));
          return (n < 16 ? "0" : "") + n.toString(16);
        }).join(""));
        (preset.points || []).forEach(function (pt, i) {
          const n = i + 1;
          setProp("point" + n + "Enable", pt.enable ? 1 : 0);
          setProp("point" + n + "X", pt.x);
          setProp("point" + n + "Y", pt.y);
          setProp("point" + n + "Size", pt.size);
          setProp("point" + n + "LabelDX", pt.dx);
          setProp("point" + n + "LabelDY", pt.dy);
        });
        refresh();
      };
      presetList.appendChild(btn);
    });
    const addButton = make("button", "tracery-add", "Add Tracery to selected clip");
    addButton.onclick = function () {
      const added = CM.addTraceryToSelection();
      if (added) {
        state.effect = added;
        if (added.loading && added.loading.then) added.loading.then(refresh);
        refresh();
      }
    };
    presetBody.appendChild(addButton);

    // ---- Points ----
    const pointsBody = group("Points");
    const tabsEl = make("div", "tracery-tabs");
    pointsBody.appendChild(tabsEl);
    const pointTabs = [];
    for (let n = 1; n <= 6; n++) {
      (function (idx) {
        const tab = make("button", "tracery-tab" + (idx === state.point ? " active" : ""), "P" + idx);
        tab.onclick = function () {
          state.point = idx;
          pointTabs.forEach(function (t, i) { t.classList.toggle("active", i + 1 === idx); });
          buildPointRows();
          refresh();
        };
        tabsEl.appendChild(tab);
        pointTabs.push(tab);
      })(n);
    }
    const placeButton = make("button", "tracery-place", "Click preview to place P1");
    placeButton.onclick = function () {
      state.placing = !state.placing;
      placeButton.classList.toggle("on", state.placing);
      placer.style.display = state.placing ? "" : "none";
      placeButton.textContent = "Click preview to place P" + state.point;
    };
    pointsBody.appendChild(placeButton);
    const pointRows = make("div", "tracery-point-rows");
    pointsBody.appendChild(pointRows);
    let pointRowUpdaters = [];
    const buildPointRows = function () {
      pointRows.innerHTML = "";
      // Drop updaters bound to the previous point's rows.
      for (let i = liveRows.length - 1; i >= 0; i--) {
        if (pointRowUpdaters.indexOf(liveRows[i]) >= 0) liveRows.splice(i, 1);
      }
      pointRowUpdaters = [];
      const track = function (fn) {
        const rec = { update: fn };
        pointRowUpdaters.push(rec);
        liveRows.push(rec);
      };
      const n = state.point;
      const slider = function (label, key, spec) {
        const row = make("div", "tracery-row");
        row.appendChild(make("label", "", label));
        const input = make("input");
        input.type = "range";
        input.min = spec.min;
        input.max = spec.max;
        input.step = spec.step;
        const valueEl = make("span", "tracery-value", "");
        input.oninput = function () {
          setProp(key, parseFloat(input.value));
          valueEl.textContent = parseFloat(input.value).toFixed(spec.decimals);
        };
        row.appendChild(input);
        row.appendChild(valueEl);
        pointRows.appendChild(row);
        track(function () {
          let value = getProp(key);
          if (value === undefined || !isFinite(Number(value))) value = spec.min;
          value = Number(value);
          valueEl.textContent = value.toFixed(spec.decimals);
          if (document.activeElement !== input) input.value = value;
          input.disabled = !state.effect;
        });
      };
      const check = function (label, key) {
        const row = make("div", "tracery-row");
        row.appendChild(make("label", "", label));
        const input = make("input");
        input.type = "checkbox";
        input.onchange = function () {
          setProp(key, input.checked ? 1 : 0);
        };
        row.appendChild(input);
        pointRows.appendChild(row);
        track(function () {
          const v = getProp(key);
          if (document.activeElement !== input) input.checked = Number(v) === 1;
          input.disabled = !state.effect;
        });
      };
      const text = function (label, key) {
        const row = make("div", "tracery-row");
        row.appendChild(make("label", "", label));
        const input = make("input");
        input.type = "text";
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
        pointRows.appendChild(row);
        track(function () {
          if (document.activeElement !== input) {
            try {
              const p = state.effect && state.effect.properties[key];
              input.value = p ? String(p.get(frame())) : "";
            } catch (_err) { /* best effort */ }
          }
          input.disabled = !state.effect;
        });
      };
      check("Enable P" + n, "point" + n + "Enable");
      slider("X [%]", "point" + n + "X", { min: 0, max: 100, step: 0.1, decimals: 1 });
      slider("Y [%]", "point" + n + "Y", { min: 0, max: 100, step: 0.1, decimals: 1 });
      slider("Size", "point" + n + "Size", { min: 1, max: 2000, step: 1, decimals: 0 });
      text("Label", "point" + n + "Label");
      slider("Label dX", "point" + n + "LabelDX", { min: -2000, max: 2000, step: 1, decimals: 0 });
      slider("Label dY", "point" + n + "LabelDY", { min: -2000, max: 2000, step: 1, decimals: 0 });
    };
    buildPointRows();

    // ---- Keying (detection source) ----
    const keyingBody = group("Keying");
    checkRow(keyingBody, "Detection", "detectEnable");
    colorRow(keyingBody, "Key color", "keyColor");
    sliderRow(keyingBody, "Threshold", { key: "threshold", min: 0, max: 100, step: 0.5, decimals: 1 });
    checkRow(keyingBody, "Show mask", "showMask");
    sliderRow(keyingBody, "Blur strength", { key: "blurStrength", min: 0, max: 8, step: 0.5, decimals: 1 });
    checkRow(keyingBody, "Alpha layer", "alphaLayer");
    selectRow(keyingBody, "Quality", "detectionQuality", "low;medium;high;extreme");

    // ---- Box ----
    const boxBody = group("Box", false);
    checkRow(boxBody, "Enabled", "boxEnable");
    selectRow(boxBody, "Shape", "boxShape", "rectangle;square;ellipse;circle");
    colorRow(boxBody, "Line color", "boxColor");
    sliderRow(boxBody, "Line width", { key: "boxLineWidth", min: 0.5, max: 20, step: 0.5, decimals: 1 });
    sliderRow(boxBody, "Opacity", { key: "boxOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });
    selectRow(boxBody, "Fill", "boxFill", "none;solid;diagonal hatch;invert");
    colorRow(boxBody, "Fill color", "boxFillColor");
    sliderRow(boxBody, "Fill opacity", { key: "boxFillOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });

    // ---- Marker ----
    const markerBody = group("Marker", false);
    selectRow(markerBody, "Shape", "markerShape", "dot;plus;cross;polygon");
    sliderRow(markerBody, "Size", { key: "markerSize", min: 1, max: 200, step: 1, decimals: 0 });
    colorRow(markerBody, "Color", "markerColor");
    sliderRow(markerBody, "Opacity", { key: "markerOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });
    sliderRow(markerBody, "Rotation", { key: "markerRotation", min: -180, max: 180, step: 1, decimals: 0 });
    sliderRow(markerBody, "Sides", { key: "markerSides", min: 3, max: 12, step: 1, decimals: 0 });
    checkRow(markerBody, "Filled", "markerFilled");

    // ---- Grid ----
    const gridBody = group("Grid", false);
    checkRow(gridBody, "Enabled", "gridEnable");
    selectRow(gridBody, "Mode", "gridMode", "cartesian;edge");
    sliderRow(gridBody, "Divisions", { key: "gridDivisions", min: 1, max: 32, step: 1, decimals: 0 });
    colorRow(gridBody, "Color", "gridColor");
    sliderRow(gridBody, "Opacity", { key: "gridOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });

    // ---- Connection Lines ----
    const linesBody = group("Connection Lines");
    checkRow(linesBody, "Enabled", "linesEnable");
    selectRow(linesBody, "Type", "lineType", "spline;pcb traces;smooth bend;step bend");
    colorRow(linesBody, "Color", "lineColor");
    sliderRow(linesBody, "Opacity", { key: "lineOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });
    sliderRow(linesBody, "Thickness", { key: "lineThickness", min: 0.5, max: 30, step: 0.1, decimals: 1 });
    sliderRow(linesBody, "Spline tension", { key: "splineTension", min: -1, max: 1, step: 0.01, decimals: 2 });
    sliderRow(linesBody, "Spline continuity", { key: "splineContinuity", min: -1, max: 1, step: 0.01, decimals: 2 });
    sliderRow(linesBody, "Spline bias", { key: "splineBias", min: -1, max: 1, step: 0.01, decimals: 2 });
    checkRow(linesBody, "Handles", "showHandles");
    sliderRow(linesBody, "Step corner", { key: "lineCorner", min: 0, max: 1, step: 0.01, decimals: 2 });

    // ---- Dash ----
    const dashBody = group("Dash", false);
    checkRow(dashBody, "Enabled", "dashEnable");
    sliderRow(dashBody, "Length", { key: "dashLength", min: 1, max: 200, step: 1, decimals: 0 });
    sliderRow(dashBody, "Gap", { key: "dashGap", min: 1, max: 200, step: 1, decimals: 0 });

    // ---- Arrow ----
    const arrowBody = group("Arrow", false);
    checkRow(arrowBody, "Enabled", "arrowEnable");
    colorRow(arrowBody, "Color", "arrowColor");
    sliderRow(arrowBody, "Opacity", { key: "arrowOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });
    sliderRow(arrowBody, "Size", { key: "arrowSize", min: 1, max: 200, step: 1, decimals: 0 });
    sliderRow(arrowBody, "Angle", { key: "arrowAngle", min: 0.05, max: 1.5, step: 0.01, decimals: 2 });
    sliderRow(arrowBody, "Position", { key: "arrowPosition", min: 0, max: 1, step: 0.01, decimals: 2 });
    checkRow(arrowBody, "Filled", "arrowFilled");

    // ---- Labels ----
    const labelsBody = group("Labels");
    checkRow(labelsBody, "Enabled", "labelsEnable");
    selectRow(labelsBody, "Display", "labelMode", "coordinates;dimensions;area;node id;custom");
    sliderRow(labelsBody, "Size", { key: "labelFontSize", min: 6, max: 120, step: 1, decimals: 0 });
    colorRow(labelsBody, "Color", "labelColor");
    sliderRow(labelsBody, "Opacity", { key: "labelOpacity", min: 0, max: 1, step: 0.01, decimals: 2 });

    const refresh = function () {
      const has = !!state.effect;
      let status = has ? "Tracery effect active" : "No Tracery effect — add one above";
      try {
        const regions = has && state.effect.pass ? state.effect.pass.lastRegionCount : null;
        if (has && typeof regions === "number") status += " · " + regions + " regions";
      } catch (_err) { /* best effort */ }
      statusEl.textContent = status;
      for (const row of liveRows) {
        refreshRow(row);
      }
      placeButton.textContent = "Click preview to place P" + state.point;
      const time = CM.playback ? CM.playback.currentFrame : 0;
      timeLabel.textContent = String(Math.max(0, Math.round(time))).padStart(4, "0");
    };

    // Transport.
    playButton.onclick = function () { if (CM.playback) CM.playback.speed = 1; };
    pauseButton.onclick = function () { if (CM.playback) { CM.playback.speed = 0; } };
    prevButton.onclick = function () {
      if (CM.playback) { CM.playback.speed = 0; CM.playback.currentFrame = Math.max(0, frame() - 1); }
    };
    nextButton.onclick = function () {
      if (CM.playback) { CM.playback.speed = 0; CM.playback.currentFrame = frame() + 1; }
    };

    // Click-to-place on the preview.
    placer.onclick = function (ev) {
      if (!state.placing || !state.effect) return;
      const r = screen.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / Math.max(r.width, 1)) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - r.top) / Math.max(r.height, 1)) * 100));
      setProp("point" + state.point + "Enable", 1);
      setProp("point" + state.point + "X", Math.round(x * 10) / 10);
      setProp("point" + state.point + "Y", Math.round(y * 10) / 10);
      state.placing = false;
      placeButton.classList.remove("on");
      placer.style.display = "none";
      refresh();
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
      CM.traceryWindow = null;
    };
    const onResize = function () { if (state.viewport) state.viewport.resize(); };
    const onKeydown = function (e) { if (e.key === "Escape") close(); };
    closeButton.onclick = close;
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeydown);

    if (!state.effect) {
      const found = CM.traceryEffectList();
      if (found.length) state.effect = found[0];
    }
    refresh();
    state.interval = setInterval(refresh, 500);
    CM.traceryWindow = {
      refresh: refresh,
      close: close,
      setEffect: function (e) { state.effect = e; refresh(); },
    };
  };
}

function routeSetupAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  // Shared family router: this module may install first, so route the
  // sibling setup actions too (each guarded by its own opener).
  if (action === "tracerySetup" && typeof editor.openTracerySetup === "function") {
    editor.openTracerySetup(target && target.parentObject);
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
  // Always chain above whatever dispatcher is installed (ours, a
  // sibling's, or upstream's): route tracerySetup here, delegate the rest.
  // The installedWrapper guard keeps re-enables from stacking.
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.runPropertyAction !== "function") return;
  if (state.installedWrapper) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__traceryDead) {
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
    state.installedWrapper.__traceryDead = true;
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
    if (!PZ) throw new Error("Tracery Setup needs the CM3 runtime.");
    if (!CM) throw new Error("Tracery Setup needs the active editor instance.");
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    state.editor = CM;
    state.getAsset = getAsset;
    installStyle(getAsset, FONT_STYLE_ID, FONT_URL);
    installStyle(getAsset, STYLE_ID, STYLE_URL);
    installData(CM);
    installWindow(CM);
    ensureDispatcher(PZ);
    wrapDispatcher(PZ);
    try {
      if (document && document.fonts && document.fonts.load) {
        document.fonts.load('600 20px Inter');
        document.fonts.load('400 14px Inter');
      }
    } catch (_err) { /* font is decorative */ }
    state.active = true;
  },
  deactivate() {
    try {
      const PZ = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || null;
      const CM = state.editor;
      if (CM && CM.traceryWindow && typeof CM.traceryWindow.close === "function") {
        try { CM.traceryWindow.close(); } catch (_error) { /* best effort */ }
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
