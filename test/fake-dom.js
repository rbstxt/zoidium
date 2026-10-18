"use strict";

// Minimal fake DOM for UI kit and node editor tests: real children, classes,
// dataset, attributes and listeners so builders and the graph renderer run
// without a browser. Event handlers fire through dispatch(type, event).

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.names = new Set();
  }
  add(...names) {
    for (const name of names) {
      if (name) this.names.add(name);
    }
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
    return this.names.has(name);
  }
  contains(name) {
    return this.names.has(name);
  }
  get value() {
    return Array.from(this.names).join(" ");
  }
}

function matchesClasses(node, selector) {
  return String(selector).split(",").map((part) => part.trim()).some((part) => {
    if (!/^\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(part)) return false;
    return part.slice(1).split(".").every((name) => node.classList.contains(name));
  });
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList(this);
    this.style = { setProperty() {} };
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._text = "";
    this.title = "";
    this.hidden = false;
    this.tabIndex = -1;
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.removed = false;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.clientLeft = 0;
    this.clientTop = 0;
  }
  get className() {
    return this.classList.value;
  }
  set className(value) {
    this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this._text;
  }
  set textContent(value) {
    this._text = value == null ? "" : String(value);
    if (this._text === "") {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }
  }
  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }
  get firstElementChild() {
    return this.children.length ? this.children[0] : null;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    const index = this.children.indexOf(ref);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parentElement = this;
    return child;
  }
  replaceChildren(...children) {
    this.textContent = "";
    children.forEach(child => this.appendChild(child));
  }
  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentElement = null;
    return child;
  }
  remove() {
    this.removed = true;
    if (this.parentElement) this.parentElement.removeChild(this);
  }
  setAttribute(key, value) {
    this.attributes[String(key)] = String(value);
    if (String(key) === "class") {
      this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }
  getAttribute(key) {
    return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
  }
  removeAttribute() {}
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((entry) => entry !== handler);
  }
  dispatch(type, event) {
    const merged = Object.assign({ type: type, target: this, preventDefault() {}, stopPropagation() {} }, event);
    for (const handler of (this.listeners[type] || []).slice()) handler(merged);
    return merged;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesClasses(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matchesClasses(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  matches(selector) {
    return matchesClasses(this, selector);
  }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  focus() {}
  blur() {}
  select() {}
  click() {
    this.dispatch("click", {});
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

function makeDocument() {
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  return {
    head: head,
    body: body,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
}

module.exports = { FakeElement, FakeClassList, makeDocument };
