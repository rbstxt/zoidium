"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const { ExpressionSamples } = require("../plugins/graph-plus/sampling.js");

test("Fit waits for the full expression range and includes peaks beyond the first sample budget", () => {
  const { PZ } = host();
  require("../plugins/graph-plus/editor.js")(PZ);
  const attrs = {};
  const group = { pz_object: { expression: { source: "late peak" }, get: frame => frame > 1900 ? 1000 : 1 },
    pz_valueScale: 1, style: {}, _expression: { setAttributeNS() {} },
  };
  const graph = Object.assign(Object.create(PZ.ui.graph.prototype), {
    editor: { sequence: { length: 2000 } }, width: 100, height: 100,
    centerX: 1000, centerY: 0, zoomX: 20, zoomY: 1, options: { curveLineWidth: 2 },
    svg: { setAttributeNS(_ns, key, value) { attrs[key] = value; } },
    propGroups: () => [group], drawRuler() {},
    _expressionSamples: new ExpressionSamples(() => 0),
    _expressionBudget: { remaining: 0, deadline: -1 },
  });
  graph.fitAll(false);
  assert.equal(group._samples.points.length, 1024, "Fit mints a fresh budget instead of using the exhausted one");
  assert.equal(group._samples.complete, false);
  assert.equal(graph.centerY, 0, "an incomplete prefix cannot change fit bounds");
  assert.equal(graph.zoomX, 20, "sampling retains the requested range until complete");
  assert.ok(graph._pendingExpressionFit);
  graph.updateViewBox();
  assert.equal(graph._pendingExpressionFit, null, "completion automatically applies the requested Fit");
  assert.ok(graph.viewY() <= -1000, "Fit contains the late peak");
  assert.ok(graph.viewY() + graph.viewH() >= -1, "Fit also contains the prefix values");
});
