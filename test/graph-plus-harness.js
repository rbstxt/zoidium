"use strict";

// Shared harness for the Graph+ tests.

const fs = require("node:fs");
const path = require("node:path");
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
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "zoidium/plugin-apis.js"), "utf8"), sandbox);
  vm.runInContext(source, sandbox, { filename: "graph-plus.js" });
  sandbox.module.exports.__test.loadDependencies({
    apis: sandbox.ZoidiumPluginApis,
    getAsset: (_kind, file) => fs.readFileSync(path.join(projectRoot, file), "utf8"),
  });
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
  const easingList = Array.from({ length: 33 }, (_entry, index) => ({ name: `ease${index}`, fn: index === 0 ? null : u => u }));
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


module.exports = { projectRoot, source, plain, loadModule, stubFn, makeHistory, makeFakePZ, makeContext, keyEl };
