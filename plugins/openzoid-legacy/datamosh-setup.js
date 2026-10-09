"use strict";

// OpenZoid Legacy — Datamosh Setup window.
//
// The Datamosh effect's "Setup" row opens a floating window (docs/plugin-ui.md).
// Like the VHS window, it edits the effect's own properties: a preset, a
// slider gesture or a seed change is one undoable step, and the values follow
// external changes such as undo.

const SETUP_CONTROL_ID = "openzoid-legacy.datamosh-setup";
const SYNC_INTERVAL_MS = 300;

const PRESETS = [
  { id: "clean", label: "Clean Pass", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 0.25, acceleration: 0.2, blend: 0.5, threshold: 0.25, blockSize: 12, motion: 0, interval: 60, samples: 4 } },
  { id: "blocky", label: "Blocky Mosh", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 0.85, acceleration: 0.45, blend: 0.85, threshold: 0.08, blockSize: 14, motion: 0, interval: 24, samples: 8 } },
  { id: "classic", label: "Classic Mosh", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 0.7, acceleration: 0.35, blend: 0.8, threshold: 0.12, blockSize: 12, motion: 8, interval: 30, samples: 6 } },
  { id: "iframe", label: "I-Frame Kill · Soupy", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 1.2, acceleration: 0.7, blend: 0.95, threshold: 0.05, blockSize: 10, motion: 0, interval: 90, samples: 12 } },
  { id: "swap", label: "Swap Motion", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 0.9, acceleration: 0.4, blend: 0.85, threshold: 0.1, blockSize: 12, motion: 7, interval: 30, samples: 6 } },
  { id: "zoom", label: "Zoom Smear", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 1, acceleration: 0.55, blend: 0.9, threshold: 0.08, blockSize: 12, motion: 4, interval: 40, samples: 8 } },
  { id: "wave", label: "Sin Melt", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 1.1, acceleration: 0.5, blend: 0.9, threshold: 0.06, blockSize: 10, motion: 6, interval: 36, samples: 8 } },
  { id: "drift", label: "Horizontal Drift", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 1, acceleration: 0.3, blend: 0.85, threshold: 0.08, blockSize: 8, motion: 3, interval: 48, samples: 10 } },
  { id: "trail", label: "Long Trail", values: { algorithm: 0, hold: 0, speed: 1, amount: 1, intensity: 0.6, acceleration: 0.6, blend: 0.9, threshold: 0.1, blockSize: 12, motion: 0, interval: 120, samples: 15 } },
];

// Sections list only keys; labels, ranges and steps come from the effect's
// property definitions.
const SECTIONS = [
  { title: "Master", keys: ["amount"] },
  { title: "Cadence", keys: ["interval", "samples", "seed", "hold", "speed", "time"], seedButton: true },
  { title: "Motion", keys: ["algorithm", "motion", "intensity", "acceleration", "blockSize", "threshold", "blend"] },
];

const SETUP_NOTE = "Datamosh reads earlier clip frames. On an Adjustment layer it samples the composite below it.";

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

module.exports = {
  activate(context) {
    const PZ = context.PZ;
    const CM = context.editor;
    if (!PZ || !PZ.property || !CM) {
      throw new Error("Datamosh Setup needs the CM3 runtime and the active editor.");
    }
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

    // One history step for every change. Changes go through CM3's property
    // operations so undo and redo replay the stored previous value.
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
      return owner && owner.type === "datamosh" && owner.properties ? owner : null;
    }

    function buildWindow(body, effect) {
      body.style.flexBasis = "0px";
      const props = effect.properties;
      const rows = [];
      let presetControl = null;
      let note = null;

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
          if (row.select) {
            if (String(row.control.get()) !== String(value)) row.control.set(String(value));
          } else if (!sameValue(row.control.get(), value)) {
            row.control.set(value);
          }
        });
        const id = matchPreset(effect);
        if (presetControl.get() !== id) presetControl.set(id);
        note.element.style.display = hostsFrameSampling(PZ, effect) ? "none" : "";
      }

      // Integer parameters use scrubbable number fields. Continuous ones use
      // sliders. Both preview on input and commit once per gesture.
      function fieldFor(key) {
        const property = props[key];
        const def = property.definition || {};
        let gesture = null;
        const handlers = {
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
        };
        const options = Object.assign({
          label: def.name || key,
          min: def.min,
          max: def.max,
          step: def.step || 0.01,
          value: valueOf(key),
        }, handlers);
        const control = def.decimals === 0
          ? controls.number(options)
          : controls.slider(options);
        rows.push({ control: control, property: property });
        return control.element;
      }

      // Long look lists (the 80 legacy algorithms) are grouped by family.
      function lookGroup(label, index) {
        if (index === 0) return "";
        if (/^(Multiply by|Multiply$)/.test(label)) return "Multiply";
        if (/^(Average|Add previous)/.test(label)) return "Average";
        if (/^Mirror/.test(label)) return "Mirror";
        if (/^Sweep/.test(label)) return "Sweep";
        if (/sin|cos/i.test(label)) return "Wave";
        if (/^(Random|Spatial)/.test(label)) return "Random";
        return "Motion";
      }

      // Motion mode is an option stored as its index in the item list.
      function motionFor(key) {
        const property = props[key];
        const rawItems = property.definition.items || "";
        const items = Array.isArray(rawItems) ? rawItems : String(rawItems).split(";");
        const grouped = items.length > 20;
        const control = controls.select({
          label: property.definition.name || key,
          value: String(valueOf(key)),
          options: items.map((label, index) => ({
            value: String(typeof label === "object" ? label.value : index),
            label: typeof label === "object" ? label.name : label,
            group: typeof label === "object" ? label.group : grouped ? lookGroup(label, index) : "",
          })),
          onChange(value) {
            recordChanges([{ property: property, value: Number(value), previous: valueOf(key) }]);
            refresh();
          },
        });
        rows.push({ control: control, property: property, select: true });
        return control.element;
      }

      note = controls.note(SETUP_NOTE, "warning");
      body.appendChild(note.element);

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
        const section = controls.section({ title: spec.title });
        keys.forEach((key) => {
          section.body.appendChild((key === "motion" || key === "algorithm") ? motionFor(key) : fieldFor(key));
        });
        if (spec.seedButton) {
          section.body.appendChild(controls.buttonRow([{
            title: "New Seed",
            hint: "Store a new seed for the block pattern",
            onClick() {
              // Advance the stored seed once per click; playback never changes it.
              recordChanges([{
                property: props.seed,
                value: ((Math.round(valueOf("seed")) || 0) + 7919) % 10000,
                previous: valueOf("seed"),
              }]);
              refresh();
            },
          }]).element);
        }
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
        id = `datamosh-${windowCounter}`;
        windowIds.set(effect, id);
      }
      return context.ui.openWindow({
        id: id,
        title: "Datamosh Setup",
        subtitle: "Segment motion",
        persistKey: "datamosh-setup-v2",
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
          button.textContent = "Datamosh Setup";
          button.title = "Open the Datamosh setup window";
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
