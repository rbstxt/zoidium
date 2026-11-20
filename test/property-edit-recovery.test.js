"use strict";

// Property edits must not strand the editor when the write fails. CM3's
// editFinish writes the value and then closes the history operation; a throw
// in the write leaves the operation open, so every later edit joins it and
// undo/redo stop working. The same throw skips the cursor reset in the number
// input's dragEnd, which leaves the "move" cursor behind.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");

function setup() {
  const context = host();
  context.document.body = { style: {} };
  context.console = { error() {}, log() {}, warn() {} };
  vm.runInContext(fs.readFileSync("plugins/core/property-history.js", "utf8"), context);
  return context;
}

test("a failed property write still closes the open history operation", () => {
  const { PZ } = setup();
  let discarded = 0;
  const history = {
    operation: [],
    discardOperation() { this.operation = null; discarded += 1; },
    finishOperation() { this.operation = null; },
  };
  const controls = {
    editor: { history },
    propertyOps: { setValue() { throw new Error("Cannot read properties of undefined (reading 'addressLookup')"); } },
  };
  const row = { pz_frame: 0, pz_oldValue: 1 };
  row.parentElement = { closest: (selector) => (selector === "ul" ? { pz_controls: controls } : null) };

  assert.doesNotThrow(() => {
    PZ.ui.controls.editFinish.call(row, { getAddress: () => [-1] }, false);
  });
  assert.equal(history.operation, null, "the operation does not stay open");
  assert.equal(discarded, 1, "the failed edit is discarded, not recorded");
});

test("a successful property write is left to CM3", () => {
  const { PZ } = setup();
  const calls = [];
  const history = {
    operation: [],
    discardOperation() { calls.push("discard"); this.operation = null; },
    finishOperation() { calls.push("finish"); this.operation = null; },
  };
  const controls = { editor: { history }, propertyOps: { setValue() { calls.push("set"); } } };
  const row = { pz_frame: 0, pz_oldValue: 1 };
  row.parentElement = { closest: () => ({ pz_controls: controls }) };

  PZ.ui.controls.editFinish.call(row, { getAddress: () => [] }, false);
  assert.deepEqual(calls, ["set", "finish"]);
});

test("the number input clears the drag cursor even when editFinish throws", () => {
  const { PZ, document } = setup();
  const input = Object.create(PZ.ui.input.prototype);
  input.ctx = {
    editFinish() { throw new Error("edit failed"); },
    el: { focus() {} },
  };
  input.moved = false;
  input.value = 1;
  input.initialValue = 1;
  document.body.style.cursor = "move";

  assert.throws(() => input.dragEnd({ altKey: false }), /edit failed/);
  assert.equal(document.body.style.cursor, "", "the move cursor is cleared");
});

test("a successful drag still ends through the input's own handler", () => {
  const { PZ, document } = setup();
  const calls = [];
  const input = Object.create(PZ.ui.input.prototype);
  input.ctx = {
    editFinish(unchanged) { calls.push(["finish", unchanged]); },
    el: { focus() { calls.push(["focus"]); } },
    noLink: false,
  };
  input.moved = true;
  input.value = 1;
  input.initialValue = 1;
  document.body.style.cursor = "move";

  input.dragEnd({ altKey: true });
  assert.deepEqual(calls, [["finish", true]]);
  assert.equal(document.body.style.cursor, "");
});

test("an input bound before installation still discards history and clears cursor on throw", () => {
  const context = host();
  context.document.body = { style: {} };
  context.console = { error() {}, log() {}, warn() {} };
  const preBoundFinish = context.PZ.ui.controls.editFinish;
  vm.runInContext(fs.readFileSync("plugins/core/property-history.js", "utf8"), context);

  let discarded = 0;
  const history = {
    operation: [],
    discardOperation() { this.operation = null; discarded += 1; },
    finishOperation() { this.operation = null; },
  };
  const controls = {
    editor: { history },
    propertyOps: { setValue() { throw new Error("stale-bound edit failed"); } },
  };
  const row = { pz_frame: 0, pz_oldValue: 1, focus() {} };
  row.parentElement = { closest: (selector) => (selector === "ul" ? { pz_controls: controls } : null) };

  const input = Object.create(context.PZ.ui.input.prototype);
  input.ctx = {
    editFinish: preBoundFinish.bind(row, { getAddress: () => [-1] }),
    el: row,
  };
  input.moved = true;
  input.value = 0.5;
  input.initialValue = 1;
  context.document.body.style.cursor = "move";

  assert.throws(() => input.dragEnd({ altKey: false }), /stale-bound edit failed/);
  assert.equal(history.operation, null, "dragEnd discards the leaked operation for pre-bound inputs");
  assert.equal(discarded, 1);
  assert.equal(context.document.body.style.cursor, "", "the move cursor is cleared");
});
