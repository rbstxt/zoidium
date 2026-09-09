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

async function startLayout(layout, postInitScripts, runtimeOverrides) {
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
    PZ: {
      zoidium: {
        define(name, api) {
          this[name] = api;
          return api;
        },
      },
    },
    URL,
    ZOIDIUM_RUNTIME: {
      overlayStyles: [],
      postInitScripts: postInitScripts || [],
      preInitScripts: [],
      ...(runtimeOverrides || {}),
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
      dispatchedEvents.push(event);
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
      const failing =
        typeof element.src === "string" && element.src.includes("failing");
      if (element.tagName === "SCRIPT") {
        loadedScripts.push(element.src);
        if (!failing) {
          const editor = { name: layout };
          if (layout === "videoeditor") context.VE = editor;
          else context.CM = editor;
          context.initTool = async function () {
            initialized = true;
          };
        }
      }
      if (failing) {
        if (typeof element.onerror === "function") element.onerror(new Error("mock load failure"));
        return;
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
  assert.ok(result.dispatchedEvents.some((event) => event.type === "zoidium:ready"));
});

test("runtime loader aliases Video Editor to CM for existing extensions", async () => {
  const result = await startLayout("videoeditor");

  assert.match(result.loadedScripts[0], /videoeditor-test\.js$/);
  assert.equal(result.context.CM, result.context.VE);
  assert.equal(result.context.ZOIDIUM_EDITOR, result.context.VE);
  assert.equal(result.context.PZ.zoidium.runtime.editor, result.context.VE);
  assert.equal(result.context.ZOIDIUM_LAYOUT, "videoeditor");
  assert.equal(result.initialized, true);
  assert.ok(result.dispatchedEvents.some((event) => event.type === "zoidium:ready"));
});

test("a failing non-critical script still reaches ready with a failure list", async () => {
  const result = await startLayout("clipmaker", [
    "./ui-kit.js",
    "./failing-settings.js",
    "./welcome.js",
  ]);

  assert.equal(result.initialized, true);
  const ready = result.dispatchedEvents.find((event) => event.type === "zoidium:ready");
  assert.ok(ready);
  assert.equal(ready.detail.degraded, true);
  assert.equal(ready.detail.failedScripts.length, 1);
  assert.equal(ready.detail.failedScripts[0].phase, "post-init");
  assert.match(ready.detail.failedScripts[0].script, /failing-settings\.js$/);
  const errors = result.dispatchedEvents.filter(
    (event) => event.type === "zoidium:extension-script-error"
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0].detail.script, /failing-settings\.js$/);
});

test("a failing UI kit aborts startup instead of cascading", async () => {
  const result = await startLayout("clipmaker", ["./ui-kit.js?failing=1"]);

  const types = result.dispatchedEvents.map((event) => event.type);
  assert.ok(types.includes("zoidium:extension-load-error"));
  assert.ok(!types.includes("zoidium:ready"));
});

test("the loader appends the shared asset version to bare URLs", async () => {
  const result = await startLayout("clipmaker", ["./ui-kit.js"], { assetVersion: 99 });

  const kit = result.loadedScripts.find((src) => src.includes("ui-kit.js"));
  assert.match(kit, /\?v=99$/);
  assert.ok(result.dispatchedEvents.some((event) => event.type === "zoidium:ready"));
});
