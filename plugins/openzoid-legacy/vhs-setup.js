"use strict";

// OpenZoid Legacy — VHS Setup window.
//
// The VHS effect's "Setup" row opens a floating window (docs/plugin-ui.md).
// The window edits the effect's own properties. Applying a preset is one
// undoable step, a slider gesture is one undoable step, and the values follow
// external changes such as undo. The window keeps no render state.

const SETUP_CONTROL_ID = "openzoid-legacy.vhs-setup";
const SYNC_INTERVAL_MS = 300;

const PRESETS = [
  { id: "clean", label: "Clean VHS", values: { amount: 1, signalStrength: 0.12, colorStripes: 0.1, chromaCrawl: 0.08, chromaLoss: 0, flicker: 0.03, vhsSharpen: 0.3, interlace: 0.35, staticWarp: 0.05, fastForward: 0, tracking: 0.08, anisotropyWarp: 0, jitterX: 0.2, jitterY: 0.2, roll: 0, rollSpeed: 1.5, persistence: 0.2, rgbSplit: 0.08, tear: 0.05, humBar: 0.05, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 0, noiseEvo: 0.4, noiseOpacity: 0.3, blinds: 0, snowDots: 0, speedDots: 0, anisoSnow: 0 } },
  { id: "broadcast", label: "Broadcast", values: { amount: 1, signalStrength: 0.25, colorStripes: 0.3, chromaCrawl: 0.22, chromaLoss: 0.02, flicker: 0.06, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.12, fastForward: 0, tracking: 0.18, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.12, tear: 0.12, humBar: 0.1, blueScreen: 0, skew: 0.25, crease: 0, ghost: 0.08, osd: 0, noiseEvo: 0.5, noiseOpacity: 0.4, blinds: 0, snowDots: 0, speedDots: 0, anisoSnow: 0 } },
  { id: "damaged", label: "Damaged Tape", values: { amount: 1, signalStrength: 0.7, colorStripes: 0.55, chromaCrawl: 0.5, chromaLoss: 0.35, flicker: 0.3, vhsSharpen: 0.5, interlace: 0.6, staticWarp: 0.65, fastForward: 0, tracking: 0.6, anisotropyWarp: 0.4, jitterX: 0.6, jitterY: 0.6, roll: 0.25, rollSpeed: 1.5, persistence: 0.35, rgbSplit: 0.4, tear: 0.6, humBar: 0.4, blueScreen: 0, skew: 0.6, crease: 0.5, ghost: 0.4, osd: 0, noiseEvo: 0.7, noiseOpacity: 0.6, blinds: 0, snowDots: 0.5, speedDots: 0.4, anisoSnow: 0.45 } },
  { id: "fastfwd", label: "Fast Forward", values: { amount: 1, signalStrength: 0.35, colorStripes: 0.4, chromaCrawl: 0.3, chromaLoss: 0.15, flicker: 0.15, vhsSharpen: 0.4, interlace: 0.55, staticWarp: 0.25, fastForward: 0.8, tracking: 0.35, anisotropyWarp: 0.15, jitterX: 0.4, jitterY: 0.5, roll: 0.35, rollSpeed: 2.5, persistence: 0.4, rgbSplit: 0.3, tear: 0.35, humBar: 0.25, blueScreen: 0, skew: 0.4, crease: 0.2, ghost: 0.25, osd: 0, noiseEvo: 0.8, noiseOpacity: 0.45, blinds: 0, snowDots: 0.35, speedDots: 0.7, anisoSnow: 0.3 } },
  { id: "trackingErr", label: "Tracking Error", values: { amount: 1, signalStrength: 0.5, colorStripes: 0.35, chromaCrawl: 0.35, chromaLoss: 0.2, flicker: 0.2, vhsSharpen: 0.4, interlace: 0.5, staticWarp: 0.4, fastForward: 0, tracking: 0.9, anisotropyWarp: 0.3, jitterX: 0.5, jitterY: 0.5, roll: 0.15, rollSpeed: 1.2, persistence: 0.3, rgbSplit: 0.35, tear: 0.5, humBar: 0.3, blueScreen: 0, skew: 0.5, crease: 0.35, ghost: 0.3, osd: 0, noiseEvo: 0.7, noiseOpacity: 0.6, blinds: 0, snowDots: 0.35, speedDots: 0.3, anisoSnow: 0.3 } },
  { id: "shot01", label: "Shot 01 · MESECAM tears", values: { amount: 1, signalStrength: 0.8, colorStripes: 0.15, chromaCrawl: 0.3, chromaLoss: 0.05, flicker: 0.05, vhsSharpen: 0.55, interlace: 0.4, staticWarp: 0.25, fastForward: 0, tracking: 0.15, anisotropyWarp: 0, jitterX: 0.45, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.25, tear: 0.15, humBar: 0.08, blueScreen: 0, skew: 0.25, crease: 0, ghost: 0.08, osd: 0, noiseEvo: 0.5, noiseOpacity: 0.4, blinds: 0, snowDots: 0.1, speedDots: 0, anisoSnow: 0.15 } },
  { id: "shot02", label: "Shot 02 · WTTW stripes", values: { amount: 1, signalStrength: 0.3, colorStripes: 0.85, chromaCrawl: 0.3, chromaLoss: 0.05, flicker: 0.08, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.15, fastForward: 0, tracking: 0.25, anisotropyWarp: 0, jitterX: 0.35, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.3, tear: 0.15, humBar: 0.12, blueScreen: 0, skew: 0.3, crease: 0.05, ghost: 0.12, osd: 1, noiseEvo: 0.5, noiseOpacity: 0.4, blinds: 0, snowDots: 0, speedDots: 0, anisoSnow: 0 } },
  { id: "shot03", label: "Shot 03 · WTTW clean", values: { amount: 1, signalStrength: 0.15, colorStripes: 0.15, chromaCrawl: 0.15, chromaLoss: 0.02, flicker: 0.04, vhsSharpen: 0.5, interlace: 0.4, staticWarp: 0.08, fastForward: 0, tracking: 0.12, anisotropyWarp: 0, jitterX: 0.25, jitterY: 0.25, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.1, tear: 0.06, humBar: 0.06, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 1, noiseEvo: 0.4, noiseOpacity: 0.3, blinds: 0, snowDots: 0, speedDots: 0, anisoSnow: 0 } },
  { id: "shot04", label: "Shot 04 · Pattern blur", values: { amount: 1, signalStrength: 0.3, colorStripes: 0.4, chromaCrawl: 0.7, chromaLoss: 0.08, flicker: 0.08, vhsSharpen: 0.4, interlace: 0.7, staticWarp: 0.15, fastForward: 0, tracking: 0.2, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.45, rgbSplit: 0.35, tear: 0.2, humBar: 0.1, blueScreen: 0, skew: 0.3, crease: 0.1, ghost: 0.15, osd: 0, noiseEvo: 0.5, noiseOpacity: 0.4, blinds: 0, snowDots: 0.1, speedDots: 0.15, anisoSnow: 0.1 } },
  { id: "shot05", label: "Shot 05 · Streak strip", values: { amount: 1, signalStrength: 0.5, colorStripes: 0.4, chromaCrawl: 0.4, chromaLoss: 0.2, flicker: 0.2, vhsSharpen: 0.3, interlace: 0.5, staticWarp: 0.9, fastForward: 0, tracking: 0.7, anisotropyWarp: 0.2, jitterX: 0.7, jitterY: 0.5, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.35, tear: 0.7, humBar: 0.3, blueScreen: 0, skew: 0.5, crease: 0.5, ghost: 0.3, osd: 0, noiseEvo: 0.7, noiseOpacity: 0.6, blinds: 0, snowDots: 0.6, speedDots: 0.4, anisoSnow: 0.5 } },
  { id: "shot06", label: "Shot 06 · Desat mono", values: { amount: 1, signalStrength: 0.2, colorStripes: 0.2, chromaCrawl: 0.1, chromaLoss: 0.95, flicker: 0.06, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.12, fastForward: 0, tracking: 0.15, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.1, tear: 0.08, humBar: 0.06, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 0, noiseEvo: 0.4, noiseOpacity: 0.3, blinds: 0, snowDots: 0, speedDots: 0, anisoSnow: 0 } },
  { id: "shot07", label: "Shot 07 · Fast forward", values: { amount: 1, signalStrength: 0.35, colorStripes: 0.35, chromaCrawl: 0.3, chromaLoss: 0.55, flicker: 0.12, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.35, fastForward: 0.7, tracking: 0.3, anisotropyWarp: 0.1, jitterX: 0.4, jitterY: 0.45, roll: 0.2, rollSpeed: 2.2, persistence: 0.35, rgbSplit: 0.25, tear: 0.4, humBar: 0.2, blueScreen: 0, skew: 0.45, crease: 0.3, ghost: 0.2, osd: 0, noiseEvo: 0.8, noiseOpacity: 0.45, blinds: 0, snowDots: 0.4, speedDots: 0.55, anisoSnow: 0.35 } },
  { id: "shot08", label: "Shot 08 · Blue blowout", values: { amount: 1, signalStrength: 0.4, colorStripes: 0.45, chromaCrawl: 0.4, chromaLoss: 0.1, flicker: 0.85, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.3, fastForward: 0, tracking: 0.5, anisotropyWarp: 0.1, jitterX: 0.5, jitterY: 0.4, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.3, tear: 0.3, humBar: 0.35, blueScreen: 0.15, skew: 0.35, crease: 0.1, ghost: 0.15, osd: 0, noiseEvo: 0.5, noiseOpacity: 0.45, blinds: 0, snowDots: 0.15, speedDots: 0.2, anisoSnow: 0.2 } },
  { id: "shot09", label: "Shot 09 · Tracking bars", values: { amount: 1, signalStrength: 0.4, colorStripes: 0.35, chromaCrawl: 0.35, chromaLoss: 0.25, flicker: 0.3, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.35, fastForward: 0, tracking: 0.95, anisotropyWarp: 0.2, jitterX: 0.55, jitterY: 0.45, roll: 0.1, rollSpeed: 1.2, persistence: 0.3, rgbSplit: 0.4, tear: 0.55, humBar: 0.3, blueScreen: 0.1, skew: 0.55, crease: 0.4, ghost: 0.3, osd: 0, noiseEvo: 0.7, noiseOpacity: 0.6, blinds: 0, snowDots: 0.35, speedDots: 0.3, anisoSnow: 0.3 } },
  { id: "shot10", label: "Shot 10 · Aniso split", values: { amount: 1, signalStrength: 0.45, colorStripes: 0.4, chromaCrawl: 0.4, chromaLoss: 0.45, flicker: 0.2, vhsSharpen: 0.35, interlace: 0.55, staticWarp: 0.25, fastForward: 0, tracking: 0.4, anisotropyWarp: 0.9, jitterX: 0.5, jitterY: 0.45, roll: 0, rollSpeed: 1.5, persistence: 0.35, rgbSplit: 0.35, tear: 0.4, humBar: 0.25, blueScreen: 0.1, skew: 0.4, crease: 0.6, ghost: 0.25, osd: 0, noiseEvo: 0.6, noiseOpacity: 0.5, blinds: 0, snowDots: 0.4, speedDots: 0.3, anisoSnow: 0.55 } },
];

// Parameter sections. Labels, ranges and steps come from the effect's own
// property definitions, so the window cannot drift from the saved values.
const SECTIONS = [
  { title: "Master", keys: ["amount"] },
  { title: "Color", keys: ["signalStrength", "colorStripes", "chromaCrawl", "chromaLoss", "flicker", "rgbSplit", "blueScreen"] },
  { title: "Image", keys: ["vhsSharpen", "interlace", "staticWarp", "fastForward", "tracking", "anisotropyWarp", "tear", "humBar", "crease", "ghost", "blinds", "snowDots", "speedDots", "anisoSnow"] },
  { title: "Motion", keys: ["jitterX", "jitterY", "roll", "rollSpeed", "persistence", "skew"] },
  { title: "Noise", keys: ["noiseEvo", "noiseOpacity"], collapsed: true },
  { title: "Overlay", keys: ["osd"], collapsed: true },
];

const TRAIL_HINT = "Averages earlier source frames. Needs an Adjustment layer.";
const TRAIL_NOTE = "Persistence samples earlier clip frames, or the composite below an Adjustment layer.";

function sameValue(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function hostsFrameSampling(PZ, effect) {
  try {
    const adjustment = PZ.layer;
    return Boolean(adjustment && effect.tryGetParentOfType && effect.tryGetParentOfType(adjustment));
  } catch (_error) {
    return false;
  }
}

// Pack-wide renderer for legacy property `buttons` declarations. The ASCII and
// Tracery setup windows (effect-windows.js) use it. The VHS and Datamosh
// effects use propertyControls instead. The renderer is shared and reference
// counted, so the first pack to need it installs it and the last one removes it.
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
  // The row element e holds the generated input in children[1]. Buttons are
  // appended after the input.
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
    const PZ = context.PZ;
    const CM = context.editor;
    if (!PZ || !PZ.property || !CM) {
      throw new Error("VHS Setup needs the CM3 runtime and the active editor.");
    }
    ensureButtonsRenderer(PZ);
    context.lifecycle.onDispose(function () {
      releaseButtonsRenderer(PZ);
    });
    const controls = context.ui.controls;
    const doc = context.document;
    const windowIds = new WeakMap();
    let windowCounter = 0;

    function localFrame(property) {
      const current = CM.playback ? Number(CM.playback.currentFrame) || 0 : 0;
      return current - (Number(property.frameOffset) || 0);
    }

    function readValue(property) {
      return Number(property.get(localFrame(property)));
    }

    // One history step for every change. Each change goes through CM3's
    // property operations, so undo and redo replay the stored previous value.
    function recordChanges(changes) {
      const pending = changes.filter((change) => !sameValue(change.previous, change.value));
      if (pending.length === 0) return;
      const ops = CM.propertyOps || new PZ.ui.properties(CM);
      CM.history.startOperation();
      try {
        pending.forEach((change) => {
          ops.setValue({
            property: change.property.getAddress(),
            frame: localFrame(change.property),
            value: change.value,
            oldValue: change.previous,
          });
        });
      } finally {
        CM.history.finishOperation();
      }
    }

    function matchPreset(effect) {
      const found = PRESETS.find((preset) => Object.keys(preset.values).every((key) => {
        const property = effect.properties[key];
        return property && sameValue(readValue(property), preset.values[key]);
      }));
      return found ? found.id : "custom";
    }

    function effectOf(property) {
      const owner = property && property.parentObject;
      return owner && owner.type === "vhs" && owner.properties ? owner : null;
    }

    function buildWindow(body, effect) {
      body.style.flexBasis = "0px";
      const props = effect.properties;
      const rows = [];
      let presetControl = null;
      let trailNote = null;

      function valueOf(key) {
        return props[key] ? readValue(props[key]) : NaN;
      }

      function applyPreset(id) {
        const preset = PRESETS.find((entry) => entry.id === id);
        if (!preset) return;
        recordChanges(Object.keys(preset.values)
          .filter((key) => props[key])
          .map((key) => ({ property: props[key], value: preset.values[key], previous: valueOf(key) })));
        refresh();
      }

      function refresh() {
        rows.forEach((row) => {
          const value = readValue(row.property);
          if (!sameValue(row.control.get(), value)) row.control.set(value);
        });
        const id = matchPreset(effect);
        if (presetControl.get() !== id) presetControl.set(id);
        trailNote.element.style.display = hostsFrameSampling(PZ, effect) ? "none" : "";
      }

      // Sliders preview while dragging and commit once on release. The value
      // before the first drag event is kept as the undo target.
      function sliderFor(key) {
        const property = props[key];
        const def = property.definition || {};
        let gesture = null;
        const control = controls.slider({
          label: def.name || key,
          min: def.min,
          max: def.max,
          step: def.step || 0.01,
          value: valueOf(key),
          hint: key === "persistence" ? TRAIL_HINT : undefined,
          onInput(value) {
            if (gesture === null) gesture = valueOf(key);
            property.set(value, localFrame(property));
          },
          onChange(value) {
            const previous = gesture === null ? valueOf(key) : gesture;
            gesture = null;
            recordChanges([{ property: property, value: value, previous: previous }]);
            refresh();
          },
        });
        rows.push({ control: control, property: property });
        return control.element;
      }

      trailNote = controls.note(TRAIL_NOTE, "warning");
      body.appendChild(trailNote.element);

      presetControl = controls.select({
        label: "Preset",
        value: matchPreset(effect),
        options: [{ value: "custom", label: "Custom" }]
          .concat(PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))),
        onChange(id) {
          applyPreset(id);
        },
      });
      body.appendChild(presetControl.element);

      SECTIONS.forEach((spec) => {
        const keys = spec.keys.filter((key) => props[key]);
        if (keys.length === 0) return;
        const section = controls.section({ title: spec.title, collapsed: Boolean(spec.collapsed) });
        keys.forEach((key) => section.body.appendChild(sliderFor(key)));
        body.appendChild(section.element);
      });

      refresh();
      const timer = context.window.setInterval(refresh, SYNC_INTERVAL_MS);
      return function cleanup() {
        context.window.clearInterval(timer);
      };
    }

    function openSetup(effect) {
      let id = windowIds.get(effect);
      if (!id) {
        windowCounter += 1;
        id = `vhs-${windowCounter}`;
        windowIds.set(effect, id);
      }
      return context.ui.openWindow({
        id: id,
        title: "VHS Setup",
        subtitle: "Signal chain",
        persistKey: "vhs-setup-v2",
        width: 420,
        height: 780,
        minHeight: 240,
        mount(body) {
          return buildWindow(body, effect);
        },
        isValid: () => effect.parent != null,
        footer: [{
          title: "Done",
          variant: "primary",
          onClick: () => {
            const win = context.ui.getWindow(id);
            if (win) win.close();
          },
        }],
      });
    }

    if (context.apis && context.apis.propertyControls) {
      const unregister = context.apis.propertyControls.register(SETUP_CONTROL_ID, {
        type: PZ.property.type.TEXT,
        create(property) {
          const effect = effectOf(property);
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "propbutton";
          button.textContent = "VHS Setup";
          button.title = "Open the VHS setup window";
          button.disabled = !effect;
          button.addEventListener("mousedown", (event) => event.stopPropagation());
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (effect) openSetup(effect);
          });
          return button;
        },
      });
      context.lifecycle.onDispose(unregister);
    }
  },
};
