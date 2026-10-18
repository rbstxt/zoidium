"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { FakeElement } = require("./fake-dom");

test("secondary CM3 documents mirror the live extension theme and release the source listener", () => {
  function document() {
    const head = new FakeElement("head"), root = new FakeElement("html");
    head.querySelectorAll = () => [];
    root.dataset = {};
    return { head, documentElement: root };
  }
  const main = new FakeElement("window"), popup = new FakeElement("window");
  main.document = document(); popup.document = document();
  popup.CustomEvent = class { constructor(type) { this.type = type; } };
  popup.dispatchEvent = event => popup.dispatch(event.type);
  const PZ = { ui: { window: function () { this.secondary = true; this.window = popup; } }, zoidium: { define() {} } };
  vm.runInNewContext(fs.readFileSync("plugins/core/window-stylesheet-guard.js", "utf8"), { window: { PZ } });
  main.document.documentElement.setAttribute("style", "--zui-bg:#2a2a2a");
  new PZ.ui.window({ windows: [{ window: main }] });
  assert.equal(popup.document.documentElement.getAttribute("style"), "--zui-bg:#2a2a2a");
  let changes = 0; popup.addEventListener("zoidium:theme-changed", () => changes++);
  main.document.documentElement.setAttribute("style", "--zui-bg:#f1f1f1");
  main.dispatch("zoidium:theme-changed");
  assert.equal(popup.document.documentElement.getAttribute("style"), "--zui-bg:#f1f1f1");
  assert.equal(changes, 1);
  popup.dispatch("pagehide");
  assert.equal(main.listeners["zoidium:theme-changed"].length, 0);
});

test("popup construction cannot start requests for flattened stylesheet paths", () => {
  function document() {
    const head = new FakeElement("head"), root = new FakeElement("html"); root.dataset = {};
    head.querySelectorAll = selector => head.children.filter(el => el.tagName === "LINK" || selector.includes(", style") && el.tagName === "STYLE");
    const doc = { head, documentElement: root, createElement(tag) {
      const node = new FakeElement(tag);
      Object.defineProperty(node, "parentNode", { get: () => node.parentElement });
      Object.defineProperty(node, "nextSibling", { get: () => node.parentElement?.children[node.parentElement.children.indexOf(node) + 1] });
      return node;
    } };
    return doc;
  }
  const main = new FakeElement("window"), popup = new FakeElement("window");
  main.document = document(); popup.document = document();
  const first = main.document.createElement("link"), style = main.document.createElement("style"), last = main.document.createElement("link");
  first.href = "http://localhost/zoidium/ui-window.css"; last.href = "http://localhost/plugins/plugin-manager.css";
  main.document.head.appendChild(first); main.document.head.appendChild(style); main.document.head.appendChild(last);
  let copiedByNative = -1;
  const PZ = { ui: { window: function (editor) {
    copiedByNative = editor.windows[0].window.document.head.querySelectorAll('link[rel="stylesheet"]').length;
    this.secondary = true; this.window = popup;
  } }, zoidium: { define() {} } };
  vm.runInNewContext(fs.readFileSync("plugins/core/window-stylesheet-guard.js", "utf8"), { window: { PZ } });
  new PZ.ui.window({ windows: [{ window: main }] });
  assert.equal(copiedByNative, 0, "the native filename-only copy never sees source links");
  assert.deepEqual(main.document.head.children, [first, style, last], "all source stylesheets return in order");
  assert.equal(popup.document.head.children[0].getAttribute("href"), first.href);
  assert.equal(popup.document.head.children[2].getAttribute("href"), last.href);
});
