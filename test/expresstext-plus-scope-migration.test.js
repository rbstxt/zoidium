"use strict";

// ExpressText+ Letters scope save/load migration: new containers default to
// Per text, while projects saved before the setting load as Across texts so
// they render identically. Uses the shared CM3 host fixture.

const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture } = require("./helpers/expresstext-host.cjs");

function freshContainer(h) {
  const Cls = h.T.createExpressObjectClass(h.PZ, h.T.getExpressDefinitions()[0]);
  const container = new Cls();
  h.project.objects.push(container);
  return container;
}

test("new containers default to per text", () => {
  const h = fixture();
  try {
    const container = freshContainer(h);
    container.load({ objects: [], properties: {}, expressProperties: {} });
    assert.equal(container.expressProperties.lettersMode.get(0), 0, "per text by default");
    assert.equal(container.expressProperties.lettersVersion.get(0), 1, "marker stamped");
    assert.equal(h.T.lettersScopeOf(container, 0), 0, "renders per text");
  } finally { h.close(); }
});

test("projects saved before the scope load as across texts", () => {
  const h = fixture();
  try {
    const container = freshContainer(h);
    // Old save shape: static rows serialize as bare values, and pre-scope
    // saves carry no letters keys.
    container.load({ objects: [], properties: {}, expressProperties: { rotationOrder: "XZY" } });
    assert.equal(container.expressProperties.rotationOrder.get(0), "XZY", "saved rows untouched");
    assert.equal(container.expressProperties.lettersMode.get(0), 1, "old projects stay across texts");
    assert.equal(container.expressProperties.lettersVersion.get(0), 1, "marker stamped for later saves");
    assert.equal(h.T.lettersScopeOf(container, 0), 1, "renders across texts");
  } finally { h.close(); }
});

test("saved scope choices survive reopen", () => {
  const h = fixture();
  try {
    const perText = freshContainer(h);
    perText.load({
      objects: [],
      properties: {},
      expressProperties: { rotationOrder: "XYZ", lettersMode: 0, lettersVersion: 1 },
    });
    assert.equal(perText.expressProperties.lettersMode.get(0), 0, "per text kept");
    const across = freshContainer(h);
    across.load({
      objects: [],
      properties: {},
      expressProperties: { rotationOrder: "XYZ", lettersMode: 1, lettersVersion: 1 },
    });
    assert.equal(across.expressProperties.lettersMode.get(0), 1, "across texts kept");
  } finally { h.close(); }
});

test("effectors never carry the scope rows", () => {
  const h = fixture();
  try {
    const defs = h.T.getExpressDefinitions();
    const Shake = h.T.createExpressObjectClass(h.PZ, defs.find((d) => d.kind === "shake"));
    const shake = new Shake();
    assert.ok(!shake.expressProperties.lettersMode, "no scope row on effectors");
    assert.ok(!shake.expressProperties.lettersVersion, "no marker row on effectors");
  } finally { h.close(); }
});
