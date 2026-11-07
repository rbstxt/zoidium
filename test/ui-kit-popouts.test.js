"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { FakeElement } = require("./fake-dom");
function surface() {
  const view = new FakeElement("window"), doc = new FakeElement("document");
  view.document = doc; doc.defaultView = view;
  view.innerWidth = 640; view.innerHeight = 400; view.screenX = -900; view.screenY = 30;
  doc.baseURI = "http://localhost:1234/index.html";
  doc.createElement = tag => {
    const el = new FakeElement(tag); el.ownerDocument = doc;
    el.style.cssText = "left:12px;width:600px";
    el.getBoundingClientRect = () => ({ width: 600, height: 400 });
    const append = el.appendChild;
    el.appendChild = function (child) {
      const adopt = node => { node.ownerDocument = this.ownerDocument; node.children.forEach(adopt); };
      if (child.parentElement) child.parentElement.removeChild(child);
      adopt(child); return append.call(this, child);
    };
    return el;
  };
  doc.head = doc.createElement("head"); doc.body = doc.createElement("body"); doc.documentElement = doc.createElement("html");
  const frames = new Map(); let id = 0;
  view.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  view.cancelAnimationFrame = key => frames.delete(key);
  view.frames = frames;
  view.Event = view.CustomEvent = class { constructor(type) { this.type = type; } };
  view.dispatchEvent = event => view.dispatch(event.type, event);
  view.focus = () => { view.focused = true; };
  view.close = () => { view.closed = true; view.dispatch("pagehide"); };
  view.MutationObserver = class { observe() {} disconnect() { this.disconnected = true; } };
  return view;
}
function load() {
  const main = surface(), notices = [], storage = new Map();
  main.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  main.ZoidiumUIBuilder = { notify: notice => notices.push(notice) };
  vm.runInNewContext(fs.readFileSync("zoidium/ui-kit-popouts.js", "utf8"), { window: main });
  return { main, api: main.ZoidiumUIBuilder.popouts, notices, storage };
}
function windowFixture(s) {
  const root = s.main.document.createElement("section"), layer = s.main.document.body;
  root.setAttribute("aria-label", "Editor"); layer.appendChild(root);
  root.dispatchEvent = () => {};
  const cleanups = [], button = s.main.document.createElement("button");
  const win = { element: root, id: "editor:1", isOpen: () => true, focus() {}, _clamp() {}, setTitle() {}, addCleanup: fn => cleanups.push(fn) };
  s.api.attach(win, { persistKey: "editor" }, layer, button);
  return { win, root, button, cleanups };
}
const count = view => Object.values(view.listeners).reduce((n, list) => n + list.length, 0);

test("environment migrates document listeners and pending animation frames, then disposes both", () => {
  const s = load(), popup = surface(), root = s.main.document.createElement("div"), events = [];
  const env = s.api.environment(root);
  const release = env.listen("document", "pointerup", () => events.push("up"));
  env.onHostChange(view => events.push(view === popup ? "popup" : "main"));
  const request = env.requestAnimationFrame(() => events.push("frame"));
  assert.equal(s.main.frames.size, 1);
  popup.document.body.appendChild(root); env.refresh();
  assert.equal(env.document, popup.document); assert.equal(env.window, popup);
  assert.equal(s.main.frames.size, 0); assert.equal(popup.frames.size, 1);
  s.main.document.dispatch("pointerup"); assert.deepEqual(events, ["popup"]);
  popup.document.dispatch("pointerup"); assert.deepEqual(events, ["popup", "up"]);
  release(); popup.document.dispatch("pointerup"); assert.equal(events.length, 2);
  env.cancelAnimationFrame(request); assert.equal(popup.frames.size, 0);
  env.dispose(); assert.equal(count(popup.document), 0);
});

test("a blocked popup leaves the live editor and listeners in the main document", () => {
  const s = load(), { win, root, cleanups } = windowFixture(s);
  s.main.open = () => null;
  assert.equal(win.popOut(), false); assert.equal(win.isPoppedOut(), false);
  assert.equal(root.parentElement, s.main.document.body);
  assert.equal(s.notices[0].title, "Popup blocked");
  cleanups.forEach(fn => fn()); assert.equal(count(s.main), 0);
});

test("popup close returns the same node with floating geometry and popup bounds retained", () => {
  const s = load(), popup = surface(), { win, root, button, cleanups } = windowFixture(s);
  let requested;
  s.main.open = (...args) => { requested = args; return popup; };
  const original = root.style.cssText;
  assert.equal(win.popOut(), true); assert.equal(win.document, popup.document);
  assert.equal(root.parentElement, popup.document.body); assert.equal(button.title, "Return to editor");
  assert.equal(requested[0], "about:blank");
  popup.close();
  assert.equal(win.isPoppedOut(), false); assert.equal(root.parentElement, s.main.document.body);
  assert.equal(root.style.cssText, original); assert.equal(button.title, "Pop out");
  assert.equal(JSON.parse(s.storage.get("zoidium.ui.popup.editor")).left, -900);
  cleanups.forEach(fn => fn()); assert.equal(count(s.main), 0); assert.equal(count(popup), 0);
});

test("repeated pop out and return keeps listener counts flat and closes children on teardown", () => {
  const s = load(), { win, root, cleanups } = windowFixture(s), popups = [];
  s.main.open = () => { const popup = surface(); popups.push(popup); return popup; };
  const initial = count(s.main);
  for (let n = 0; n < 20; n++) {
    win.popOut(); win.returnToMain();
    assert.equal(count(s.main), initial); assert.equal(count(popups.at(-1)), 0);
    assert.equal(s.main.document.body.children.filter(node => node === root).length, 1);
  }
  win.popOut(); cleanups.reverse().forEach(fn => fn());
  assert.equal(popups.at(-1).closed, true); assert.equal(count(s.main), 0);
});

test("style synchronization changes link attributes only when their values change", () => {
  const s = load(), popup = surface(), source = s.main.document.createElement("link"), writes = {};
  source.rel = "stylesheet"; source.href = "http://localhost:1234/theme.css";
  source.media = "screen"; source.disabled = false;
  s.main.document.head.querySelectorAll = () => [source];
  let synchronize;
  s.main.MutationObserver = class { constructor(callback) { synchronize = callback; } observe() {} disconnect() {} };
  const create = popup.document.createElement;
  popup.document.createElement = tag => {
    const node = create(tag);
    Object.defineProperty(node, "nextSibling", { get() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) + 1] || null;
    } });
    if (tag === "link") for (const [key, initial] of Object.entries({ rel: "", href: "", media: "", disabled: false })) {
      let value = initial; writes[key] = 0;
      Object.defineProperty(node, key, { get: () => value, set(next) { writes[key]++; value = next; } });
    }
    return node;
  };
  s.main.open = () => popup;
  const { win, cleanups } = windowFixture(s);
  win.popOut();
  const first = { ...writes };
  for (let i = 0; i < 50; i++) synchronize();
  assert.deepEqual(writes, first, "theme mutations cannot restart already loaded stylesheets");
  source.href = "http://localhost:1234/next.css"; synchronize();
  assert.equal(writes.href, first.href + 1);
  source.disabled = true; synchronize(); assert.equal(writes.disabled, 1);
  cleanups.reverse().forEach(fn => fn());
});
