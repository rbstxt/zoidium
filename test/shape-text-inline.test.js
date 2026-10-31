"use strict";
// Node harness for the AE-style in-place text session (text-inline.js): key
// handling, live Source Text writes, word selection, IME composition,
// outside-click commits and external-change adoption, all without a browser.
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { createLoader } = require("../plugins/shape-plus/text-engine.js"), { layoutText } = require("../plugins/shape-plus/text-layout.js");
const { install } = require("../plugins/shape-plus/text-inline.js");
const { makeDocument, FakeElement } = require("./fake-dom.js");
let latin;
before(async () => {
  const engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  const b = fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");
  latin = engine.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), "RobotoFlex-subset.ttf");
});
const keyEvent = (key, extra = {}) => Object.assign({ key, preventDefault() {}, stopPropagation() {}, isComposing: false }, extra);
function makeHost(initial = "AV office") {
  const store = { text: initial, expression: null };
  const document = makeDocument();
  document.activeElement = null;
  const canvas = new FakeElement("canvas");
  const item = {
    id: "t1",
    kind: "text",
    properties: { sourceText: { expression: null, get: () => store.text } },
    evaluate: () => ({
      properties: { fontSize: 100, leading: 120, caps: "normal" },
      textLayout: layoutText(latin, null, { sourceText: store.text, fontSize: 100, horizontalScale: 100, verticalScale: 100, leading: 120 }),
    }),
  };
  const gesture = { began: 0, finished: 0, cancelled: 0, active: false };
  const s = {
    document, canvas, window: undefined,
    valid: () => true,
    localFrame: () => 0,
    find: id => (id === "t1" ? item : null),
    setValue: (property, value) => { store.text = value; },
    refresh: () => {},
    message: () => {},
    selectItem: () => {},
    finishNudge: () => {},
    gesture: {
      begin: () => { gesture.began++; gesture.active = true; return true; },
      finish: cancel => { gesture.active = false; if (cancel) gesture.cancelled++; else gesture.finished++; },
      get active() { return gesture.active; },
    },
    canvasApi: {
      entries: () => [{ item, matrix: null }],
      screen: point => point,
      local: point => point,
      itemAt: () => ({ item, matrix: null }),
    },
    _store: store, _item: item, _gesture: gesture,
  };
  return s;
}
function drawCalls(s) {
  const calls = [];
  const context = {
    beginPath: () => calls.push("begin"),
    moveTo: () => calls.push("move"),
    lineTo: () => calls.push("line"),
    closePath: () => calls.push("close"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
  };
  Object.defineProperty(context, "fillStyle", { set: () => {} });
  Object.defineProperty(context, "strokeStyle", { set: () => {} });
  Object.defineProperty(context, "lineWidth", { set: () => {} });
  s.drawTextEdit(context);
  return calls;
}

test("typing, arrows, Enter and Escape commit one history step", () => {
  const s = makeHost("AV");
  const { finish } = install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  assert.equal(input.getAttribute("aria-label"), "Edit Shape+ text");
  assert.equal(s.textEdit.active, true);
  input.oninput({ data: "!", isComposing: false });
  assert.equal(s._store.text, "AV!");
  input.onkeydown(keyEvent("ArrowLeft"));
  input.onkeydown(keyEvent("Backspace"));
  assert.equal(s._store.text, "A!");
  input.onkeydown(keyEvent("Enter"));
  assert.equal(s._store.text, "A\n!");
  input.onkeydown(keyEvent("Escape"));
  assert.equal(s._gesture.finished, 1);
  assert.equal(s._gesture.cancelled, 0);
  assert.equal(s.textEdit.active, false);
  assert.equal(input.removed, true);
  finish();
});

test("Backspace deletes a combining mark with its base", () => {
  const s = makeHost("é");
  install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.onkeydown(keyEvent("Backspace"));
  assert.equal(s._store.text, "");
});

test("selection, word select and Delete", () => {
  const s = makeHost("hello world");
  install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  // Shift+Left extends from the end; Delete removes the selection.
  input.onkeydown(keyEvent("ArrowLeft", { shiftKey: true }));
  input.onkeydown(keyEvent("ArrowLeft", { shiftKey: true }));
  input.onkeydown(keyEvent("Delete"));
  assert.equal(s._store.text, "hello wor");
  // Double-click path selects the word under the point.
  const probe = layoutText(latin, null, { sourceText: s._store.text, fontSize: 100, horizontalScale: 100, verticalScale: 100, leading: 120 });
  const w = probe.glyphs[6];
  s.textEdit.selectWord([w.x + 1, probe.rows[0].baseline]);
  input.onkeydown(keyEvent("Backspace"));
  assert.equal(s._store.text, "hello ");
});

test("composition previews live and commits once", () => {
  const s = makeHost("AB");
  const { check } = install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.onkeydown(keyEvent("ArrowLeft"));
  input.oncompositionstart();
  assert.equal(s._store.text, "AB");
  input.value = "あ";
  input.oninput({ data: "あ", isComposing: true });
  assert.equal(s._store.text, "AあB");
  input.oncompositionend({ data: "あ" });
  assert.equal(s._store.text, "AあB");
  assert.equal(input.value, "");
  check();
  assert.equal(s.textEdit.active, true);
});

test("clicking outside commits, Escape commits, errors stay grouped", () => {
  const s = makeHost("text");
  install(s);
  s.editText(s._item);
  s.canvasApi.itemAt = () => null;
  assert.equal(s.textEdit.press({}, [5, 5]) === null, true);
  assert.equal(s.textEdit.active, false);
  assert.equal(s._gesture.finished, 1);
});

test("pressing inside moves the caret and drags a selection", () => {
  const s = makeHost("hello world");
  install(s);
  s.editText(s._item);
  const gesture = s.textEdit.press({}, [10000, 0]);
  assert.ok(gesture);
  gesture.move({ clientX: 0, clientY: 0 });
  const calls = drawCalls(s);
  assert.ok(calls.includes("fill"), "selection highlight is drawn");
  gesture.end();
  assert.equal(s.textEdit.active, true);
});

test("an expression-driven item stays read-only with a notice", () => {
  const s = makeHost("text");
  let noticed = "";
  s.message = text => { noticed = text; };
  s._item.properties.sourceText.expression = "time";
  install(s);
  s.editText(s._item);
  assert.equal(s.textEdit.active, false);
  assert.match(noticed, /Expression-driven/);
  assert.equal(s._gesture.began, 0);
});

test("frame changes end the session, outside edits are adopted", () => {
  const s = makeHost("one");
  const { check } = install(s);
  s.editText(s._item);
  s._store.text = "one two";
  check();
  assert.equal(s.textEdit.active, true);
  const input = s.document.body.children.at(-1);
  input.oninput({ data: "!", isComposing: false });
  assert.equal(s._store.text, "one! two");
  s.localFrame = () => 7;
  check();
  assert.equal(s.textEdit.active, false);
  assert.equal(s._gesture.finished, 1);
});
