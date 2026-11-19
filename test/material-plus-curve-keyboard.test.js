"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const curves = require("../plugins/material-plus/graph-curves.js");

test("curve selection survives composition Escape", () => {
  const doc = { activeElement: null }, value = curves.defaultValue;
  doc.createElement = tag => { const el = new FakeElement(tag); el.ownerDocument = doc; return el; };
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  const property = { definition: {}, get: () => value, set() {} };
  const root = curves.createCurveControl(property, { document: doc, controls: { editStart() {}, editFinish() {} } });
  const graph = root.querySelector(".zoidium-color-curves-graph"), status = root.querySelector(".zoidium-color-curves-status");
  graph.dispatch("keydown", { key: "Tab" });
  const selected = status.textContent;
  assert.match(selected, /Input/);
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    graph.dispatch("keydown", { key: "Escape", ...composition });
    assert.equal(status.textContent, selected);
  }
  graph.dispatch("keydown", { key: "Escape" });
  assert.doesNotMatch(status.textContent, /Input/);
  root.dispose();
});
