"use strict";
const test = require("node:test");
const { nativeHost } = require("./expressions-plus-harness.js");
const { resourceCounter } = require("./helpers/resource-counter.js");
const plugin = require("../plugins/geometry-plus/geometry-plus.js");

for (const id of ["rounded-box", "polyhedron", "cone", "capsule", "tube", "gear", "helix", "spline"]) {
  test(`${id} releases generated geometries on unload`, () => {
    const { PZ, THREE } = nativeHost();
    const counter = resourceCounter();
    for (const name of ["Geometry", "ExtrudeGeometry", "CylinderGeometry", "TubeGeometry", "BoxGeometry", "SphereGeometry", "IcosahedronGeometry", "DodecahedronGeometry", "OctahedronGeometry", "TetrahedronGeometry"]) {
      if (THREE[name]) THREE[name] = counter.track(THREE[name], name);
    }
    const classes = [];
    plugin.activate({ PZ, window: { THREE }, object3d: { registerClass(entry) { classes.push(entry); return () => {}; } } });
    try {
      const shape = classes.find(entry => entry.type.endsWith("/" + id)).factory();
      shape.properties.load();
      shape.materials.push({ load() {}, update() {}, unload() {} });
      shape.load({});
      shape.update(0);
      shape.unload();
      counter.assertDisposed();
    } finally { plugin.deactivate(); }
  });
}
