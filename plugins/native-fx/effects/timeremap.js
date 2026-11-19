"use strict";

// Native FX (temporal): Time Remap retimes the layer input. Speed mode
// integrates a keyframeable percentage from the clip start; remap mode reads a
// keyframeable source time. Frame blending optionally mixes the two source
// frames around a fractional clock with the host frame sampler.
const timeRemapEffect = this;
if (typeof timeRemapEffect._zoidiumGetAsset !== "function") {
  throw new Error("[Zoidium] Time Remap requires bundled assets.");
}
const timeRemapRequire = ZoidiumPluginApis.modules.createRequire(
  timeRemapEffect._zoidiumGetAsset.bind(timeRemapEffect),
  { root: "./plugins/native-fx/time-remap/" },
);
const timeRemapMath = timeRemapRequire("./math.js");
const timeRemapInterpolate = timeRemapRequire("./interpolate.js");

const timeRemapVertexShader = [
  "uniform vec2 uvScale;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vUvScaled = uv * uvScale;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");
const timeRemapFragmentShader = [
  "precision highp float;",
  "uniform sampler2D tFrameA;",
  "uniform sampler2D tFrameB;",
  "uniform float mixWeight;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vec4 first = texture2D(tFrameA, vUvScaled);",
  "  vec4 second = texture2D(tFrameB, vUvScaled);",
  "  gl_FragColor = first + (second - first) * mixWeight;",
  "}",
].join("\n");

function timeRemapNumber(property, frame, fallback) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function timeRemapOption(property, frame, fallback) {
  return Math.round(timeRemapNumber(property, frame, fallback));
}

function timeRemapRate(effect) {
  try {
    const layer = effect.parentLayer || effect.tryGetParentOfType?.(PZ.layer);
    const sequence = layer?.getParentOfType?.(PZ.sequence) || layer?.parentProject?.sequence;
    const rate = Number(sequence?.properties?.rate?.get?.());
    return Number.isFinite(rate) && rate > 0 ? rate : 30;
  } catch (_error) {
    return 30;
  }
}

function timeRemapSpeedCache(effect) {
  let cache = effect._zoidiumTimeRemapCache;
  if (!cache) {
    cache = { signature: null, prefix: [0] };
    effect._zoidiumTimeRemapCache = cache;
  }
  return cache;
}

// Expression-driven speed must not reuse a prefix across evaluations: the
// expression can read other animated project values that the keyframe data
// does not contain. It shares one table only inside the current host
// evaluation token, which the host changes as layers are evaluated.
function timeRemapSpeedMemo(effect) {
  let memo = effect._zoidiumTimeRemapMemo;
  if (!memo) {
    memo = { token: undefined, signature: null, prefix: [0] };
    effect._zoidiumTimeRemapMemo = memo;
  }
  return memo;
}

function timeRemapEvaluationToken() {
  try {
    const temporal = PZ.zoidium?.temporal;
    const epoch = Number(temporal?.evaluationEpoch);
    // Without a host evaluation counter, integrate per call instead of
    // risking a table from another evaluation.
    if (!Number.isFinite(epoch)) return undefined;
    const context = temporal.contexts?.[temporal.contexts.length - 1];
    const output = Number(context?.outputFrame);
    return epoch + ":" + (Number.isFinite(output) ? output : "");
  } catch (_error) {
    return undefined;
  }
}

function timeRemapIsAdjustmentLayer(effect) {
  const Adjustment = PZ.layer?.adjustment;
  const layer = effect.parentLayer || effect.tryGetParentOfType?.(PZ.layer);
  return Boolean(Adjustment && layer instanceof Adjustment);
}

function timeRemapBlendWeights(frame) {
  const taps = timeRemapMath.blendTaps(frame);
  return { taps, first: 1 - taps.fraction, second: taps.fraction };
}

const timeRemapLifecycle = {
  load(data) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tFrameA: { type: "t", value: null },
        tFrameB: { type: "t", value: null },
        mixWeight: { type: "f", value: 0 },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
      },
      vertexShader: timeRemapVertexShader,
      fragmentShader: timeRemapFragmentShader,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const copyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.CopyShader.uniforms),
      vertexShader: THREE.CopyShader.vertexShader,
      fragmentShader: THREE.CopyShader.fragmentShader,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const blendPass = new THREE.ShaderPass(material);
    const copyPass = new THREE.ShaderPass(copyMaterial);
    timeRemapEffect._zoidiumTimeRemapMaterial = material;
    timeRemapEffect._zoidiumTimeRemapCopyMaterial = copyMaterial;
    timeRemapEffect._zoidiumTimeRemapBlendPass = blendPass;
    timeRemapEffect._zoidiumTimeRemapCopyPass = copyPass;
    timeRemapEffect._zoidiumTimeRemapTaps = null;
    timeRemapEffect.pass = {
      enabled: false,
      uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      render(renderer, writeBuffer, readBuffer) {
        const temporal = PZ.zoidium?.temporal;
        const samples = temporal?.resolveFrameSamples?.(timeRemapEffect) || [];
        const taps = timeRemapEffect._zoidiumTimeRemapTaps;
        const uvScale = timeRemapEffect.pass.uniforms.uvScale.value;
        if (samples.length !== 2 || !taps) {
          copyPass.uniforms.uvScale.value.copy(uvScale);
          copyPass.uniforms.uvOffset.value.set(0, 0);
          copyPass.uniforms.opacity.value = 1;
          copyPass.uniforms.tDiffuse.value = readBuffer.texture;
          copyPass.render(renderer, writeBuffer, readBuffer, true);
          return;
        }
        blendPass.uniforms.uvScale.value.copy(uvScale);
        blendPass.uniforms.tFrameA.value = samples[0].texture;
        blendPass.uniforms.tFrameB.value = samples[1].texture;
        blendPass.uniforms.mixWeight.value = taps.mix;
        blendPass.render(renderer, writeBuffer, null, true);
      },
    };
    timeRemapEffect.properties.load(data && data.properties);
  },
  update(frame) {
    const pass = timeRemapEffect.pass;
    if (!pass) return;
    const enabled = timeRemapOption(timeRemapEffect.properties.enabled, frame, 1) === 1;
    const blend = timeRemapOption(timeRemapEffect.properties.blend, frame, 0);
    let active = enabled && blend !== 0;
    // On an ordinary layer the update frame is the mapped source clock, so an
    // integer source time needs no taps and the pass can be skipped. An
    // adjustment layer's mapped clock is known only to the host, so its pass
    // stays enabled and copies the input when no taps exist.
    if (active && blend === 1 && !timeRemapIsAdjustmentLayer(timeRemapEffect)) {
      active = timeRemapMath.blendTaps(frame).fraction > timeRemapMath.EPSILON;
    }
    pass.enabled = active;
  },
  prepare: async function prepare() {},
  resize() {},
  unload() {
    timeRemapEffect._zoidiumTimeRemapMaterial?.dispose?.();
    timeRemapEffect._zoidiumTimeRemapCopyMaterial?.dispose?.();
    timeRemapEffect._zoidiumTimeRemapMaterial = null;
    timeRemapEffect._zoidiumTimeRemapCopyMaterial = null;
    timeRemapEffect._zoidiumTimeRemapBlendPass?.quad?.geometry?.dispose?.();
    timeRemapEffect._zoidiumTimeRemapCopyPass?.quad?.geometry?.dispose?.();
    timeRemapEffect._zoidiumTimeRemapBlendPass = null;
    timeRemapEffect._zoidiumTimeRemapCopyPass = null;
    timeRemapEffect._zoidiumTimeRemapTaps = null;
    timeRemapEffect.pass = null;
  },
};

// Both contracts share the same properties. defineTemporal installs the
// lifecycle; defineFrameSampler reinstalls it and wraps update/prepare with
// the frame sampler hooks, so it must be the second call.
ZoidiumPluginApis.defineTemporal.call(timeRemapEffect, {
  kind: "time-remap",
  displayName: "Time Remap",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    mode: {
      dynamic: true,
      name: "Mode",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "speed;remap",
    },
    speed: {
      dynamic: true,
      name: "Speed (%)",
      type: PZ.property.type.NUMBER,
      value: 100,
      min: -10000,
      max: 10000,
      step: 1,
      decimals: 3,
    },
    remap: {
      dynamic: true,
      name: "Remap source time",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
    },
    sourceTime: {
      dynamic: true,
      name: "Source time (s)",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: -100000,
      max: 100000,
      step: 0.01,
      decimals: 3,
    },
    blend: {
      dynamic: true,
      name: "Frame blending",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "off;frame mix",
    },
  },
  getOperator(effect, frame) {
    if (timeRemapOption(effect.properties.enabled, frame, 1) !== 1) return null;
    if (timeRemapOption(effect.properties.mode, frame, 0) === 0) {
      const mapper = timeRemapMath.speedMap(effect.properties.speed, {
        cache: timeRemapSpeedCache(effect),
        memo: timeRemapSpeedMemo(effect),
        token: timeRemapEvaluationToken(),
      });
      // The default row is exactly identity: no operator, no extra clock work.
      if (mapper.constant !== null && Math.abs(mapper.constant - timeRemapMath.IDENTITY_SPEED) < 1e-9) {
        return null;
      }
      return { kind: "time-remap", enabled: true, mode: "speed", map: mapper.map };
    }
    // Remap starts off so that choosing the mode cannot jump the footage.
    if (timeRemapOption(effect.properties.remap, frame, 0) !== 1) return null;
    const seconds = timeRemapMath.remapSeconds(effect.properties.sourceTime, frame);
    if (seconds === null) return null;
    const source = seconds * timeRemapRate(effect);
    return {
      kind: "time-remap",
      enabled: true,
      mode: "remap",
      map: (_frame, anchor) => timeRemapMath.finiteNumber(anchor, 0) + source,
    };
  },
  lifecycle: timeRemapLifecycle,
});

ZoidiumPluginApis.defineFrameSampler.call(timeRemapEffect, {
  displayName: "Time Remap",
  properties: {},
  getRequest(effect, frame) {
    timeRemapEffect._zoidiumTimeRemapTaps = null;
    if (timeRemapOption(effect.properties.enabled, frame, 1) !== 1) return { enabled: false };
    const blend = timeRemapOption(effect.properties.blend, frame, 0);
    if (blend === 0) return { enabled: false };

    let offsets = null;
    let weights = null;
    if (blend > 1) {
      // Reserved slot: value 2 asks a registered motion-interpolation
      // sampler. Nothing registers by default, so it falls back to frame mix.
      const plan = timeRemapInterpolate.request({ frame, blendMode: blend });
      if (plan) {
        offsets = plan.frames;
        weights = plan.weights;
      }
    }
    if (!offsets) {
      const mix = timeRemapBlendWeights(frame);
      if (!(mix.taps.fraction > timeRemapMath.EPSILON)) return { enabled: false };
      offsets = [mix.taps.lower - frame, mix.taps.upper - frame];
      weights = [mix.first, mix.second];
    }
    const total = weights[0] + weights[1];
    if (!(total > 0)) return { enabled: false };
    timeRemapEffect._zoidiumTimeRemapTaps = { mix: weights[1] / total };
    return {
      enabled: true,
      preserveInputRGB: true,
      frames: offsets,
    };
  },
  lifecycle: timeRemapLifecycle,
});
ZoidiumPluginApis.installFrameSamplerContext(timeRemapEffect);
