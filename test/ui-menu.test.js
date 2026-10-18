"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const { FakeElement } = require("./fake-dom");

function surface() {
  const doc = new FakeElement("document"), view = new FakeElement("window");
  view.innerWidth = 400; view.innerHeight = 300; view.document = doc;
  doc.head = new FakeElement("head"); doc.body = new FakeElement("body");
  doc.documentElement = new FakeElement("html"); doc.documentElement.isConnected = true;
  doc.defaultView = view;
  doc.createElement = tag => {
    const el = new FakeElement(tag);
    el.ownerDocument = doc;
    el.focus = () => { doc.activeElement = el; };
    el.getBoundingClientRect = () => ({ width: 210, height: 120 });
    Object.defineProperty(el, "lastElementChild", { get: () => el.children.at(-1) });
    return el;
  };
  const observers = [], resizers = [];
  view.MutationObserver = class {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  };
  view.ResizeObserver = class {
    constructor(fn) { this.fn = fn; resizers.push(this); }
    observe(target) { this.target = target; } disconnect() { this.disconnected = true; }
  };
  return { doc, view, observers, resizers };
}
function load() {
  const s = surface();
  vm.runInNewContext(fs.readFileSync("zoidium/ui-kit-menus.js", "utf8"), { window: s.view });
  s.api = s.view.ZoidiumUIBuilder.menus;
  return s;
}
const item = label => ({ label, action() {} });
const rows = handle => handle.element.querySelectorAll(".zui-menu-item");
const key = (handle, value, extra) => handle.element.dispatch("keydown", { key: value, ...extra });

test("pointer and anchor placement flip using measured size and clamp at every edge", () => {
  const { api, doc } = load();
  let m = api.openMenu({ x: 395, y: 295, items: [item("One")] });
  assert.equal(m.element.style.left, "185px"); assert.equal(m.element.style.top, "175px");
  m = api.openMenu({ x: -30, y: -100, items: [item("One")] });
  assert.equal(m.element.style.left, "4px"); assert.equal(m.element.style.top, "4px");
  const anchor = doc.createElement("button");
  anchor.getBoundingClientRect = () => ({ left: 350, right: 380, top: 260, bottom: 285 });
  m = api.openMenu({ anchor, items: [item("One")] });
  assert.equal(m.element.style.left, "170px"); assert.equal(m.element.style.top, "138px");
  m.close(); assert.equal(doc.activeElement, anchor);
});

test("keyboard wraps, skips disabled items, roves focus, activates and restores focus", () => {
  const { api, doc } = load(); let runs = 0;
  const owner = doc.createElement("canvas"); doc.activeElement = owner;
  const m = api.openMenu({ items: [{ label: "Disabled", disabled: true }, item("First"),
    { separator: true }, { title: "Section" }, { label: "Last", action: () => runs++ }] });
  const r = rows(m);
  assert.equal(doc.activeElement, r[1]); assert.deepEqual(r.map(row => row.tabIndex), [-1, 0, -1]);
  key(m, "ArrowDown"); assert.equal(doc.activeElement, r[2]);
  key(m, "ArrowDown"); assert.equal(doc.activeElement, r[1]);
  key(m, "End"); assert.equal(doc.activeElement, r[2]);
  key(m, "Home"); assert.equal(doc.activeElement, r[1]);
  key(m, "Tab", { shiftKey: true }); assert.equal(doc.activeElement, r[2]);
  key(m, "Tab"); assert.equal(doc.activeElement, r[1]);
  key(m, "ArrowUp"); key(m, " ");
  assert.equal(runs, 1); assert.equal(m.isOpen(), false); assert.equal(doc.activeElement, owner);
});

test("disabled items cannot highlight or run; hints, swatches, checks, titles and separators survive", () => {
  const { api } = load(); let runs = 0;
  const m = api.openMenu({ title: "Tools", items: [{ separator: true },
    { label: "Off", disabled: true, action: () => runs++ },
    { label: "Red", hint: "A hint", color: "#b53838", checked: true, shortcut: "R", action: () => runs++ },
    { separator: true }] });
  const r = rows(m);
  r[0].dispatch("pointermove"); r[0].click(); assert.equal(runs, 0); assert.equal(m.isOpen(), true);
  assert.equal(r[0].getAttribute("aria-disabled"), "true");
  assert.equal(r[1].title, "A hint"); assert.equal(r[1].getAttribute("role"), "menuitemcheckbox");
  assert.equal(r[1].getAttribute("aria-checked"), "true");
  assert.equal(r[1].querySelector(".zui-menu-swatch").style.background, "#b53838");
  assert.equal(m.element.querySelectorAll(".zui-menu-separator").length, 0);
  key(m, "Enter"); assert.equal(runs, 1);
});

test("single-open is global across documents and cooperates with the searchable menu", () => {
  const { api } = load(), popup = surface();
  const first = api.openMenu({ items: [item("Main")] });
  const second = api.openMenu({ document: popup.doc, items: [item("Popup")] });
  assert.equal(first.isOpen(), false);
  assert.equal(second.element.ownerDocument, popup.doc);
  assert.equal(popup.doc.body.children[0], second.element);
  let closedSearch = 0;
  const release = api.claim(() => closedSearch++);
  assert.equal(second.isOpen(), false);
  api.openMenu({ items: [item("Another")] }); release();
  assert.equal(closedSearch, 1);
});

test("outside pointer, Esc, blur, pagehide, host scroll/resize, abort and owner disposal close and remove listeners", () => {
  for (const path of ["outside", "escape", "blur", "pagehide", "scroll", "resize", "abort", "owner", "close"]) {
    const { api, doc, view, observers } = load();
    const owner = doc.createElement("section"); owner.isConnected = true;
    const controller = new AbortController(); let closes = 0;
    const m = api.openMenu({ owner, signal: controller.signal, items: [item("One")], onClose: () => closes++ });
    if (path === "outside") doc.dispatch("pointerdown", { target: doc.body });
    if (path === "escape") key(m, "Escape");
    if (["blur", "pagehide", "resize"].includes(path)) view.dispatch(path);
    if (path === "scroll") {
      doc.dispatch("scroll", { target: m.element }); assert.equal(m.isOpen(), true);
      doc.dispatch("scroll", { target: owner });
    }
    if (path === "abort") controller.abort();
    if (path === "owner") { owner.isConnected = false; observers[0].fn(); }
    if (path === "close") m.close();
    m.close(); assert.equal(m.isOpen(), false, path); assert.equal(closes, 1, path);
    assert.equal(doc.body.children.length, 0, path);
    assert.ok(Object.values(view.listeners).every(list => !list.length), path);
    assert.ok(Object.values(doc.listeners).every(list => !list.length), path);
    assert.ok(observers.every(observer => observer.disconnected), path);
  }
});

test("Shape+ forwards its full menu contract to the kit", () => {
  const { api, doc } = load();
  const owner = doc.createElement("canvas");
  const adapter = require("../plugins/shape-plus/editor-menu.js").createMenu(doc, owner, api);
  adapter.open(20, 30, [{ label: "Group", shortcut: "Ctrl+G", action() {} }], { title: "Shape+", focusReturn: owner });
  assert.equal(adapter.element.querySelector(".zui-menu-key").textContent, "Ctrl+G");
  assert.equal(adapter.element.querySelector(".zui-menu-title").textContent, "Shape+");
  adapter.close(); assert.equal(adapter.element, null);
});

test("migrated callers delegate to the shared menu and cannot reintroduce literal menu chrome", () => {
  for (const file of ["plugins/shape-plus/editor-menu.js", "plugins/core/centered-layout.js", "plugins/asset-manager/assets-window.js", "zoidium/ui-kit-menus.js"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /openMenu/);
    assert.doesNotMatch(source, /#[\da-f]{3,8}\b|rgba?\(\s*\d/i, file);
  }
  const tabs = fs.readFileSync("plugins/core/centered-layout.js", "utf8");
  for (const text of ["Move to top", "Move up", "Move down", "Move to bottom", "Move to right sidebar", "Move to left sidebar"]) assert.ok(tabs.includes(text));
  const assets = fs.readFileSync("plugins/asset-manager/assets-window.js", "utf8");
  for (const text of ["command.hint", "command.color", "command.enabled", "parts.uses", "owner: parts.root"]) assert.ok(assets.includes(text));
  const css = fs.readFileSync("plugins/asset-manager/assets.css", "utf8");
  assert.doesNotMatch(css, /zam-(context-menu|usage-menu|usage-entry)/);
});

test("centered sidebar caller keeps every move action and its remember behavior", () => {
  const src = fs.readFileSync("plugins/core/centered-layout.js", "utf8");
  const start = src.indexOf("  var menu = null;"), end = src.indexOf("  function installStyle()", start);
  const calls = []; let saved = 0, opened;
  const tab = { pz_tab: {} }, left = { panels: [1, 2] }, right = { panels: [3] };
  const sandbox = {
    left, right, global: { ZoidiumUI: { openMenu: options => { opened = options; return { close() {} }; } } },
    tabsOf: () => [tab, {}], remember: () => saved++,
    moveToEnd: (...args) => { calls.push(["end", ...args]); return true; },
    shift: (...args) => { calls.push(["shift", ...args]); return true; },
    transfer: (...args) => { calls.push(["transfer", ...args]); return true; },
  };
  vm.runInNewContext(src.slice(start, end) + "\nthis.open = openMenu;", sandbox);
  sandbox.open(50, 80, tab, left);
  assert.equal(opened.owner, tab); assert.equal(opened.items.length, 6);
  assert.equal(opened.items[0].disabled, true); assert.equal(opened.items[2].disabled, false);
  opened.items[2].action(); opened.items[5].action();
  assert.equal(saved, 2); assert.equal(calls[0][0], "shift");
  assert.deepEqual(calls[1], ["transfer", tab.pz_tab, left, right, true]);
});

test("Assets caller forwards anchored project commands, hints and content swatches", () => {
  const src = fs.readFileSync("plugins/asset-manager/assets-window.js", "utf8");
  const start = src.indexOf("  function closeContextMenu()"), end = src.indexOf("  function labelEntries", start);
  let opened, ran = 0;
  const root = {}, doc = {}, anchor = {};
  const sandbox = { contextMenu: null, doc, parts: { root }, session: { kit: {
    openMenu: options => { opened = options; return { close() { options.onClose(); } }; },
  } } };
  vm.runInNewContext(src.slice(start, end) + "\nthis.show = showMenu;", sandbox);
  sandbox.show([{ label: "Red", color: "#b53838", hint: "Label the item", enabled: false, run: () => ran++ }], { anchor });
  assert.equal(opened.anchor, anchor); assert.equal(opened.owner, root); assert.equal(opened.document, doc);
  const row = opened.items[0];
  assert.equal(row.hint, "Label the item"); assert.equal(row.color, "#b53838"); assert.equal(row.disabled, true);
  row.action(); assert.equal(ran, 1);
  opened.onClose(); assert.equal(sandbox.contextMenu, null);
});

test("resize dismissal observes the host panel, allowing ordinary owner text to finish loading", () => {
  const { api, doc, resizers } = load();
  const owner = doc.createElement("div");
  let menu = api.openMenu({ owner, items: [item("Popup")] });
  assert.equal(resizers.length, 0, "a text owner's font metrics are not a host resize");
  menu.close();
  const host = doc.createElement("div"); host.className = "zoidium-window"; host.appendChild(owner);
  let width = 400;
  host.getBoundingClientRect = () => ({ width, height: 300 });
  menu = api.openMenu({ owner, items: [item("Window")] });
  assert.equal(resizers[0].target, host);
  resizers[0].fn(); assert.equal(menu.isOpen(), true, "initial observation does not dismiss");
  width = 420; resizers[0].fn(); assert.equal(menu.isOpen(), false);
  assert.equal(resizers[0].disconnected, true);
});
