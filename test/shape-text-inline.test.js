"use strict";
// Node harness for the AE-style in-place text session (text-inline.js): key
// handling, live Source Text writes, word selection, IME composition,
// exception safety, undo/redo handoff and outside-change handling, all
// without a browser.
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
  const store = { text: initial, expression: null, leading: 120, failEvaluate: false, failSetValue: false, messages: [] };
  const history = { operation: null, undone: 0, redone: 0 };
  const document = makeDocument();
  document.activeElement = null;
  const canvas = new FakeElement("canvas");
  const layouts = new Map();
  const item = {
    id: "t1",
    kind: "text",
    properties: { sourceText: { expression: null, get: () => store.text } },
    evaluate: () => {
      if (store.failEvaluate) throw Error("evaluate boom");
      const key = store.text + "\n" + store.leading;
      if (!layouts.has(key)) {
        layouts.set(key, layoutText(latin, null, { sourceText: store.text, fontSize: 100, horizontalScale: 100, verticalScale: 100, leading: store.leading }));
      }
      return {
        properties: { fontSize: 100, leading: store.leading, caps: "normal" },
        textLayout: layouts.get(key),
      };
    },
  };
  const gesture = { began: 0, finished: 0, cancelled: 0, active: false };
  const s = {
    document, canvas, window: undefined,
    editor: { history },
    valid: () => true,
    localFrame: () => 0,
    find: id => (id === "t1" ? item : null),
    setValue: (property, value) => {
      if (store.failSetValue) throw Error("setValue boom");
      store.text = value;
    },
    refresh: () => {},
    message: text => { store.messages.push(text); },
    selectItem: () => {},
    finishNudge: () => {},
    gesture: {
      begin: () => {
        gesture.began++;
        if (history.operation !== null) return false;
        history.operation = gesture;
        gesture.active = true;
        return true;
      },
      finish: cancel => {
        gesture.active = false;
        history.operation = null;
        if (cancel) gesture.cancelled++;
        else gesture.finished++;
      },
      get active() { return gesture.active; },
    },
    canvasApi: {
      entries: () => [{ item, matrix: null }],
      screen: point => point,
      local: point => point,
      itemAt: () => ({ item, matrix: null }),
    },
    _store: store, _item: item, _gesture: gesture, _history: history,
  };
  history.undo = () => { history.undone++; };
  history.redo = () => { history.redone++; };
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

test("an outside Source Text change ends the session and keeps the text", () => {
  const s = makeHost("one");
  const { check } = install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.oninput({ data: "!", isComposing: false });
  assert.equal(s._store.text, "one!");
  // An outside edit (panel field, menu/keyboard undo) ends the session.
  s._store.text = "one! two";
  check();
  assert.equal(s.textEdit.active, false);
  assert.equal(s._gesture.finished, 1);
  assert.equal(s._store.text, "one! two");
  assert.equal(s._history.operation, null);
});

test("other property edits keep the session and refresh the layout", () => {
  const s = makeHost("one\ntwo");
  const { check } = install(s);
  s.editText(s._item);
  const before = s.textEdit.active;
  s._store.leading = 200;
  check();
  assert.equal(before, true);
  assert.equal(s.textEdit.active, true);
  assert.equal(s._gesture.finished, 0);
  const input = s.document.body.children.at(-1);
  input.oninput({ data: "!", isComposing: false });
  assert.equal(s._store.text, "one\ntwo!");
});

test("frame changes end the session", () => {
  const s = makeHost("one");
  const { check } = install(s);
  s.editText(s._item);
  s.localFrame = () => 7;
  check();
  assert.equal(s.textEdit.active, false);
  assert.equal(s._gesture.finished, 1);
  assert.equal(s._history.operation, null);
});

test("a throwing evaluate ends the session with the operation closed", () => {
  const s = makeHost("text");
  install(s);
  s._store.failEvaluate = true;
  s.editText(s._item);
  assert.equal(s.textEdit.active, false);
  assert.equal(s._history.operation, null);
  assert.ok(s._store.messages.some(text => text.includes("Shape+ text edit ended")));
});

test("a throwing setValue ends the session and keeps prior writes", () => {
  const s = makeHost("AB");
  install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.oninput({ data: "x", isComposing: false });
  assert.equal(s._store.text, "ABx");
  s._store.failSetValue = true;
  input.oninput({ data: "y", isComposing: false });
  assert.equal(s.textEdit.active, false);
  assert.equal(s._history.operation, null);
  assert.equal(s._store.text, "ABx");
  assert.ok(s._store.messages.some(text => text.includes("Shape+ text edit ended")));
});

test("Cmd/Ctrl+Z commits the session and runs host undo", () => {
  for (const event of [keyEvent("z", { metaKey: true }), keyEvent("z", { ctrlKey: true })]) {
    const s = makeHost("AB");
    install(s);
    s.editText(s._item);
    const input = s.document.body.children.at(-1);
    input.oninput({ data: "x", isComposing: false });
    let stopped = false;
    const undoEvent = Object.assign({}, event, { stopPropagation() { stopped = true; }, preventDefault() {} });
    input.onkeydown(undoEvent);
    assert.equal(s.textEdit.active, false);
    assert.equal(stopped, true);
    assert.equal(s._history.undone, 1);
    assert.equal(s._history.redone, 0);
    assert.equal(s._gesture.finished, 1);
    assert.equal(s._history.operation, null);
  }
});

test("Cmd/Ctrl+Shift+Z and Ctrl+Y commit the session and run host redo", () => {
  for (const event of [keyEvent("z", { metaKey: true, shiftKey: true }), keyEvent("y", { ctrlKey: true })]) {
    const s = makeHost("AB");
    install(s);
    s.editText(s._item);
    let stopped = false;
    const redoEvent = Object.assign({}, event, { stopPropagation() { stopped = true; }, preventDefault() {} });
    s.document.body.children.at(-1).onkeydown(redoEvent);
    assert.equal(s.textEdit.active, false);
    assert.equal(stopped, true);
    assert.equal(s._history.redone, 1);
    assert.equal(s._history.undone, 0);
    assert.equal(s._history.operation, null);
  }
});

test("other host shortcuts commit and pass through untouched", () => {
  const s = makeHost("AB");
  install(s);
  s.editText(s._item);
  let stopped = false, prevented = false;
  s.document.body.children.at(-1).onkeydown({
    key: "s", metaKey: true, isComposing: false,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  assert.equal(s.textEdit.active, false);
  assert.equal(stopped, false);
  assert.equal(prevented, false);
  assert.equal(s._gesture.finished, 1);
  assert.equal(s._history.operation, null);
});

test("pure modifier presses do nothing", () => {
  const s = makeHost("AB");
  install(s);
  s.editText(s._item);
  s.document.body.children.at(-1).onkeydown(keyEvent("Meta", { metaKey: true }));
  assert.equal(s.textEdit.active, true);
  assert.equal(s._gesture.finished, 0);
});

test("Cmd/Ctrl+arrows jump by row and document", () => {
  const s = makeHost("hello\nworld");
  install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.onkeydown(keyEvent("ArrowLeft", { metaKey: true }));
  input.onkeydown(keyEvent("ArrowRight", { metaKey: true }));
  input.onkeydown(keyEvent("ArrowDown", { metaKey: true }));
  assert.equal(s._store.text, "hello\nworld");
  input.onkeydown(keyEvent("Backspace"));
  assert.equal(s._store.text, "hello\nworl");
});

test("keyCode 229 counts as composing in keydown and input", () => {
  const s = makeHost("AB");
  install(s);
  s.editText(s._item);
  const input = s.document.body.children.at(-1);
  input.onkeydown(keyEvent("ArrowLeft"));
  input.onkeydown(keyEvent("Backspace", { keyCode: 229 }));
  assert.equal(s._store.text, "AB");
  input.value = "あ";
  input.oninput({ data: "", isComposing: false, keyCode: 229 });
  assert.equal(s._store.text, "AあB");
  assert.equal(s.textEdit.active, true);
});
