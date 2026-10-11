"use strict";

// Shared confirm dialog: built on openWindow and the shared footer buttons.
// Exercises confirm/cancel/Escape/close paths, danger focus, Enter handling
// and the Promise + callback contract through a fake DOM.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const UI_KIT_SOURCE = fs.readFileSync(path.join(projectRoot, "zoidium", "ui-kit.js"), "utf8");

class FakeClassList {
  constructor() {
    this.names = new Set();
  }
  add(...names) {
    for (const name of names) this.names.add(name);
  }
  remove(...names) {
    for (const name of names) this.names.delete(name);
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.names.has(name)) this.names.delete(name);
      else this.names.add(name);
    } else if (force) this.names.add(name);
    else this.names.delete(name);
  }
  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this._className = "";
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.parent = null;
    this.textContent = "";
    this.title = "";
    this.hidden = false;
    this.tabIndex = -1;
    this.type = "";
    this.disabled = false;
    this.focused = false;
    this.removed = false;
    this.isConnected = true;
  }
  get className() {
    return this._className;
  }
  set className(value) {
    this._className = String(value || "");
    for (const name of this._className.split(/\s+/)) {
      if (name) this.classList.add(name);
    }
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }
  getAttribute(key) {
    return this.attributes[key];
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }
  remove() {
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }
  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((held) => held !== listener);
  }
  fire(type, event) {
    for (const listener of (this.listeners[type] || []).slice()) {
      listener.call(this, event || {});
    }
  }
  click() {
    this.fire("click", { preventDefault() {}, stopPropagation() {} });
  }
  focus() {
    this.focused = true;
  }
  blur() {}
  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child === target || (child.contains && child.contains(target)));
  }
  closest() {
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (selector === "button" && child.tagName === "BUTTON") found.push(child);
        if (selector === "p" && child.tagName === "P") found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function loadKit() {
  const document = {
    body: new FakeElement("body"),
    activeElement: null,
    head: new FakeElement("head"),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
  };
  const context = {
    document,
    console,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
  context.window = context;
  vm.runInNewContext(UI_KIT_SOURCE, context);
  return { api: context.ZoidiumUI, document };
}

function confirmWindow(document) {
  const layer = document.body.children[document.body.children.length - 1];
  const wins = (layer ? layer.children : []).filter(
    (child) => String(child.className).split(" ")[0] === "zoidium-window"
  );
  assert.equal(wins.length, 1, "expected one confirm window");
  return wins[0];
}

function footerButtons(win) {
  return win.querySelectorAll("button").filter((button) => button.textContent !== "");
}

test("ZoidiumUI.confirm is exposed and frozen", () => {
  const { api } = loadKit();
  assert.equal(typeof api.confirm, "function");
  assert.ok(Object.isFrozen(api));
});

test("confirm button resolves true and calls onConfirm", async () => {
  const { api, document } = loadKit();
  const calls = [];
  const promise = api.confirm({
    title: "Delete composition",
    message: 'Delete composition "Intro"?',
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    danger: true,
    onConfirm: () => calls.push("confirm"),
    onCancel: () => calls.push("cancel"),
  });
  assert.ok(promise && typeof promise.then === "function", "confirm returns a promise");
  const win = confirmWindow(document);
  const message = win.querySelectorAll("p")[0];
  assert.ok(message, "expected a message paragraph");
  assert.ok(message.classList.contains("zoidium-confirm-message"));
  assert.equal(message.textContent, 'Delete composition "Intro"?');
  const buttons = footerButtons(win);
  assert.deepEqual(buttons.map((button) => button.textContent), ["Cancel", "Delete"]);
  assert.ok(buttons[1].classList.contains("danger"), "danger confirm carries the danger variant");
  assert.equal(buttons[0].focused, true, "danger focuses the safe button");
  assert.equal(buttons[1].focused, false);
  buttons[1].click();
  assert.equal(await promise, true);
  assert.deepEqual(calls, ["confirm"]);
  assert.equal(win.removed, true);
});

test("cancel button resolves false and calls onCancel", async () => {
  const { api, document } = loadKit();
  const calls = [];
  const promise = api.confirm({
    title: "Save anyway?",
    message: "Save anyway?",
    confirmLabel: "Save anyway",
    onConfirm: () => calls.push("confirm"),
    onCancel: () => calls.push("cancel"),
  });
  const win = confirmWindow(document);
  const buttons = footerButtons(win);
  assert.ok(buttons[1].classList.contains("primary"), "plain confirm uses the primary variant");
  assert.equal(buttons[1].focused, true, "plain confirm focuses the confirm button");
  buttons[0].click();
  assert.equal(await promise, false);
  assert.deepEqual(calls, ["cancel"]);
});

test("closing the window resolves false", async () => {
  const { api, document } = loadKit();
  const promise = api.confirm({ message: "Delete this restore point?" });
  const win = confirmWindow(document);
  const registered = api.getWindow(win.dataset.windowId);
  assert.ok(registered, "confirm window is registered");
  registered.close();
  assert.equal(await promise, false);
});

test("Escape resolves false", async () => {
  const { api, document } = loadKit();
  const promise = api.confirm({ message: "Delete all restore points?" });
  const win = confirmWindow(document);
  win.fire("keydown", { key: "Escape", defaultPrevented: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(await promise, false);
  assert.equal(win.removed, true);
});

test("Enter confirms from the message body", async () => {
  const { api, document } = loadKit();
  const promise = api.confirm({ message: "Enable this plugin?" });
  const win = confirmWindow(document);
  const message = win.querySelectorAll("p")[0];
  win.fire("keydown", { key: "Enter", defaultPrevented: false, target: message, preventDefault() {}, stopPropagation() {} });
  assert.equal(await promise, true);
});

test("Enter on the focused cancel button leaves the choice to the button", async () => {
  const { api, document } = loadKit();
  const promise = api.confirm({ message: "Delete everything?", danger: true });
  const win = confirmWindow(document);
  const buttons = footerButtons(win);
  const cancel = buttons[0];
  // The keydown bubbles from the focused cancel button; the shared handler
  // leaves it to the button's own click, which cancels.
  win.fire("keydown", { key: "Enter", defaultPrevented: false, target: cancel, preventDefault() {}, stopPropagation() {} });
  cancel.click();
  assert.equal(await promise, false);
});
