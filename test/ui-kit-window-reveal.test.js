"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");

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

test("popup commands preserve the target and translate Command and Shift+Z without forwarding text undo", () => {
  const { context, api } = loadKit(1000, 600), commands = [];
  context.CM = { keydown(event) { assert.ok(event.target); commands.push(event); event.preventDefault(); } };
  const win = api.openWindow({ id: "commands", title: "Commands" });
  win.isPoppedOut = () => true;
  function key(options) {
    const event = { key: "z", metaKey: true, ctrlKey: false, shiftKey: false,
      target: win.element, ...options };
    win.element.dispatch("keydown", event);
  }
  key({});
  assert.equal(commands.length, 1); assert.equal(commands[0].ctrlKey, true);
  assert.equal(commands[0].key, "z"); assert.equal(commands[0].target, win.element);
  key({ shiftKey: true }); assert.equal(commands.at(-1).key, "y");
  const text = new FakeElement("textarea");
  text.closest = () => text;
  key({ target: text }); assert.equal(commands.length, 2);
  key({ defaultPrevented: true }); assert.equal(commands.length, 2);
  win.close();
});

test("popup host and Graph chrome listeners together forward each command exactly once", () => {
  const { context, api } = loadKit(1000, 600), commands = [];
  const editor = context.CM = { keydown(event) { commands.push(event.key); } };
  const win = api.openWindow({ id: "graph-commands", title: "Graph" });
  win.isPoppedOut = () => true;
  const graph = { module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync("plugins/graph-plus/graph-plus.js", "utf8"), graph);
  const forward = graph.module.exports.__test.forwardChromeCommand;
  win.element.addEventListener("keydown", event => forward(editor, win, event));
  for (const [key, metaKey, shiftKey] of [["z", false, false], ["y", false, false], ["s", false, false], ["z", true, true]]) {
    win.element.dispatch("keydown", { key, ctrlKey: !metaKey, metaKey, shiftKey, target: win.element });
  }
  assert.deepEqual(commands, ["z", "y", "s", "y"], "CM3 need not preventDefault to avoid a second chrome forward");
  win.close();
});
