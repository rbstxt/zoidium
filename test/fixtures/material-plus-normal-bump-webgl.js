"use strict";

// Browser regression test. Pass the staged THREE r91 global, the Material+
// bundle JSON and document; returns pixel comparisons or throws on failure.
// Uses only bundled Zoidium sources; CM3 stays in the ignored runtime stage.
module.exports = async function verifyNormalBumpWebgl(THREE, bundle, document) {
  const load = name => {
    const module = { exports: {} };
    new Function("module", "exports", bundle.assets.text["/plugins/material-plus/" + name])(module, module.exports);
    return module.exports;
  };
  const donor = {};
  load("surface-material.js")(donor, { THREE, ...load("surface-shader.js")(THREE, document) });
  donor.load({ surfaceOnly: true });
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(64, 64);
  const target = new THREE.WebGLRenderTarget(64, 64);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.z = 3;
  const geometry = new THREE.PlaneBufferGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry);
  scene.add(mesh);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  const texture = (width, height, pixel) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...pixel(x, y), 255], (y * width + x) * 4);
    const result = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    result.magFilter = result.minFilter = THREE.LinearFilter;
    result.needsUpdate = true;
    return result;
  };
  const normal = texture(2, 2, () => [204, 145, 227]);
  const bump = texture(64, 64, (x, y) => { const value = Math.round(30 + x * 2 + y); return [value, value, value]; });
  const flatBump = texture(2, 2, () => [128, 128, 128]);
  const oppositeNormal = texture(2, 2, () => [128, 128, 0]);
  const render = ({ patched = true, normalMap = null, bumpMap = null, normalScale = 1, bumpScale = 1, rotation = [0, 0, 0], side = THREE.FrontSide } = {}) => {
    const material = new THREE.MeshPhysicalMaterial({ normalMap, bumpMap, bumpScale, side });
    material.normalScale.set(normalScale, normalScale);
    material.defines = Object.fromEntries(["PZ_PROJECTION", "PZ_RAMP_SRC", "PZ_RAMP", "PZ_GRAPH_COLOR", "PZ_FRESNEL", "PZ_AO", "PZ_AO_MAP", "PZ_CEL"].map(key => [key, 0]));
    material.onBeforeCompile = shader => {
      if (patched) donor.threeObj.onBeforeCompile(shader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor = vec4( normal * 0.5 + 0.5, 1.0 );');
    };
    mesh.material = material;
    mesh.rotation.set(...rotation);
    renderer.render(scene, camera, target, true);
    const pixels = new Uint8Array(64 * 64 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
    material.dispose();
    return pixels;
  };
  const distance = (a, b) => { let max = 0; for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a[(y * 64 + x) * 4 + c] - b[(y * 64 + x) * 4 + c])); return max; };
  const results = [];
  const check = (name, actual, limit = 0) => { results.push({name, maxChannelError: actual, limit}); if (actual > limit) throw Error(name + ': ' + actual + ' > ' + limit); };
  try {
    for (const options of [{}, {normalMap: normal}, {bumpMap: bump}, {normalMap: normal, rotation:[.2,.3,.1]}, {bumpMap:bump, rotation:[.2,.3,.1]}]) {
      check('single-map parity ' + JSON.stringify({normal:!!options.normalMap,bump:!!options.bumpMap,rotation:options.rotation}), distance(render(options), render({...options,patched:false})));
    }
    const both = {normalMap:normal, bumpMap:bump, bumpScale:.8};
    check('zero bump strength', distance(render({...both,bumpScale:0}), render({normalMap:normal,patched:false})), 1);
    check('zero normal strength', distance(render({...both,normalScale:0}), render({bumpMap:bump,bumpScale:.8,patched:false})), 1);
    check('constant bump identity', distance(render({...both,bumpMap:flatBump}), render({normalMap:normal,patched:false})), 1);
    const combined = render(both);
    const normalOnly = render({normalMap:normal});
    const bumpOnly = render({bumpMap:bump,bumpScale:.8});
    const normalDelta = distance(combined, normalOnly), bumpDelta = distance(combined, bumpOnly);
    if (normalDelta < 5 || bumpDelta < 5) throw Error('A map was ignored: ' + normalDelta + ', ' + bumpDelta);
    results.push({name:'both maps contribute', normalDelta,bumpDelta});
    // Compare the actual shader against an independent axis-angle rotation.
    // Decode native geometric/map/bump normals, rotate the bump with Rodrigues.
    const v = (pixels, i) => new THREE.Vector3(...Array.from(pixels.slice(i, i + 3), x => x / 255 * 2 - 1)).normalize();
    for (const [name, options] of [['front',both], ['rotated',{...both,rotation:[.2,.3,.1]}], ['back',{...both,rotation:[0,Math.PI,0],side:THREE.DoubleSide}], ['negative bump',{...both,bumpScale:-.8}]]) {
      const base = render({...options,patched:false,normalMap:null,bumpMap:null});
      const mapped = render({...options,patched:false,bumpMap:null});
      const detail = render({...options,patched:false,normalMap:null});
      const actual = render(options);
      let max = 0;
      for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) {
        const i = (y * 64 + x) * 4;
        const s = v(base,i), t = v(mapped,i), u = v(detail,i);
        const axis = new THREE.Vector3().crossVectors(s,t);
        const angle = Math.atan2(axis.length(), s.dot(t));
        if (axis.lengthSq() > 1e-10) u.applyAxisAngle(axis.normalize(),angle);
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(Math.round((u.getComponent(c) * .5 + .5) * 255) - actual[i+c]));
      }
      check('RNM reference ' + name,max,3);
    }
    const anti = render({...both,normalMap:oppositeNormal,normalScale:0});
    if (anti[(32 * 64 + 32) * 4 + 3] !== 255) throw Error('Opposite normals did not render');
    results.push({name:'opposite normals remain finite',pixel:Array.from(anti.slice((32*64+32)*4,(32*64+32)*4+4))});
    if (errors.length) throw Error(errors.join('\n'));
    return {revision:THREE.REVISION,results,shaderErrors:errors};
  } finally {
    console.error = originalError;
    donor.pzRampTexture.dispose(); donor.threeObj.dispose();
    geometry.dispose(); target.dispose(); renderer.dispose();
    for (const map of [normal,bump,flatBump,oppositeNormal]) map.dispose();
  }
};
