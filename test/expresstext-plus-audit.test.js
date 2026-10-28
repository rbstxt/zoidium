'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./helpers/expresstext-host.cjs');

test('removing ExpressText+ after a text edit preserves the newest native geometry', () => {
  const h = fixture();
  try {
    const text = h.text();
    text.update(0);
    const first = h.T.getSplitState(text).fullGeometry;
    text.properties.text.set('B');
    text.update(0);
    const split = h.T.getSplitState(text);
    h.T.restoreExpressRendering(text);
    assert.equal(text.threeObj.geometry.parameters.text, 'B');
    assert.notEqual(text.threeObj.geometry, first);
  } finally { h.close(); }
});

test('nested Group transforms apply exactly once to ExpressText+ letters', () => {
  const h = fixture();
  try {
    const group = h.group();
    group.properties.position.set([30,0,0],0);
    const text = h.text(group);
    text.properties.position.set([5,0,0],0);
    h.container.update(0);
    h.project.threeObj.updateMatrixWorld(true);
    const root = h.T.getSplitState(text).renderRoot;
    const nativePosition = new h.THREE.Vector3().setFromMatrixPosition(text.threeObj.matrixWorld);
    const expressPosition = new h.THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    assert.equal(expressPosition.x, nativePosition.x);
  } finally { h.close(); }
});

test('the first Orbit frame matches a repeated render of the same frame', () => {
  const h = fixture();
  try {
    h.section('Orbit', {orbitAngle: [0,0,Math.PI]});
    const a = h.text(h.container, 'A'), b = h.text(h.container, 'A');
    a.properties.position.set([-30,0,0],0);
    b.properties.position.set([30,0,0],0);
    h.container.update(0);
    const anchor = h.T.getSplitState(a).entries[0].anchor;
    const first = anchor.position.toArray();
    h.container.update(0);
    const repeated = anchor.position.toArray();
    assert.deepEqual(first, repeated);
  } finally { h.close(); }
});

test('moving a Text to another Group moves its split rendering too', () => {
  const h = fixture();
  try {
    const a = h.group(), b = h.group();
    const text = h.text(a, 'A');
    h.container.update(0);
    const split = h.T.getSplitState(text);
    a.objects.splice(0,1);
    b.objects.push(text);
    h.container.update(0);
    assert.equal(text.threeObj.parent, b.threeObj, 'native parent changed');
    assert.equal(split.renderRoot.parent === b.threeObj, true, 'split renderer follows the new parent');
  } finally { h.close(); }
});

test('Formula t measures seconds using the actual sequence rate', () => {
  const h = fixture();
  try {
    h.project.sequence.properties.load();
    h.project.sequence.properties.rate.set(60);
    h.section('Formula', {formulaExpression: 't', formulaPosition: [1,0,0]});
    const text = h.text(h.container, 'A');
    h.container.update(60);
    const entry = h.T.getSplitState(text).entries[0];
    const displacement = entry.anchor.position.x - entry.base[0];
    assert.equal(displacement, 1);
  } finally { h.close(); }
});

for (const action of ["leave", "deactivate"]) {
  test(`${action} ExpressText+ retains text, size, and bevel edits without another split update`, () => {
    const h = fixture();
    try {
      const text = h.text();
      h.container.update(0);
      const previous = h.T.getSplitState(text).fullGeometry;
      let disposed = 0;
      previous.addEventListener("dispose", () => { disposed++; });
      text.properties.text.set("B");
      text.properties.size.set([40, 8]);
      text.properties.bevel.set(1);
      text.updateGeometry();
      const latest = text.threeObj.geometry;
      if (action === "deactivate") h.close();
      else {
        h.container.objects.splice(0, 1);
        h.project.objects.push(text);
        text.update(0);
      }
      assert.equal(text.threeObj.geometry.parameters.text, "B");
      assert.equal(text.threeObj.geometry.parameters.parameters.height, 8);
      assert.equal(text.threeObj.geometry.parameters.parameters.bevelEnabled, true);
      if (action === "deactivate") assert.equal(text.threeObj.geometry, latest);
      assert.equal(disposed, 1);
    } finally { h.close(); }
  });
}

test("Orbit reads source edits on a later Text before that Text updates", () => {
  const h = fixture();
  try {
    h.section("Orbit", { orbitAngle: [0, 0, Math.PI] });
    const a = h.text(h.container, "A"), b = h.text(h.container, "A");
    a.properties.position.set([-30, 0, 0], 0);
    b.properties.position.set([30, 0, 0], 0);
    h.container.update(0);
    for (const [key, value] of [["text", "AB"], ["size", [35, 5]], ["positionMode", 1], ["bevel", 1]]) {
      b.properties[key].set(value);
      a.update(0);
      const first = h.T.getSplitState(a).entries.map(e => Array.from(e.anchor.position.toArray()));
      h.container.update(0);
      assert.deepEqual(h.T.getSplitState(a).entries.map(e => Array.from(e.anchor.position.toArray())), first, key);
    }
  } finally { h.close(); }
});

for (const pose of [
  { position: [30, 0, 0] },
  { rotation: [0.4, -0.7, 1.2] },
  { scale: [2, 0.5, 3] },
  { position: [9, 3, -2], rotation: [0.2, 0.6, -0.4], scale: [2, 0.5, 3] },
]) {
  test(`nested split world matrices match native Text for ${JSON.stringify(pose)}`, () => {
    const h = fixture();
    try {
      const outer = h.group(), inner = h.group(outer), text = h.text(inner, "A");
      for (const [key, value] of Object.entries(pose)) outer.properties[key].set(value, 0);
      inner.properties.position.set([5, 2, -3], 0);
      inner.properties.rotation.set([0.3, 0.1, -0.2], 0);
      text.properties.position.set([4, -1, 2], 0);
      text.properties.rotation.set([0.1, 0.4, -0.5], 0);
      text.properties.scale.set([0.8, 1.3, 2], 0);
      h.container.update(0);
      h.project.threeObj.updateMatrixWorld(true);
      const split = h.T.getSplitState(text);
      assert.deepEqual(Array.from(split.renderRoot.matrixWorld.elements), Array.from(text.threeObj.matrixWorld.elements));
      const actual = split.entries[0].anchor.matrixWorld;
      const expected = text.threeObj.matrixWorld.clone().multiply(new h.THREE.Matrix4().makeTranslation(...split.entries[0].base));
      Array.from(actual.elements).forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-10));
    } finally { h.close(); }
  });
}

test("split parents follow moves, reorder, undo, and redo without rebuilding letters", () => {
  const h = fixture();
  try {
    const { editorFor } = require("./helpers/editor-identity-host.cjs");
    const editor = editorFor(h.PZ, h.project);
    const a = h.group(), b = h.group();
    a.properties.position.set([10, 0, 0], 0);
    b.properties.position.set([-20, 0, 0], 0);
    const text = h.text(a, "A");
    h.text(b, "B");
    h.container.update(0);
    const split = h.T.getSplitState(text), entries = split.entries;
    function move({ from, to, index }) {
      const oldIndex = from.objects.indexOf(text);
      from.objects.splice(oldIndex, 1);
      to.objects.splice(index, 0, text);
      editor.history.pushCommand(move, { from: to, to: from, index: oldIndex });
    }
    function check(parent) {
      h.container.update(0);
      h.project.threeObj.updateMatrixWorld(true);
      assert.equal(split.renderRoot.parent, parent.threeObj);
      assert.equal(split.entries, entries);
      assert.deepEqual(Array.from(split.renderRoot.matrixWorld.elements), Array.from(text.threeObj.matrixWorld.elements));
    }
    editor.history.startOperation();
    move({ from: a, to: b, index: 0 });
    editor.history.finishOperation();
    check(b);
    editor.history.undo(); check(a);
    editor.history.redo(); check(b);
    editor.history.startOperation();
    move({ from: b, to: b, index: 1 });
    editor.history.finishOperation();
    check(b);
    assert.equal(b.objects[1], text);
    editor.history.undo(); check(b);
    assert.equal(b.objects[0], text);
  } finally { h.close(); }
});

for (const kind of ["Formula", "Shake"]) {
  test(`${kind} uses sequence seconds at 24, 30, and 60 fps with stagger`, () => {
    const samples = [24, 30, 60].map(rate => {
      const h = fixture();
      try {
        h.project.sequence.properties.load();
        h.project.sequence.properties.rate.set(rate);
        h.section(kind, kind === "Formula"
          ? { formulaExpression: "t", formulaPosition: [1, 0, 0], formulaDelay: rate / 4 }
          : { shakePosition: [1, 0, 0], shakeFrequency: 0.7, shakeDelay: rate / 4 });
        const text = h.text();
        h.container.update(rate);
        return h.T.getSplitState(text).entries.map(e => e.anchor.position.x - e.base[0]);
      } finally { h.close(); }
    });
    for (const sample of samples) sample.forEach((v, i) => assert.ok(Math.abs(v - samples[1][i]) < 1e-10));
  });
}

test("animated Random retains its frame-based Animation speed across sequence rates", () => {
  const samples = [24, 30, 60].map(rate => {
    const h = fixture();
    try {
      h.project.sequence.properties.load();
      h.project.sequence.properties.rate.set(rate);
      h.section("Random", { randomMode: 2, randomAnimationSpeed: 50 });
      const text = h.text();
      h.container.update(45);
      return h.T.getSplitState(text).entries.map(e => Array.from(e.anchor.position.toArray()));
    } finally { h.close(); }
  });
  assert.deepEqual(samples[0], samples[1]);
  assert.deepEqual(samples[2], samples[1]);
});

test("Delay caches invalidate when Formula and Shake change sequence rates", () => {
  const h = fixture();
  try {
    h.project.sequence.properties.load();
    h.section("Formula", { formulaExpression: "t", formulaPosition: [1, 0, 0] });
    h.section("Shake", { shakePosition: [1, 0, 0] });
    h.section("Delay", { delayMode: 1 });
    const text = h.text(h.container, "A");
    h.container.update(60);
    const first = h.T.getSplitState(text).entries[0].anchor.position.x;
    h.project.sequence.properties.rate.set(60);
    h.container.update(60);
    const next = h.T.getSplitState(text).entries[0].anchor.position.x;
    assert.notEqual(next, first);
    require("../plugins/expresstext-plus/expresstext-delay-cache.js").clearDelayCache();
    h.container.update(60);
    assert.equal(h.T.getSplitState(text).entries[0].anchor.position.x, next);
  } finally { h.close(); }
});
