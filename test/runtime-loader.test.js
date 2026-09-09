"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderSource = fs.readFileSync(
  path.join(__dirname, "..", "zoidium", "runtime-loader.js"),
  "utf8"
);

async function startLayout(layout) {
  let domReady;
  let initialized = false;
  const loadedScripts = [];
  const dispatchedEvents = [];
  const document = {
    baseURI: "http://127.0.0.1:8123/",
    body: { appendChild() {} },
    documentElement: { dataset: {} },
    readyState: "loading",
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") domReady = listener;
    },
    createElement(tagName) {
      return {
        tagName: String(tagName).toUpperCase(),
        style: {},
      };
    },
  };
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    PZ: {},
    URL,
    ZOIDIUM_RUNTIME: {
      overlayStyles: [],
      postInitScripts: [],
      preInitScripts: [],
    },
    ZOIDIUM_RUNTIME_PROFILES: {
      defaultLayout: "clipmaker",
      layouts: {
        clipmaker: {
          editorGlobal: "CM",
          entryScript: "./clipmaker-test.js",
          label: "Clipmaker 3",
        },
        videoeditor: {
          editorGlobal: "VE",
          entryScript: "./videoeditor-test.js",
          label: "Video Editor 2",
        },
      },
    },
    console,
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
    },
    document,
    localStorage: {
      getItem() {
        return JSON.stringify({ layout });
      },
    },
  };
  context.window = context;
  document.head = {
    appendChild(element) {
      if (element.tagName === "SCRIPT") {
        loadedScripts.push(element.src);
        const editor = { name: layout };
        if (layout === "videoeditor") context.VE = editor;
        else context.CM = editor;
        context.initTool = async function () {
          initialized = true;
        };
      }
      if (typeof element.onload === "function") element.onload();
    },
  };

  vm.runInNewContext(loaderSource, context);
  assert.equal(typeof domReady, "function");
  await domReady();
  return { context, dispatchedEvents, initialized, loadedScripts };
}

test("runtime loader selects Clipmaker by layout setting", async () => {
  const result = await startLayout("clipmaker");

  assert.match(result.loadedScripts[0], /clipmaker-test\.js$/);
  assert.equal(result.context.ZOIDIUM_EDITOR, result.context.CM);
  assert.equal(result.context.ZOIDIUM_LAYOUT, "clipmaker");
  assert.equal(result.initialized, true);
  assert.ok(result.dispatchedEvents.includes("zoidium:ready"));
});

test("runtime loader aliases Video Editor to CM for existing extensions", async () => {
  const result = await startLayout("videoeditor");

  assert.match(result.loadedScripts[0], /videoeditor-test\.js$/);
  assert.equal(result.context.CM, result.context.VE);
  assert.equal(result.context.ZOIDIUM_EDITOR, result.context.VE);
  assert.equal(result.context.PZ.zoidium.runtime.editor, result.context.VE);
  assert.equal(result.context.ZOIDIUM_LAYOUT, "videoeditor");
  assert.equal(result.initialized, true);
});
