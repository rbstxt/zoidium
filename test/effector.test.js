"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");

function createHarness() {
  class PropertyList {
    constructor(definitions, parent) {
      this.parent = parent;
      this.addAll(definitions || {});
    }

    addAll(definitions) {
      for (const [name, definition] of Object.entries(definitions || {})) {
        if (this[name]) continue;
        const property = {
          ...definition,
          value: definition.value,
          get() {
            return this.value;
          },
        };
        this[name] = property;
      }
    }

    load() {}
  }

  class ObjectList extends Array {
    constructor(parent) {
      super();
      this.parent = parent;
      this.onListChanged = { watch() {}, unwatch() {} };
    }
  }

  class Object3D {
    constructor() {
      this.properties = new PropertyList({}, this);
      this.children = [this.properties];
    }

    parentChanged() {}
  }

  class ThreeObject3D {
    constructor() {
      this.parent = null;
      this.visible = true;
      this.position = { set() {} };
      this.rotation = { order: "XYZ", set() {} };
      this.scale = { set() {} };
    }

    add(child) {
      child.parent = this;
    }

    remove(child) {
      if (child.parent === this) child.parent = null;
    }
  }

  const PZ = {
    object3d: Object3D,
    objectList: ObjectList,
    propertyList: PropertyList,
    property: {
      type: {
        NUMBER: 0,
        OPTION: 1,
        VECTOR3: 2,
        LIST: 3,
        TEXT: 4,
      },
    },
  };
  class GroupObject extends Object3D {
    constructor() {
      super();
      this.threeObj = null;
      this.properties.addAll(GroupObject.propertyDefinitions);
      this.customProperties = new ObjectList(this);
      this.objects = new ObjectList(this);
      this.children.push(this.customProperties, this.objects);
    }
  }
  GroupObject.propertyDefinitions = {
    name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Group" },
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    position: { dynamic: true, name: "Position", type: PZ.property.type.VECTOR3, value: [0, 0, 0] },
    rotation: { dynamic: true, name: "Rotation", type: PZ.property.type.VECTOR3, value: [0, 0, 0] },
    scale: { dynamic: true, name: "Scale", type: PZ.property.type.VECTOR3, value: [1, 1, 1] },
    eulerOrder: { name: "Rotation order", type: PZ.property.type.LIST, value: "XYZ", items: "XYZ" },
  };
  PZ.object3d.group = GroupObject;
  return { PZ, THREE: { Object3D: ThreeObject3D } };
}

test("Twist and Warp expose group Properties and direct polygon controls", () => {
  const { PZ, THREE } = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const Warp = _test.createWarpClass(PZ, THREE);
  const twist = new Twist();
  const warp = new Warp();

  for (const effector of [twist, warp]) {
    assert.ok(effector.properties.position);
    assert.ok(effector.properties.rotation);
    assert.ok(effector.properties.scale);
    assert.equal(effector.properties.curveQuality.value, 1);
    assert.equal(effector.properties.curveQuality.items, "Low polygon;Smooth");
    assert.equal(effector.properties.polygonCount.value, 16);
    assert.equal(effector.properties.polygonCount.min, 1);
    assert.equal(effector.properties.polygonCount.max, 256);
    assert.equal(effector.properties.smoothness, undefined);
  }
});

test("Twist rotates mesh positions around the selected axis", () => {
  const { PZ, THREE } = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  twist.properties.axis.value = 1;
  twist.properties.angle.value = Math.PI / 2;
  const positions = new Float32Array([1, -1, 0, 1, 1, 0]);

  twist.deformPositions(positions, 0, { min: [-1, -1, -1], max: [1, 1, 1] });

  assert.ok(Math.abs(positions[0] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(positions[2] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(positions[3] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(positions[5] + Math.SQRT1_2) < 1e-6);
});

test("Twist treats offset changes as a cached uniform rotation", () => {
  const { PZ, THREE } = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  twist.properties.axis.value = 1;
  twist.properties.angle.value = Math.PI / 2;
  const data = { min: [-1, -1, -1], max: [1, 1, 1] };
  const first = new Float32Array([1, -1, 0, 1, 1, 0]);
  twist.deformPositions(first, 0, data, null, { index: 0, canUseOffsetRotation: true });

  twist.properties.offset.value = 0.5;
  const optimized = new Float32Array([1, -1, 0, 1, 1, 0]);
  twist.deformPositions(optimized, 1, data, null, { index: 0, canUseOffsetRotation: true });

  const reference = new Twist();
  reference.properties.axis.value = 1;
  reference.properties.angle.value = Math.PI / 2;
  reference.properties.offset.value = 0.5;
  const expected = new Float32Array([1, -1, 0, 1, 1, 0]);
  reference.deformPositions(expected, 1, { min: [-1, -1, -1], max: [1, 1, 1] });

  for (let index = 0; index < optimized.length; index += 1) {
    assert.ok(Math.abs(optimized[index] - expected[index]) < 1e-6);
  }
  assert.equal(data.twistCache.get(twist).offset, 0.5);
});

test("Warp bends along X and respects a falloff field", () => {
  const { PZ, THREE } = createHarness();
  const Warp = _test.createWarpClass(PZ, THREE);
  const warp = new Warp();
  warp.properties.amount.value = Math.PI / 2;
  warp.properties.field.value = 3;
  warp.properties.fieldPosition.value = [0, 0, 0];
  warp.properties.fieldScale.value = [5, 5, 5];
  const positions = new Float32Array([0, 0, 0, 20, 0, 0]);

  warp.deformPositions(positions, 0, { min: [0, -1, -1], max: [20, 1, 1] });

  assert.ok(positions[0] > 0 && positions[0] < 10);
  assert.ok(positions[1] > 0);
  assert.deepEqual(Array.from(positions.slice(3, 6)), [20, 0, 0]);
  assert.equal(_test.fieldWeight(0, 0, 0, 3, [0, 0, 0], [5, 5, 5]), 1);
  assert.equal(_test.fieldWeight(20, 0, 0, 3, [0, 0, 0], [5, 5, 5]), 0);
});

test("Effector objects serialize their source object list", () => {
  const { PZ, THREE } = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  twist.type = "zoidium:repeater/twist";
  twist.properties.name = { set() {} };
  const data = twist.toJSON();

  assert.equal(data.type, "zoidium:repeater/twist");
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.objects, twist.objects);
});

test("scene integration restores source positions before the next frame", () => {
  const { PZ, THREE } = createHarness();
  class Scene {
    constructor() {
      this.objects = [];
    }

    update() {
      this.updated = true;
    }
  }
  PZ.layer = { scene: Scene };

  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  twist.properties.angle.value = Math.PI / 2;
  const position = {
    array: new Float32Array([1, -1, 0, 1, 1, 0]),
    needsUpdate: false,
  };
  const geometry = {
    attributes: { position },
    computeVertexNormals() {},
    computeBoundingSphere() {},
  };
  const mesh = {
    isMesh: true,
    geometry,
    userData: {},
    traverse(callback) {
      callback(this);
    },
  };
  twist.objects.push({ threeObj: mesh });
  const scene = new Scene();
  scene.objects.push(twist);

  const support = _test.createDeformationSupport(PZ, THREE);
  scene.update(0);
  assert.notDeepEqual(Array.from(position.array), [1, -1, 0]);
  twist.properties.angle.value = 0;
  scene.update(1);
  assert.deepEqual(Array.from(position.array), [1, -1, 0, 1, 1, 0]);
  twist.properties.angle.value = Math.PI / 2;
  scene.update(2);
  support.deactivate();
  assert.deepEqual(Array.from(position.array), [1, -1, 0, 1, 1, 0]);
  assert.equal(Scene.prototype.__zoidiumEffectorDeformPatch, undefined);
});

test("generated repeater geometry is detached once and reused across frames", () => {
  const { THREE } = createHarness();
  let cloneCount = 0;
  const createGeometry = (values) => ({
    attributes: { position: { array: new Float32Array(values) } },
    clone() {
      cloneCount += 1;
      return createGeometry(values);
    },
  });
  const mesh = {
    isMesh: true,
    __zoidiumEffectorGeneratedClone: true,
    geometry: createGeometry([0, 0, 0]),
    userData: {},
  };

  const first = _test.getDeformMeshData(THREE, mesh);
  const geometry = mesh.geometry;
  const second = _test.getDeformMeshData(THREE, mesh);

  assert.equal(cloneCount, 1);
  assert.equal(first, second);
  assert.equal(mesh.geometry, geometry);
});

test("smooth curve quality uses the requested polygon count and switches back to low polygon", () => {
  class BufferAttribute {
    constructor(array, itemSize, normalized) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
      this.normalized = normalized;
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.groups = [];
    }

    addAttribute(name, attribute) {
      this.attributes[name] = attribute;
      return this;
    }

    addGroup(start, count, materialIndex) {
      this.groups.push({ start, count, materialIndex });
    }

    clearGroups() {
      this.groups = [];
    }

    computeBoundingSphere() {}

    computeBoundingBox() {}

    computeVertexNormals() {
      if (!this.attributes.normal) {
        this.addAttribute(
          "normal",
          new BufferAttribute(new Float32Array(this.attributes.position.count * 3), 3)
        );
      }
    }

    dispose() {
      this.disposed = true;
    }
  }
  const THREE = { BufferAttribute, BufferGeometry };
  const geometry = new BufferGeometry();
  geometry.addAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), 3)
  );
  geometry.addAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3)
  );
  geometry.addGroup(0, 3, 0);
  const mesh = { geometry, userData: {} };

  const smooth = _test.getDeformMeshData(THREE, mesh, 16);
  assert.equal(smooth.polygonCount, 16);
  assert.equal(smooth.geometry.attributes.position.count, 48);
  assert.notEqual(mesh.geometry, geometry);
  const smoothGeometry = smooth.geometry;

  const low = _test.getDeformMeshData(THREE, mesh, 0);
  assert.equal(low.polygonCount, 0);
  assert.equal(mesh.geometry, geometry);
  assert.equal(smoothGeometry.disposed, true);
});

test("smooth curve quality can generate an exact non-level polygon count", () => {
  class BufferAttribute {
    constructor(array, itemSize, normalized) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
      this.normalized = normalized;
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.groups = [];
    }

    addAttribute(name, attribute) {
      this.attributes[name] = attribute;
    }

    computeBoundingSphere() {}

    computeBoundingBox() {}

    computeVertexNormals() {}
  }
  const THREE = { BufferAttribute, BufferGeometry };
  const geometry = new BufferGeometry();
  geometry.addAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), 3)
  );
  const mesh = { geometry, userData: {} };

  const data = _test.getDeformMeshData(THREE, mesh, 7);

  assert.equal(data.polygonCount, 7);
  assert.equal(data.geometry.attributes.position.count, 21);

  const original = _test.getDeformMeshData(THREE, mesh, 1);
  assert.equal(original.polygonCount, 1);
  assert.equal(original.geometry, geometry);
  assert.equal(_test.getDeformMeshData(THREE, mesh, 1), original);
});
