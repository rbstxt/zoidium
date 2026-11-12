"use strict";
// Group Visible when (B33): a property group carries the same condition
// fields as a single property. A row shows only when its own condition AND
// its group's condition pass; a hidden group hides its heading and children,
// and Show hidden reveals them. Storage is per-member group metadata, so
// save/load, JSON copy, and undo/redo behave like other group settings.
const test = require("node:test"), assert = require("node:assert/strict");
const { host } = require("./property-groups-ui-harness");
const { installEditor } = require("../plugins/shader-plus/editor");
const { parseConditions } = require("../plugins/shader-plus/visibility");
const { KINDS } = require("../plugins/shader-plus/kinds");

function sliders(PZ, list, names) {
  return names.map(name => {
    const p = PZ.property.create(KINDS.slider.create());
    list.push(p); p.load(); p.properties.name.set(name); return p;
  });
}
function setup() {
  const h = host(), { PZ, list, editor, doc, api } = h;
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  editor.playback = { currentFrame: 0 };
  PZ.ui.objectTypes = new Map([[PZ.property, []]]);
  PZ.ui.edit.prototype.generateItemCommands = function () {};
  PZ.ui.edit.prototype.generateButton = () => doc.createElement("button");
  const menus = [];
  const installed = installEditor({ context: { PZ, editor, document: doc, ui: { openMenu(payload) { menus.push(payload); } },
    window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } },
    patch: (holder, key, make) => { holder[key] = make(holder[key]); }, presetFont: () => null });
  const [controller, b, c] = sliders(PZ, list, ["Level", "Amount", "Mix"]);
  api.setGroup(editor, [b, c], "Controls");
  const view = h.panel();
  view.options.showPropertyControls = true;
  view.objects = list; view.objectsChanged(); h.flush();
  const rows = view.el.querySelectorAll("li").filter(row => row.pz_object?.parent === list);
  for (const row of rows) Object.defineProperty(row, "isConnected", { value: true });
  const byName = name => rows.find(row => row.pz_object.properties.name.get() === name);
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const openGroupSettings = name => {
    installed.groupSettings(byName(name), Array.from(list).find(p => p.properties.name.get() === name));
    return view.el.querySelectorAll("div").find(el => el.getAttribute("aria-label") === "Group settings");
  };
  const find = (panel, label) => all(panel).find(node => node.getAttribute("aria-label") === label);
  const submit = panel => all(panel).find(node => node.textContent === "Apply").onclick();
  const error = panel => all(panel).find(node => node.classList.contains("zsp-settings-error")).textContent;
  const headings = () => view.el.querySelectorAll(".zpg-heading");
  const heading = () => headings().find(el => el.zpg?.name === "Controls");
  return { ...h, api, installed, editor, view, rows, byName, openGroupSettings, find, submit, error, headings, heading, menus, controller, b, c };
}

test("Group settings stores one condition on every member with undo and redo", () => {
  const { PZ, api, editor, list, find, submit, error, openGroupSettings, b, c } = setup();
  const panel = openGroupSettings("Amount");
  assert.ok(panel, "a grouped row opens Group settings");
  const options = find(panel, "Visible when").children.map(o => o.value);
  assert.ok(options.includes(""), "Always is offered");
  assert.ok(options.includes("Level"), "ungrouped properties can control a group");
  assert.ok(!options.includes("Amount") && !options.includes("Mix"), "grouped properties cannot control their own group");
  find(panel, "Visible when").value = "Level";
  find(panel, "Visible when").dispatch("change", {});
  find(panel, "Has value").value = "> 5; 1..3";
  submit(panel); assert.equal(error(panel), "");
  for (const p of [b, c]) assert.deepEqual(api.meta(p).visibleWhen, { property: "Level", values: [], conditions: [{ op: ">", value: 5 }, { op: "range", min: 1, max: 3 }] });
  const after = JSON.stringify(list);
  editor.history.undo();
  for (const p of [b, c]) assert.equal(api.meta(p).visibleWhen, undefined);
  editor.history.redo(); assert.equal(JSON.stringify(list), after);
  for (const saved of JSON.parse(after)) { const q = PZ.property.create(saved.type); q.load(saved); assert.equal(JSON.stringify(q), JSON.stringify(saved)); }
});

test("a hidden group hides its rows and heading; Show hidden reveals them", () => {
  const { installed, controller, byName, openGroupSettings, find, submit, heading } = setup();
  const panel = openGroupSettings("Amount");
  find(panel, "Visible when").value = "Level";
  find(panel, "Visible when").dispatch("change", {});
  find(panel, "Has value").value = "> 5"; submit(panel);
  controller.set(0, 0); installed.sync();
  assert.equal(byName("Amount").hidden, true);
  assert.equal(byName("Mix").hidden, true);
  assert.equal(byName("Level").hidden, false, "the ungrouped controller stays visible");
  assert.equal(heading().style.display, "none", "the heading hides with its group");
  controller.set(10, 0); installed.sync();
  assert.equal(byName("Amount").hidden, false);
  assert.equal(byName("Mix").hidden, false);
  assert.equal(heading().style.display, "", "the heading returns with its group");
});

test("Show hidden reveals group-hidden rows but keeps the group collapse state", () => {
  const { installed, editor, list, controller, byName, openGroupSettings, find, submit, heading, view } = setup();
  const panel = openGroupSettings("Mix");
  find(panel, "Visible when").value = "Level";
  find(panel, "Visible when").dispatch("change", {});
  find(panel, "Has value").value = "> 5"; submit(panel);
  const steps = editor.history.undoStack.length;
  controller.set(0, 0); installed.sync();
  const commandsRow = view.list.firstElementChild;
  view.generateItemCommands(commandsRow, list);
  const button = commandsRow.children[1].firstElementChild;
  button.onclick({ stopPropagation() {} });
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(byName("Amount").hidden, false);
  assert.equal(byName("Mix").hidden, false);
  assert.equal(heading().style.display, "", "the heading is revealed too");
  assert.ok(byName("Amount").classList.contains("zsp-hidden-property"), "revealed rows stay dimmed");
  button.onclick({ stopPropagation() {} });
  assert.equal(byName("Amount").hidden, true);
  assert.equal(heading().style.display, "none");
  assert.equal(editor.history.undoStack.length, steps, "revealing writes no history");
});

test("a row needs both its own condition and its group's condition", () => {
  const { installed, controller, b, byName, openGroupSettings, find, submit, heading } = setup();
  const panel = openGroupSettings("Amount");
  find(panel, "Visible when").value = "Level";
  find(panel, "Visible when").dispatch("change", {});
  find(panel, "Has value").value = "> 5"; submit(panel);
  b.definition.zoidiumShader = { ...b.definition.zoidiumShader, visibleWhen: parseConditions("= 999") };
  controller.set(10, 0); installed.sync();
  assert.equal(byName("Amount").hidden, true, "a failing row condition hides the row");
  assert.equal(byName("Mix").hidden, false);
  assert.equal(heading().style.display, "", "the heading stays while a member passes");
  controller.set(0, 0); installed.sync();
  assert.equal(byName("Mix").hidden, true, "a failing group condition hides passing rows");
  assert.equal(heading().style.display, "none");
});

test("projects without a group condition keep every row and heading visible", () => {
  const { installed, byName, heading } = setup();
  installed.sync();
  for (const name of ["Level", "Amount", "Mix"]) assert.equal(byName(name).hidden, false);
  assert.equal(heading().style.display, "", "old projects look exactly as before");
});

test("the context menu offers Group settings only for grouped rows", () => {
  const { byName, menus } = setup();
  byName("Amount").oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
  byName("Level").oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
  assert.deepEqual(menus.map(menu => menu.items.some(item => item.label === "Group settings…")), [true, false]);
});

test("moving a property between groups takes the target group's condition, or none", () => {
  const { api, installed, doc, openGroupSettings, find, submit, b, c, list } = setup();
  const panel = openGroupSettings("Amount");
  find(panel, "Visible when").value = "Level";
  find(panel, "Visible when").dispatch("change", {});
  find(panel, "Has value").value = "> 5"; submit(panel);
  const condition = api.meta(b).visibleWhen;
  assert.ok(condition);
  const moveTo = (p, group) => {
    const parent = doc.createElement("ul"), row = doc.createElement("li");
    row.append(doc.createElement("div")); parent.append(row);
    installed.settings(row, p);
    const settings = parent.lastElementChild;
    find(settings, "Group").value = group;
    submit(settings);
  };
  moveTo(c, "");
  assert.equal(c.definition.zoidiumPropertyGroup?.visibleWhen, undefined, "ungrouping drops the old group's condition");
  assert.deepEqual(api.meta(b).visibleWhen, condition, "the remaining member keeps it");
  moveTo(c, "Controls");
  assert.deepEqual(c.definition.zoidiumPropertyGroup.visibleWhen, condition, "rejoining adopts the group's condition");
  assert.ok(Array.from(list).includes(c));
});
