"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { FakeElement } = require("./fake-dom.js");

function document() {
  const head = new FakeElement("head");
  head.querySelectorAll = selector => head.children.filter(node => {
    if (selector === 'link[rel="stylesheet"]') return node.tagName === "LINK" && node.getAttribute("rel") === "stylesheet";
    if (selector.includes("data-zoidium-mirrored")) return node.tagName === "LINK" || node.getAttribute("data-zoidium-mirrored") !== null;
    return node.tagName === "LINK" || node.tagName === "STYLE";
  });
  return { head, createElement: tag => new FakeElement(tag), documentElement: { getAttribute: () => null, dataset: {} } };
}

test("native popups never request CM3's flattened CSS URLs and preserve source cascade order", () => {
  const source = document(), popup = document(), originals = [];
  for (const href of ["http://localhost/ui.css", "http://localhost/fonts/fonts.css?v=5", "http://localhost/zoidium/theme-editor.css?v=160"]) {
    const link = new FakeElement("link"); link.setAttribute("rel", "stylesheet"); link.setAttribute("href", href); link.href = href;
    // Fake DOM uses parentElement; browsers expose both names.
    Object.defineProperty(link, "parentNode", { get() { return this.parentElement; } });
    Object.defineProperty(link, "nextSibling", { get() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; } });
    source.head.appendChild(link); originals.push(link);
  }
  const style = new FakeElement("style"); Object.defineProperty(style, "parentNode", { get() { return this.parentElement; } }); style.textContent = ".test{color:inherit}"; source.head.appendChild(style); originals.push(style);
  let initialCopies = -1;
  function OriginalWindow() {
    initialCopies = source.head.querySelectorAll('link[rel="stylesheet"]').length;
    this.secondary = true; this.window = { document: popup };
  }
  const PZ = { ui: { window: OriginalWindow }, zoidium: { define() {} } }, window = { PZ };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/core/window-stylesheet-guard.js"), "utf8"), { window });
  new PZ.ui.window({ windows: [{ window: { document: source } }] });
  assert.equal(initialCopies, 0, "no transient root-level URL requests before mirroring");
  assert.ok(source.head.children.every((node, index) => node === originals[index]), "adjacent source links retain their exact cascade order");
  assert.deepEqual(popup.head.children.filter(node => node.tagName === "LINK").map(link => link.getAttribute("href")), originals.slice(0, 3).map(link => link.href));
  assert.equal(popup.head.children.find(node => node.tagName === "STYLE").textContent, style.textContent);
});
