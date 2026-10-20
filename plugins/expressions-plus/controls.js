"use strict";
const STORAGE = "zoidiumControls";
const KINDS = Object.freeze({ Slider: { type: 0, value: 0 }, Angle: { type: 0, value: 0 }, Checkbox: { type: 6, value: 0 }, Color: { type: 4, value: [1, 1, 1] }, "Point 2D": { type: 1, value: [0, 0] }, "Point 3D": { type: 2, value: [0, 0, 0] } });
const clone = v => JSON.parse(JSON.stringify(v));
function decode(text) {
  if (!text) return { version: 1, nextId: 1, controls: [] };
  const data = typeof text === "string" ? JSON.parse(text) : clone(text);
  if (data.version !== 1 || !Array.isArray(data.controls) || data.controls.length > 256) throw new Error("Unsupported Sequence Controls data");
  const ids = new Set(), names = new Set();
  for (const p of data.controls) {
    const kind = p.type?.zoidiumControlKind, id = p.type?.zoidiumControlId, name = p.properties?.name;
    if (!Object.hasOwn(KINDS, kind) || p.type.type !== KINDS[kind].type || !/^c\d+$/.test(id) || ids.has(id) || typeof name !== "string" || !name.trim() || names.has(name)) throw new Error("Invalid Sequence Controls data");
    ids.add(id); names.add(name);
  }
  data.nextId = Math.max(1, Number(data.nextId) || 1, ...Array.from(ids, s => Number(s.slice(1)) + 1));
  return data;
}
function createControlsStore({ PZ, patch, notify = () => {} }) {
  const states = new WeakMap(), lists = new WeakMap();
  function label(p) {
    // Keep a custom property's editable native name while avoiding a second
    // property-definition label that would shadow rename updates in CM3.
    const name = p.properties.name.get();
    if (p.definition.name) delete p.definition.name;
    return name;
  }
  function snapshot(sequence) {
    const state = ensure(sequence);
    return { version: 1, nextId: state.nextId, controls: Array.from(state.list, p => clone(p)) };
  }
  function restore(sequence, input) {
    const data = decode(input), state = ensure(sequence);
    state.nextId = data.nextId;
    state.list.splice(0, state.list.length);
    for (const saved of data.controls) {
      const p = PZ.property.create(clone(saved.type));
      state.list.push(p); p.load(clone(saved)); label(p);
    }
    notify(sequence);
  }
  function ensure(sequence) {
    if (states.has(sequence)) return states.get(sequence);
    const list = new PZ.objectList(sequence, PZ.property.dynamic);
    list.name = "Controls";
    sequence.children.push(list);
    const state = { list, nextId: 1 };
    states.set(sequence, state); lists.set(list, sequence);
    const meta = PZ.property.create({ name: "Sequence Controls data", type: PZ.property.type.TEXT, value: "", visible: false });
    sequence.properties.add(STORAGE, meta);
    meta.toJSON = () => list.length ? JSON.stringify(snapshot(sequence)) : "";
    meta.onChanged.watch(() => {
      try { restore(sequence, meta.get()); }
      catch (error) { console.warn("[Zoidium] Sequence Controls: " + error.message); }
    });
    return state;
  }
  function add(sequence, kind, options = {}) {
    if (!Object.hasOwn(KINDS, kind)) throw new Error("Unknown Sequence Control type");
    const state = ensure(sequence);
    if (state.list.length >= 256) throw new Error("A sequence supports at most 256 controls");
    const taken = new Set(Array.from(state.list, label));
    let name = String(options.name || kind), index = 2;
    while (taken.has(name)) name = String(options.name || kind) + " " + index++;
    const definition = { custom: true, dynamic: true, type: KINDS[kind].type, value: clone(KINDS[kind].value),
      zoidiumControlKind: kind, zoidiumControlId: "c" + state.nextId++ };
    if (kind === "Slider") Object.assign(definition, { min: options.min ?? 0, max: options.max ?? 100, step: options.step ?? .01 });
    if (kind === "Angle") Object.assign(definition, { scaleFactor: Math.PI / 180, step: 1, decimals: 1 });
    if (kind === "Checkbox") definition.items = "off;on";
    const p = PZ.property.create(definition);
    state.list.push(p); p.load(); p.properties.name.set(name);
    p.set(clone(options.value ?? KINDS[kind].value), 0);
    label(p); notify(sequence); return p;
  }
  function rename(sequence, p, name) {
    name = String(name).trim();
    if (!name || Array.from(ensure(sequence).list).some(other => other !== p && label(other) === name)) throw new Error("Control names must be nonempty and unique");
    p.properties.name.set(name); notify(sequence);
  }
  function remove(sequence, p) { const list = ensure(sequence).list, index = list.indexOf(p); if (index >= 0) list.splice(index, 1); notify(sequence); }
  function move(sequence, p, delta) { const list = ensure(sequence).list, index = list.indexOf(p), next = Math.max(0, Math.min(list.length - 1, index + delta)); if (index < 0 || index === next) return; list.splice(index, 1); list.splice(next, 0, p); notify(sequence); }
  patch(PZ.sequence.prototype, "load", original => function loadWithControls() { ensure(this); return original.apply(this, arguments); });
  patch(PZ.propertyList.prototype, "toJSON", original => function propertiesWithControls() {
    const data = original.apply(this, arguments);
    if (states.has(this.parent) && this === this.parent.properties && !states.get(this.parent).list.length) delete data[STORAGE];
    return data;
  });
  return { ensure, snapshot, restore, add, rename, remove, move, label, sequenceOfList: list => lists.get(list), list: sequence => ensure(sequence).list,
    isControl: p => !!p?.definition?.zoidiumControlId, sequenceOf: p => lists.get(p?.parent),
    compatible: (p, c) => p?.definition?.type === c?.definition?.type || p?.definition?.type === 0 && c?.definition?.zoidiumControlKind === "Checkbox" };
}
module.exports = { createControlsStore, decode, KINDS, STORAGE };
