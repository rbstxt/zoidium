"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.attributes = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name) || this.className.split(" ").includes(name),
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] = this.listeners[name] || []).push(callback); }
  click() { (this.listeners.click || []).slice().forEach((callback) => callback()); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1))) return child;
      if (selector.startsWith("[") && Object.entries(child.attributes).some(([key, value]) => selector === `[${key}="${value}"]`)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function loadToasts() {
  const body = new Element("body");
  const created = [];
  const delays = [];
  const window = {
    document: { body, createElement: (tag) => new Element(tag) },
    ZoidiumUI: { createButton: (config) => {
      created.push(config);
      const button = new Element("button");
      if (config && config.title) button.textContent = config.title;
      if (config && typeof config.onClick === "function") button.addEventListener("click", config.onClick);
      return button;
    } },
    __zoidiumRestoreParts: { store: { state: {} } },
    setTimeout: (callback, ms) => { delays.push(ms); return 0; },
    clearTimeout() {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../zoidium/project-restore-toasts.js"), "utf8");
  vm.runInNewContext(source, { window });
  return { toasts: window.__zoidiumRestoreParts.toasts, body, created, delays };
}

test("error toasts point to the rescue tool first and then to Discord bug reports", () => {
  const { toasts, body } = loadToasts();
  toasts.showProjectError({ message: "Nothing was saved." });
  const help = body.children[0].querySelector(".zoidium-project-toast-help");
  assert.equal(help.hidden, false);
  const links = help.children.filter((child) => child.tagName === "A");
  assert.deepEqual(links.map((link) => [link.textContent, link.href, link.target, link.rel]), [
    ["Try the rescue tool", "/about/rescue", "_blank", "opener"],
    ["Report the bug on Discord", "https://discord.gg/PWAmY9m5bu", "_blank", "noopener noreferrer"],
  ]);
  assert.match(help.children.map((child) => child.textContent).join(""), /^Can't save or restore\? Try the rescue tool\. Still stuck\? Report the bug on Discord\.$/);

  toasts.showToast({ title: "Saved." });
  assert.equal(help.hidden, true, "success toasts carry no help line");
});

test("multi-action toasts render one button per action in order", () => {
  const { toasts, body, created } = loadToasts();
  toasts.showToast({ title: "Frame rate changed.", actions: [
    { label: "Undo", run() {} },
    { label: "Just this project", run() {} },
    { label: "Make 60 fps default", run() {}, primary: true },
  ] });
  const bar = body.children[0].querySelector(".zoidium-project-toast-actions");
  assert.equal(bar.hidden, false);
  const buttons = bar.children.filter((child) => String(child.attributes["data-toast-action"] || "").startsWith("custom-"));
  assert.deepEqual(buttons.map((button) => button.textContent),
    ["Undo", "Just this project", "Make 60 fps default"]);
  assert.equal(created.at(-1).className, "zoidium-project-toast-primary");
});

test("action toasts linger while plain notices fade quickly", () => {
  const plain = loadToasts();
  plain.toasts.showToast({ title: "Saved." });
  assert.equal(plain.delays.at(-1), 3000);
  const multi = loadToasts();
  multi.toasts.showToast({ title: "Changed.", actions: [{ label: "Undo", run() {} }, { label: "Keep", run() {} }] });
  assert.equal(multi.delays.at(-1), 8000);
});

test("a single legacy action keeps its button and behaviour", async () => {
  const { toasts, body } = loadToasts();
  let runs = 0;
  toasts.showToast({ title: "Notice.", action: { label: "Show in Assets", run() { runs += 1; } } });
  const toast = body.children[0];
  const custom = toast.querySelector('[data-toast-action="custom"]');
  assert.equal(custom.hidden, false);
  assert.equal(custom.textContent, "Show in Assets");
  const bar = toast.querySelector(".zoidium-project-toast-actions");
  assert.equal(bar.children.filter((child) =>
    String(child.attributes["data-toast-action"] || "").startsWith("custom-")).length, 0);
  custom.click();
  assert.equal(toast.classList.contains("is-visible"), false);
  await Promise.resolve();
  assert.equal(runs, 1);
});

test("an action click runs once and closes the toast", async () => {
  const { toasts, body } = loadToasts();
  let runs = 0;
  toasts.showToast({ title: "Changed.", actions: [
    { label: "Undo", run() { runs += 1; } },
    { label: "Just this project", run() {} },
  ] });
  const toast = body.children[0];
  assert.equal(toast.classList.contains("is-visible"), true);
  const bar = toast.querySelector(".zoidium-project-toast-actions");
  const undo = bar.children.find((child) => child.textContent === "Undo");
  undo.click();
  undo.click();
  assert.equal(toast.classList.contains("is-visible"), false);
  await Promise.resolve();
  assert.equal(runs, 1);
});

test("the rescue page exists in English and Japanese and links the support server", () => {
  for (const page of ["about/rescue/index.html", "about/rescue/ja/index.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.match(html, /id="rescue-bookmarklet"/);
    assert.match(html, /<script src="\/about\/rescue\/rescue-page\.js"><\/script>/);
    assert.match(html, /href="https:\/\/discord\.gg\/PWAmY9m5bu" target="_blank" rel="noopener noreferrer"/);
  }
  const redirects = fs.readFileSync(path.join(__dirname, "../_redirects"), "utf8");
  assert.match(redirects, /^\/rescue \/about\/rescue 301$/m);
});
