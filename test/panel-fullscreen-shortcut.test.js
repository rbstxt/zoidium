"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DOCUMENT_MARKER,
  TOGGLE_CODE,
  TOGGLE_KEY,
  isToggleRequest,
  installShortcut,
  installShortcutForWindows,
  install,
} = require("../plugins/core/panel-fullscreen-shortcut");

class FakeKeyboardEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

function keyEvent(init) {
  return Object.assign(
    new FakeKeyboardEvent("keydown", { bubbles: true, cancelable: true }),
    init
  );
}

function createDocument() {
  const listeners = [];
  const body = { tagName: "BODY" };
  const doc = {
    activeElement: body,
    body,
    defaultView: { KeyboardEvent: FakeKeyboardEvent },
    listeners,
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture });
    },
  };
  return doc;
}

// PZ.ui.panel writes the panel reference onto its own element, and that
// element is what carries the focus inside the pane container.
function createPanel() {
  const dispatched = [];
  const panel = {};
  const el = {
    pz_panel: panel,
    dispatchEvent(event) {
      dispatched.push(event);
      return !event.defaultPrevented;
    },
  };
  panel.el = el;
  return { panel, el, dispatched };
}

function press(doc, event) {
  for (const entry of doc.listeners) {
    if (entry.type === "keydown") entry.listener(event);
  }
  return event;
}

test("the shortcut follows the character the combination types", () => {
  const accepted = [
    // Shift plus the "@" key of a JIS keyboard.
    { key: "`", code: "BracketLeft", shiftKey: true },
    // A layout that puts the character on yet another key.
    { key: "`", code: "Equal", shiftKey: true },
    { key: "`", code: "IntlBackslash" },
    // An input source that owns the key reports no character, so the position
    // the character sits on for a JIS keyboard is the only signal left.
    { key: "Process", code: "BracketLeft", shiftKey: true },
    { key: "Unidentified", code: "BracketLeft", shiftKey: true },
    { key: "Dead", code: "BracketLeft", shiftKey: true },
    { key: "", code: "BracketLeft", shiftKey: true },
  ];

  for (const init of accepted) {
    assert.equal(isToggleRequest(keyEvent(init)), true, JSON.stringify(init));
  }
});

test("the shortcut leaves the native key, typing, and browser shortcuts alone", () => {
  const rejected = [
    // CM3 toggles this code by itself.
    { key: "`", code: "Backquote" },
    { key: "~", code: "Backquote", shiftKey: true },
    // Combinations that type something other than the native character.
    { key: "@", code: "Digit2", shiftKey: true },
    { key: "@", code: "BracketLeft" },
    { key: "2", code: "Digit2" },
    { key: "a", code: "KeyA" },
    // Shift plus the bracket on a US layout, which types "{".
    { key: "{", code: "BracketLeft", shiftKey: true },
    // An input source composing elsewhere, and the unshifted JIS position.
    { key: "Process", code: "KeyA", shiftKey: true },
    { key: "Process", code: "BracketLeft" },
    // Modifier combinations stay with the browser.
    { key: "`", code: "BracketLeft", shiftKey: true, ctrlKey: true },
    { key: "`", code: "BracketLeft", metaKey: true },
    { key: "`", code: "BracketLeft", altKey: true },
    { key: "Process", code: "BracketLeft", shiftKey: true, ctrlKey: true },
  ];

  for (const init of rejected) {
    assert.equal(isToggleRequest(keyEvent(init)), false, JSON.stringify(init));
  }
});

test("a focused panel is toggled with the event CM3 listens for", () => {
  const doc = createDocument();
  const { el, dispatched } = createPanel();
  doc.activeElement = el;
  installShortcut(doc);

  const event = press(doc, keyEvent({ key: TOGGLE_KEY, code: "BracketLeft", shiftKey: true }));

  assert.equal(dispatched.length, 1);
  const toggle = dispatched[0];
  assert.equal(toggle.type, "keydown");
  assert.equal(toggle.code, TOGGLE_CODE);
  assert.equal(toggle.key, "`");
  assert.equal(toggle.bubbles, true, "the pane container must receive it");
  assert.equal(toggle.shiftKey, undefined, "the toggle branch is not the popup branch");
  assert.equal(event.defaultPrevented, true);
});

test("the remapped key does nothing without a focused panel", () => {
  const doc = createDocument();
  const { dispatched } = createPanel();
  installShortcut(doc);

  const onBody = press(doc, keyEvent({ key: TOGGLE_KEY, code: "BracketLeft", shiftKey: true }));
  assert.equal(dispatched.length, 0);
  assert.equal(onBody.defaultPrevented, false);

  // A text field inside a panel owns the focus; it carries no panel back
  // reference, so the character keeps its normal meaning there.
  doc.activeElement = { tagName: "TEXTAREA" };
  const inField = press(doc, keyEvent({ key: TOGGLE_KEY, code: "BracketLeft", shiftKey: true }));
  assert.equal(dispatched.length, 0);
  assert.equal(inField.defaultPrevented, false);
});

test("installing the shortcut twice keeps a single capture listener", () => {
  const doc = createDocument();
  assert.equal(installShortcut(doc), true);
  assert.equal(installShortcut(doc), false);
  assert.equal(doc[DOCUMENT_MARKER], true);
  assert.equal(doc.listeners.length, 1);
  assert.equal(doc.listeners[0].capture, true);
});

test("secondary windows install the shortcut for their own document", () => {
  const secondaryDocument = createDocument();
  function Window() {
    this.window = { document: secondaryDocument };
    this.el = {};
  }
  const PZ = { ui: { window: Window } };

  assert.equal(installShortcutForWindows(PZ), true);
  assert.equal(installShortcutForWindows(PZ), false, "the wrapper is installed once");

  const instance = new PZ.ui.window({});
  assert.ok(instance instanceof Window, "the constructor contract is preserved");
  assert.equal(secondaryDocument[DOCUMENT_MARKER], true);
  assert.equal(secondaryDocument.listeners.length, 1);
});

test("install reports whether the CM3 runtime is available", () => {
  assert.equal(install({ document: createDocument() }), false);

  const doc = createDocument();
  function Window() {
    this.window = { document: createDocument() };
    this.el = {};
  }
  assert.equal(install({ document: doc, PZ: { ui: { window: Window } } }), true);
  assert.equal(doc[DOCUMENT_MARKER], true);
});
