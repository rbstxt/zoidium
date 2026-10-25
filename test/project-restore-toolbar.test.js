"use strict";

// The project-name field must survive CM3 toolbar rebuilds without a
// forever body-wide observer and without stacking name-changed listeners.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function readSource(relative) {
  return fs.readFileSync(path.join(projectRoot, relative), "utf8");
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  tokens() {
    return new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
  }

  add(...names) {
    const values = this.tokens();
    names.forEach((name) => values.add(name));
    this.element.className = Array.from(values).join(" ");
  }

  contains(name) {
    return this.tokens().has(name);
  }
}

function matchToken(element, token) {
  if (token.startsWith("#")) return element.id === token.slice(1);
  if (token.startsWith(".")) return element.classList.contains(token.slice(1));
  return element.tagName === token.toUpperCase();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parent = null;
    this.id = "";
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.title = "";
    this.value = "";
    this.type = "";
    this.name = "";
    this.disabled = false;
  }

  get parentElement() {
    return this.parent;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    if (child.parent) child.remove();
    this.children.push(child);
    child.parent = this;
    return child;
  }

  insertBefore(child, before) {
    if (child.parent) child.remove();
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  insertAdjacentHTML(position, markup) {
    if (position !== "beforeend") throw new Error(`unsupported position: ${position}`);
    const holder = parseMarkup(String(markup));
    for (const child of holder.children.slice()) this.appendChild(child);
  }

  matchesSelector(selector) {
    const tokens = String(selector).split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    if (!matchToken(this, tokens[tokens.length - 1])) return false;
    let ancestor = this.parent;
    for (let index = tokens.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchToken(ancestor, tokens[index])) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matchesSelector(selector)) found.push(child);
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

function parseMarkup(markup) {
  const holder = new FakeElement("div");
  const stack = [holder];
  const token = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^">])*)>|([^<]+)/g;
  let match;
  while ((match = token.exec(markup)) !== null) {
    if (match[3] !== undefined) {
      const text = match[3].trim();
      if (text) stack[stack.length - 1].textContent += text;
      continue;
    }
    const closing = match[0].startsWith("</");
    const tag = match[1].toLowerCase();
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const element = new FakeElement(tag);
    const classMatch = /class="([^"]*)"/.exec(match[2] || "");
    if (classMatch) {
      classMatch[1].split(/\s+/).filter(Boolean).forEach((name) => element.classList.add(name));
    }
    stack[stack.length - 1].appendChild(element);
    if (!match[0].endsWith("/>")) stack.push(element);
  }
  return holder;
}

function loadToolbarHarness() {
  const created = [];
  const globalListeners = {};
  const documentListeners = {};
  const observers = [];
  const menubarTabs = [];
  const intervals = [];
  let toolbarParent = new FakeElement("div");
  toolbarParent.id = "controls";

  const body = new FakeElement("body");
  body.appendChild(toolbarParent);

  function makeToolbar() {
    const toolbar = new FakeElement("div");
    toolbar.classList.add("toolbarpanel");
    toolbar.appendChild(new FakeElement("button"));
    toolbar.appendChild(new FakeElement("button"));
    return toolbar;
  }

  let toolbar = makeToolbar();
  toolbarParent.appendChild(toolbar);

  const documentObject = {
    body,
    activeElement: null,
    createElement(tag) {
      const element = new FakeElement(tag);
      created.push(element);
      return element;
    },
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
    addEventListener(type, listener) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(listener);
    },
  };

  const editor = { project: { id: "project-1" }, confirmIfDirty: () => true };
  const projectFiles = {
    displayNameForUi: (name) => (name && String(name).trim()) || "project",
    getProjectName: () => "project",
    setProjectName: (target, value) => String(value || "project"),
    setRawProjectName: () => {},
    getProjectRevision: () => 0,
  };

  const headerLabel = new FakeElement("div");
  headerLabel.classList.add("proplabel");

  const sandbox = {
    crypto: require("node:crypto").webcrypto,
    PZ: { zoidium: { projectFiles } },
    CM: editor,
    document: documentObject,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    ZoidiumUI: {
      createButton: () => new FakeElement("button"),
      createPageHeader: () => {
        const header = new FakeElement("div");
        header.appendChild(headerLabel);
        return header;
      },
      controls: { note: () => ({ element: new FakeElement("p") }) },
      createMenubarTab: (options) => {
        menubarTabs.push(options);
        return options;
      },
      confirm: async () => true,
    },
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.options = null;
        observers.push(this);
      }

      observe(target, options) {
        this.target = target;
        this.options = options;
      }

      disconnect() {
        this.target = null;
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = (init && init.detail) || {};
      }
    },
    Event: class Event {
      constructor(type, init) {
        this.type = type;
        this.bubbles = Boolean(init && init.bubbles);
      }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: () => {},
    addEventListener: (type, listener) => {
      if (!globalListeners[type]) globalListeners[type] = [];
      globalListeners[type].push(listener);
    },
    dispatchEvent: () => true,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const relative of [
    "zoidium/project-restore-store.js",
    "zoidium/project-restore-snapshots.js",
    "zoidium/project-restore-toasts.js",
    "zoidium/project-restore.js",
  ]) {
    vm.runInContext(readSource(relative), sandbox, { filename: relative });
  }

  function fireObserver(index = 0) {
    observers[index].callback();
  }

  function fireGlobal(type, event) {
    for (const listener of globalListeners[type] || []) listener(event);
  }

  function countCreated(tag) {
    return created.filter((element) => element.tagName === tag.toUpperCase()).length;
  }

  function fieldInput() {
    return documentObject.querySelector(".zoidium-project-name input");
  }

  return {
    sandbox, editor, projectFiles, menubarTabs, observers, globalListeners,
    documentObject, fireObserver, fireGlobal, countCreated, fieldInput,
    get toolbar() {
      return toolbar;
    },
    get toolbarParent() {
      return toolbarParent;
    },
    rebuildToolbar() {
      toolbar.remove();
      toolbar = makeToolbar();
      toolbarParent.appendChild(toolbar);
      return toolbar;
    },
    replaceToolbarParent() {
      const wrapper = new FakeElement("div");
      wrapper.id = "controls";
      toolbar.remove();
      wrapper.appendChild(toolbar);
      body.appendChild(wrapper);
      toolbarParent.remove();
      toolbarParent = wrapper;
      return wrapper;
    },
  };
}

test("the project-name field installs once and survives toolbar rebuilds", () => {
  const harness = loadToolbarHarness();
  assert.equal(harness.globalListeners["zoidium:project-name-changed"].length, 1);

  // One observer watches the document body, so re-parented toolbars are seen.
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].target, harness.documentObject.body);
  assert.equal(harness.observers[0].options.childList, true);
  assert.equal(harness.observers[0].options.subtree, true);

  const input = harness.fieldInput();
  assert.ok(input, "expected the project-name input to be installed");
  assert.equal(input.value, "project");

  // Steady-state mutations do not rebuild the field.
  const labels = harness.countCreated("label");
  harness.fireObserver();
  harness.fireObserver();
  harness.fireObserver();
  assert.equal(harness.countCreated("label"), labels);
  assert.equal(harness.fieldInput(), input, "expected the same input element to survive");
  assert.equal(harness.globalListeners["zoidium:project-name-changed"].length, 1);

  // A rebuilt toolbar gets the field back without another listener.
  harness.rebuildToolbar();
  assert.equal(harness.fieldInput(), null);
  harness.fireObserver();
  const rebuilt = harness.fieldInput();
  assert.ok(rebuilt, "expected the field to be reinstalled after a rebuild");
  assert.equal(harness.globalListeners["zoidium:project-name-changed"].length, 1);

  // A replaced parent is still inside the observed body and installs the field.
  harness.replaceToolbarParent();
  harness.rebuildToolbar();
  harness.fireObserver();
  assert.ok(harness.fieldInput(), "expected the field after the parent was replaced");
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.globalListeners["zoidium:project-name-changed"].length, 1);
});

test("the single name-changed listener resolves the input at event time", () => {
  const harness = loadToolbarHarness();
  const input = harness.fieldInput();
  harness.fireGlobal("zoidium:project-name-changed", {
    detail: { editor: harness.editor, name: "  renamed  " },
  });
  assert.equal(input.value, "renamed");
  assert.equal(input.title, "renamed");

  harness.documentObject.activeElement = input;
  harness.fireGlobal("zoidium:project-name-changed", {
    detail: { editor: harness.editor, name: "while editing" },
  });
  assert.equal(input.value, "renamed", "expected the focused input to keep its text");
  harness.documentObject.activeElement = null;

  harness.fireGlobal("zoidium:project-name-changed", {
    detail: { editor: {}, name: "other editor" },
  });
  assert.equal(input.value, "renamed", "expected events from other editors to be ignored");

  harness.rebuildToolbar();
  harness.fireObserver();
  harness.fireGlobal("zoidium:project-name-changed", {
    detail: { editor: harness.editor, name: "after rebuild" },
  });
  assert.equal(harness.fieldInput().value, "after rebuild");
});

test("the restore panel keeps its header when the static markup is appended", () => {
  const harness = loadToolbarHarness();
  const panel = harness.menubarTabs[0].panel;
  assert.ok(panel, "expected the Restore panel to be created");
  assert.ok(
    panel.firstElementChild.classList.contains("zoidium-restore-header"),
    "expected the header to stay first",
  );
  assert.ok(panel.querySelector(".zoidium-restore-list"), "expected the static markup to be appended");
});
