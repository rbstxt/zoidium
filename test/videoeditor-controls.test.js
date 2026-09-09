"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const patchSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "plugins",
    "core-patches",
    "restore-videoeditor-controls.js"
  ),
  "utf8"
);

function createContext() {
  const toolbarCalls = [];
  const windows = [];
  let viewport = null;
  const editor = {
    playback: {
      onLoopChanged: {},
      loop: false,
    },
    createWindow(options) {
      const graphWindow = {
        editor: {},
        options,
        setPanel(panel) {
          this.panel = panel;
        },
        enabled: false,
      };
      windows.push(graphWindow);
      return graphWindow;
    },
  };

  function Toolbar(editorInstance, buttons) {
    toolbarCalls.push({ editorInstance, buttons });
  }
  Toolbar.CTRL = 2;

  function Viewport() {
    viewport = this;
    this.edit = false;
    this.onEditChanged = {};
    this.widget2d = {
      edit: true,
      onEditChanged: {},
    };
  }

  const context = {
    ZOIDIUM_LAYOUT: "videoeditor",
    VE: editor,
    PZ: {
      ui: {
        toolbar: Toolbar,
        viewport: Viewport,
        graphEditor: function GraphEditor() {},
      },
    },
  };
  context.window = context;
  editor.setUpEditor = function () {
    new context.PZ.ui.viewport(editor);
    new context.PZ.ui.toolbar(editor, [
      { title: "start (home)", icon: "start" },
      {
        title: "loop (ctrl-l)",
        key: "l",
        fn() {
          editor.playback.loop = !editor.playback.loop;
        },
      },
    ]);
  };

  vm.runInNewContext(patchSource, context);
  editor.setUpEditor();

  return { context, editor, toolbarCalls, viewport, windows };
}

test("Video Editor restores camera, transform, loop, and graph controls", () => {
  const { editor, toolbarCalls, viewport } = createContext();
  const buttons = toolbarCalls[0].buttons;
  const titles = buttons.map((button) => button.title || "separator");

  assert.deepEqual(titles, [
    "editing camera (c)",
    "layer transform controls (t)",
    "separator",
    "start (home)",
    "loop (ctrl-l)",
    "graph",
  ]);
  assert.equal(buttons.find((button) => button.title === "loop (ctrl-l)").icon, "loop");
  assert.equal(viewport.edit, true);
  assert.equal(viewport.widget2d.edit, false);
  assert.equal(editor.playback.loop, true);
  assert.equal(editor.__zoidiumControlsRestored, true);
});

test("restored controls keep their Video Editor actions", () => {
  const { editor, toolbarCalls, windows } = createContext();
  const buttons = toolbarCalls[0].buttons;
  const camera = buttons.find((button) => button.title === "editing camera (c)");
  const transform = buttons.find((button) => button.title === "layer transform controls (t)");
  const loop = buttons.find((button) => button.title === "loop (ctrl-l)");
  const graph = buttons.find((button) => button.title === "graph");

  camera.fn();
  transform.fn();
  loop.fn.call({ editor });
  graph.fn();

  assert.equal(editor.playback.loop, false);
  loop.fn.call({ editor });
  assert.equal(editor.playback.loop, true);
  assert.equal(windows[0].options.title, "Graph editor");
  assert.equal(windows[0].enabled, true);
});

test("Clipmaker is not patched by the Video Editor controls patch", () => {
  const context = {
    ZOIDIUM_LAYOUT: "clipmaker",
    VE: { setUpEditor: function () {} },
    PZ: { ui: { toolbar: function () {}, viewport: function () {} } },
  };
  context.window = context;

  vm.runInNewContext(patchSource, context);

  assert.equal(context.VE.__zoidiumControlsRestored, undefined);
});
