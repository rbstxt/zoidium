"use strict";

// Tests for Graph Editor 2 (plugins/graph-plus/):
// install/uninstall restores the CM3 classes, key operations produce single
// history steps, Easing+-style wrappers survive, CSS uses theme tokens.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "plugins/graph-plus/graph-plus.js"), "utf8");

// Objects created inside the vm sandbox carry a different Object prototype,
// so cross-realm assertions compare through plain JSON first.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadModule(sandboxExtensions = {}) {
  const sandbox = { module: { exports: {} }, console, ...sandboxExtensions };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "graph-plus.js" });
  return { GraphPlus: sandbox.module.exports, sandbox };
}

function stubFn(impl) {
  const fn = function () {
    fn.calls.push(Array.from(arguments));
    return impl ? impl.apply(this, arguments) : undefined;
  };
  fn.calls = [];
  return fn;
}

function makeHistory() {
  return {
    ops: 0,
    finished: 0,
    commands: [],
    startOperation() {
      this.ops += 1;
    },
    finishOperation() {
      this.finished += 1;
    },
    pushCommand(fn, arg) {
      this.commands.push([fn, arg]);
    },
  };
}

// Minimal host surface the ported editor needs at definition time plus the
// propertyOps hooks the operation tests exercise.
function makeFakePZ() {
  function FakePanel() {}
  FakePanel.prototype = {};
  function FakeSplit() {}
  FakeSplit.prototype = {};
  function FakeProps() {}
  FakeProps.prototype.setValue = stubFn();
  FakeProps.prototype.setControlPoints = stubFn();
  function OrigGraph() {}
  OrigGraph.grid = function OrigGrid() {};
  function OrigGraphEditor() {}
  const easingList = Array.from({ length: 33 }, (_entry, index) => ({ name: `ease${index}` }));
  easingList[7] = { name: "ease-in-out" };
  return {
    ui: {
      panel: FakePanel,
      splitPanel: FakeSplit,
      graph: OrigGraph,
      graphEditor: OrigGraphEditor,
      properties: FakeProps,
      edit: function () {},
      drag: function () {},
    },
    observable: { defineObservableProp() {} },
    tween: { easingList, correctCurve: () => 0.5 },
    objectList: function () {},
    package: function () {},
    keyframe: function (value, frame, tween) {
      this.value = value;
      this.frame = frame;
      this.tween = tween;
    },
    clip: function () {},
    sequence: function () {},
    property: { dynamic: { keyframes: function () {}, group: function () {} } },
    stringHash: () => 7,
  };
}

function makeContext(PZ, editor = { windows: [] }) {  const disposed = [];
  return {
    context: {
      PZ,
      editor,
      lifecycle: { onDispose: (fn) => disposed.push(fn) },
    },
    disposed,
  };
}

function keyEl(frame, value, address, extra = {}) {
  const gel = {
    _gid: `g${frame}`,
    pz_object: {
      getAddress: () => address,
      keyframes: [{}, {}],
      definition: { allowEmpty: true },
      ...extra.gelProp,
    },
    pz_valueScale: extra.scale ?? 1,
  };
  return {
    parentElement: { parentElement: gel },
    pz_object: { frame, value, tween: 1, controlPoints: [[-10, 0], [10, 0]], ...extra.kf },
  };
}

// --- manifest --------------------------------------------------------------

test("manifest validates against the plugin schema", () => {
  const Ajv = require("ajv");
  const schema = JSON.parse(fs.readFileSync(path.join(projectRoot, "plugins/manifest.schema.json"), "utf8"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins/graph-plus/manifest.json"), "utf8")
  );
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
  assert.equal(manifest.kind, "extension");
  assert.equal(manifest.modules.length, 1);
  const modulePath = manifest.modules[0].source.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  assert.ok(fs.existsSync(path.join(projectRoot, modulePath)));
});

// --- install / uninstall ----------------------------------------------------

test("activate swaps the graph classes and deactivate restores them", async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const { context, disposed } = makeContext(PZ);
  const origGraph = PZ.ui.graph;
  const origGrid = PZ.ui.graph.grid;
  const origEditor = PZ.ui.graphEditor;

  assert.equal(disposed.length, 0);
  await GraphPlus.activate(context);
  assert.equal(disposed.length, 1, "cleanup registered before host mutation");
  assert.notEqual(PZ.ui.graph, origGraph);
  assert.notEqual(PZ.ui.graph.grid, origGrid);
  assert.notEqual(PZ.ui.graphEditor, origEditor);
  assert.equal(typeof PZ.ui.graph, "function");
  assert.equal(typeof PZ.ui.graphEditor, "function");

  GraphPlus.deactivate();
  assert.equal(PZ.ui.graph, origGraph);
  assert.equal(PZ.ui.graph.grid, origGrid);
  assert.equal(PZ.ui.graphEditor, origEditor);

  // Re-activation reuses the defined classes without redefining them.
  await GraphPlus.activate(makeContext(PZ).context);
  assert.notEqual(PZ.ui.graph, origGraph);
  GraphPlus.deactivate();
  assert.equal(PZ.ui.graph, origGraph);
});

test("activation failure leaves the host untouched", async () => {
  const { GraphPlus } = loadModule();
  const PZ = { ui: {} };
  await assert.rejects(GraphPlus.activate(makeContext(PZ).context), /stock CM3 graph editor/);
  assert.equal(PZ.ui.graph, undefined);
});

test("uninstall keeps a foreign replacement instead of clobbering it", async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const origGraph = PZ.ui.graph;
  const origEditor = PZ.ui.graphEditor;
  await GraphPlus.activate(makeContext(PZ).context);
  const foreign = function ForeignGraph() {};
  PZ.ui.graph = foreign;
  GraphPlus.deactivate();
  assert.equal(PZ.ui.graph, foreign, "foreign class survives");
  assert.equal(PZ.ui.graphEditor, origEditor, "owned editor still restored");
});

// --- key operations: one history step each -----------------------------------

test("deleteKeyframes deletes every selected key in one history step", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const deleted = [];
  const self = {
    editor: { history },
    propertyOps: { deleteKeyframe: (arg) => deleted.push(arg) },
    updateLegend: () => {},
  };
  proto.deleteKeyframes.call(self, [keyEl(4, 1, "prop-a"), keyEl(9, 2, "prop-a")]);
  assert.equal(deleted.length, 2);
  assert.deepEqual(plain(deleted[0]), { property: "prop-a", frame: 4 });
  assert.deepEqual(plain(deleted[1]), { property: "prop-a", frame: 9 });

  // The keyboard Delete path wraps the same op in one history operation.
  const keyHistory = makeHistory();
  let innerCalls = 0;
  const keySelf = {
    editor: { history: keyHistory },
    selectedKeys: () => ["a"],
    deleteKeyframes: () => {
      innerCalls += 1;
    },
  };
  proto.keydown.call(keySelf, { key: "Delete", stopPropagation: () => {} });
  assert.equal(innerCalls, 1);
  assert.equal(keyHistory.ops, 1);
  assert.equal(keyHistory.finished, 1);
});

test("tangent and interpolation toggles write through propertyOps", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const tangents = [];
  const tweens = [];
  const controls = [];
  const self = {
    editor: { history },
    propertyOps: {
      setContinuousTangent: (arg) => tangents.push(arg),
      setTween: (arg) => tweens.push(arg),
      setControlPoints: (arg) => controls.push(arg),
    },
  };
  proto.toggleContinuousTangents.call(self, [keyEl(3, 1, "p", { kf: { continuousTangent: true } })]);
  assert.deepEqual(plain(tangents), [{ property: "p", frame: 3, continuous: false }]);
  proto.toggleInterpolation.call(self, [keyEl(3, 1, "p", { kf: { tween: 1 } })]);
  assert.deepEqual(plain(tweens), [{ property: "p", frame: 3, tween: 257 }]);
  proto.resetHandles.call(self, [keyEl(3, 1, "p")]);
  assert.deepEqual(plain(controls), [{ property: "p", frame: 3, controlPoints: [[-10, 0], [10, 0]] }]);
});

test("applyEasingToSelected writes the picked easing in one history step", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const writes = [];
  const status = [];
  const self = {
    editor: { history },
    propertyOps: { setTween: (arg) => writes.push(arg) },
    selectedKeys: () => [keyEl(6, 2, "addr")],
    updateStatus: (message) => status.push(message),
  };
  proto.applyEasingToSelected.call(self, 7);
  assert.equal(history.ops, 1);
  assert.equal(history.finished, 1);
  assert.deepEqual(plain(writes), [{ property: "addr", frame: 6, tween: 7 }]);
  assert.ok(status.join(" ").includes("ease-in-out"));
});

test("addKeyframeAtPlayhead creates one key per visible curve", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const created = [];
  const groups = [
    { style: { display: "" }, pz_object: { getAddress: () => "a" }, pz_frameOffset: 0 },
    { style: { display: "none" }, pz_object: { getAddress: () => "b" }, pz_frameOffset: 0 },
  ];
  groups[0].pz_object.hasKeyframe = () => false;
  groups[0].pz_object.get = () => 5;
  groups[0].pz_object.interpolated = true;
  const self = {
    editor: { history, playback: { currentFrame: 12 } },
    propertyOps: { createKeyframe: (arg) => created.push(arg) },
    propGroups: () => groups,
  };
  proto.addKeyframeAtPlayhead.call(self);
  assert.equal(history.ops, 1);
  assert.equal(history.finished, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].property, "a");
  assert.equal(created[0].data.frame, 12);
  assert.equal(created[0].data.value, 5);
});

test("arrow nudge records the undo command with the old value", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const el = keyEl(10, 4, "addr");
  const self = {
    editor: { history },
    zoomY: 1,
    selectedKeys: () => [el],
    refreshAdjacentCurves: () => {},
    finishMovingKeyframes: () => {},
    updateStatus: () => {},
  };
  proto.keydown.call(self, { key: "ArrowRight", stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(el.pz_object.frame, 11);
  assert.equal(history.ops, 1);
  assert.equal(history.finished, 1);
  assert.equal(history.commands.length, 1);
  const [fn, arg] = history.commands[0];
  assert.equal(typeof fn, "function");
  assert.deepEqual(plain(arg), { property: "addr", value: 4, frame: 11 });
});

// --- Easing+ coexistence -----------------------------------------------------

test("Easing+-style wrappers survive install and keep working", async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  // Easing+ wraps the native hooks; simulate both wrappers with spies.
  const realSetValue = PZ.ui.properties.prototype.setValue;
  const setValueCalls = [];
  PZ.ui.properties.prototype.setValue = function () {
    setValueCalls.push(Array.from(arguments));
    return realSetValue.apply(this, arguments);
  };
  const correctCurveCalls = [];
  const wrappedCurve = PZ.tween.correctCurve;
  PZ.tween.correctCurve = (...args) => {
    correctCurveCalls.push(args);
    return wrappedCurve(...args);
  };

  await GraphPlus.activate(makeContext(PZ).context);
  assert.notEqual(PZ.ui.properties.prototype.setValue, realSetValue, "wrapper preserved");

  // The eased display path goes through the (wrapped) correctCurve.
  const proto = PZ.ui.graph.prototype;
  const recorded = {};
  const gelStub = { pz_valueScale: 1, pz_frameOffset: 0, pz_color: "#888", style: { display: "" } };
  const viewStub = { options: { curveLineWidth: 2.5 } };
  const fakePath = {
    parentElement: { parentElement: gelStub },
    setAttributeNS: (_ns, key, value) => {
      recorded[key] = value;
    },
  };
  const left = { frame: 0, value: 0, tween: 1, controlPoints: [[0, 0], [10, 0]] };
  const right = { frame: 10, value: 10, tween: 257, controlPoints: [[-10, 0], [10, 0]] };
  proto.updateCurve.call(viewStub, fakePath, left, right);
  assert.equal(correctCurveCalls.length, 1);
  assert.ok(String(recorded.d).startsWith("M"));

  // A linear segment renders straight without sampling.
  correctCurveCalls.length = 0;
  proto.updateCurve.call(viewStub, fakePath, left, { ...right, tween: 1 });
  assert.equal(correctCurveCalls.length, 0);
  assert.ok(String(recorded.d).includes("L"));

  GraphPlus.deactivate();
  // The wrappers are the same functions Easing+ installed.
  assert.notEqual(PZ.ui.properties.prototype.setValue, realSetValue);
  assert.equal(typeof PZ.tween.correctCurve, "function");
});

test("graphEditor mounts when the host wraps splitPanel as a factory", () => {
  const { GraphPlus } = loadModule();
  // Zoidium core replaces PZ.ui.splitPanel with an Ad-filtering factory that
  // returns a fresh panel instead of initializing `this`.
  function RealSplit() {}
  RealSplit.prototype = {};
  const factoryCalls = [];
  function SplitFactory(editor, first, second, ratio, direction) {
    factoryCalls.push([first, second, ratio, direction]);
    const mounted = new RealSplit();
    mounted.el = {};
    return mounted;
  }
  SplitFactory.prototype = RealSplit.prototype;
  const PZ = makeFakePZ();
  PZ.ui.splitPanel = SplitFactory;
  PZ.ui.graph = function FakeGraph() {
    this.el = {};
  };
  PZ.observable = {
    defineObservableProp(target, name) {
      target[name] = null;
      target.onObjectsChanged = { watch() {} };
    },
  };
  const defined = GraphPlus.__test.gpDefineGraphEditor(PZ);
  // Lightweight stand-ins: the factory shape is what this test exercises,
  // not the real graph panel (which needs a DOM).
  PZ.ui.graph = function FakeGraph() {
    this.el = {};
  };
  PZ.ui.edit = function FakeEdit() {
    return { selection: [] };
  };
  const editor = { sequence: null, playback: { currentFrame: 0 } };
  const panel = new defined.graphEditor(editor);
  assert.equal(factoryCalls.length, 1);
  assert.ok(panel.el, "mounted instance carries the factory panel element");
  assert.ok(panel._left, "left picker kept");
  assert.ok(panel._right, "right graph kept");
  assert.ok(panel instanceof defined.graphEditor, "instanceof shape kept");
  assert.equal(panel.title, "Graph editor");
});

test("graph panels style whichever document adopts them", () => {
  const appended = [];
  function makeDoc() {
    const store = {};
    return {
      createElement: () => ({}),
      head: { appendChild: (el) => appended.push(el) },
      getElementById: (id) => store[id] || null,
      __store: store,
    };
  }
  const docA = makeDoc();
  const docB = makeDoc();
  const { GraphPlus } = loadModule({ requestAnimationFrame: () => 0 });
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const self = {
    el: { ownerDocument: docA },
    editor: { playback: { currentFrame: 5 } },
    _lastRulerFrame: 5,
    _legendTick: 1,
  };
  proto.update.call(self);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, GraphPlus.__test.STYLE_ID);
  docA.__store[appended[0].id] = appended[0];
  proto.update.call(self);
  assert.equal(appended.length, 1, "same document is not styled twice");
  self.el.ownerDocument = docB;
  proto.update.call(self);
  assert.equal(appended.length, 2, "adopting document gets the styles");
});

// --- live rebuild ------------------------------------------------------------
test("open graph panels rebuild on enable and disable", () => {
  const { GraphPlus } = loadModule();
  const { rebuildOpenPanels } = GraphPlus.__test;
  function OrigFake() {}
  function NewFake(editor) {
    this.editor = editor;
    this._left = { selection: [] };
  }
  const oldPanel = new OrigFake();
  oldPanel.enabled = true;
  oldPanel.objects = { marker: "keep" };
  // Stock-shaped picker (no _left): selection must still carry over.
  oldPanel.panels = [{ selection: ["prop-a", "prop-b"] }];
  const seen = [];
  let touchedForeign = false;
  const editor = { windows: [] };
  const win = {
    panel: oldPanel,
    editor,
    setPanel(next) {
      seen.push(next);
      this.panel = next;
    },
  };
  editor.windows.push(
    win,
    { panel: null, editor, setPanel: () => { touchedForeign = true; } },
    { panel: { notAGraph: true }, editor, setPanel: () => { touchedForeign = true; } }
  );
  const rebuilt = rebuildOpenPanels(editor.windows, OrigFake, NewFake);
  assert.equal(rebuilt, 1);
  assert.equal(oldPanel.enabled, false);
  assert.equal(seen.length, 1);
  assert.ok(seen[0] instanceof NewFake);
  assert.deepEqual(plain(seen[0].objects), { marker: "keep" });
  assert.deepEqual(plain(seen[0]._left.selection), ["prop-a", "prop-b"]);
  assert.equal(touchedForeign, false);

  // A failing constructor keeps the old panel and never throws.
  function BrokenCtor() {
    throw new Error("nope");
  }
  const oldPanel2 = new OrigFake();
  const win2 = {
    panel: oldPanel2,
    editor,
    setPanel: () => assert.fail("broken ctor must not swap"),
  };
  assert.equal(rebuildOpenPanels([win2], OrigFake, BrokenCtor), 0);
  assert.equal(win2.panel, oldPanel2);
});

// --- theme CSS ---------------------------------------------------------------

test("toolbar styles use theme tokens and stay scoped", () => {
  const { GraphPlus } = loadModule();
  const css = GraphPlus.__test.gpCssText();
  for (const token of ["--zui-bg-title", "--zui-bg-input", "--zui-accent", "--zui-value", "--zui-font"]) {
    assert.ok(css.includes(token), `missing token ${token}`);
  }
  for (const banned of ["#939393", "graph2-css", "Inter"]) {
    assert.ok(!css.includes(banned), `banned string remains: ${banned}`);
  }
  for (const line of css.split("\n")) {
    if (!line.includes("{")) continue; // comment lines carry no rules
    const selector = line.split("{", 1)[0];
    assert.ok(selector.includes("g2-"), `unscoped rule: ${selector}`);
  }
  assert.equal(GraphPlus.__test.STYLE_ID, "zoidium-graph-plus-css");
});

test("no wall-clock or random values leak into project data", () => {
  assert.equal(source.split("Date.now").length - 1, 2, "only the status hover throttle");
  assert.ok(!source.includes("Math.random"));
});

// --- popup window (Ctrl+G) fixes -------------------------------------------------

test("popup layout cannot squeeze the canvas to zero", () => {
  const { GraphPlus } = loadModule();
  const css = GraphPlus.__test.gpCssText();
  const toolbar = css.split("\n").find((line) => line.startsWith(".g2-toolbar{"));
  assert.ok(toolbar.includes("overflow-y:auto"), "toolbar scrolls instead of starving the canvas");
  assert.ok(toolbar.includes("max-height:"), "toolbar height is capped for narrow popups");
  assert.ok(css.includes("g2-narrow"), "compact tiles for narrow hosts");
  const status = css.split("\n").find((line) => line.startsWith(".g2-status{"));
  assert.ok(status.includes("flex-wrap:nowrap"), "status bar stays one row");
  assert.ok(status.includes("overflow:hidden"), "status bar clips instead of growing");
  const canvas = css.split("\n").find((line) => line.startsWith(".g2-canvas{flex"));
  assert.ok(/min-height:(?!0)/.test(canvas), "canvas keeps a minimum height");
  const tracks = css.split("\n").find((line) => line.startsWith(".g2-tracks{"));
  assert.ok(tracks.includes("min-height:0"), "track list can shrink in a row flex");
});

test("owner helpers resolve the popup document and window", () => {
  const { GraphPlus } = loadModule();
  const { g2doc, g2win } = GraphPlus.__test;
  const popupWin = { name: "popup" };
  const popupDoc = { name: "popupDoc", defaultView: popupWin };
  const el = { ownerDocument: popupDoc };
  assert.equal(g2doc(el), popupDoc);
  assert.equal(g2win(el), popupWin);
  assert.equal(g2doc(null), null);
});

test("graph panels use their owner document for new elements", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const created = [];
  const popupDoc = {
    createElement: (tag) => {
      created.push(tag);
      return {};
    },
    createElementNS: (_ns, tag) => {
      created.push("ns:" + tag);
      return { setAttributeNS() {}, style: {}, classList: { add() {} } };
    },
  };
  const self = Object.create(proto);
  self.el = { ownerDocument: popupDoc };
  self.canvasEl = { ownerDocument: popupDoc };
  assert.equal(proto._doc.call(self), popupDoc);
  const kf = proto.createCurve.call(self);
  assert.ok(created.includes("ns:path"), "curve created in the owner document");
  assert.ok(kf, "curve element returned");
});

test("pointer drags listen on the owning window, not the main one", () => {
  const { GraphPlus } = loadModule();
  const { beginPointerDrag } = GraphPlus.__test;
  const added = [];
  const removed = [];
  function makeWin(name) {
    return {
      name,
      addEventListener: (type) => added.push(name + ":" + type),
      removeEventListener: (type) => removed.push(name + ":" + type),
    };
  }
  const popupWin = makeWin("popup");
  const popupDoc = {
    defaultView: popupWin,
    addEventListener: (type) => added.push("popupDoc:" + type),
    removeEventListener: (type) => removed.push("popupDoc:" + type),
  };
  const target = {
    ownerDocument: popupDoc,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // No pointerId: setPointerCapture is skipped, so the window fallback runs.
  const drag = beginPointerDrag(target, {}, () => {}, () => {});
  assert.ok(added.includes("popup:pointermove"), "owner window gets pointermove");
  assert.ok(added.includes("popup:pointerup"), "owner window gets pointerup");
  assert.ok(added.includes("popupDoc:pointerup"), "owner document gets pointerup");
  drag.finish(null);
  assert.ok(removed.includes("popup:pointermove"), "owner listeners removed on finish");
});

test("space shortcuts rebind when the panel moves documents", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  function makeWin() {
    const listeners = {};
    return {
      listeners,
      addEventListener: (type, fn) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
    };
  }
  const winA = makeWin();
  const winB = makeWin();
  const self = {
    _spaceDown: false,
    _win: () => winA,
  };
  proto._ensureSpaceListeners.call(self);
  assert.equal(winA.listeners.keydown.length, 1);
  self._win = () => winB;
  proto._ensureSpaceListeners.call(self);
  assert.equal(winA.listeners.keydown.length, 0, "old window unbound");
  assert.equal(winB.listeners.keydown.length, 1, "new window bound");
  winB.listeners.keydown[0]({ code: "Space", repeat: false });
  assert.equal(self._spaceDown, true);
  proto.unload.call(self);
  assert.equal(winB.listeners.keydown.length, 0, "unload unbinds");
});

test("canvas resize observer re-measures after popup adoption", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const observed = [];
  let fire = null;
  function FakeRO(cb) {
    fire = cb;
  }
  FakeRO.prototype.observe = function (el) {
    observed.push(el);
  };
  FakeRO.prototype.disconnect = function () {};
  const docA = {};
  const docB = {};
  const winB = { ResizeObserver: FakeRO };
  let resized = 0;
  const self = {
    canvasEl: { ownerDocument: docB },
    el: { ownerDocument: docB },
    _doc: () => docB,
    _win: () => winB,
    _roDoc: docA,
    _ro: { disconnect: () => {} },
    resize: () => {
      resized += 1;
    },
  };
  proto._installResizeObserver.call(self);
  assert.equal(observed.length, 1, "canvas observed in the new document");
  assert.equal(self._roDoc, docB);
  fire();
  assert.equal(resized, 1, "observer callback re-measures");
  // Same document: no reinstall.
  observed.length = 0;
  proto._installResizeObserver.call(self);
  assert.equal(observed.length, 0);
});
