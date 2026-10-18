"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const NodeMaterial = require("../plugins/material-plus/node-material");
const Pbr = require("../plugins/material-plus/pbr-plus");
const createGraph = require("../plugins/material-plus/graph-runtime.js");
const { harness } = require("./material-node-harness.js");
const graph = (port, params = {}, type = "color", values = { color: [.8, .2, .1] }) => ({ nodes: [
  { id: "source", type, params: values }, { id: "output", type: "output", params },
], links: [{ from: "source", fromPort: "out", to: "output", toPort: port }] });

test("Output bakes independent RGB emission, luminance and deterministic color/height normals", () => {
  const nodes = createGraph({}, null);
  const input = graph("emission");
  input.links.push({ ...input.links[0], toPort: "luminance" });
  const result = nodes.evaluate(input, 8, 0, {});
  assert.deepEqual(Array.from(result.emission.slice(0, 4)), [204, 51, 26, 255]);
  assert.deepEqual(result.emission, result.luminance);
  const normal = nodes.evaluate(graph("normal", {}, "color", { color: [.8, .5, 1] }), 8, 0, {}).normal;
  assert.ok(normal[0] > 180 && normal[2] > 220);
  const flat = nodes.evaluate(graph("normal", { normalStrength: 0 }), 8, 0, {}).normal;
  assert.deepEqual(Array.from(flat.slice(0, 4)), [128, 128, 0, 255]);
  const heightGraph = graph("normal", { normalMode: 1 }, "noise", { seed: 9, scale: 3 });
  const height = nodes.evaluate(heightGraph, 32, 0, {}).normal;
  assert.deepEqual(height, nodes.evaluate(heightGraph, 32, 0, {}).normal);
  assert.ok(height.some((value, i) => i % 4 === 0 && value !== 128));
  heightGraph.nodes[1].params.normalStrength = 0;
  assert.deepEqual(Array.from(nodes.evaluate(heightGraph, 32, 0, {}).normal.slice(0, 4)), [128, 128, 255, 255]);
});

for (const type of ["nodes", "pbrplus"]) {
  test(`${type} preserves defaults, serializes controls and binds both normal sources with bump`, async () => {
    const h = harness(); NodeMaterial.activate(h.context); Pbr.activate(h.context);
    let m;
    try {
      m = h.material(type); (await h.PZ.material.fnList[type]).call(m); m.load();
      await m.prepare(0);
      for (const [key, value] of Object.entries({ emissionStrength: 1, clearcoat: 0, clearcoatRoughness: 0,
        reflectivity: .5, environment: null, environmentIntensity: 1, environmentRotation: 0, shadowSide: 0 })) {
        assert.equal(m.properties[key].get(), value, key);
        assert.equal(JSON.parse(JSON.stringify(m.toJSON())).properties[key], value);
      }
      m.properties.useNodeGraph.set(1);
      m.properties.bakeResolution.set(0);
      const g = graph("normal", {}, "color", { color: [.7, .5, 1] });
      g.links.push({ ...g.links[0], toPort: "emission" }, { ...g.links[0], toPort: "bump" });
      m.properties.graph.set(JSON.stringify(g));
      m.properties.normalMap.set("authored-normal");
      await m.prepare(0);
      assert.ok(m.threeObj.normalMap);
      assert.notEqual(m.threeObj.normalMap, m.pzGraphTextures.normal);
      assert.equal(m.pzUniforms.uPzGraphNormal.value, m.pzGraphTextures.normal);
      assert.equal(m.pzUniforms.uPzGraphEmission.value, m.pzGraphTextures.emission);
      assert.equal(m.threeObj.defines.PZ_GRAPH_NORMAL, 1);
      assert.equal(m.threeObj.defines.PZ_NORMAL_IMAGE, 1);
      m.properties.bumpNoise.set(1);
      assert.equal(m.threeObj.bumpMap, m.pzNoiseTexture);
      assert.equal(m.pzUniforms.uPzGraphNormal.value, m.pzGraphTextures.normal);
      m.properties.bumpNoise.set(0);
      assert.equal(m.threeObj.bumpMap, m.pzGraphTextures.bump);
      m.properties.normalMap.set(null);
      assert.equal(m.threeObj.normalMap, m.pzGraphTextures.normal);
      assert.equal(m.threeObj.defines.PZ_NORMAL_IMAGE, 0);
      m.properties.clearcoat.get = frame => frame / 10;
      m.properties.clearcoatRoughness.set(.2);
      m.properties.reflectivity.set(.8);
      m.properties.emissionStrength.get = frame => frame;
      m.update(5);
      assert.equal(m.threeObj.clearCoat, .5);
      assert.equal(m.threeObj.clearCoatRoughness, .2);
      assert.equal(m.threeObj.reflectivity, .8);
      assert.equal(m.pzUniforms.uPzEmissionStrength.value, 5);
      m.properties.reflReflection.set(1);
      m.properties.reflReflectionStrength.set(.7);
      m.properties.reflReflectionOpacity.set(.5);
      m.properties.reflReflectionRoughness.set(.35);
      m.update(5);
      assert.equal(m.threeObj.clearCoat, .35, "the existing reflection layer wins");
      assert.equal(m.threeObj.clearCoatRoughness, .35);
      for (const side of [0, 1, 2]) {
        m.properties.side.set(side); m.update(0);
        assert.equal(m.threeObj.shadowSide, side === 2 ? h.context.window.THREE.BackSide : null);
      }
      for (const [value, expected] of [[1, "FrontSide"], [2, "BackSide"], [3, "DoubleSide"]]) {
        m.properties.shadowSide.set(value);
        assert.equal(m.threeObj.shadowSide, h.context.window.THREE[expected]);
      }
    } finally { m?.unload(); for (const dispose of h.dispose.reverse()) dispose(); }
  });

  test(`${type} Environment uses a native image reference across save/open, replace, missing and reload`, async () => {
    const h = harness();
    const reloaders = [];
    h.context.apis.assets = { registerReloader(spec) { reloaders.push(spec); return () => {}; } };
    const assets = new Map();
    const ImageAsset = h.PZ.asset.image;
    h.PZ.asset.image = class extends ImageAsset {
      getImage() { return this.asset.key === "missing" ? { width: 0, height: 0 } : { width: 1023, height: 511 }; }
    };
    NodeMaterial.activate(h.context); Pbr.activate(h.context);
    const materials = [];
    const create = async data => {
      const m = h.material(type);
      m.parentProject.assets.load = key => { if (!assets.has(key)) assets.set(key, { key }); return assets.get(key); };
      (await h.PZ.material.fnList[type]).call(m); m.load(data); materials.push(m); await m.prepare(0); return m;
    };
    try {
      const m = await create();
      let gets = 0, releases = 0;
      const scene = {};
      m.parentLayer.envMap = { getTexture() { gets++; return scene; }, releaseTexture() { releases++; } };
      m.properties.reflection.set(1); m.update(0);
      assert.equal(m.threeObj.envMap, scene);
      m.properties.environmentIntensity.set(2);
      m.properties.environment.set("environment-a");
      await m.prepare(0);
      assert.equal(m.threeObj.envMapIntensity, 2, "the first prepared frame includes environment intensity");
      m.update(3);
      const texture = m.threeObj.envMap;
      assert.equal(texture, m.pzEnvironment.texture);
      assert.equal(texture.image.width, 512);
      assert.equal(texture.image.height, 256);
      assert.equal(texture.mapping, h.context.window.THREE.EquirectangularReflectionMapping);
      assert.equal(texture.generateMipmaps, true);
      assert.equal(m.threeObj.defines.PZ_ENVIRONMENT, 1);
      assert.equal(gets, releases, "custom environment releases its scene capture");
      m.properties.environmentIntensity.get = frame => frame;
      m.properties.environmentRotation.set(.4);
      m.update(3);
      assert.equal(m.threeObj.envMapIntensity, 3);
      assert.equal(m.pzUniforms.uPzEnvironmentRotation.value, .4);
      const saved = JSON.parse(JSON.stringify(m.toJSON()));
      assert.equal(saved.properties.environment, "environment-a");
      const opened = await create(saved);
      assert.equal(opened.pzEnvironment.asset, assets.get("environment-a"));
      assert.equal(opened.properties.environment.type, h.PZ.property.type.ASSET);
      assert.equal(opened.properties.environment.assetType, h.PZ.asset.type.IMAGE);
      // Native Replace writes this ASSET property, invoking its changed handler.
      opened.properties.environment.set("environment-b"); await opened.prepare(0);
      assert.equal(opened.pzEnvironment.asset, assets.get("environment-b"));
      assert.ok(h.unloaded.includes(assets.get("environment-a")));
      opened.properties.environment.set("missing"); await opened.prepare(0);
      assert.equal(opened.pzEnvironment.texture, null);
      assert.equal(JSON.parse(JSON.stringify(opened.toJSON())).properties.environment, "missing");
      opened.properties.environment.set("environment-b"); await opened.prepare(0);
      const previous = opened.threeObj.envMap;
      await reloaders[0].reload("environment-b", assets.get("environment-b"));
      assert.ok(previous.disposed);
      assert.notEqual(opened.threeObj.envMap, previous);
      m.properties.environment.set(null); m.update(0);
      assert.equal(m.threeObj.envMap, scene);
      assert.ok(texture.disposed);
    } finally { for (const m of materials) m.unload(); for (const dispose of h.dispose.reverse()) dispose(); }
  });
}

test("Environment native ASSET metadata participates in Remove Unused, Replace and undo", async () => {
  const { retainedFixture } = require("./asset-retention-fixture.js");
  const f = retainedFixture();
  const old = await f.add("studio.png", "image/png");
  const next = await f.add("outdoor.png", "image/png");
  const target = { props: {} };
  require("../plugins/material-plus/surface-controls.js")(target, { PZ: f.PZ });
  const def = target.props.environment;
  const material = f.child(f.project.sequence, new f.Obj("Node Material"));
  const property = new f.Property(def.name, old.key, def.type, def.assetType);
  f.properties(material, { environment: property });
  const read = () => { f.api.refresh(); return f.api.snapshot(); };
  assert.equal(read().items.find(item => item.id === old.key).usages.length, 1);
  assert.equal(f.api.removeUnused([old.key]).removed.length, 0);
  const result = await f.api.replace(old.key, { itemId: next.key });
  assert.equal(result.ok, true);
  assert.equal(result.replaced, 1);
  assert.equal(property.get(), next.key);
  f.editor.history.undo();
  assert.equal(property.get(), old.key);
  assert.ok(f.project.assets.list[old.key]);
  old.file = null; old.url = null;
  assert.equal(read().items.find(item => item.id === old.key).status, "missing");
  assert.equal(f.api.removeUnused([old.key]).removed.length, 0, "a missing authored environment is still used");
  f.api.dispose();
});

test("surface shader retains native chunks and installs emission, normal RNM and environment uniforms", () => {
  const h = harness();
  const THREE = h.context.window.THREE;
  THREE.ShaderChunk = {
    normalmap_pars_fragment: "vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;\nmapN.xy = normalScale * mapN.xy;\nmat3 tsn = mat3( S, T, N );",
    lights_pars_maps: "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
  };
  const donor = {};
  require("../plugins/material-plus/surface-material.js")(donor, {
    THREE, ...require("../plugins/material-plus/surface-shader.js")(THREE, h.context.document),
  });
  donor.load({ surfaceOnly: true });
  const shader = { uniforms: {}, vertexShader: "void main() {\n#include <uv_pars_vertex>\n#include <begin_vertex>\n}",
    fragmentShader: "#include <lights_pars_maps>\n#include <lights_physical_pars_fragment>\n#include <normalmap_pars_fragment>\nvoid main() {\n#include <emissivemap_fragment>\n#include <normal_fragment_maps>\n}" };
  donor.threeObj.onBeforeCompile(shader);
  for (const key of ["uPzGraphEmission", "uPzGraphNormal", "uPzEmissionStrength", "uPzEnvironmentRotation"]) {
    assert.equal(shader.uniforms[key], donor.pzUniforms[key]);
  }
  assert.match(shader.fragmentShader, /#include <emissivemap_fragment>/, "legacy luminance chunk survives");
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \+= texture2D\( uPzGraphEmission, vPzUv \)/);
  assert.match(shader.fragmentShader, /pzReorientBump\( vec3\( 0.0, 0.0, 1.0 \), normalize\( mapN \), normalize\( detailN \) \)/);
  assert.match(shader.fragmentShader, /normal = pzReorientBump\( pzSurfaceNormal, normal, pzBumpNormal \)/);
  assert.match(shader.fragmentShader, /reflectVec.xz = mat2/);
  donor.pzRampTexture.dispose(); donor.threeObj.dispose();
});
