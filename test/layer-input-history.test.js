"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const createUi = require("../plugins/layer-input/layer-input-ui");
const createSources = require("../plugins/layer-input/layer-input-sources");

function element() {
  return { children: [], classList: { add() {} }, dataset: {}, setAttribute() {},
    appendChild(child) { this.children.push(child); child.parentElement = this; },
    replaceChildren() { this.children = []; } };
}

test("shader input mode is one undoable and redoable project edit", () => {
  const undo = [], redo = [];
  const history = { operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn, arg) { this.operation.push(() => fn(arg)); },
    finishOperation() { if (this.operation.length) undo.push(this.operation); this.operation = null; },
    replay(from, to) { const commands = from.pop(); this.operation = []; commands.slice().reverse().forEach(fn => fn()); to.push(this.operation); this.operation = null; } };
  const property = { definition: { name: "Input", _zoidiumShaderLayerSource: true }, type: {},
    get: () => "", getAddress: () => "input", onChanged: { update() {} } };
  const consumer = property.parentObject = {};
  const project = { addressLookup: () => property, ui: { onChanged: { update() {} } } };
  const state = { editor: { project, history }, document: { activeElement: null, createElement: element } };
  const deps = createSources(state, {});
  Object.assign(deps, { getSourceOptions: () => [], getCurrentSourceToken: () => "", getSourceError: () => "", getSourceStatus: () => "" });
  const control = createUi(state, deps).createSourceInput(property);
  const mode = control.children[0].children[1];
  mode.value = "source";
  mode.onchange();
  assert.equal(deps.getSourceMode(consumer, property), "source");
  assert.equal(undo.length, 1);
  history.replay(undo, redo);
  assert.equal(deps.getSourceMode(consumer, property), "effects-masks");
  assert.equal(property.type._zoidiumLayerInputMode, "effects-masks");
  history.replay(redo, undo);
  assert.equal(deps.getSourceMode(consumer, property), "source");
  assert.equal(property.type._zoidiumLayerInputMode, "source");
  mode.value = "source";
  mode.onchange();
  assert.equal(undo.length, 1);
  history.startOperation();
  mode.value = "masks";
  mode.onchange();
  assert.equal(mode.value, "source");
  assert.equal(deps.getSourceMode(consumer, property), "source");
  history.finishOperation();
  assert.equal(undo.length, 1);
});
