"use strict";

// Covers the extension surface added to ZoidiumUI: queued component modules,
// scoped window skins and the standard side panel builder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8");

function fakeElement(tag) {
  return {
    tagName: String(tag || "div").toUpperCase(),
    style: { setProperty() {} },
    dataset: {},
    children: [],
    classList: {
      values: new Set(),
      add(...names) { names.forEach((name) => this.values.add(name)); },
      remove(...names) { names.forEach((name) => this.values.delete(name)); },
      contains(name) { return this.values.has(name); },
      toggle(name, force) { if (force === undefined ? !this.values.has(name) : force) this.values.add(name); else this.values.delete(name); },
    },
    set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); },
    get className() { return Array.from(this.classList.values).join(" "); },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    insertBefore(child) { this.children.unshift(child); child.parentElement = this; return child; },
    remove() {
      const parent = this.parentElement;
      if (parent) parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
    },
    querySelector() { return null; },
    setAttribute() {},
    addEventListener() {},
  };
}

function loadKit(extraModules) {
  const head = fakeElement("head");
  const context = {
    console,
    document: {
      head,
      body: fakeElement("body"),
      createElement: fakeElement,
      querySelector: () => null,
    },
  };
  context.window = context;
  if (extraModules) context.ZoidiumUIModules = extraModules;
  vm.createContext(context);
  vm.runInContext(read("zoidium/ui-panels.js"), context, { filename: "ui-panels.js" });
  vm.runInContext(read("zoidium/ui-kit.js"), context, { filename: "ui-kit.js" });
  return { context, api: context.ZoidiumUI, head };
}

test("queued UI modules install into the frozen ZoidiumUI surface", () => {
  const { context, api } = loadKit();
  for (const name of ["properties", "registerEditor", "openAttributePanel", "registerAttributePanel", "registerSkin", "createSidePanel"]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.ok(Object.isFrozen(api));
  assert.equal(context.ZoidiumUIModules, undefined, "the module queue is consumed");
});

test("a module may not redefine an existing member", () => {
  const modules = [{ name: "bad", install: () => ({ openWindow() {} }) }];
  assert.throws(() => loadKit(modules), /redefines openWindow/);
});

test("skins scope every rule to the skinned windows", () => {
  const { api, head } = loadKit();
  const remove = api.registerSkin("trapcode-suite:designer", `
    /* comment */
    :scope { color: red; }
    .tc-preset:hover, .tc-block.active { color: #fff; }
    body { margin: 0; }
    .a:not(.b, .c) { top: 0; }
    @media (prefers-reduced-motion: reduce) { .tc-designer * { animation: none; } }
    @keyframes tcFade { from { opacity: 0; } to { opacity: 1; } }
  `);
  assert.equal(head.children.length, 1);
  const css = head.children[0].textContent;
  const scope = '.zoidium-window[data-zui-skin="trapcode-suite:designer"]';
  assert.ok(css.includes(`${scope}{ color: red; }`), css);
  assert.ok(css.includes(`${scope} .tc-preset:hover,${scope} .tc-block.active{`), css);
  assert.ok(css.includes(`${scope}{ margin: 0; }`), css);
  assert.ok(css.includes(`${scope} .a:not(.b, .c){`), "commas inside :not() are not split");
  assert.ok(css.includes(`@media (prefers-reduced-motion: reduce){${scope} .tc-designer *{`), css);
  assert.ok(css.includes("@keyframes tcFade{"), "keyframes are copied");
  assert.ok(!css.includes("comment"));
  remove();
  assert.equal(head.children.length, 0, "removing the skin removes its style element");
});

test("re-registering a skin replaces its stylesheet", () => {
  const { api, head } = loadKit();
  const first = api.registerSkin("x:y", ".a { top: 0; }");
  api.registerSkin("x:y", ".b { top: 1px; }");
  assert.equal(head.children.length, 1);
  assert.ok(head.children[0].textContent.includes(".b"));
  first();
  assert.equal(head.children.length, 1, "a stale remover does not remove the replacement");
});

test("createSidePanel returns null when the sidebar is unavailable", () => {
  const { api } = loadKit();
  assert.equal(api.createSidePanel({ title: "Compositions" }), null);
  assert.equal(api.createSidePanel({}), null);
});
