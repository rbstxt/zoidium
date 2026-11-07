"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ticks, tickLabel, ZOOM } = require("../plugins/graph-plus/view.js");
const { wheelView } = require("../plugins/graph-plus/input.js");
const { host } = require("./helpers/editor-identity-host.cjs");

test("grid subdivisions and ruler labels share exact values across both zoom ranges", () => {
  for (const zoom of [ZOOM.y.min, ZOOM.x.min, .001, .02, .3, 1, 7, 200, 500, 10000]) {
    const { major, minor } = ticks(zoom);
    assert.ok(major / zoom >= 64 - 1e-8 && major / zoom <= 160 + 1e-8);
    assert.ok(Math.abs(major / minor - 5) < 1e-10);
    const labels = [];
    for (let index = -10; index <= 10; index++) {
      const value = index * major;
      const label = tickLabel(value);
      assert.ok(Math.abs(Number(label) - value) / zoom < 1e-8);
      labels.push(label);
    }
    assert.equal(new Set(labels).size, labels.length, "small values retain distinct labels");
  }
});

test("Fit and wheel use identical zoom endpoints without editing project data", () => {
  const { PZ } = host();
  require("../plugins/graph-plus/editor.js")(PZ);
  for (const large of [false, true]) {
    const property = { keyframes: [{frame:0,value:0}, {frame:large ? 1e9 : .000001,value:large ? 1e9 : .000001}] };
    const keys = property.keyframes.map(pz_object => ({pz_object}));
    const group = {pz_object: property, style:{}, _keys:{children:keys}};
    const graph = Object.assign(Object.create(PZ.ui.graph.prototype), {
      editor:{sequence:{length:100}}, width:1000, height:500,
      propGroups:()=>[group], updateViewBox(){},
    });
    const before = JSON.stringify(property);
    graph.fitAll(false);
    const end = large ? "max" : "min";
    assert.equal(graph.zoomX, ZOOM.x[end]); assert.equal(graph.zoomY, ZOOM.y[end]);
    let view = {centerX:0,centerY:0,width:1000,height:500,zoomX:1,zoomY:1};
    for (let i=0;i<20;i++) view = wheelView(view, {ctrlKey:true,deltaY:large ? 2000 : -2000}, {kind:"zoom"}, {x:500,y:250});
    assert.equal(view.zoomX, graph.zoomX); assert.equal(view.zoomY, graph.zoomY);
    assert.equal(JSON.stringify(property), before);
  }
});
