"use strict";

// Detach guard: reportUnavailableFont must not throw when the text's clip was
// deleted (parentProject getter throws). A detached text stays silent because
// the editor project comparison cannot run. An attached text without a font
// still warns.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const diagnostics = require("../plugins/text-plus/text-plus-diagnostics.js");
const { state } = require("../plugins/text-plus/text-plus-utils.js");

function textObject(project) {
  return {
    properties: {
      name: { get: () => "Title" },
      font: { get: () => "font-key" },
      text: { get: () => "Hello" },
    },
    font: undefined,
    geometryNeedsUpdate: false,
    fontNeedsUpdate: false,
    parentProject: project,
  };
}

function warningsDuring(run) {
  const messages = [];
  const original = console.warn;
  console.warn = (message) => messages.push(String(message));
  diagnostics.resetTextFontDiagnostics();
  try {
    run();
  } finally {
    console.warn = original;
  }
  return messages;
}

test("reportUnavailableFont warns for an attached text without a font", () => {
  const project = {};
  const savedEditor = state.editor;
  state.editor = { project };
  try {
    const messages = warningsDuring(() => {
      diagnostics.reportUnavailableFont(textObject(project));
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /font-missing|no font asset is assigned/);
  } finally {
    state.editor = savedEditor;
  }
});

test("reportUnavailableFont does not throw for a detached text", () => {
  const savedEditor = state.editor;
  state.editor = { project: {} };
  try {
    const detached = textObject(undefined);
    Object.defineProperty(detached, "parentProject", {
      configurable: true,
      get() {
        throw new TypeError("Cannot read properties of null (reading 'parentObject')");
      },
    });
    let messages;
    assert.doesNotThrow(() => {
      messages = warningsDuring(() => {
        diagnostics.reportUnavailableFont(detached);
      });
    });
    assert.deepEqual(messages, []);
  } finally {
    state.editor = savedEditor;
  }
});
