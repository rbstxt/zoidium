"use strict";

// Shared harnesses for the ExpressText+ topic parts below.
// The module binding, the legacy combined-props shim, keyframe helpers
// and the fake PZ/THREE hosts live here so every part sees the same fakes.

"use strict";

// Coverage for the ExpressText+ Phase-1 core: letter selection parsing,
// strength/field/stagger math, effector envelopes, per-letter evaluation
// and the property schema. All pure (no DOM, THREE, or CM3 runtime).

const assert = require("node:assert/strict");
const test = require("node:test");

const mod = require("../plugins/expresstext-plus/expresstext.js");
const T = mod._test;

// Legacy helper: the old combined-props evaluation now runs as an explicit
// four-layer stack, which is exactly what the panel model composes.
T.evaluateLetter = (props, frame, index, list, base) =>
  T.evaluateStack(
    ["shake", "plain", "random", "delay"].map((kind) => ({ kind, props })),
    props,
    frame,
    index,
    list,
    base
  );

function props(values) {
  return T.staticProps(values);
}

// Frame-varying rows: a value may be a constant or a function of frame,
// mirroring host keyframes.
function keyedProps(values) {
  return {
    get(key) {
      const value = values[key];
      if (value === undefined) return undefined;
      return {
        get: (frame) => (typeof value === "function" ? value(frame) : value),
      };
    },
  };
}
function copyState(state) {
  return {
    position: state.position.slice(),
    rotation: state.rotation.slice(),
    scale: state.scale.slice(),
  };
}

function copyVel(vel) {
  return {
    positionVelocity: vel.positionVelocity.slice(),
    rotationVelocity: vel.rotationVelocity.slice(),
    scaleVelocity: vel.scaleVelocity.slice(),
  };
}
function fakePZ() {
  return {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: class FakeDynamic {},
    },
    object3d: { eulerOrders: "XYZ;XZY;YXZ;YZX;ZXY;ZYX" },
    ui: { objectTypes: new Map() },
  };
}

// Fake custom-prop row + section group mirroring the live shape:
// identity via definition (name for groups, effectorKey for rows).
function fakeRow(key, value) {
  return { definition: { name: `${key}-label`, effectorKey: key }, get: () => value };
}

function fakeSection(displayName, rows) {
  return {
    definition: { name: displayName },
    objects: Object.entries(rows).map(([k, v]) => fakeRow(k, v)),
  };
}
function fakeThree(boxes, captured) {
  const pos = () => ({
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  });
  function Obj() {
    this.position = pos();
    this.kids = [];
  }
  Obj.prototype.add = function (c) { this.kids.push(c); };
  function Mesh(geo, mat) {
    this.geometry = geo;
    this.material = mat;
    this.position = pos();
  }
  function Extrude(shapes, options) {
    captured.push({ shapes, options });
    const box = boxes.shift() || { min: [0, 0, 0], max: [10, 10, 2] };
    this.boundingBox = {
      min: { x: box.min[0], y: box.min[1], z: box.min[2] },
      max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    };
    this.dispose = () => {};
  }
  Extrude.prototype.computeBoundingBox = function () {};
  function Buffer() {}
  function TextGeometry() {}
  function ShapePath() {}
  ShapePath.prototype.moveTo = function () {};
  ShapePath.prototype.lineTo = function () {};
  ShapePath.prototype.quadraticCurveTo = function () {};
  ShapePath.prototype.bezierCurveTo = function () {};
  ShapePath.prototype.toShapes = function () { return [{}]; };
  return { Object3D: Obj, Mesh, ExtrudeGeometry: Extrude, BufferGeometry: Buffer, TextGeometry, ShapePath };
}

// Recording THREE stubs: capture exactly what the renderer writes onto
// letter anchors (rotation/position/scale), with identity matrix math.
function recordingThree() {
  const vec = (x, y, z) => ({
    x: x || 0,
    y: y || 0,
    z: z || 0,
    set(nx, ny, nz) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    },
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    },
    add(v) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    },
    applyMatrix4() {
      return this;
    },
  });
  function Obj() {
    this.position = vec();
    this.rotation = {
      args: null,
      set(...a) {
        this.args = a;
      },
      copy(v) {
        this.args = v.args ? v.args.slice() : [v.x, v.y, v.z];
      },
    };
    this.scale = {
      args: null,
      set(...a) {
        this.args = a;
      },
      copy(v) {
        this.args = v.args ? v.args.slice() : [v.x, v.y, v.z];
      },
    };
    this.children = [];
    this.matrixAutoUpdate = false;
  }
  Obj.prototype.add = function (c) {
    this.children.push(c);
  };
  function Mesh(geo, mat) {
    Obj.call(this);
    this.geometry = geo;
    this.material = mat;
  }
  Mesh.prototype = Object.create(Obj.prototype);
  function Euler(x, y, z, order) {
    this.args = [x, y, z, order];
  }
  function Matrix4() {}
  Matrix4.prototype.makeRotationFromEuler = function () {
    return this;
  };
  function Extrude() {
    return {
      computeBoundingBox() {},
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 2 } },
      dispose() {},
    };
  }
  function Buffer() {}
  function TextGeometry() {}
  function ShapePath() {}
  ShapePath.prototype.moveTo = function () {};
  ShapePath.prototype.lineTo = function () {};
  ShapePath.prototype.toShapes = function () {
    return [{}];
  };
  return {
    Object3D: Obj,
    Mesh,
    Euler,
    Matrix4,
    ExtrudeGeometry: Extrude,
    BufferGeometry: Buffer,
    TextGeometry,
    ShapePath,
    Vector3: function (x, y, z) {
      return vec(x, y, z);
    },
  };
}

module.exports = { mod, T, props, keyedProps, copyState, copyVel, fakePZ, fakeRow, fakeSection, fakeThree, recordingThree };
