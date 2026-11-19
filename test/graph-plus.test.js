"use strict";

// Tests for Graph Editor 2 (plugins/graph-plus/):
// install/uninstall restores the CM3 classes, key operations produce single
// history steps, Easing+-style wrappers survive, CSS uses theme tokens.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { projectRoot, source, plain, loadModule, stubFn, makeHistory, makeFakePZ, makeContext, keyEl } = require("./graph-plus-harness.js");

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
  groups[0].pz_object.animated = true;
  const self = {
    editor: { history, playback: { currentFrame: 12 } },
    propertyOps: { createKeyframe: (arg) => created.push(arg), toggleAnimation: () => assert.fail("already animated") },
    propGroups: () => groups,
    ensureAnimated: proto.ensureAnimated,
  };
  proto.addKeyframeAtPlayhead.call(self);
  assert.equal(history.ops, 1);
  assert.equal(history.finished, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].property, "a");
  assert.equal(created[0].data.frame, 12);
  assert.equal(created[0].data.value, 5);
});

test("addKeyframeAtPlayhead turns the stopwatch on for a static property", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const created = [];
  const toggled = [];
  const keys = [0];
  const prop = {
    animated: false,
    interpolated: true,
    getAddress: () => "a",
    get: () => 5,
    hasKeyframe: (frame) => keys.includes(frame),
  };
  const self = {
    editor: { history, playback: { currentFrame: 12 } },
    propertyOps: {
      createKeyframe: (arg) => created.push(arg),
      // CM3 moves the single static keyframe to the frame and sets animated.
      toggleAnimation: (target, frame, expression, state) => {
        toggled.push([target, frame, expression, state]);
        keys[0] = frame;
        target.animated = true;
      },
    },
    propGroups: () => [{ style: { display: "" }, pz_object: prop, pz_frameOffset: 0 }],
    ensureAnimated: proto.ensureAnimated,
  };
  proto.addKeyframeAtPlayhead.call(self);
  assert.deepEqual(toggled, [[prop, 12, false, true]]);
  assert.equal(created.length, 0);
  assert.equal(prop.animated, true);
});

test("arrow nudge records the undo command with the old value", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const history = makeHistory();
  const el = keyEl(10, 4, "addr");
  const committed = [];
  const self = {
    editor: { history },
    zoomY: 1,
    selectedKeys: () => [el],
    refreshAdjacentCurves: () => {},
    finishMovingKeyframes: proto.finishMovingKeyframes,
    propertyOps: {
      startMove: (_prop, count) => Array.from({ length: count }, () => ({ property: "addr", oldFrame: 0, newFrame: 0 })),
      finishMove: (prop, selected, moves, map) => {
        assert.equal(prop, el.parentElement.parentElement.pz_object);
        assert.ok(selected.has(el.pz_object));
        assert.equal(map.get(moves[0]), el.pz_object);
        committed.push(...plain(moves));
      },
    },
    updateViewBox: () => {}, updateLegend: () => {},
    updateStatus: () => {},
  };
  proto.keydown.call(self, { key: "ArrowRight", stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(el.pz_object.frame, 11);
  assert.deepEqual(committed, [{ property: "addr", oldFrame: 11, newFrame: 10 }],
    "finishMove receives an inverse move from the current frame to the original frame");
  assert.equal(el.pz_oldFrame, undefined, "the real move commit consumes the transient original frame");
  assert.equal(history.ops, 1);
  assert.equal(history.finished, 1);
  assert.equal(history.commands.length, 1);
  const [fn, arg] = history.commands[0];
  assert.equal(typeof fn, "function");
  assert.deepEqual(plain(arg), { property: "addr", value: 4, frame: 11 });
});

test("arrow nudges preserve fractional keyframe positions", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const proto = GraphPlus.__test.gpDefineGraphEditor(PZ).graph.prototype;
  const el = keyEl(-1.25, 4, "addr");
  const self = {
    editor: { history: makeHistory() }, zoomY: 1,
    selectedKeys: () => [el], refreshAdjacentCurves: () => {},
    finishMovingKeyframes: () => {}, updateStatus: () => {},
  };
  proto.keydown.call(self, { key: "ArrowRight", stopPropagation() {}, preventDefault() {} });
  assert.equal(el.pz_object.frame, -0.25);
  proto.keydown.call(self, { key: "ArrowLeft", stopPropagation() {}, preventDefault() {} });
  assert.equal(el.pz_object.frame, -1.25);
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

test("graph panels style and schedule frames in whichever document adopts them", () => {
  const appended = [];
  function makeDoc() {
    const store = {};
    return {
      createElement: () => ({}),
      head: { appendChild: (el) => appended.push(el) },
      getElementById: (id) => store[id] || null,
      __store: store,
      frames: 0,
      defaultView: { requestAnimationFrame() { this.frames = (this.frames || 0) + 1; return this.frames; } },
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
  Object.setPrototypeOf(self, proto);
  proto.update.call(self);
  assert.equal(docA.defaultView.frames, 1);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, GraphPlus.__test.STYLE_ID);
  docA.__store[appended[0].id] = appended[0];
  proto.update.call(self);
  assert.equal(appended.length, 1, "same document is not styled twice");
  self.el.ownerDocument = docB;
  proto.update.call(self);
  assert.equal(appended.length, 2, "adopting document gets the styles");
  assert.equal(docB.defaultView.frames, 1, "new frames use the popup's animation clock");
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
  for (const banned of ["#", "rgba(", "box-shadow", "letter-spacing", "graph2-css", "Inter"]) {
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
  const sources = fs.readdirSync(path.join(projectRoot, "plugins/graph-plus"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => fs.readFileSync(path.join(projectRoot, "plugins/graph-plus", file), "utf8")).join("\n");
  assert.equal(sources.split("Date.now").length - 1, 3, "status hover throttle and wheel gesture timeout stay outside project data");
  assert.ok(!sources.includes("Math.random"));
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
    closeEasePopup: stubFn(),
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

// Canvas paints must resolve the current theme, unlike SVG which reads CSS vars.
test("ruler rereads theme colors and font on every draw", () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const { context } = makeContext(PZ);
  GraphPlus.activate(context);
  let reads = 0;
  let variant = "first";
  const paints = [];
  const ctx = new Proxy({}, { get(target, name) {
    return name in target ? target[name] : () => {};
  }, set(target, name, value) { target[name] = value; paints.push([name, value]); return true; } });
  const graph = {
    bodyEl: { clientWidth: 300 },
    rulerCanvas: { width: 300, height: 30, getContext: () => ctx, ownerDocument: { defaultView: {
      getComputedStyle() { reads++; return { getPropertyValue: name => variant + name }; },
    } } },
    viewX: () => 0, viewW: () => 100, editor: { playback: { currentFrame: 20 } },
  };
  PZ.ui.graph.prototype.drawRuler.call(graph);
  variant = "second";
  PZ.ui.graph.prototype.drawRuler.call(graph);
  assert.equal(reads, 2);
  for (const theme of ["first", "second"]) {
    assert.ok(paints.some(([key, value]) => key === "fillStyle" && value === theme + "--zui-value"));
    assert.ok(paints.some(([key, value]) => key === "font" && value === "10px " + theme + "--zui-font"));
  }
});

test("native popup inherits current theme and font resources, then restores them on disable", () => {
  const values = new Map([["--zui-accent", "original"]]);
  const style = {
    getPropertyValue: key => values.get(key) || "",
    getPropertyPriority: () => "",
    setProperty: (key, value) => values.set(key, value),
    removeProperty: key => values.delete(key),
  };
  let theme = "first";
  const main = {
    documentElement: {},
    defaultView: { getComputedStyle: () => ({ getPropertyValue: key => theme + key }) },
    querySelectorAll: () => [{ href: "http://localhost/zoidium/ui-window.css" }, { href: "http://localhost/fonts/fonts.css?v=5" }],
  };
  const appended = [];
  const popup = {
    documentElement: { style },
    head: { appendChild: el => appended.push(el) },
    createElement: () => ({ dataset: {}, remove() { this.removed = true; } }),
    getElementById: id => appended.find(el => el.id === id),
    querySelectorAll: () => appended.filter(el => el.dataset.graphPlusTheme),
    defaultView: { getComputedStyle: () => style },
  };
  const PZ = makeFakePZ();
  const { GraphPlus } = loadModule({ document: main });
  const { context } = makeContext(PZ, { windows: [{ panel: { el: { ownerDocument: popup } } }] });
  GraphPlus.activate(context);
  assert.equal(values.get("--zui-accent"), "first--zui-accent");
  assert.deepEqual(appended.filter(el => el.rel === "stylesheet").map(el => el.href), main.querySelectorAll().map(el => el.href));
  theme = "second";
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  PZ.ui.graph.prototype.drawRuler.call({ bodyEl: { clientWidth: 100 }, rulerCanvas: { ownerDocument: popup, getContext: () => ctx }, viewX: () => 0, viewW: () => 100, editor: {} });
  assert.equal(values.get("--zui-font"), "second--zui-font");
  assert.equal(values.get("--zui-accent"), "second--zui-accent");
  GraphPlus.deactivate(context);
  assert.equal(values.get("--zui-accent"), "original");
  assert.equal(values.has("--zui-font"), false);
  assert.ok(appended.every(el => el.removed));
});
