"use strict";

// Easing+ curve copy/paste: text formats, clamping, the in-memory fallback and
// the rule that paste commits the same control points as an equivalent pair of
// handle drags. The modules load through the shipped bundle loader so the tests
// pin the same files the bundle runs.

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRequire, getAsset } = require("./easing-plus-bundle");

const PART_ROOT = "./plugins/easing-plus/";
const bundleRequire = createRequire(getAsset, { root: PART_ROOT });
const curves = bundleRequire("./easing-curves.js");
const clipboard = bundleRequire("./easing-clipboard.js");
const createHost = bundleRequire("./easing-host.js");
const createDialog = bundleRequire("./easing-dialog.js");

function installGlobals() {
  const saved = { window: globalThis.window, document: globalThis.document };
  class FakeNode {
    constructor() {
      this.children = [];
      this.attributes = {};
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    remove() {}
  }
  const graph = new FakeNode();
  graph.getBoundingClientRect = () => ({ left: 0, top: 0, width: 520, height: 420 });
  globalThis.document = {
    activeElement: null,
    createElement: () => new FakeNode(),
    createElementNS: () => new FakeNode(),
  };
  globalThis.window = { PZ: {} };
  return {
    graph,
    restore() {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
    },
  };
}

function makeTarget() {
  return {
    property: {
      keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 10 }],
      definition: {},
      getAddress: () => "layer.position",
    },
    start: { frame: 0, value: 0, controlPoints: [[0, 0], [10, 0]] },
    end: { frame: 30, value: 10, controlPoints: [[-10, 0], [0, 0]] },
  };
}

function makeSession(graph) {
  const points = curves.cubic(0.333, 0.333, 0.667, 0.667);
  return {
    points,
    graph,
    editor: {
      history: {
        startOperation() {},
        finishOperation() {},
      },
    },
    targets: [makeTarget()],
    coordinateControls: [],
    presetButtons: [],
    selectedAnchor: 0,
    selectedSegment: 0,
    selectedPreset: -1,
    overshoot: { bottom: false, top: false },
    pendingOvershoot: { bottom: false, top: false },
    dirty: false,
    resizeObserver: null,
  };
}

function installCommit(recorded) {
  class PropertyOps {
    setControlPoints(args) {
      recorded.push({
        operation: "controlPoints",
        frame: args.frame,
        controlPoints: args.controlPoints.map((pair) => pair.slice()),
      });
    }
    setTween(args) {
      recorded.push({ operation: "tween", frame: args.frame, tween: args.tween });
    }
  }
  globalThis.window.PZ.ui = { properties: PropertyOps };
}

function makeDialogApi(graph) {
  const state = { dialog: null };
  const host = createHost(state, { curves });
  const dialog = createDialog(state, {
    curves,
    clipboard,
    applyCurveToTarget: host.applyCurveToTarget,
  });
  return { state, dialog, graph };
}

function commitSession(api, session) {
  api.state.dialog = session;
  api.dialog.finishDialog(session);
}

test("formatCurve writes CSS cubic-bezier text with up to four decimals", () => {
  assert.equal(
    clipboard.formatCurve([0.25, 0.1, 0.25, 1]),
    "cubic-bezier(0.25, 0.1, 0.25, 1)"
  );
  assert.equal(
    clipboard.formatCurve([0.3333333, 0.00004, 0.6666666, 1.23456]),
    "cubic-bezier(0.3333, 0, 0.6667, 1.2346)"
  );
});

test("parseCurve accepts CSS, plain and JSON text", () => {
  const expected = [0.25, 0.1, 0.25, 1];
  assert.deepEqual(clipboard.parseCurve("cubic-bezier(0.25, 0.1, 0.25, 1)"), expected);
  assert.deepEqual(
    clipboard.parseCurve("  CUBIC-BEZIER( .25 , 0.1 , 0.25 , 1 )  "),
    expected
  );
  assert.deepEqual(clipboard.parseCurve("0.25, 0.1, 0.25, 1"), expected);
  assert.deepEqual(clipboard.parseCurve("0.25 0.1 0.25 1"), expected);
  assert.deepEqual(clipboard.parseCurve("0.25,\t0.1   0.25,1"), expected);
  assert.deepEqual(clipboard.parseCurve("[0.25, 0.1, 0.25, 1]"), expected);
  assert.deepEqual(clipboard.parseCurve("[-1, 2e0, 1.5, -0.5]"), [0, 2, 1, -0.5]);
});

test("formatCurve and parseCurve round trip", () => {
  const values = [0.1234, -0.5, 0.9876, 1.5];
  assert.deepEqual(clipboard.parseCurve(clipboard.formatCurve(values)), values);
});

test("parseCurve clamps X to 0-1 and keeps Y free", () => {
  assert.deepEqual(clipboard.parseCurve("cubic-bezier(-0.5, -2, 1.5, 3)"), [0, -2, 1, 3]);
  assert.deepEqual(clipboard.parseCurve("[2, 4, -1, -4]"), [1, 4, 0, -4]);
});

test("parseCurve rejects malformed and non-finite text", () => {
  const invalid = [
    "",
    "   ",
    "hello",
    "1, 2, 3",
    "1 2 3 4 5",
    "cubic-bezier(1, 2, 3)",
    "cubic-bezier(1, 2, 3, 4, 5)",
    "cubic-bezier(a, b, c, d)",
    "cubic-bezier(1 2 3 4)",
    "1, 2, 3, NaN",
    "1, 2, 3, Infinity",
    "1e999, 0, 1, 1",
    "[1, 2, 3]",
    '[1, 2, 3, "4"]',
    "[1, 2, 3, 4] extra",
    "{1, 2, 3, 4}",
    null,
    42,
  ];
  for (const text of invalid) {
    assert.equal(clipboard.parseCurve(text), null, `expected null for ${String(text)}`);
  }
});

test("rememberedCurve keeps a copy for clipboard-denied pastes", () => {
  clipboard.forgetRememberedCurve();
  assert.equal(clipboard.rememberedCurve(), null);
  assert.deepEqual(clipboard.rememberCurve([0.2, 0.4, 0.8, 1.6]), [0.2, 0.4, 0.8, 1.6]);
  const stored = clipboard.rememberedCurve();
  stored[0] = 0.9;
  assert.deepEqual(clipboard.rememberedCurve(), [0.2, 0.4, 0.8, 1.6]);
  assert.equal(clipboard.rememberCurve([1, 2, 3]), null);
  clipboard.forgetRememberedCurve();
  assert.equal(clipboard.rememberedCurve(), null);
});

test("shortcutFor ignores copy and paste while a field is edited", () => {
  const field = { closest: () => ({ tagName: "INPUT" }) };
  const graph = { closest: () => null };
  assert.equal(clipboard.shortcutFor({ key: "c", ctrlKey: true, target: field }), null);
  assert.equal(clipboard.shortcutFor({ key: "v", metaKey: true, target: field }), null);
  assert.equal(clipboard.shortcutFor({ key: "c", ctrlKey: true, target: graph }), "c");
  assert.equal(clipboard.shortcutFor({ key: "v", metaKey: true, target: graph }), "v");
  assert.equal(clipboard.shortcutFor({ key: "V", ctrlKey: true, target: null }), "v");
  assert.equal(clipboard.shortcutFor({ key: "c", ctrlKey: true, shiftKey: true, target: graph }), null);
  assert.equal(clipboard.shortcutFor({ key: "c", ctrlKey: true, altKey: true, target: graph }), null);
  assert.equal(clipboard.shortcutFor({ key: "x", ctrlKey: true, target: graph }), null);
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(clipboard.shortcutFor({ key: "v", ctrlKey: true, target: graph, ...composition }), null);
  }
});

test("paste applies the same normalized points as an equivalent handle drag", () => {
  const globals = installGlobals();
  const recordedDrag = [];
  const recordedPaste = [];
  try {
    installCommit(recordedDrag);
    const dragApi = makeDialogApi(globals.graph);
    const dragged = makeSession(globals.graph);
    assert.equal(curves.writeHandle(dragged.points, 0, "out", 0.15, 0.2), 0.15);
    assert.equal(curves.writeHandle(dragged.points, 1, "in", 0.75, 1.3), 0.75);
    dragged.dirty = true;
    dragged.selectedPreset = -1;
    commitSession(dragApi, dragged);

    installCommit(recordedPaste);
    const pasteApi = makeDialogApi(globals.graph);
    const pasted = makeSession(globals.graph);
    assert.equal(
      pasteApi.dialog.pasteCurveText(pasted, "cubic-bezier(0.15, 0.2, 0.75, 1.3)"),
      true
    );
    assert.equal(pasted.dirty, true);
    commitSession(pasteApi, pasted);

    assert.deepEqual(recordedPaste, recordedDrag);
    assert.deepEqual(
      recordedPaste.filter((entry) => entry.operation === "controlPoints").map((entry) => entry.controlPoints),
      [
        [[0, 0], [0.15 * 30, 10 * 0.2]],
        [[(0.75 - 1) * 30, 3], [0, 0]],
      ]
    );
  } finally {
    globals.restore();
  }
});

test("invalid paste text leaves the curve unchanged and reports inline", () => {
  const globals = installGlobals();
  try {
    installCommit([]);
    const api = makeDialogApi(globals.graph);
    const session = makeSession(globals.graph);
    const before = curves.clonePoints(session.points);
    session.clipboardMessage = { textContent: "" };
    assert.equal(api.dialog.pasteCurveText(session, "not a curve"), false);
    assert.equal(session.dirty, false);
    assert.deepEqual(session.points, before);
    assert.match(session.clipboardMessage.textContent, /cubic-bezier/);
  } finally {
    globals.restore();
  }
});

test("copy writes CSS text and refreshes the in-memory curve", async () => {
  const globals = installGlobals();
  const written = [];
  try {
    installCommit([]);
    globalThis.window.navigator = {
      clipboard: { writeText: async (text) => { written.push(text); } },
    };
    const api = makeDialogApi(globals.graph);
    const session = makeSession(globals.graph);
    session.clipboardMessage = { textContent: "" };
    assert.equal(await api.dialog.copyCurve(session), true);
    assert.deepEqual(written, ["cubic-bezier(0.333, 0.333, 0.667, 0.667)"]);
    assert.deepEqual(clipboard.rememberedCurve(), [0.333, 0.333, 0.667, 0.667]);
  } finally {
    clipboard.forgetRememberedCurve();
    globals.restore();
  }
});

test("paste falls back to the remembered curve when the clipboard read is denied", async () => {
  const globals = installGlobals();
  try {
    installCommit([]);
    globalThis.window.navigator = {
      clipboard: {
        readText: async () => {
          throw new Error("clipboard denied");
        },
      },
    };
    clipboard.forgetRememberedCurve();
    clipboard.rememberCurve([0.1, 0.2, 0.8, 0.9]);
    const api = makeDialogApi(globals.graph);
    const session = makeSession(globals.graph);
    session.clipboardMessage = { textContent: "" };
    assert.equal(await api.dialog.pasteCurve(session), true);
    assert.deepEqual(curves.readSegment(session.points, 0), [0.1, 0.2, 0.8, 0.9]);
    assert.equal(session.dirty, true);
  } finally {
    clipboard.forgetRememberedCurve();
    globals.restore();
  }
});
