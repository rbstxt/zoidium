"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function setup(type) {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", type + ".js"]);
  Object.assign(THREE, {
    CustomBlending: 5, AddEquation: 100, ZeroFactor: 200, OneFactor: 201, SrcColorFactor: 202, SrcAlphaFactor: 204,
    OneMinusSrcAlphaFactor: 205, OneMinusDstColorFactor: 209,
    Material: class { dispose() {} },
  });
  const object = new PZ.object3d[type]();
  object.load(type === "particular" ? { spinMode: 0 } : null);
  const instance = type === "form" ? object.forms[0] : object.systems[0];
  if (type === "particular") instance.sceneRate = () => 30;
  return { PZ, THREE, instance };
}

for (const type of ["form", "particular"]) {
  test(type + " Add preserves low-opacity alpha in the scene buffer", () => {
    const { THREE, instance } = setup(type);
    const particle = instance.properties.particle;
    particle.opacity.set(1);
    particle.blending.set(1);
    instance.update(11);
    const materials = [instance.material];
    if (type === "form") materials.push(instance.stringMaterial);
    for (const material of materials) {
      assert.equal(material.blending, THREE.CustomBlending);
      assert.equal(material.blendEquation, THREE.AddEquation);
      assert.equal(material.blendSrc, THREE.SrcAlphaFactor, "keep the existing RGB weighting");
      assert.equal(material.blendDst, THREE.OneFactor, "keep additive destination RGB");
      assert.equal(material.blendEquationAlpha, THREE.AddEquation);
      assert.equal(material.blendSrcAlpha, THREE.OneFactor, "do not square the source alpha");
      assert.equal(material.blendDstAlpha, THREE.OneFactor);
      assert.equal(material.depthWrite, false);
    }
    assert.equal(instance.material.uniforms.opacity.value, 0.01, "opacity is not raised to hide the bug");
  });

  test(type + " blend changes and shuffled seeks restore each non-Add mode", () => {
    const { THREE, instance } = setup(type);
    const particle = instance.properties.particle;
    const modes = [0];
    for (const mode of modes) {
      particle.blending.set(mode);
      instance.update(11);
      const shader = instance.material.fragmentShader;
      const positions = Array.from((instance.points || instance.threeObj).geometry.attributes.position.array);
      for (const frame of [37, 0, 11]) {
        particle.blending.set(1);
        instance.update(frame);
        particle.blending.set(mode);
        instance.update(11);
        assert.equal(instance.material.blending, THREE.NormalBlending);
        assert.equal(instance.material.fragmentShader, shader);
        assert.deepEqual(Array.from((instance.points || instance.threeObj).geometry.attributes.position.array), positions);
        if (type === "form") assert.equal(instance.stringMaterial.blending, THREE.NormalBlending);
      }
    }
  });
}

test("particular Screen and Multiply blend against the destination", () => {
  const { THREE, instance } = setup("particular");
  const particle = instance.properties.particle, material = () => instance.material;
  particle.blending.set(2);
  instance.update(11);
  assert.equal(material().blending, THREE.CustomBlending);
  assert.equal(material().blendSrc, THREE.OneMinusDstColorFactor);
  assert.equal(material().blendDst, THREE.OneFactor);
  assert.equal(material().defines.PARTICLE_BLEND_SCREEN, 1);
  particle.blending.set(3);
  instance.update(11);
  assert.equal(material().blendSrc, THREE.ZeroFactor);
  assert.equal(material().blendDst, THREE.SrcColorFactor);
  assert.equal(material().defines.PARTICLE_BLEND_MULTIPLY, 1);
  assert.equal(material().defines.PARTICLE_BLEND_SCREEN, undefined);
  assert.equal(material().blendSrcAlpha, THREE.OneFactor);
  assert.equal(material().blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
  assert.match(material().fragmentShader, /PARTICLE_BLEND_SCREEN[\s\S]*rgb \*= gl_FragColor\.a/);
  assert.match(material().fragmentShader, /PARTICLE_BLEND_MULTIPLY[\s\S]*mix\(vec3\(1\.0\)/);
  particle.blending.set(0);
  instance.update(11);
  assert.equal(material().blending, THREE.NormalBlending);
  assert.equal(material().defines.PARTICLE_BLEND_SCREEN, undefined);
  assert.equal(material().defines.PARTICLE_BLEND_MULTIPLY, undefined);
});
