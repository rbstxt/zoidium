"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { kitScripts, readScript } = require("./uikit-files");
const { makeDocument, FakeElement } = require("./fake-dom");

function loadKit(width, height) {
  const context = { console: { error() {} }, document: makeDocument(), innerWidth: width, innerHeight: height,
    addEventListener() {}, removeEventListener() {} };
  context.document.head = new FakeElement("head");
  context.window = context;
  vm.createContext(context);
  for (const file of kitScripts()) vm.runInContext(readScript(file), context, { filename: file });
  return { context, api: context.ZoidiumUI };
}

test("reveal expands a collapsed window and fits it fully inside the editor", () => {
  const { context, api } = loadKit(1280, 720);
  const win = api.openWindow({ id: "test:reveal", title: "Reveal", width: 600, height: 400, minWidth: 300, minHeight: 200 });
  win.setCollapsed(true);
  context.innerWidth = 500;
  context.innerHeight = 300;
  win.reveal();
  assert.equal(win.element.classList.contains("collapsed"), false);
  const style = win.element.style;
  const left = parseFloat(style.left), top = parseFloat(style.top);
  const width = parseFloat(style.width), height = parseFloat(style.height);
  assert.ok(left >= 8 && top >= 8, `inside the top-left margin: ${left},${top}`);
  assert.ok(left + width <= 492 && top + height <= 292, `inside the bottom-right margin: ${left + width},${top + height}`);
  win.close();
});

test("reveal keeps a maximized window maximized", () => {
  const { api } = loadKit(1000, 600);
  const win = api.openWindow({ id: "test:max", title: "Max", width: 400, height: 300, maximizable: true });
  win.setMaximized(true);
  win.reveal();
  assert.equal(win.isMaximized(), true);
  assert.equal(win.element.style.width, "984px");
  win.close();
});
