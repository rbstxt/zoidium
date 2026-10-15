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
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.attributes = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name) || this.className.split(" ").includes(name),
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener() {}
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
  const window = {
    document: { body, createElement: (tag) => new Element(tag) },
    ZoidiumUI: { createButton: () => new Element("button") },
    __zoidiumRestoreParts: { store: { state: {} } },
    setTimeout: () => 0, clearTimeout() {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../zoidium/project-restore-toasts.js"), "utf8");
  vm.runInNewContext(source, { window });
  return { toasts: window.__zoidiumRestoreParts.toasts, body };
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
