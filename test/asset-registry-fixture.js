"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(options = {}) {
  class Observable {
    constructor() { this.listeners = new Set(); }
    watch(fn) { this.listeners.add(fn); }
    unwatch(fn) { this.listeners.delete(fn); }
    update(...args) { for (const fn of Array.from(this.listeners)) fn(...args); }
  }
  const addresses = new Map(); let next = 0;
  class Obj {
    constructor(name) { this.children = []; this.parent = null; if (name) this.properties = { name: { value: name } }; }
    getAddress() { const key = String(++next); addresses.set(key, this); return [key]; }
    traverse(fn) { fn(this); for (const child of this.children) child.traverse?.(fn); }
  }
  class PropertyList {
    constructor() { Object.defineProperty(this, "onListChanged", { value: new Observable() }); }
    traverse(fn) { for (const child of Object.values(this)) child?.traverse?.(fn); }
  }
  class Property extends Obj {
    constructor(name, value, type = 8, assetType) {
      super(); this.definition = { name, type, assetType }; this.value = value;
      this.onChanged = new Observable(); this.onKeyframeChanged = new Observable();
      this.onKeyframeCreated = new Observable(); this.onKeyframeDeleted = new Observable();
    }
    get() { return this.value; }
    set(value) { this.value = value; this.onChanged.update(); }
  }
  class Clip extends Obj {}
  class Effect extends Obj {}
  const PZ = { property: { type: { ASSET: 8 } }, propertyList: PropertyList, clip: Clip, effect: Effect,
    asset: { source: { FILE: 1, PRESET: 3 }, type: { IMAGE: 0, FONT: 1, GEOMETRY: 2, SHADER: 4 },
      image: class {}, font: class {}, geometry: class {}, lut: class {}, shader: class {} } };
  const project = { assets: { list: {}, onAssetCreated: new Observable(), onAssetRemoved: new Observable(),
    load() { throw new Error("Collection loaded an asset"); }, unload() { throw new Error("Collection unloaded an asset"); } },
    sequence: new Obj(), media: [], ui: { onChanged: new Observable() }, addressLookup(address) { return addresses.get(address[0]); } };
  project.sequence.parent = project;
  project.sequence.traverse = Obj.prototype.traverse;
  const editor = { project, onProjectChanged: new Observable(), onSequenceChanged: new Observable() };
  const raf = new Map(), events = new Map(); let timer = 0;
  const sandbox = { PZ, CM: editor, TextEncoder, TextDecoder, Blob, URL, AbortController, setTimeout, clearTimeout, console,
    location: { href: "http://localhost/", origin: "http://localhost" },
    requestAnimationFrame(fn) { const id = ++timer; raf.set(id, fn); return id; }, cancelAnimationFrame(id) { raf.delete(id); },
    addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); },
    ...options.globals };
  options.setup?.({ PZ, project, editor, sandbox });
  vm.createContext(sandbox);
  for (const name of ["walk", "status", "reveal", "fetch", "decode", "consumers", "actions", ...(options.edits ? ["retention", "edits", "replace"] : []), ""]) {
    const file = name === "retention" ? "asset-retention.js" : "asset-registry" + (name ? "-" + name : "") + ".js";
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/core", file), "utf8"), sandbox);
  }
  const api = sandbox.ZoidiumAssets;
  function child(parent, node) { parent.children.push(node); node.parent = parent; return node; }
  function properties(owner, definitions) {
    const list = new PropertyList(); Object.defineProperty(list, "parent", { value: owner, writable: true });
    const previousName = owner.properties?.name?.value;
    owner.properties = list; child(owner, list);
    if (previousName) { list.name = new Property("Name", previousName, 7); list.name.parent = list; }
    for (const [key, prop] of Object.entries(definitions)) { list[key] = prop; prop.parent = list; }
    return list;
  }
  function category(list, key, definitions) {
    const group = new PropertyList(); Object.defineProperty(group, "parent", { value: list }); list[key] = group;
    for (const [key, prop] of Object.entries(definitions)) { group[key] = prop; prop.parent = group; }
    return group;
  }
  function asset(key, options = {}) {
    return project.assets.list[key] = { key, filename: key + ".png", source: 1, size: 12,
      file: { size: 12, type: "image/png" }, url: "blob:" + key, data: new Map(), ...options };
  }
  function adapter(plugin) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins", plugin, "asset-references.js"), "utf8"), { module, TextEncoder });
    const cleanups = [];
    module.exports.activate({ PZ, window: sandbox, apis: { assets: api }, lifecycle: { onDispose(fn) { cleanups.push(fn); } } });
    return () => cleanups.forEach(fn => fn());
  }
  function flush() { const pending = Array.from(raf.values()); raf.clear(); pending.forEach(fn => fn()); }
  return { api, PZ, project, editor, sandbox, raf, events, Obj, Clip, Effect, Property, PropertyList,
    child, properties, category, asset, adapter, flush };
}
module.exports = { fixture };
