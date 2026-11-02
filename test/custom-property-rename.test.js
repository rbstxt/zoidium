"use strict";

// Right-click rename for custom properties: CM3 starts its inline rename
// editor from a row's own contextmenu handler (PZ.ui.edit.prototype.renameClick
// in ui-1.0.72.js), which wraps one propertyOps.setValue in
// startOperation/finishOperation (one undo step). Zoidium replaces that
// handler in two places, so both menus must offer the same editor instead:
// Graph Editor 2's shared row menu (selection-host.js, document capture phase)
// and the Expressions+ direct row menu for linkable dynamic properties
// (controls-ui.js linkMenu). The fake panels below mirror the native
// renameClick contract so the tests pin the wiring: choosing Rename delegates
// to the owning panel's renameClick exactly once with the right-clicked row.

const test = require("node:test");
const assert = require("node:assert/strict");
const { installControlsUI } = require("../plugins/expressions-plus/controls-ui");
const installSelection = require("../plugins/graph-plus/selection-host");

function fakeName(value, readOnly = false) {
  let current = value;
  return {
    definition: { readOnly },
    get: () => current,
    getAddress: () => ["properties", "name"],
    set: next => { current = next; },
  };
}

// Mirrors CM3's renameClick: one history operation around the name write.
// When PZ is given, the panel also passes as an edit panel (rowAt requires
// panel instanceof PZ.ui.edit with showPropertyControls).
function fakePanel(PZ, editor) {
  const panel = {
    calls: [],
    history: [],
    renameClick({ currentTarget }) {
      panel.calls.push(currentTarget);
      panel.history.push("startOperation");
      currentTarget.pz_object.properties.name.set("Renamed");
      panel.history.push("finishOperation");
    },
  };
  if (PZ?.ui?.edit) {
    Object.setPrototypeOf(panel, PZ.ui.edit.prototype);
    panel.options = { showPropertyControls: true };
    panel.editor = editor;
  }
  return panel;
}

function fakeRow(pzObject, panel) {
  const classes = new Set();
  return {
    tagName: "LI",
    pz_object: pzObject,
    isConnected: true,
    ownerDocument: null,
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => { classes.delete(name); },
      toggle: (name, force) => {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
    closest: selector => (selector === ".editorpanel" ? { pz_panel: panel } : null),
    querySelector: () => null,
    focus() {},
  };
}

function dynamicProperty(PZ, value = "Property", readOnly = false) {
  return Object.assign(new PZ.property.dynamic.keyframes(), {
    definition: { type: 0 },
    properties: { name: fakeName(value, readOnly) },
  });
}

function installSharedMenu() {
  class Dynamic {}
  Dynamic.keyframes = class extends Dynamic {};
  Dynamic.group = class extends Dynamic {};
  const PZ = { property: { dynamic: Dynamic }, ui: { edit: class Edit { generateListItem() {} } } };
  const listeners = {};
  let received = null;
  const kit = { openMenu: options => { received = options; return { close() {} }; } };
  const doc = {
    defaultView: { ZoidiumUI: kit },
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: () => {},
  };
  let opened = false;
  const editor = {};
  const handle = installSelection({ PZ, editor, document: doc, open: () => { opened = true; return null; } });
  return {
    PZ,
    editor,
    items: () => received.items,
    fire(row) {
      const target = {
        closest: selector => {
          if (selector === ".g2-editor") return null;
          if (selector === ".g2-property-label") return null;
          if (selector === "li, .kftrack") return row;
          return null;
        },
      };
      listeners.contextmenu({ target, preventDefault() {}, stopPropagation() {}, ctrlKey: false, clientX: 5, clientY: 6 });
    },
    wasOpenCalled: () => opened,
    dispose: () => handle.dispose(),
  };
}

test("shared row menu offers Rename for a custom property row", () => {
  const menu = installSharedMenu();
  const panel = fakePanel(menu.PZ, menu.editor);
  const property = dynamicProperty(menu.PZ);
  const row = fakeRow(property, panel);
  menu.fire(row);
  try {
    assert.deepEqual(menu.items().filter(item => item.label).map(item => item.label), ["Rename…", "Show in Graph Editor"]);
    assert.equal(menu.items()[1].shortcut, "Alt+Shift+G");
    menu.items()[0].action();
    assert.deepEqual(panel.calls, [row], "Rename delegates to the panel renameClick with the right-clicked row");
    assert.deepEqual(panel.history, ["startOperation", "finishOperation"], "rename commits in one history step");
    assert.equal(property.properties.name.get(), "Renamed");
  } finally {
    menu.dispose();
  }
});

test("shared row menu keeps Show in Graph Editor and hides Rename for read-only names", () => {
  const menu = installSharedMenu();
  const panel = fakePanel(menu.PZ, menu.editor);
  const row = fakeRow(dynamicProperty(menu.PZ, "Property", true), panel);
  menu.fire(row);
  try {
    assert.deepEqual(menu.items().filter(item => item.label).map(item => item.label), ["Show in Graph Editor"]);
    menu.items()[0].action();
    assert.equal(menu.wasOpenCalled(), true, "Show in Graph Editor still opens the graph");
    assert.deepEqual(panel.calls, [], "no rename editor starts for a read-only name");
  } finally {
    menu.dispose();
  }
});

function installLinkMenu({ isControl = false, readOnly = false } = {}) {
  class Dynamic {}
  const PZ = { property: { dynamic: Dynamic }, sequence: class {}, ui: { edit: class Edit {
    generatePropertyList() {}
    generateListItem(parent, target) {
      const row = fakeRow(target, panel);
      row.oncontextmenu = "native-rename";
      return row;
    }
  } } };
  const panel = fakePanel();
  let received = null;
  const context = {
    PZ,
    editor: {},
    document: {},
    window: {},
    ui: { openMenu: options => { received = options; }, notify: () => {} },
    lifecycle: { onDispose() {} },
  };
  const target = isControl
    ? Object.assign(new Dynamic(), { controlName: "Amount", definition: { zoidiumControlId: "c1" } })
    : Object.assign(new Dynamic(), { definition: { type: 0 }, properties: { name: fakeName("Property", readOnly) } });
  const store = {
    sequenceOfList: () => null,
    isControl: () => isControl,
    sequenceOf: () => ({}),
    list: () => (isControl ? [target] : []),
    compatible: () => false,
    label: item => item.controlName,
  };
  installControlsUI({ context, store, patch: (holder, key, wrap) => { holder[key] = wrap(holder[key]); } });
  const view = { options: { showPropertyControls: true } };
  const generate = target => PZ.ui.edit.prototype.generateListItem.call(view, null, target);
  const row = generate(target);
  return { row, panel, generate, items: () => received.items };
}

test("link menu offers Rename for a renameable dynamic property row", () => {
  const { row, panel, items } = installLinkMenu();
  row.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 });
  assert.deepEqual(items().filter(item => item.label).map(item => item.label), ["Rename…", "Link to control…"]);
  assert.equal(items()[1].disabled, true, "Link to control stays disabled without compatible controls");
  items()[0].action();
  assert.deepEqual(panel.calls, [row]);
  assert.deepEqual(panel.history, ["startOperation", "finishOperation"]);
  assert.equal(row.pz_object.properties.name.get(), "Renamed");
});

test("object and effect rows keep the native rename handler", () => {
  const { generate } = installLinkMenu();
  for (const target of [{ properties: { name: fakeName("Group") } }, { properties: { name: fakeName("Blur") } }]) {
    const row = generate(target);
    assert.equal(row.oncontextmenu, "native-rename", "non-property rows are not intercepted");
  }
  const readOnly = installLinkMenu({ readOnly: true });
  readOnly.row.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 });
  assert.deepEqual(readOnly.items().filter(item => item.label).map(item => item.label), ["Link to control…"]);
});

test("control rows keep their own Rename item", () => {
  const { row, items } = installLinkMenu({ isControl: true });
  row.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 });
  const labels = items().filter(item => item.label).map(item => item.label);
  assert.equal(labels[0], "Rename…");
  assert.ok(labels.includes("Remove control"), "control items are unchanged: " + labels.join(", "));
  assert.equal(labels.filter(label => label === "Rename…").length, 1, "no duplicate Rename item");
});

test("shared row menu leaves Rename to Expressions+ for control rows", () => {
  const menu = installSharedMenu();
  const panel = fakePanel(menu.PZ, menu.editor);
  // Real controls are keyframes or group properties with a name, so they reach the shared menu.
  const control = Object.assign(dynamicProperty(menu.PZ, "Amount"), { definition: { type: 0, zoidiumControlId: "c1" } });
  menu.fire(fakeRow(control, panel));
  try {
    assert.deepEqual(menu.items().filter(item => item.label).map(item => item.label), ["Show in Graph Editor"]);
  } finally {
    menu.dispose();
  }
});
