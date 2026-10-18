"use strict";

// Native property controls for the constraint rows.
//
// The rows keep standard CM3 storage types (TEXT and OPTION) and render a
// CM3 select (`.editbox > select.pz-inputbox`) through the shared property
// control registry, so they sit in the Objects panel exactly like native
// option rows and record history through CM3's own edit hooks.

const math = require("./track-to-math.js");

const NONE_LABEL = "None";
const MISSING_LABEL = "(Missing target)";

function objectLabel(object) {
  try {
    const name = object?.properties?.name?.get?.();
    return typeof name === "string" && name.trim() ? name : "3D object";
  } catch (_error) {
    return "3D object";
  }
}

// Candidate targets in the scene of `object`: every other 3D object with a
// Three object, labelled with its group path, excluding the object itself
// and its descendants. Pure apart from reading names.
function listTargets(scene, object) {
  const results = [];
  const roots = scene?.objects;
  if (!roots || typeof roots.length !== "number") return results;
  function walk(list, path) {
    for (let i = 0; i < list.length; i += 1) {
      const candidate = list[i];
      if (!candidate || candidate === object) continue;
      const label = path.concat(objectLabel(candidate));
      if (candidate.threeObj) results.push({ object: candidate, label: label.join(" / ") });
      const children = candidate.objects;
      if (children && typeof children.length === "number") walk(children, label);
    }
  }
  walk(roots, []);
  const counts = new Map();
  for (const entry of results) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
  const seen = new Map();
  for (const entry of results) {
    if (counts.get(entry.label) < 2) continue;
    const index = (seen.get(entry.label) || 0) + 1;
    seen.set(entry.label, index);
    entry.label = `${entry.label} (${index})`;
  }
  return results;
}

function createControls(options) {
  const PZ = options.PZ;
  const document = options.document;
  const store = options.store;
  const evaluator = options.evaluator;
  const KEYS = store.KEYS;

  function controlsOf(element) {
    return element.closest?.("ul")?.pz_controls || null;
  }

  function makeSelect(label) {
    const container = document.createElement("div");
    container.classList.add("editbox");
    const select = document.createElement("select");
    select.classList.add("pz-inputbox");
    select.setAttribute("aria-label", label);
    container.appendChild(select);
    return { container, select };
  }

  function fillOptions(select, entries) {
    select.replaceChildren();
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      option.disabled = Boolean(entry.disabled);
      select.appendChild(option);
    }
  }

  // One undo step: CM3's editStart/editFinish around the main property,
  // with optional extra values recorded inside the same operation.
  function commit(select, property, value, extras) {
    const controls = controlsOf(select);
    if (!controls) {
      property.set(value);
      return;
    }
    PZ.ui.controls.editStart.call(select, property);
    const frame = select.parentElement.pz_frame;
    property.set(value, frame);
    for (const extra of extras || []) {
      controls.propertyOps.setValue({ property: extra.property.getAddress(), value: extra.value });
    }
    PZ.ui.controls.editFinish.call(select, property);
  }

  function createTargetControl(property) {
    const { container, select } = makeSelect("Track to target");
    let candidates = [];
    let signature = "";

    function refresh(force) {
      const object = property.parentObject;
      const scene = evaluator.sceneOf(object, PZ);
      candidates = listTargets(scene, object);
      const current = store.readTarget(object);
      const entries = [{ value: "", label: NONE_LABEL }];
      let selected = "";
      candidates.forEach((entry, index) => {
        const value = String(index);
        entries.push({ value, label: entry.label });
        if (current && store.readId(entry.object) === current) selected = value;
      });
      if (current && !selected) {
        entries.push({ value: "missing", label: MISSING_LABEL, disabled: true });
        selected = "missing";
      }
      const next = entries.map((entry) => `${entry.value}\u0000${entry.label}`).join("\u0001");
      const focused = document.activeElement === select;
      if (next !== signature && (force || !focused)) {
        signature = next;
        fillOptions(select, entries);
      }
      if (force || !focused) select.value = selected;
      select.title = selected === "missing"
        ? "The target is no longer in this scene; Track To is inactive"
        : "Object that this object points at";
    }

    // CM3 refreshes static rows only when their own value changes. Rebuild
    // the list before it opens so renamed and added objects appear.
    select.onfocus = select.onpointerdown = () => refresh(true);
    select.onchange = function () {
      const object = property.parentObject;
      const choice = select.value;
      let value = "";
      if (choice !== "" && choice !== "missing") {
        const entry = candidates[Number(choice)];
        if (!entry) return refresh(true);
        value = store.ensureId(entry.object);
        if (!value) return refresh(true);
      } else if (choice === "missing") {
        return refresh(true);
      }
      if (value === store.readTarget(object)) return refresh(true);
      commit(select, property, value);
      refresh(true);
    };
    container.pz_update = () => refresh(false);
    refresh(true);
    return container;
  }

  function createTrackAxisControl(property) {
    const { container, select } = makeSelect("Track axis");
    fillOptions(select, math.TRACK_AXIS_ITEMS.split(";").map((label, index) => ({ value: String(index), label })));
    select.onchange = function () {
      const object = property.parentObject;
      const value = Number(select.value);
      const upProperty = store.propertyOf(object, KEYS.upAxis);
      const extras = [];
      if (upProperty && math.upAxisIndex(upProperty.get()) === math.trackAxisInfo(value).axis) {
        extras.push({ property: upProperty, value: math.resolveUpAxis(value, upProperty.get()) });
      }
      commit(select, property, value, extras);
    };
    container.pz_update = () => {
      if (document.activeElement !== select) select.value = String(property.get());
    };
    container.pz_update();
    return container;
  }

  function createUpAxisControl(property) {
    const { container, select } = makeSelect("Up axis");
    const labels = math.UP_AXIS_ITEMS.split(";");
    function refresh() {
      const object = property.parentObject;
      const trackAxis = math.trackAxisInfo(store.readTrackAxis(object)).axis;
      fillOptions(select, labels.map((label, index) => ({
        value: String(index),
        label,
        disabled: index === trackAxis,
      })));
      select.value = String(math.resolveUpAxis(store.readTrackAxis(object), property.get()));
      select.title = "Local axis that stays closest to the world up direction (+Y); it cannot equal the track axis";
    }
    select.onfocus = select.onpointerdown = refresh;
    select.onchange = function () {
      const value = Number(select.value);
      const trackAxis = math.trackAxisInfo(store.readTrackAxis(property.parentObject)).axis;
      if (value === trackAxis) return refresh();
      commit(select, property, value);
    };
    container.pz_update = () => {
      if (document.activeElement !== select) refresh();
    };
    refresh();
    return container;
  }

  function register(propertyControls) {
    const T = PZ.property.type;
    return [
      propertyControls.register(store.CONTROL_IDS.target, { type: T.TEXT, create: createTargetControl }),
      propertyControls.register(store.CONTROL_IDS.trackAxis, { type: T.OPTION, create: createTrackAxisControl }),
      propertyControls.register(store.CONTROL_IDS.upAxis, { type: T.OPTION, create: createUpAxisControl }),
    ];
  }

  return { register, listTargets };
}

module.exports = { createControls, listTargets, objectLabel };
