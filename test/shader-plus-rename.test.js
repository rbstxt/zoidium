"use strict";
// Shader+ Rename when: display-only row labels driven by another property's
// value. Rules share the Visible when condition syntax and storage style.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { FakeElement } = require("./fake-dom");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { KINDS } = require("../plugins/shader-plus/kinds");
const { parseConditions, formatConditions } = require("../plugins/shader-plus/visibility");
const { renamed, rulesOf } = require("../plugins/shader-plus/rename");
const { installEditor } = require("../plugins/shader-plus/editor");

function controller(values) {
  return { get: frame => typeof values === "function" ? values(frame) : values[frame] };
}
const pick = map => name => ({ get: () => map[name] });

test("rename rules use the first match and fall back to the original name", () => {
  const rules = [
    { property: "Mode", name: "Scale", values: [3] },
    { property: "Mode", name: "Spin", values: [3, 4] },
  ];
  assert.equal(renamed(rules, pick({ Mode: 3 }), 0, "Rotation"), "Scale");
  assert.equal(renamed(rules, pick({ Mode: 4 }), 0, "Rotation"), "Spin");
  assert.equal(renamed(rules, pick({ Mode: 5 }), 0, "Rotation"), "Rotation");
  assert.equal(renamed(rules, () => null, 0, "Rotation"), "Rotation", "a missing controller never matches");
  assert.equal(renamed([], pick({ Mode: 3 }), 0, "Rotation"), "Rotation");
  assert.equal(renamed(undefined, pick({ Mode: 3 }), 0, "Rotation"), "Rotation");
});

test("rename rules skip a missing controller and continue to the next rule", () => {
  const rules = [{ property: "Gone", name: "Missing", values: [1] }, { property: "Mode", name: "Shown", values: [1] }];
  assert.equal(renamed(rules, pick({ Mode: 1 }), 0, "Value"), "Shown");
});

test("rename follows an animated controller at the current frame", () => {
  const rules = [{ property: "Mode", name: "Scale", conditions: [{ op: ">=", value: 5 }] }];
  const animated = controller(frame => frame < 10 ? 2 : 7);
  assert.equal(renamed(rules, name => name === "Mode" ? animated : null, 0, "Rotation"), "Rotation");
  assert.equal(renamed(rules, name => name === "Mode" ? animated : null, 10, "Rotation"), "Scale");
  assert.equal(renamed(rules, name => name === "Mode" ? animated : null, 20, "Rotation"), "Scale");
});

test("rename conditions round-trip through the shared parser and JSON", () => {
  const rule = { property: "Mode", name: "Scale", ...parseConditions("> 5.5; 1..3; = 4; off") };
  assert.deepEqual(parseConditions(formatConditions(rule)), { values: rule.values, conditions: rule.conditions });
  assert.deepEqual(JSON.parse(JSON.stringify([rule])), [rule]);
  assert.deepEqual(rulesOf([rule]), [rule]);
  const malformed = [null, 3, {}, { property: "Mode" }, { property: "", name: "X", values: [1] },
    { property: "Mode", name: "", values: [1] }, { property: "Mode", name: "X" }];
  assert.deepEqual(rulesOf(malformed), []);
  assert.equal(renamed(malformed, pick({ Mode: 1 }), 0, "Rotation"), "Rotation");
});

class Element extends FakeElement {
  get value() { return this._value || ""; }
  set value(value) { this._value = String(value ?? ""); }
  get lastElementChild() { return this.children.at(-1); }
  get selectedIndex() { return this.children.findIndex(c => c.value === this.value); }
  set selectedIndex(index) { this.value = this.children[index]?.value || ""; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  insertBefore(child, ref) { child.parentElement?.removeChild(child); return super.insertBefore(child, ref); }
  after(node) { this.parentElement.insertBefore(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
}

function setup(definition, controllers = []) {
  const { PZ, context: realm } = nativeHost();
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), realm); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const History = PZ.ui.history;
  PZ.ui = { ...PZ.ui, objectTypes: new Map([[PZ.property, []]]), edit: class {}, properties: class {} };
  const editor = { project: { forEachItemOfType() {}, ui: { onChanged: { update() {} } } },
    history: { operation: null, startOperation() {}, pushCommand() {}, finishOperation() {}, discardOperation() {} } };
  const context = { PZ, editor, document: { createElement: tag => new Element(tag) }, window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } };
  editor.onProjectChanged = new PZ.observable();
  editor.history = new History(editor); editor.history.projectChanged();
  const api = installEditor({ context, patch() {}, presetFont: () => null });
  const effect = Object.create(PZ.effect.shader.prototype); effect.customProperties = new PZ.objectList(effect, PZ.property);
  const p = PZ.property.create(definition); effect.customProperties.push(p); p.load(); p.properties.name.set("Rotation"); p.getAddress = () => [0];
  for (const record of controllers) {
    const q = PZ.property.create(record.definition); effect.customProperties.push(q); q.load(); q.properties.name.set(record.name);
    if (record.value !== undefined) q.set(record.value, 0);
  }
  editor.project.addressLookup = () => p;
  const parent = new Element("ul"), row = new Element("li"); row.append(new Element("div")); parent.append(row);
  api.settings(row, p);
  const panel = parent.lastElementChild;
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const find = label => all(panel).find(node => node.getAttribute("aria-label") === label);
  const submit = () => all(panel).find(node => node.textContent === "Apply").onclick();
  const error = () => all(panel).find(node => node.classList.contains("zsp-settings-error")).textContent;
  const apply = () => { submit(); assert.equal(error(), ""); };
  return { PZ, p, api, editor, find, apply, submit, error, effect };
}

test("the settings panel stores several rename rules and undoes them in one step", () => {
  const { PZ, p, find, apply, editor } = setup(KINDS.slider.create(), [
    { name: "Mode", definition: KINDS.dropdown.create(), value: 1 },
    { name: "Level", definition: KINDS.slider.create(), value: 1 },
  ]);
  const name = p.properties.name.get(), value = p.get(0), keys = JSON.stringify(p.keyframes), before = JSON.stringify(p);
  find("Add rename rule").onclick();
  find("Rule property 1").value = "Mode"; find("Rule values 1").value = "1; 2"; find("Rule name 1").value = "Scale";
  find("Add rename rule").onclick();
  find("Rule property 2").value = "Level"; find("Rule values 2").value = "> 5"; find("Rule name 2").value = "Spin";
  apply();
  assert.deepEqual(p.definition.zoidiumShader.renameWhen, [
    { property: "Mode", name: "Scale", values: [1, 2] },
    { property: "Level", name: "Spin", values: [], conditions: [{ op: ">", value: 5 }] },
  ]);
  assert.equal(p.properties.name.get(), name, "the property name never changes");
  assert.equal(p.get(0), value); assert.equal(JSON.stringify(p.keyframes), keys);
  const after = JSON.stringify(p);
  editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  for (let i = 0; i < 2; i++) { const data = JSON.parse(after), q = PZ.property.create(data.type); q.load(data); assert.equal(JSON.stringify(q), after); }
});

test("rename rules reorder and remove from top to bottom", () => {
  const definition = KINDS.slider.create();
  definition.zoidiumShader = { renameWhen: [
    { property: "Mode", name: "Scale", values: [0] },
    { property: "Mode", name: "Spin", values: [1] },
    { property: "Mode", name: "Squash", values: [2] },
  ] };
  const { p, find, apply, PZ } = setup(definition, [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  assert.deepEqual(find("Rule property 2").children.map(option => option.value), ["", "Mode"]);
  find("Move up rule 3").onclick(); apply();
  assert.deepEqual(p.definition.zoidiumShader.renameWhen.map(rule => rule.name), ["Scale", "Squash", "Spin"]);
  const saved = JSON.parse(JSON.stringify(p));
  const reopened = setup(saved.type, [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  reopened.find("Remove rule 1").onclick(); reopened.apply();
  assert.deepEqual(reopened.p.definition.zoidiumShader.renameWhen.map(rule => rule.name), ["Squash", "Spin"]);
  reopened.find("Remove rule 2").onclick(); reopened.apply();
  assert.deepEqual(reopened.p.definition.zoidiumShader.renameWhen.map(rule => rule.name), ["Squash"]);
});

test("an incomplete rename rule keeps the panel open and writes no history", () => {
  const { p, find, submit, error, editor } = setup(KINDS.slider.create(), [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  const before = JSON.stringify(p);
  find("Add rename rule").onclick();
  find("Rule property 1").value = "Mode"; find("Rule name 1").value = "Scale"; submit();
  assert.match(error(), /Enter the values that rename this property/);
  find("Rule values 1").value = "1"; find("Rule name 1").value = ""; submit();
  assert.match(error(), /Enter the name to show/);
  assert.equal(JSON.stringify(p), before); assert.equal(editor.history.undoStack.length, 0);
});

test("an old shader without renameWhen loads unchanged and keeps its own name", () => {
  const definition = KINDS.slider.create();
  definition.zoidiumShader = { visibleWhen: { property: "Mode", values: [1] } };
  const { p, find, apply } = setup(definition, [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  const before = JSON.stringify(p);
  assert.equal(rulesOf(p.definition.zoidiumShader.renameWhen).length, 0);
  apply(); assert.equal(JSON.stringify(p), before);
  assert.equal(p.definition.zoidiumShader.renameWhen, undefined);
});

test("moving and duplicating a property keeps its rename rules", () => {
  const { host } = require("./property-groups-ui-harness");
  const h = host(), { PZ, list, editor, doc, api } = h;
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  editor.playback = { currentFrame: 0 };
  PZ.ui.objectTypes = new Map([[PZ.property, []]]);
  PZ.ui.edit.prototype.generateItemCommands = function () {};
  PZ.ui.edit.prototype.generateButton = () => doc.createElement("button");
  const installed = installEditor({ context: { PZ, editor, document: doc, ui: { openMenu() {} },
    window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } },
    patch: (holder, key, make) => { holder[key] = make(holder[key]); }, presetFont: () => null });
  const property = (name, kind) => {
    const p = PZ.property.create(KINDS[kind].create()); list.push(p); p.load(); p.properties.name.set(name); return p;
  };
  const target = property("Amount", "slider");
  property("Level", "slider");
  target.definition.zoidiumShader = { ...target.definition.zoidiumShader, renameWhen: [{ property: "Level", name: "Scale", values: [1] }] };
  const rules = JSON.parse(JSON.stringify(target.definition.zoidiumShader.renameWhen));
  const view = h.panel(); view.options.showPropertyControls = true; view.objects = list; view.objectsChanged(); h.flush();
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const moveTo = (p, group) => {
    const parent = doc.createElement("ul"), item = doc.createElement("li");
    item.append(doc.createElement("div")); parent.append(item);
    installed.settings(item, p);
    const panel = parent.lastElementChild;
    const find = label => all(panel).find(node => node.getAttribute("aria-label") === label);
    find("Group").value = group;
    all(panel).find(node => node.textContent === "Apply").onclick();
    return panel;
  };
  moveTo(target, "Controls");
  assert.equal(api.name(target), "Controls");
  assert.deepEqual(target.definition.zoidiumShader.renameWhen, rules);
  moveTo(target, "");
  assert.equal(api.name(target), "");
  assert.deepEqual(target.definition.zoidiumShader.renameWhen, rules);
  const data = JSON.parse(JSON.stringify(target)), copy = PZ.property.create(data.type); copy.load(data);
  assert.deepEqual(copy.definition.zoidiumShader.renameWhen, rules);
});

test("row labels follow the first matching rule and return to the property name", () => {
  const { host } = require("./property-groups-ui-harness");
  const h = host(), { PZ, list, editor, doc } = h;
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  editor.playback = { currentFrame: 0 };
  PZ.ui.objectTypes = new Map([[PZ.property, []]]);
  PZ.ui.edit.prototype.generateItemCommands = function () {};
  PZ.ui.edit.prototype.generateButton = () => doc.createElement("button");
  const installed = installEditor({ context: { PZ, editor, document: doc, ui: { openMenu() {} },
    window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } },
    patch: (holder, key, make) => { holder[key] = make(holder[key]); }, presetFont: () => null });
  const property = (name, definition) => {
    const p = PZ.property.create(definition); list.push(p); p.load(); p.properties.name.set(name); return p;
  };
  const level = property("Level", KINDS.slider.create()), target = property("Rotation", KINDS.slider.create());
  target.definition.zoidiumShader = { ...target.definition.zoidiumShader, renameWhen: [
    { property: "Level", name: "Scale", values: [3] },
    { property: "Level", name: "Spin", conditions: [{ op: ">", value: 5 }] },
  ] };
  const view = h.panel(); view.options.showPropertyControls = true; view.objects = list; view.objectsChanged(); h.flush();
  const rows = view.el.querySelectorAll("li").filter(row => row.pz_object?.parent === list);
  for (const entry of rows) Object.defineProperty(entry, "isConnected", { value: true });
  const row = rows.find(entry => entry.pz_object === target);
  const button = doc.createElement("button"), label = doc.createElement("span");
  button.innerText = "collapse"; row.firstElementChild.append(button, label);
  level.set(0, 0); installed.sync();
  assert.equal(button.innerText, "collapse");
  assert.equal(label.innerText, "Rotation");
  level.set(3, 0); installed.sync();
  assert.equal(label.innerText, "Scale", "the first matching rule wins");
  level.set(9, 0); installed.sync();
  assert.equal(label.innerText, "Spin");
  const deleted = target.definition.zoidiumShader.renameWhen;
  target.definition.zoidiumShader = { ...target.definition.zoidiumShader, renameWhen: [{ property: "Gone", name: "Missing", values: [1] }] };
  installed.sync(); assert.equal(label.innerText, "Rotation", "a missing controller shows the property name");
  target.definition.zoidiumShader.renameWhen = deleted;
  level.set(3, 0); installed.sync(); assert.equal(label.innerText, "Scale");
  assert.equal(target.properties.name.get(), "Rotation", "the property name is unchanged");
});

test("settings text tolerates malformed stored conditions", () => {
  const { formatConditions } = require("../plugins/shader-plus/visibility.js");
  assert.equal(formatConditions({ values: 3, conditions: [null, { op: ">", value: 2 }] }), "> 2");
  assert.equal(formatConditions({ values: ["a", 1] }), "a; 1");
  assert.equal(formatConditions(null), "");
});

test("rename conditions follow a static dropdown index", () => {
  const mode = { definition: KINDS.staticDropdown.create(), get: () => "1" };
  const rule = { property: "Mode", name: "Scale", ...parseConditions("1") };
  assert.equal(renamed([rule], () => mode, 0, "Rotation"), "Scale");
});
