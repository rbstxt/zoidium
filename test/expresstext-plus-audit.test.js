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
