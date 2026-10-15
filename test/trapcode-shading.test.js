"use strict";

// Coverage for the shared Trapcode shading model (trapcode-common.js
// T.shading, used by Form Shading and Particular Lighting): scene light
// collection is a pure function of the scene graph, donor defaults keep
// shading off, the JS mirror of the shader math is bounded and
// deterministic, and the material update only touches the shader while on.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite, readSource } = require("./trapcode-env");

function loadShading() {
  const { PZ, THREE } = loadSuite(["trapcode-common.js"]);
  return { T: PZ.trapcode, PZ, THREE };
}

function stubGroup(values) {
  const group = {};
  for (const key of Object.keys(values)) {
    group[key] = { get: () => values[key] };
  }
  return group;
}

function formLikeGroup() {
  return stubGroup({
    shading: 1, lightFalloff: 1, nominalDistance: 250, ambient: 20,
    diffuse: 80, specularAmount: 50, specularSharpness: 50,
    reflectionStrength: 100, shadowlet: 1,
  });
}

const POINT = (x, y, z, intensity = 1) => ({
  kind: 0, color: [1, 1, 1], intensity, position: [x, y, z], direction: null,
});

test("donor defaults keep shading off and read both control layouts", () => {
  const { T } = loadShading();
  const off = T.shading.readParams({});
  assert.equal(off.on, 0);
  assert.equal(off.ambient, 0.2);
  assert.equal(off.diffuse, 0.8);
  assert.equal(off.falloff, 0);
  assert.equal(off.nominal, 250);
  assert.equal(off.shadowlet, 0);
  const form = T.shading.readParams(formLikeGroup());
  assert.equal(form.on, 1);
  assert.equal(form.falloff, 1);
  assert.equal(form.specAmt, 0.5);
  assert.equal(form.specSharp, 0.5);
  assert.equal(form.shadowlet, 1);
  const particular = T.shading.readParams(stubGroup({ enabled: 1, ambient: 30 }));
  assert.equal(particular.on, 1);
  assert.equal(particular.ambient, 0.3);
  assert.equal(particular.shadowlet, 0, "missing shadowlet falls back to off");
});

test("real definition groups default to off with donor values", () => {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "form.js", "particular.js"]);
  THREE.Material = class {
    constructor(params) {
      Object.assign(this, params || {});
      this.defines = (params && params.defines) || {};
    }
    dispose() {}
  };
  const form = new PZ.object3d.form();
  form.load(null);
  const shading = form.forms[0].properties.shading;
  assert.equal(shading.shading.get(0), 0);
  assert.equal(shading.nominalDistance.get(0), 250);
  assert.equal(shading.shadowlet.get(0), 0);
  const lighting = new PZ.object3d.particular.system().properties.lighting;
  assert.equal(lighting.enabled.get(0), 0);
  assert.equal(lighting.nominalDistance.get(0), 250);
  assert.equal(lighting.shadowlet.get(0), 0);
});

test("light collection is a pure function of the scene graph", () => {
  const { T, THREE } = loadShading();
  const root = new THREE.Object3D();
  const holder = new THREE.Object3D();
  root.add(holder);
  const point = new THREE.PointLight(0xffffff, 2, 0);
  point.position.set(100, 0, 0);
  root.add(point);
  const directional = new THREE.DirectionalLight(0xffffff, 1);
  directional.position.set(0, 50, 0);
  root.add(directional);
  const first = T.shading.collectLights(holder);
  const second = T.shading.collectLights(holder);
  assert.deepEqual(second, first);
  assert.equal(first.length, 2);
  assert.equal(first[0].kind, T.shading.KIND_POINT);
  assert.deepEqual(first[0].position, [100, 0, 0]);
  assert.equal(first[0].intensity, 2);
  assert.equal(first[1].kind, T.shading.KIND_DIRECTIONAL);
  const dir = first[1].direction;
  assert.ok(Math.abs(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2] - 1) < 1e-9);
  const empty = T.shading.collectLights(new THREE.Object3D());
  assert.deepEqual(empty, []);
});

test("shadePoint is ambient-only without lights and brighter near a light", () => {
  const { T } = loadShading();
  const params = T.shading.readParams(formLikeGroup());
  const camera = [0, 0, 1000];
  const ambientOnly = T.shading.shadePoint([0, 0, 0], camera, params, [], null);
  assert.deepEqual(ambientOnly.mul, [0.2, 0.2, 0.2]);
  assert.deepEqual(ambientOnly.spec, [0, 0, 0]);
  const near = T.shading.shadePoint([240, 0, 0], camera, params, [POINT(250, 0, 0)], null);
  const far = T.shading.shadePoint([0, 0, 0], camera, params, [POINT(250, 0, 0)], null);
  assert.ok(near.mul[0] > far.mul[0], "inverse square falloff favors the near particle");
  assert.ok(far.mul[0] > 0.2, "far particle still gets diffuse light");
  const repeat = T.shading.shadePoint([240, 0, 0], camera, params, [POINT(250, 0, 0)], null);
  assert.deepEqual(repeat, near);
});

test("falloff none ignores distance, specular stays bounded", () => {
  const { T } = loadShading();
  const params = T.shading.readParams(stubGroup({
    shading: 1, lightFalloff: 3, nominalDistance: 250, ambient: 20,
    diffuse: 80, specularAmount: 100, specularSharpness: 1,
    reflectionStrength: 100, shadowlet: 0,
  }));
  const camera = [0, 0, 1000];
  const a = T.shading.shadePoint([200, 0, 0], camera, params, [POINT(250, 0, 0, 2)], null);
  const b = T.shading.shadePoint([0, 0, 0], camera, params, [POINT(250, 0, 0, 2)], null);
  assert.ok(Math.abs(a.mul[0] - b.mul[0]) < 0.05, "no falloff washes out distance");
  for (const v of a.spec.concat(b.spec)) assert.ok(v >= 0 && v <= 8, "specular bounded, got " + v);
});

test("shadowlet darkens the far side within a 0.4..1 band", () => {
  const { T } = loadShading();
  const params = T.shading.readParams(formLikeGroup());
  const box = { min: [-100, -100, -100], max: [100, 100, 100], center: [0, 0, 0] };
  const camera = [0, 0, 1000];
  const light = { kind: 1, color: [1, 1, 1], intensity: 1, position: null, direction: [1, 0, 0] };
  const front = T.shading.shadePoint([-100, 0, 0], camera, params, [light], box);
  const back = T.shading.shadePoint([100, 0, 0], camera, params, [light], box);
  assert.ok(back.mul[0] < front.mul[0], "back of the cloud is darker");
  const ratio = back.mul[0] / front.mul[0];
  assert.ok(ratio >= 0.4 && ratio <= 1, "shadowlet band holds, got " + ratio);
  const noShadow = Object.assign({}, params, { shadowlet: 0 });
  const plain = T.shading.shadePoint([100, 0, 0], camera, noShadow, [light], box);
  assert.ok(plain.mul[0] > back.mul[0], "shadowlet off skips the darkening");
});

test("material update toggles the define only while on", () => {
  const { T, THREE } = loadShading();
  const root = new THREE.Object3D();
  const holder = new THREE.Object3D();
  root.add(holder);
  const light = new THREE.PointLight(0xffffff, 1, 0);
  light.position.set(50, 0, 0);
  root.add(light);
  const material = { uniforms: T.shading.newUniforms(), defines: {}, needsUpdate: false };
  assert.equal(T.shading.update(material, stubGroup({ shading: 0 }), holder, null), false);
  assert.ok(!material.defines.USE_SHADING);
  assert.equal(T.shading.update(material, formLikeGroup(), holder, null), true);
  assert.equal(material.defines.USE_SHADING, 1);
  assert.equal(material.uniforms.uShadeLightCount.value, 1);
  assert.equal(material.uniforms.uShadeFalloff.value, 1);
  assert.ok(material.needsUpdate, "define flip recompiles");
  material.needsUpdate = false;
  assert.equal(T.shading.update(material, stubGroup({ shading: 0 }), holder, null), false);
  assert.ok(!material.defines.USE_SHADING);
  assert.ok(material.needsUpdate, "define removal recompiles");
});

test("uniform block covers every uniform the GLSL declares", () => {
  const { T } = loadShading();
  const uniforms = T.shading.newUniforms();
  const declared = {};
  for (const line of T.shading.VERTEX_LINES) {
    const match = line.match(/^uniform\s+(float|vec3)\s+(\w+)(\[4\])?;/);
    if (match) declared[match[2]] = match[3] ? "array" : match[1];
  }
  assert.ok(Object.keys(declared).length >= 14, "block declares its uniforms");
  for (const name of Object.keys(declared)) {
    assert.ok(uniforms[name], "uniform present: " + name);
    if (declared[name] === "array") assert.equal(uniforms[name].value.length, 4, name + " fits MAX_LIGHTS");
  }
  const apply = T.shading.applyLines("position").join("\n");
  assert.ok(apply.includes("shadeSurface(position,"), "apply snippet uses the world expression");
});

test("the shading path uses no wall clock, history, or Math.random", () => {
  const sources = ["trapcode-common.js", "form.js", "particular.js"]
    .map((file) => readSource(file)).join("\n");
  assert.ok(!sources.includes("Math.random("), "no Math.random in the suite sources");
  assert.ok(!sources.includes("Date.now("), "no wall clock in the suite sources");
  assert.ok(!sources.includes("performance.now("), "no performance clock in the suite sources");
});

// Identifiers the assembled shaders may use without declaring.
const GLSL_PREAMBLE = new Set([
  "float", "int", "bool", "void", "vec2", "vec3", "vec4", "mat3", "mat4",
  "sampler2D", "uniform", "attribute", "varying", "const",
  "precision", "highp", "mediump", "lowp",
  "if", "else", "for", "while", "do", "break", "continue", "return", "discard",
  "true", "false", "in", "out", "inout",
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan",
  "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
  "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max", "clamp",
  "mix", "step", "smoothstep", "length", "distance", "dot", "cross",
  "normalize", "faceforward", "reflect", "refract", "matrixCompMult",
  "lessThan", "lessThanEqual", "greaterThan", "greaterThanEqual",
  "equal", "notEqual", "any", "all", "not",
  "texture2D", "textureCube", "texture2DLodEXT",
  "dFdx", "dFdy", "fwidth",
  // Provided by the three.js ShaderMaterial vertex prefix.
  "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix",
  "normalMatrix", "cameraPosition", "position", "normal", "uv", "color",
  // GLSL ES built-in outputs.
  "gl_Position", "gl_PointSize", "gl_PointCoord", "gl_FragColor", "gl_FrontFacing",
]);

function checkAssembledShader(source, label) {
  let depth = 0;
  let ppDepth = 0;
  const declared = new Set();
  const definedFunctions = new Set();
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text.startsWith("#")) {
      if (/^#if/.test(text)) ppDepth++;
      else if (/^#endif/.test(text)) ppDepth = Math.max(0, ppDepth - 1);
      continue;
    }
    const outerDepth = depth;
    for (const ch of text) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      assert.ok(depth >= 0, label + " closes no unopened block: " + text);
    }
    const decl = text.match(/^(uniform|attribute|varying)\s+\w+\s+([A-Za-z_]\w*)/);
    if (decl) {
      // Branches (#ifdef/#else) may legitimately declare the same name.
      if (ppDepth === 0) assert.ok(!declared.has(decl[2]), label + " declares " + decl[2] + " twice");
      declared.add(decl[2]);
    }
    const fn = text.match(/^(\w[\w\d]*)\s+([A-Za-z_]\w*)\s*\(/);
    if (fn && outerDepth === 0 && !["if", "for", "while"].includes(fn[2])) {
      definedFunctions.add(fn[2]);
      const params = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")).split(",");
      for (const param of params) {
        const name = param.trim().split(/\s+/).pop();
        if (name && /^[A-Za-z_]\w*$/.test(name)) declared.add(name);
      }
    }
    const core = text.replace(/^}\s*else[^{]*{\s*/, "").replace(/^else[^{]*{\s*/, "");
    const loop = core.match(/^for\s*\(\s*(?:int|float)\s+([A-Za-z_]\w*)/);
    if (loop) declared.add(loop[1]);
    const local = core.match(/^(?:float|int|bool|vec2|vec3|vec4|mat3|mat4)\s+(.+?);/);
    if (local) {
      // Split top-level commas only (initializers may call with commas).
      const pieces = [];
      let pieceDepth = 0;
      let piece = "";
      for (const ch of local[1]) {
        if (ch === "(") pieceDepth++;
        if (ch === ")") pieceDepth--;
        if (ch === "," && pieceDepth === 0) {
          pieces.push(piece);
          piece = "";
        } else {
          piece += ch;
        }
      }
      pieces.push(piece);
      for (const part of pieces) {
        const head = part.split("=")[0].trim().split(/\s+/).pop();
        if (head && /^[A-Za-z_]\w*$/.test(head)) declared.add(head);
      }
    }
  }
  assert.equal(depth, 0, label + " braces balance");
  const used = new Set();
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text.startsWith("#")) continue;
    // Swizzle/field access never needs a declaration.
    const code = text
      .replace(/^(uniform|attribute|varying)\s+\w+\s+[A-Za-z_]\w*.*$/, "")
      .replace(/\.\s*[A-Za-z_]\w*/g, "");
    for (const match of code.matchAll(/\b([A-Za-z_]\w*)\b/g)) used.add(match[1]);
  }
  for (const name of used) {
    if (/^\d+$/.test(name)) continue;
    assert.ok(
      declared.has(name) || definedFunctions.has(name) || GLSL_PREAMBLE.has(name),
      label + " uses undeclared identifier: " + name
    );
  }
}

test("assembled Form and Particular vertex shaders declare everything they use", () => {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "form.js", "particular.js"]);
  THREE.Material = class {
    constructor(params) {
      Object.assign(this, params || {});
      this.defines = (params && params.defines) || {};
    }
    dispose() {}
  };
  const form = new PZ.object3d.form();
  form.load(null);
  checkAssembledShader(form.forms[0].material.vertexShader, "form");
  const system = new PZ.object3d.particular.system();
  system.rebuildMaterial();
  checkAssembledShader(system.material.vertexShader, "particular");
});
