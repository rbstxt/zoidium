"use strict";
const fs = require("node:fs"), vm = require("node:vm");
const { FakeElement } = require("./fake-dom");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { install } = require("../plugins/core/property-groups");
function document() {
  const doc = {};
  class Element extends FakeElement {
    constructor(tag) { super(tag); this.ownerDocument = doc; }
    appendChild(child) { child.remove(); return super.appendChild(child); }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    prepend(node) { node.remove(); super.insertBefore(node, this.firstElementChild); }
    after(node) { const parent = this.parentElement, next = this.nextElementSibling; node.remove(); parent.insertBefore(node, next); }
    get nextElementSibling() { const a = this.parentElement?.children || []; return a[a.indexOf(this) + 1] || null; }
    querySelectorAll(selector) {
      const found = [];
      const visit = el => { for (const child of el.children) {
        if (selector[0] === "." ? child.classList.contains(selector.slice(1)) : child.tagName === selector.toUpperCase()) found.push(child);
        visit(child);
      } };
      visit(this); return found;
    }
  }
  doc.createElement = tag => new Element(tag);
  doc.head = doc.createElement("head"); doc.body = doc.createElement("body");
  doc.getElementById = id => [doc.head, ...doc.head.querySelectorAll("style")].find(el => el.id === id);
  return doc;
}
function host() {
  const { PZ, context } = nativeHost();
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), context); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const doc = document(), tasks = [];
  class Edit {
    constructor(editor, options = {}) {
      this.editor = editor; this.options = options; this.onEnabledChanged = new PZ.observable();
      this.el = doc.createElement("div"); this.list = doc.createElement("ul"); this.el.append(this.list);
      this.item_drag = { addElts() {} };
    }
    set enabled(value) { this._enabled = value; this.onEnabledChanged.update(); }
    get enabled() { return this._enabled; }
    generateListItem(parent, object) {
      const row = parent.ownerDocument.createElement("li"); row.pz_object = object;
      row.append(doc.createElement("div"), doc.createElement("div")); parent.append(row);
      return row;
    }
    generateObjectList(row, list) {
      const el = row.ownerDocument.createElement("ul"); el.pz_object = list; row.after(el);
      el.pz_objectRemoved = () => {}; list.onObjectRemoved.watch(el.pz_objectRemoved);
      for (const object of list) this.generateListItem(el, object);
    }
    unloadListItem(row) {
      const next = row.nextElementSibling;
      if (next?.tagName === "UL") {
        for (const child of [...next.children]) this.unloadListItem(child);
        next.pz_object.onObjectRemoved.unwatch(next.pz_objectRemoved); next.remove();
      }
      row.remove();
    }
    objectsChanged() {
      for (const row of [...this.list.children]) this.unloadListItem(row);
      if (this.objects) {
        const row = this.generateListItem(this.list, {});
        this.generateObjectList(row, this.objects);
      }
    }
  }
  PZ.ui.edit = Edit;
  const api = install(PZ); PZ.zoidium = { propertyGroups: api };
  const root = new PZ.object(), owner = new PZ.object(); root.children = [owner]; owner.parent = root;
  const list = new PZ.objectList(owner, PZ.property); owner.children = [list]; owner.customProperties = list;
  for (let i = 0; i < 64; i++) { const p = PZ.property.create({ custom: true, dynamic: true, type: 0, value: .5 }); list.push(p); p.load(); }
  const editor = { project: { ui: { onChanged: { update() {} } }, addressLookup: address => address.reduce((node, key) => node.children ? node.children[key] : node[key], root) }, onProjectChanged: new PZ.observable() };
  editor.history = new PZ.ui.history(editor); editor.history.projectChanged();
  context.window = { PZ, queueMicrotask: fn => tasks.push(fn), addEventListener() {},
    setInterval() { throw Error("Unexpected interval"); }, setTimeout() { throw Error("Unexpected timer"); } };
  vm.runInContext(fs.readFileSync("plugins/core/property-groups-ui.js", "utf8"), context);
  const flush = () => { while (tasks.length) tasks.shift()(); };
  const panel = (objects = list) => { const view = new Edit(editor); view.enabled = true; view.objects = objects; view.objectsChanged(); return view; };
  return { PZ, api, editor, list, root, panel, flush, tasks, doc };
}
module.exports = { host, document };
