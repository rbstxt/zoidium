"use strict";
const { plan } = require("./looks-instances.js");

// Reuse the released tool math verbatim. Each instance gets its own uniforms
// and functions; consecutive color stages share one shader and one draw.
function compile(source, instances, tools) {
  const functions = ["fxCc", "fxHsl", "fxCr", "fxCru", "fxCon", "fxCrev", "fxStrip", "fxLgg", "fxRsat", "fxWc",
    "fxFw4", "fxMojo", "fxAsh", "fxCurv", "fxScv", "fxLut", "fxLfl", "fxDfl", "fxVig", "fxHaze", "fxPop",
    "fxDif", "fxStar", "fxAna", null, "fxShut", "fxEdge", "fxCa", "fxTele"];
  const shared = source.slice(source.indexOf("uniform sampler2D tDiffuse;"), source.indexOf("// ---------- chain stages"));
  const pieces = ["uniform sampler2D tDiffuse; uniform vec2 resolution; uniform vec2 uvScale;",
    "uniform float mlInputStraight; uniform float mlOutputStraight; varying vec2 vUv;"];
  for (const instance of instances) {
    const name = functions[tools.indexOf(instance.tool)];
    const start = name ? source.indexOf("vec3 " + name + "(") : -1;
    const end = start < 0 ? -1 : source.indexOf("\n}", start) + 2;
    let part = (shared + (name ? source.slice(start, end) : ""))
      .replace(/^uniform (?:sampler2D tDiffuse|vec2 resolution|vec2 uvScale);$/gm, "")
      .replace(/^varying .*;$/gm, "")
      .replace("return t.a > 0.000001 ? t.rgb / t.a : vec3(0.0);",
        "return t.a > 0.000001 ? (mlInputStraight > 0.5 ? t.rgb : t.rgb / t.a) : vec3(0.0);");
    part = part.replace(/\b(u_\w+|uCurvesLUT|uSCurveLUT|lk\w+|fx\w+)\b/g, name => name + "_" + instance.id);
    pieces.push(part);
  }
  const lens = instances.length === 1 && instances[0].tool === "lens-distortion" ? instances[0].id : null;
  const lines = ["void main(){vec2 uv=vUv;"];
  if (lens) lines.push(`
    vec2 off=uv-vec2(0.5);float r2=dot(off,off);
    float f=1.0+u_lensDistortion_${lens}*r2*4.0;
    uv=vec2(0.5+off.x*f,0.5+off.y*(1.0+u_lensDistortion_${lens}*r2*4.0*u_lensFlatten_${lens}));`);
  lines.push("vec4 src=texture2D(tDiffuse,clamp(uv,vec2(0.0),vec2(1.0))*uvScale);float a=src.a;",
    "vec3 c=a>0.000001?(mlInputStraight>0.5?src.rgb:src.rgb/a):vec3(0.0);");
  for (const instance of instances) {
    const name = functions[tools.indexOf(instance.tool)];
    if (name) lines.push(`c=${name}_${instance.id}(c,uv);`);
  }
  lines.push("gl_FragColor=mlOutputStraight>0.5?vec4(a>0.000001?c:vec3(0.0),a):vec4(clamp(c,0.0,1.0)*a,a);}");
  return pieces.concat(lines).join("\n");
}

function create(effect, THREE, tools, getAsset, makeStage) {
  const stages = new Map(), passes = new Map();
  let active = [], targets = [], disposed = false;
  const source = getAsset("text", "./plugins/magic-looks/looks-grade.glsl");
  const vertex = getAsset("text", "./plugins/magic-looks/looks-vert.glsl");
  function releasePass(pass) {
    pass.material.dispose();
    pass.quad?.geometry?.dispose();
  }
  function reconcile() {
    const order = effect.looksInstances.order, ids = new Set(order.map(item => item.id));
    for (const [id, stage] of stages) if (!ids.has(id)) { stage.unload(); stages.delete(id); }
    for (const instance of order) if (!stages.has(instance.id)) stages.set(instance.id, makeStage(instance));
    const wanted = new Set();
    active = plan(order, item => stages.get(item.id)._looksActiveTools[item.tool]);
    for (const entry of active) {
      const signature = entry.instances.map(item => item.id).join("/");
      wanted.add(signature);
      if (!passes.has(signature)) {
        const uniforms = {
          tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
          uvScale: { value: new THREE.Vector2(1, 1) }, mlInputStraight: { value: 0 }, mlOutputStraight: { value: 0 },
        };
        for (const item of entry.instances) {
          for (const [name, value] of Object.entries(stages.get(item.id).pass.uniforms)) {
            if (/^(u_|uCurvesLUT|uSCurveLUT)/.test(name)) uniforms[name + "_" + item.id] = value;
          }
        }
        const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex,
          fragmentShader: compile(source, entry.instances, tools), depthTest: false, depthWrite: false,
          blending: THREE.NoBlending });
        passes.set(signature, new THREE.ShaderPass(material));
      }
      entry.pass = passes.get(signature);
    }
    for (const [signature, pass] of passes) if (!wanted.has(signature)) {
      releasePass(pass); passes.delete(signature);
    }
  }
  return {
    async prepare(frame) {
      if (disposed) return;
      reconcile();
      await Promise.all(Array.from(stages.values(), stage => stage.prepare(frame)));
    },
    update(frame) {
      if (disposed) return;
      reconcile();
      for (const stage of stages.values()) stage.update(frame);
      reconcile();
      effect.pass.enabled = effect.properties.enabled.get(frame) === 1 && active.length > 0;
    },
    render(renderer, writeBuffer, readBuffer) {
      if (!active.length) return;
      const scale = effect.pass.uniforms.uvScale.value;
      const width = Math.max(1, Math.round(readBuffer.width * scale.x));
      const height = Math.max(1, Math.round(readBuffer.height * scale.y));
      const needed = Math.min(2, active.length - 1);
      while (targets.length > needed) targets.pop().dispose();
      while (targets.length < needed) targets.push(new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
        type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      }));
      for (const target of targets) if (target.width !== width || target.height !== height) target.setSize(width, height);
      let input = readBuffer;
      const resolution = effect.parentLayer.properties.resolution.get();
      for (let i = 0; i < active.length; i++) {
        const pass = active[i].pass, last = i === active.length - 1;
        const output = last ? writeBuffer : targets[i % 2];
        pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
        pass.uniforms.uvScale.value.set(i === 0 ? scale.x : 1, i === 0 ? scale.y : 1);
        pass.uniforms.mlInputStraight.value = i === 0 ? 0 : 1;
        pass.uniforms.mlOutputStraight.value = last ? 0 : 1;
        pass.renderToScreen = last && effect.pass.renderToScreen;
        pass.render(renderer, output, input, true);
        input = output;
      }
    },
    reload: async (key, asset) => Promise.all(Array.from(stages.values(), stage => stage._looksLutAssets.reload(key, asset))),
    stage: id => stages.get(id),
    dispose() {
      disposed = true;
      for (const stage of stages.values()) stage.unload();
      for (const pass of passes.values()) releasePass(pass);
      for (const target of targets) target.dispose();
      stages.clear(); passes.clear(); targets = []; active = [];
    },
  };
}
module.exports = { compile, create };
