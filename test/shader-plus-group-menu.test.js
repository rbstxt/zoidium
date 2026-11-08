"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host } = require("./property-groups-ui-harness");
const { installGroupMenu } = require("../plugins/shader-plus/group-menu");
function setup() {
  const h = host(), { PZ, list, editor, doc, api } = h;
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  PZ.ui.objectTypes = new Map([[list.type, [{ name: "Number" }]]]);
  PZ.ui.edit.prototype.generateAdd = function (subject) {
    const picker = doc.createElement("div"), cancel = doc.createElement("button"); cancel.click = () => picker.remove(); picker.append(cancel);
    for (const entry of PZ.ui.objectTypes.get(subject.type)) { const row = doc.createElement("li"); row.pz_item = entry; picker.append(row); }
    this.el.append(picker); Object.defineProperty(this.el, "lastElementChild", { configurable: true, get() { return this.children.at(-1); } });
  };
  installGroupMenu({ context: { PZ, editor, document: doc, lifecycle: { onDispose() {} } }, patch: (holder, key, make) => { holder[key] = make(holder[key]); } });
  const view = h.panel(), rows = view.el.querySelectorAll("li").filter(row => row.pz_object?.parent === list);
  view.list.firstElementChild.pz_object = list;
  const open = () => { view.generateAdd(list); const entry = view.el.lastElementChild.querySelectorAll("li").find(row => row.pz_item.name === "Group"); assert.ok(entry); entry.onclick({ stopPropagation() {} }); return view.el.querySelectorAll("div").find(row => row.getAttribute("aria-label") === "Create property group"); };
  return { ...h, view, rows, open, api };
}
test("the searchable Group action moves only selected same-list properties in one reversible operation", () => {
  const { PZ, api, editor, list, rows, open } = setup();
  const before = JSON.stringify(list); rows[0].classList.add("selected"); rows[2].classList.add("selected");
  const form = open(); form.querySelectorAll("input")[0].value = "Controls"; form.querySelectorAll("button").find(b => b.textContent === "Apply").onclick();
  assert.equal(api.name(list[0]), "Controls"); assert.equal(api.name(list[2]), "Controls"); assert.equal(api.name(list[1]), "");
  assert.equal(editor.history.undoStack.length, 1); const after = JSON.stringify(list);
  editor.history.undo(); assert.equal(JSON.stringify(list), before); editor.history.redo(); assert.equal(JSON.stringify(list), after);
  for (const saved of JSON.parse(after)) { const p = PZ.property.create(saved.type); p.load(saved); assert.equal(JSON.stringify(p), JSON.stringify(saved)); }
  assert.equal(PZ.ui.objectTypes.get(list.type).some(entry => entry.name === "Group"), false, "native menus outside Shader stay unchanged");
});
test("Group rejects an empty selection and locked source groups without partial edits", () => {
  const { api, editor, list, rows, open } = setup();
  let form = open(); form.querySelectorAll("input")[0].value = "Controls"; form.querySelectorAll("button").find(b => b.textContent === "Apply").onclick();
  assert.match(form.querySelectorAll("div").find(d => d.getAttribute("role") === "status").textContent, /Select property rows/);
  form.querySelectorAll("button").find(b => b.textContent === "Cancel").onclick();
  api.setGroup(editor, list[0], "Locked"); api.settings(editor, list, "Locked", { name: "Locked", locked: true });
  rows[0].classList.add("selected"); rows[1].classList.add("selected"); const before = JSON.stringify(list), count = editor.history.undoStack.length;
  form = open(); form.querySelectorAll("input")[0].value = "Controls"; form.querySelectorAll("button").find(b => b.textContent === "Apply").onclick();
  assert.match(form.querySelectorAll("div").find(d => d.getAttribute("role") === "status").textContent, /Unlock/);
  assert.equal(JSON.stringify(list), before); assert.equal(editor.history.undoStack.length, count);
});
