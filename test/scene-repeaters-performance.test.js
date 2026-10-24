"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRepeaterClass } = require("../plugins/scene-plus/scene-repeaters.js");

let nextId = 0;
class Vector {
  set(...values) { this.values = values; return this; }
  copy(other) { this.values = other.values?.slice(); return this; }
}
class Node {
  constructor() {
    this.uuid = String(++nextId);
    this.children = [];
    this.position = new Vector(); this.quaternion = new Vector();
    this.rotation = new Vector(); this.scale = new Vector();
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  traverse(visit) { visit(this); for (const child of this.children) child.traverse(visit); }
  clone() {
    const copy = new Node();
    copy.geometry = this.geometry; copy.material = this.material;
    copy.position.copy(this.position);
    for (const child of this.children) copy.add(child.clone());
    return copy;
  }
}
function fixture(mode, frame = 12, delay = 0) {
  class Group {
    update(time) { for (const source of this.objects) source.update(time); }
    async prepare(time) { for (const source of this.objects) await source.prepare?.(time); }
  }
  const PZ = { object3d: { group: Group }, property: { type: { NUMBER: 0, VECTOR3: 2 } } };
  const Repeater = createRepeaterClass(PZ, { Object3D: Node }, mode, "test");
  const calls = [];
  const source = { threeObj: new Node(), update(time) { calls.push(time); this.threeObj.position.set(time, 0, 0); } };
  const repeater = Object.assign(Object.create(Repeater.prototype), {
    _mode: mode, threeObj: new Node(), _instanceRoots: [], _cloneDirty: true,
    objects: [source], properties: { eulerOrder: { get: () => "XYZ" } },
    repeaterProperties: { count: { get: () => 10 }, delay: { get: () => delay } },
  });
  return { repeater, source, calls, frame };
}

for (const [frame, delay, expected] of [[12, 0, [12, 12]], [2, 3, [2, 0, 2]],
  [12, 1, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 12]]]) {
  test(`echo evaluates each distinct source time once and restores once: ${frame}, ${delay}`, () => {
    const { repeater, source, calls } = fixture("echo", frame, delay);
    repeater.rebuildEchoInstances(frame);
    assert.deepEqual(calls, expected);
    assert.equal(repeater._instanceRoots.length, 10);
    const clones = repeater._instanceRoots.map(instance => instance.clones[0].clone);
    assert.equal(new Set(clones).size, 10);
    assert.equal(new Set(clones.map(node => node.position)).size, 10);
    for (const instance of repeater._instanceRoots) {
      assert.equal(instance.clones[0].clone.position.values[0], instance.sourceFrame);
    }
    assert.equal(source.threeObj.position.values[0], frame);
  });
}

test("echo restores every source once if cloning fails", () => {
  const { repeater, source, calls } = fixture("echo", 12, 1);
  source.threeObj.clone = () => { throw new Error("clone failed"); };
  assert.throws(() => repeater.rebuildEchoInstances(12), /clone failed/);
  assert.deepEqual(calls, [12, 12]);
});

for (const mode of ["step", "linear", "random"]) {
  test(`${mode} preparation retains instances and detects source resource and topology edits`, async () => {
    const { repeater, source } = fixture(mode);
    source.threeObj.geometry = { uuid: "geometry-a" };
    source.threeObj.material = { uuid: "material-a" };
    repeater.update(12);
    let roots = repeater._instanceRoots;
    source.prepare = async () => { source.threeObj.position.set(19, 2, 3); };
    await repeater.prepare(19);
    assert.equal(repeater._instanceRoots, roots);
    assert.deepEqual(roots[0].clones[0].clone.position.values, [19, 2, 3]);
    // A prepared deformation's geometry must survive the subsequent update.
    roots[0].clones[0].clone.geometry = { uuid: "completed-deformation" };
    await repeater.prepare(19);
    repeater.update(19);
    assert.equal(repeater._instanceRoots, roots);
    assert.equal(roots[0].clones[0].clone.geometry.uuid, "completed-deformation");
    for (const edit of [
      () => { source.threeObj.geometry = { uuid: "geometry-b" }; },
      () => { source.threeObj.material = { uuid: "material-b" }; },
      () => source.threeObj.add(new Node()),
      () => { source.threeObj.children[0] = new Node(); },
      () => { repeater.repeaterProperties.count.get = () => 3; },
    ]) {
      source.prepare = async () => { edit(); };
      await repeater.prepare(19);
      assert.notEqual(repeater._instanceRoots, roots);
      roots = repeater._instanceRoots;
    }
    assert.equal(roots.length, 3);
  });
}
