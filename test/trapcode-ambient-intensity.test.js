"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

const group = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]));
const settings = (layout = "shading", enabled = 1) => group({
  [layout]: enabled, ambient: 20, diffuse: 80, reflectionStrength: 100,
  specularAmount: 50, specularSharpness: 50, lightFalloff: 1, nominalDistance: 250, shadowlet: 0,
});
const bytes = value => Buffer.from(JSON.stringify(value));
const hash = value => crypto.createHash("sha256").update(bytes(value)).digest("hex");

function setup() {
  const { PZ, THREE } = loadSuite(["trapcode-common.js"]);
  // The shared Node host lacks AmbientLight. Use the real classification flag.
  class AmbientLight extends THREE.PointLight {
    constructor() { super(0xffffff, 1); this.isAmbientLight = true; }
  }
  THREE.AmbientLight = AmbientLight;
  const scene = new THREE.Object3D();
  const holder = new THREE.Object3D();
  scene.add(holder);
  return { shading: PZ.trapcode.shading, THREE, scene, holder };
}

for (const type of ["AmbientLight", "HemisphereLight"]) {
  for (const layout of ["shading", "enabled"]) {
    test(`${type}: uploaded color and GLSL give half intensity for ${layout}`, () => {
      const { shading, THREE, scene, holder } = setup();
      const light = type === "AmbientLight" ? new THREE.AmbientLight()
        : new THREE.HemisphereLight(0xffffff, 0x00ff00, 1);
      scene.add(light);
      // Evaluate the actual GLSL branch's arithmetic, not a duplicate constant.
      // This checks uniforms and expressions, without claiming a GPU render.
      const branch = shading.VERTEX_LINES.find(line => /kind > 1\.5/.test(line));
      const match = /mul \+= lCol \* ([\d.]+);/.exec(branch);
      assert.ok(match, "recognize the GLSL ambient arithmetic");
      const factor = Number(match[1]);
      for (const [color, intensity] of [[[1, 1, 1], 1], [[0.25, 0.5, 0.75], 2.5], [[1, 1, 1], 0]]) {
        light.color.setRGB(...color);
        light.intensity = intensity;
        const material = { uniforms: shading.newUniforms(), defines: {} };
        assert.equal(shading.update(material, settings(layout), holder), true);
        const u = material.uniforms;
        assert.equal(u.uShadeLightKind.value[0].x, shading.KIND_AMBIENT);
        const uploaded = u.uShadeLightColor.value[0];
        const gpu = [uploaded.x, uploaded.y, uploaded.z].map(c => u.uShadeAmbient.value + c * factor);
        const reference = shading.shadePoint([0, 0, 0], [0, 0, 10],
          shading.readParams(settings(layout)), shading.collectLights(holder));
        assert.deepEqual(gpu, reference.mul);
        assert.deepEqual(gpu, color.map(c => 0.2 + c * intensity * 0.5));
        assert.deepEqual(reference.spec, [0, 0, 0]);
      }
    });
  }
}

test("shading off leaves uniform bytes unchanged, including after shading was on", () => {
  const { shading, THREE, scene, holder } = setup();
  scene.add(new THREE.AmbientLight());
  scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 2));
  for (const layout of ["shading", "enabled"]) {
    const material = { uniforms: shading.newUniforms(), defines: {} };
    for (const previouslyOn of [false, true]) {
      if (previouslyOn) shading.update(material, settings(layout), holder);
      const before = bytes(material.uniforms);
      assert.equal(shading.update(material, settings(layout, 0), holder), false);
      assert.deepEqual(bytes(material.uniforms), before);
      assert.equal(material.defines.USE_SHADING, undefined);
    }
  }
});

test("non-ambient uniforms and reference output stay byte-identical", () => {
  const snapshots = [];
  for (const type of [null, "PointLight", "DirectionalLight", "SpotLight", "RectAreaLight", "fifth ambient"]) {
    const { shading, THREE, scene, holder } = setup();
    const add = (light, i) => {
      light.position.set(50 + i * 10, 75, 125);
      light.color.setRGB(0.25, 0.5, 0.75);
      scene.add(light);
    };
    if (type === "fifth ambient") {
      for (let i = 0; i < 4; i++) add(new THREE.PointLight(0xffffff, 2), i);
      scene.add(new THREE.AmbientLight());
    } else if (type) add(new THREE[type](0xffffff, 2), 0);
    const material = { uniforms: shading.newUniforms(), defines: {} };
    shading.update(material, settings(), holder);
    const lights = shading.collectLights(holder).slice(0, shading.MAX_LIGHTS);
    snapshots.push({ type, material, reference: shading.shadePoint([0, 0, 0], [0, 0, 1000],
      shading.readParams(settings()), lights) });
  }
  // Captured from the implementation before the ambient upload correction.
  assert.equal(hash(snapshots), "24fb94d4e3d02cf86fb4b01112f4e82f677e81fe278820d2d85fcceced9ec287");
});

test("GLSL and its Form and Particular application stay byte-identical", () => {
  const { shading } = setup();
  // Keeping the shader bytes fixes the uniform contract without changing any
  // shading-off or non-ambient shader arithmetic.
  assert.equal(hash([shading.VERTEX_LINES, shading.applyLines("position"), shading.applyLines("worldPos")]),
    "b2c1b72df6253a26a30852a44eefa1be708c873ab84e016d77a615486a00f3be");
});
