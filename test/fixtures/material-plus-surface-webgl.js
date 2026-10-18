"use strict";

// Run with the cached CM3 THREE/PZ and plugin APIs in a browser on HTTP.
// Both baseline and candidate use native property serialization and the same
// deterministic scene, camera, project images, bake size and renderer.
module.exports = async function renderSurfaceWebgl(THREE, PZ, apis, bundle, document, baseline = false) {
  const modules = new Map();
  function load(name) {
    name = name.replace(/^\.\//, "");
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} }; modules.set(name, module);
    const source = bundle.assets.text["/plugins/material-plus/" + name];
    new Function("module", "exports", "require", source)(module, module.exports, load);
    return module.exports;
  }
  const image = document.createElement("canvas"); image.width = 1024; image.height = 512;
  const ctx = image.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1024, 512);
  gradient.addColorStop(0, "#eef8ff"); gradient.addColorStop(.35, "#a6d3fa");
  gradient.addColorStop(.5, "#344267"); gradient.addColorStop(.75, "#d58b49"); gradient.addColorStop(1, "#30384d");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = "white"; ctx.fillRect(80, 60, 160, 240); ctx.fillRect(680, 120, 100, 180);
  const normal = document.createElement("canvas"); normal.width = normal.height = 64;
  normal.getContext("2d").fillStyle = "rgb(180,145,240)";
  normal.getContext("2d").fillRect(0, 0, 64, 64);
  const pz = Object.assign(Object.create(PZ), { material: { fnList: {} }, zoidium: {},
    asset: { ...PZ.asset, image: class {
      constructor(asset) { this.asset = asset; this.loading = Promise.resolve(); }
      getImage() { return this.asset.key === "normal" ? normal : image; }
      getTexture() { const texture = new THREE.CanvasTexture(this.getImage()); return texture; }
    } } });
  const dispose = [];
  const win = { THREE, PZ: pz, ZoidiumPluginApis: apis, document, Worker, Blob, URL, setTimeout: setTimeout.bind(globalThis), performance };
  const context = { PZ: pz, window: win, document, plugin: { id: "material-plus" }, apis,
    lifecycle: { onDispose(fn) { dispose.push(fn); } },
    getAsset(type, path) { return bundle.assets.text[path.replace(/^\.\//, "/").split("?")[0]]; } };
  load("node-material.js").activate(context); load("pbr-plus.js").activate(context);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256); renderer.setClearColor(0x171b24);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const target = new THREE.WebGLRenderTarget(256, 256);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 30); camera.position.set(3, 2.5, 5); camera.lookAt(new THREE.Vector3(0, 0, 0));
  const light = new THREE.DirectionalLight(0xffffff, 1.8); light.position.set(-2, 4, 3); light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = light.shadow.camera.bottom = -3;
  light.shadow.camera.right = light.shadow.camera.top = 3; light.shadow.camera.near = .1; light.shadow.camera.far = 15;
  scene.add(light); scene.add(new THREE.AmbientLight(0x708090, .3));
  const geometry = new THREE.SphereBufferGeometry(1, 64, 40);
  const sphere = new THREE.Mesh(geometry); sphere.castShadow = sphere.receiveShadow = true; scene.add(sphere);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1 });
  const floorGeo = new THREE.PlaneBufferGeometry(20, 20);
  const floor = new THREE.Mesh(floorGeo, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.05; floor.receiveShadow = true; scene.add(floor);
  const cube = new THREE.CubeTexture(Array(6).fill(image)); cube.needsUpdate = true;
  const outputs = {};
  const materials = [];
  const create = async type => {
    const m = { type, parentLayer: { envMap: { getTexture: () => cube, releaseTexture() {} } },
      parentProject: { assets: { load: key => ({ key }), unload() {} }, sequence: { properties: { rate: { get: () => 30 } } } }, getAddress: () => [] };
    m.properties = new PZ.propertyList({}, m);
    (await pz.material.fnList[type]).call(m); m.load(); m.properties.bakeResolution.set(0);
    materials.push(m); return m;
  };
  const capture = async (name, material) => {
    await material.prepare(0); material.update(0); sphere.material = material.threeObj;
    renderer.render(scene, camera, target, true);
    const pixels = new Uint8Array(256 * 256 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    outputs[name] = Array.from(pixels);
  };
  const connect = (m, channels, params = {}) => {
    m.properties.useNodeGraph.set(1);
    m.properties.graph.set(JSON.stringify({ nodes: [{ id: "noise", type: "noise", params: { scale: 5, seed: 13, contrast: 1.4 } },
      { id: "color", type: "color", params: { color: [.8, .12, .03] } },
      { id: "normal", type: "color", params: { color: [.75, .4, .92] } },
      { id: "output", type: "output", params }], links: channels.map(([from, port]) => ({ from, fromPort: "out", to: "output", toPort: port })) }));
  };
  try {
    for (const type of ["nodes", "pbrplus"]) {
      const m = await create(type);
      await capture(type + "-default", m);
      m.properties.reflection.set(1); m.properties.reflReflection.set(1);
      m.properties.reflReflectionStrength.set(.6); m.properties.reflReflectionRoughness.set(.23);
      await capture(type + "-reflection-layer", m);
      m.properties.reflection.set(0); m.properties.reflReflection.set(0);
      m.properties.normalMap.set("normal"); m.properties.bumpStrength.set(.3);
      connect(m, [["noise", "bump"], ["color", "color"]]);
      await capture(type + "-normal-bump", m);
      connect(m, [["noise", "luminance"]]);
      await capture(type + "-luminance", m);
      m.properties.normalMap.set(null);
      connect(m, []);
      m.properties.side.set(2);
      await capture(type + "-shadow-auto", m);
      if (baseline) continue;
      m.properties.shadowSide.set(3);
      await capture(type + "-shadow-double", m);
      m.properties.shadowSide.set(0); m.properties.side.set(0);
      m.properties.metalness.set(1); m.properties.roughness.set(.2);
      await capture(type + "-metal-no-environment", m);
      m.properties.environment.set("environment");
      await capture(type + "-metal-environment", m);
      m.properties.environmentRotation.set(1.2);
      await capture(type + "-environment-rotated", m);
      m.properties.roughness.set(.8);
      await capture(type + "-environment-rough", m);
      m.properties.metalness.set(0); m.properties.roughness.set(.65);
      await capture(type + "-clearcoat-off", m);
      m.properties.clearcoat.set(1); m.properties.clearcoatRoughness.set(.04);
      await capture(type + "-clearcoat-on", m);
      m.properties.environment.set(null); m.properties.clearcoat.set(0);
      m.properties.color.set([.04, .04, .04]);
      await capture(type + "-emission-off", m);
      connect(m, [["color", "emission"]]);
      m.properties.emissionStrength.set(1.5);
      await capture(type + "-emission-color", m);
      connect(m, [["noise", "bump"]]);
      m.properties.bumpStrength.set(.2); m.properties.normalMap.set("normal");
      await capture(type + "-node-normal-off", m);
      connect(m, [["noise", "bump"], ["normal", "normal"]]);
      await capture(type + "-node-normal-on", m);
      m.properties.bumpNoise.set(1);
      await capture(type + "-node-normal-noise", m);
      m.properties.bumpNoise.set(0); m.properties.normalMap.set(null);
      connect(m, [["normal", "normal"]]);
      await capture(type + "-node-normal-only", m);
      connect(m, [["noise", "normal"]], { normalMode: 1, normalStrength: .08 });
      await capture(type + "-height-normal", m);
    }
    return { revision: THREE.REVISION, outputs };
  } finally {
    for (const m of materials) m.unload(); for (const fn of dispose.reverse()) fn();
    for (const r of [geometry, floorGeo, floorMat, cube, target, renderer]) r.dispose();
  }
};
