"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const { FakeElement } = require("./fake-dom.js");

function setup() {
  const doc = { activeElement: null }, windows = [], events = new Map(), calls = [];
  class Element extends FakeElement { constructor(tag) { super(tag); this.ownerDocument = doc; } append(...items) { items.forEach(item => this.appendChild(item)); } }
  doc.createElement = tag => new Element(tag); doc.body = new Element("body");
  const theme = { id: "one", name: "Original", main: "#111111", overrides: {}, clips: {} };
  const palette = Object.fromEntries(["focus", "link", "clip", "clipSelected", "clipSelection"].map(key => [key, "#111111"]));
  const state = { selected: () => theme, openSession() {}, themes: () => [theme], selection: () => theme.id,
    name: () => theme.name, palette: () => palette, status: () => "", canUndo: () => true, canRedo: () => true,
    isDirty: () => false, rename: value => calls.push(["rename", value]), edit: (...args) => calls.push(["edit", ...args]),
    undo: () => calls.push(["undo"]), redo: () => calls.push(["redo"]) };
  const model = { PRESETS: [], color: value => value, labelColor: () => "#fff" };
  const view = { document: doc, ZoidiumUIBuilder: { themeModel: model, themeEditor: state, themeClips: { types: () => [] } },
    PZ: { ui: { colorPicker: class { constructor() { this.el = new Element("div"); } update() {} } } },
    addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); } };
  view.ZoidiumUI = { getWindow: () => null, openWindow(options) {
    const body = new Element("div"), footer = new Element("footer"), element = new Element("div");
    footer.querySelector = () => footer.children[0];
    const win = { body, element, footer, closed: false, close() { this.closed = true; }, setFooter() { footer.appendChild(new Element("button")); } };
    windows.push(win); win.cleanup = options.mount(body, win); return win;
  } };
  vm.runInNewContext(fs.readFileSync("zoidium/theme-editor.js", "utf8"), { window: view });
  const win = state.open();
  return { win, windows, calls, events, state };
}

test("theme rename and color fields leave composition untouched", () => {
  const { win, windows, calls } = setup();
  const toolbar = win.body.querySelector(".zoidium-theme-toolbar");
  toolbar.children.find(node => node.textContent === "Rename").click();
  const rename = windows[1], field = rename.body.children[0]; field.value = "New";
  const color = win.body.querySelector(".zoidium-theme-hex"); color.value = "#abcdef";
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    field.dispatch("keydown", { key: "Enter", ...composition });
    color.dispatch("keydown", { key: "Enter", ...composition });
    color.dispatch("keydown", { key: "Escape", ...composition });
    assert.equal(rename.closed, false); assert.equal(color.value, "#abcdef"); assert.deepEqual(calls, []);
  }
  field.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls, [["rename", "New"]]);
});

test("theme undo ignores composing and editable targets", () => {
  const { win, calls } = setup();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { tagName: "SELECT", closest: () => ({}) } }]) {
    win.element.dispatch("keydown", { key: "z", ctrlKey: true, target: win.element, ...extra });
    assert.deepEqual(calls, []);
  }
  win.element.dispatch("keydown", { key: "z", ctrlKey: true });
  assert.deepEqual(calls, [["undo"]]);
});

test("theme windows remove global listeners on every close", () => {
  const { win, events, state, windows } = setup();
  win.cleanup(); assert.equal(events.size, 0);
  for (let i = 0; i < 15; i++) {
    state.open(); const opened = windows.at(-1);
    assert.equal(events.size, 2);
    opened.cleanup(); assert.equal(events.size, 0);
    assert.equal((opened.element.listeners.keydown || []).length, 0);
  }
});
