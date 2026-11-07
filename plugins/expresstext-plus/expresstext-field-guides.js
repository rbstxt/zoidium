"use strict";

const { customSections } = require("./expresstext-sections.js");
const { containerTexts } = require("./expresstext-render.js");
const { readProp, readVector } = require("./expresstext-eval.js");

// Unit-box edges. Field evaluation uses each text's undeformed local space.
function boxEdges() {
  const points = [];
  for (let axis = 0; axis < 3; axis++) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
      const start = [0, 0, 0], end = [0, 0, 0];
      start[axis] = -0.5; end[axis] = 0.5;
      start[a] = end[a] = x; start[b] = end[b] = y;
      points.push(...start, ...end);
    }
  }
  return points;
}

function installFieldGuides(PZ, THREE, editor) {
  const Original = THREE.BoxHelper, helpers = new Set();
  if (!Original || !THREE.LineSegments || !editor?.mainViewport) return () => {};
  let disposed = false;
  function release(helper) {
    for (const guide of helper.__expressFieldGuides || []) {
      helper.remove(guide); guide.geometry.dispose(); guide.material.dispose();
    }
    helper.__expressFieldGuides = [];
    helpers.delete(helper);
  }
  function FieldHelper(root, color) {
    const helper = new Original(root, color);
    if (disposed) return helper;
    for (const old of helpers) if (!old.parent) release(old);
    const owner = root?.__zoidiumExpressOwner;
    if (!owner) return helper;
    helpers.add(helper);
    helper.__expressFieldGuides = [];
    const beforeRender = helper.onBeforeRender;
    function update() {
      if (disposed) return;
      const frame = editor.playback.currentFrame - (owner.frameOffset || 0);
      const sections = owner.zoidiumExpressEffector
        ? [{ kind: owner.zoidiumExpressEffector, props: owner.expressProperties }]
        : customSections(owner);
      const active = sections.filter(section => Number(readProp(section.props, `${section.kind}Field`, frame, 0)) > 0);
      const texts = containerTexts(owner);
      const guides = helper.__expressFieldGuides;
      const count = active.length * texts.length;
      while (guides.length > count) {
        const guide = guides.pop(); helper.remove(guide); guide.geometry.dispose(); guide.material.dispose();
      }
      let at = 0;
      for (const text of texts) for (let index = 0; index < active.length; index++) {
        let guide = guides[at++];
        if (!guide) {
          const geometry = new THREE.BufferGeometry();
          geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(boxEdges()), 3));
          const material = new THREE.LineBasicMaterial({color: [0xffa040, 0x50e0d0, 0xb090ff, 0xff7090][index % 4],
            depthTest: false, transparent: true, opacity: 0.85});
          guide = new THREE.LineSegments(geometry, material);
          guide.name = "ExpressText+ field";
          guide.layers.set(1); guide.frustumCulled = false; guide.matrixAutoUpdate = false;
          helper.add(guide); guides.push(guide);
        }
        const { kind, props } = active[index];
        const position = readVector(props, `${kind}FieldPosition`, frame, [0, 0, 0]);
        const scale = readVector(props, `${kind}FieldScale`, frame, [100, 100, 100]).map(v => Math.max(0.01, Math.abs(v)));
        text.threeObj.updateMatrixWorld(true);
        guide.matrix.makeScale(...scale);
        guide.matrix.setPosition(new THREE.Vector3(...position));
        guide.matrix.premultiply(text.threeObj.matrixWorld);
        guide.matrixWorld.copy(guide.matrix);
      }
    }
    // Guides are children of CM3's selection helper, never the project tree.
    // Only the editor camera enables helper layer 1.
    helper.onBeforeRender = function () { beforeRender?.apply(this, arguments); update(); };
    update();
    return helper;
  }
  FieldHelper.prototype = Original.prototype;
  THREE.BoxHelper = FieldHelper;
  return () => {
    disposed = true;
    if (THREE.BoxHelper === FieldHelper) THREE.BoxHelper = Original;
    for (const helper of helpers) release(helper);
  };
}

module.exports = { boxEdges, installFieldGuides };
