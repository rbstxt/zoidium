"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).

const ccWideTimeEffect = this;
const ccWideTimeVertexShader = [
  "uniform vec2 uvScale;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vUvScaled = uv * uvScale;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

const CC_WIDE_TIME_SHADER_URL = "/plugins/native-fx/shaders/fx_ccwidetime.glsl";

function ccWideTimeNumber(property, frame, fallback) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function ccWideTimeSteps(properties, frame) {
  const forward = Math.min(
    45,
    Math.max(0, Math.round(ccWideTimeNumber(properties.forwardSteps, frame, 3))),
  );
  const backward = Math.min(
    45,
    Math.max(0, Math.round(ccWideTimeNumber(properties.backwardSteps, frame, 3))),
  );
  return { forward, backward };
}

// Tap offsets ordered nearest-first so the sampler's 64-tap cap deterministically
// drops the farthest taps when both step counts are at their maximum.
function ccWideTimeOffsets(forward, backward) {
  const offsets = [];
  const reach = Math.max(forward, backward);
  for (let step = 1; step <= reach; step += 1) {
    if (step <= backward) offsets.push(-step);
    if (step <= forward) offsets.push(step);
  }
  return offsets;
}

// Shared GL helpers (zoidium/shared/gl.js, loaded before any plugin code
// runs). Pinned by test/shared-helpers.test.js.
function ccWideTimeTarget(width, height) {
  return ZoidiumPluginApis.gl.createRenderTarget(THREE, width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function ccWideTimeTargetMatches(target, width, height) {
  return ZoidiumPluginApis.gl.sameSize(target, width, height);
}

function ccWideTimeEnsureTargets(effect, width, height) {
  for (let index = 0; index < 2; index += 1) {
    let target = effect._zoidiumWideTimeTargets[index];
    if (!target) {
      target = ccWideTimeTarget(width, height);
      effect._zoidiumWideTimeTargets[index] = target;
    } else if (!ccWideTimeTargetMatches(target, width, height)) {
      target.setSize(width, height);
    }
  }
}

async function ccWideTimeShaderText(fetchAsset) {
  if (typeof fetchAsset === "function") {
    let bundled;
    try {
      bundled = fetchAsset("text", CC_WIDE_TIME_SHADER_URL);
    } catch (_error) {
      bundled = undefined;
    }
    if (typeof bundled === "string") return bundled;
  }
  throw new Error(
    "Missing bundled asset: fx_ccwidetime.glsl (/plugins/native-fx/shaders/fx_ccwidetime.glsl)",
  );
}

ZoidiumPluginApis.defineFrameSampler.call(ccWideTimeEffect, {
  displayName: "CC Wide Time",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    forwardSteps: {
      dynamic: true,
      name: "Forward Steps",
      type: PZ.property.type.NUMBER,
      value: 3,
      min: 0,
      max: 45,
      step: 1,
      decimals: 0,
    },
    backwardSteps: {
      dynamic: true,
      name: "Backward Steps",
      type: PZ.property.type.NUMBER,
      value: 3,
      min: 0,
      max: 45,
      step: 1,
      decimals: 0,
    },
    nativeMotionBlur: {
      dynamic: true,
      name: "Native Motion Blur",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
    },
  },
  getRequest(effect, frame) {
    const { forward, backward } = ccWideTimeSteps(effect.properties, frame);
    return {
      enabled:
        ccWideTimeNumber(effect.properties.enabled, frame, 1) === 1 &&
        forward + backward >= 1,
      frames: ccWideTimeOffsets(forward, backward),
    };
  },
  lifecycle: {
    async load(data) {
      const fragmentShader = await ccWideTimeShaderText(
        ccWideTimeEffect._zoidiumGetAsset?.bind?.(ccWideTimeEffect),
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tAcc: { type: "t", value: null },
          tFrame: { type: "t", value: null },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          uWeight: { type: "f", value: 1 },
          uInit: { type: "i", value: 1 },
          uAccumulate: { type: "i", value: 0 },
        },
        vertexShader: ccWideTimeVertexShader,
        fragmentShader,
        transparent: true,
        premultipliedAlpha: true,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
      });
      const pass = new THREE.ShaderPass(material);
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
      const copyPass = new THREE.ShaderPass(copyMaterial);

      ccWideTimeEffect._zoidiumWideTimeMaterial = material;
      ccWideTimeEffect._zoidiumWideTimePass = pass;
      ccWideTimeEffect._zoidiumWideTimeCopyMaterial = copyMaterial;
      ccWideTimeEffect._zoidiumWideTimeCopyPass = copyPass;
      ccWideTimeEffect._zoidiumWideTimeTargets = [];
      ccWideTimeEffect._zoidiumWideTimeAccumulate = 0;
      ccWideTimeEffect.pass = {
        enabled: true,
        uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
        needsSwap: true,
        clear: false,
        renderToScreen: false,
        render(renderer, writeBuffer, readBuffer) {
          const temporal = PZ.zoidium?.temporal;
          const samples = temporal?.resolveFrameSamples?.(ccWideTimeEffect) || [];
          ccWideTimeEffect._zoidiumWideTimeLastSamples = samples.length;
          const uvScale = ccWideTimeEffect.pass.uniforms.uvScale.value;
          const copy = ccWideTimeEffect._zoidiumWideTimeCopyPass;
          const accumulate = ccWideTimeEffect._zoidiumWideTimeAccumulate !== 0;
          if (samples.length === 0 || !ccWideTimeEffect._zoidiumWideTimePass) {
            copy.uniforms.uvScale.value.copy(uvScale);
            copy.uniforms.uvOffset.value.set(0, 0);
            copy.uniforms.opacity.value = 1;
            copy.render(renderer, writeBuffer, readBuffer, true);
            return;
          }

          ccWideTimeEnsureTargets(ccWideTimeEffect, readBuffer.width, readBuffer.height);
          const blend = ccWideTimeEffect._zoidiumWideTimePass;
          const weight = accumulate ? 1 : 1 / (samples.length + 1);
          blend.uniforms.uvScale.value.copy(uvScale);
          blend.uniforms.uWeight.value = weight;
          blend.uniforms.uAccumulate.value = accumulate ? 1 : 0;
          let accTexture = readBuffer.texture;
          for (let index = -1; index < samples.length; index += 1) {
            const isLast = index === samples.length - 1;
            const target = isLast
              ? writeBuffer
              : ccWideTimeEffect._zoidiumWideTimeTargets[
                  (index + 1) % 2
                ];
            blend.uniforms.uInit.value = index === -1 ? 1 : 0;
            blend.uniforms.tAcc.value = accTexture;
            blend.uniforms.tFrame.value =
              index === -1 ? readBuffer.texture : samples[index].texture;
            blend.render(renderer, target, null, true);
            accTexture = target.texture;
          }
        },
      };
      ccWideTimeEffect.properties.load(data && data.properties);
    },
    update(frame) {
      if (!ccWideTimeEffect.pass) return;
      const { forward, backward } = ccWideTimeSteps(ccWideTimeEffect.properties, frame);
      ccWideTimeEffect.pass.enabled =
        ccWideTimeNumber(ccWideTimeEffect.properties.enabled, frame, 1) === 1 &&
        forward + backward >= 1;
      ccWideTimeEffect._zoidiumWideTimeAccumulate =
        ccWideTimeNumber(ccWideTimeEffect.properties.nativeMotionBlur, frame, 0) === 1
          ? 1
          : 0;
    },
    prepare: async function prepare() {},
    resize() {},
    unload() {
      for (const target of ccWideTimeEffect._zoidiumWideTimeTargets || []) {
        target?.dispose?.();
      }
      ccWideTimeEffect._zoidiumWideTimeMaterial?.dispose?.();
      ccWideTimeEffect._zoidiumWideTimeCopyMaterial?.dispose?.();
      ccWideTimeEffect._zoidiumWideTimeTargets = [];
      ccWideTimeEffect._zoidiumWideTimeMaterial = null;
      ccWideTimeEffect._zoidiumWideTimePass = null;
      ccWideTimeEffect._zoidiumWideTimeCopyMaterial = null;
      ccWideTimeEffect._zoidiumWideTimeCopyPass = null;
      ccWideTimeEffect.pass = null;
    },
  },
});

ZoidiumPluginApis.installFrameSamplerContext(this);
