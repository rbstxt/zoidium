"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).

const timeDifferenceEffect = this;
const timeDifferenceVertexShader = [
  "uniform vec2 uvScale;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vUvScaled = uv * uvScale;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

const TIME_DIFFERENCE_SHADER_URL = "/plugins/native-fx/shaders/fx_timedifference.glsl";

function timeDifferenceNumber(property, frame, fallback) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function timeDifferenceRate(effect) {
  try {
    const rate = Number(effect?.parentProject?.sequence?.properties?.rate?.get?.());
    return rate > 0 ? rate : 30;
  } catch (_error) {
    return 30;
  }
}

// Shared GL helpers (zoidium/shared/gl.js, loaded before any plugin code
// runs). Pinned by test/shared-helpers.test.js.
function timeDifferenceTarget(width, height) {
  return ZoidiumPluginApis.gl.createRenderTarget(THREE, width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

async function timeDifferenceShaderText(fetchAsset) {
  if (typeof fetchAsset === "function") {
    let bundled;
    try {
      bundled = fetchAsset("text", TIME_DIFFERENCE_SHADER_URL);
    } catch (_error) {
      bundled = undefined;
    }
    if (typeof bundled === "string") return bundled;
  }
  throw new Error(
    "Missing bundled asset: fx_timedifference.glsl (/plugins/native-fx/shaders/fx_timedifference.glsl)",
  );
}

ZoidiumPluginApis.defineFrameSampler.call(timeDifferenceEffect, {
  displayName: "Time Difference",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    offset: {
      dynamic: true,
      name: "Time Offset (sec)",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: -30,
      max: 30,
      step: 0.1,
      decimals: 3,
    },
    contrast: {
      dynamic: true,
      name: "Contrast",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      decimals: 2,
    },
    absoluteDifference: {
      dynamic: true,
      name: "Absolute Difference",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    alphaChannel: {
      dynamic: true,
      name: "Alpha Channel",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Original;Target;Blend;Max;Full On;Lightness Of Result;Max Of Result;Alpha Difference;Alpha Difference Only",
    },
  },
  getRequest(effect, frame) {
    const seconds = timeDifferenceNumber(effect.properties.offset, frame, 0);
    return {
      enabled: timeDifferenceNumber(effect.properties.enabled, frame, 1) === 1,
      count: 1,
      offsetFrames: seconds * timeDifferenceRate(effect),
      startOpacity: 1,
      decay: 1,
    };
  },
  lifecycle: {
    async load(data) {
      const fragmentShader = await timeDifferenceShaderText(
        timeDifferenceEffect._zoidiumGetAsset?.bind?.(timeDifferenceEffect),
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tBase: { type: "t", value: null },
          tOther: { type: "t", value: null },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          uGain: { type: "f", value: 1 },
          uAbs: { type: "i", value: 1 },
          uAlphaMode: { type: "i", value: 0 },
        },
        vertexShader: timeDifferenceVertexShader,
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

      timeDifferenceEffect._zoidiumTimeDifferenceMaterial = material;
      timeDifferenceEffect._zoidiumTimeDifferencePass = pass;
      timeDifferenceEffect._zoidiumTimeDifferenceCopyMaterial = copyMaterial;
      timeDifferenceEffect._zoidiumTimeDifferenceCopyPass = copyPass;
      timeDifferenceEffect._zoidiumTimeDifferenceGain = 1;
      timeDifferenceEffect._zoidiumTimeDifferenceAbs = 1;
      timeDifferenceEffect._zoidiumTimeDifferenceAlphaMode = 0;
      timeDifferenceEffect.pass = {
        enabled: true,
        uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
        needsSwap: true,
        clear: false,
        renderToScreen: false,
        render(renderer, writeBuffer, readBuffer) {
          const temporal = PZ.zoidium?.temporal;
          const samples = temporal?.resolveFrameSamples?.(timeDifferenceEffect) || [];
          timeDifferenceEffect._zoidiumTimeDifferenceLastSamples = samples.length;
          const uvScale = timeDifferenceEffect.pass.uniforms.uvScale.value;
          const copy = timeDifferenceEffect._zoidiumTimeDifferenceCopyPass;
          if (samples.length === 0 || !timeDifferenceEffect._zoidiumTimeDifferencePass) {
            copy.uniforms.uvScale.value.copy(uvScale);
            copy.uniforms.uvOffset.value.set(0, 0);
            copy.uniforms.opacity.value = 1;
            copy.render(renderer, writeBuffer, readBuffer, true);
            return;
          }
          const difference = timeDifferenceEffect._zoidiumTimeDifferencePass;
          difference.uniforms.uvScale.value.copy(uvScale);
          difference.uniforms.tBase.value = readBuffer.texture;
          difference.uniforms.tOther.value = samples[0].texture;
          difference.uniforms.uGain.value = timeDifferenceEffect._zoidiumTimeDifferenceGain;
          difference.uniforms.uAbs.value = timeDifferenceEffect._zoidiumTimeDifferenceAbs;
          difference.uniforms.uAlphaMode.value =
            timeDifferenceEffect._zoidiumTimeDifferenceAlphaMode;
          // Like Echo's blend pass, all textures arrive through uniforms, so
          // the inner pass takes no readBuffer (CM3's ShaderPass writes
          // uniforms.tDiffuse, which this material does not declare).
          difference.render(renderer, writeBuffer, null, true);
        },
      };
      timeDifferenceEffect.properties.load(data && data.properties);
    },
    update(frame) {
      if (!timeDifferenceEffect.pass) return;
      timeDifferenceEffect.pass.enabled =
        timeDifferenceNumber(timeDifferenceEffect.properties.enabled, frame, 1) === 1;
      timeDifferenceEffect._zoidiumTimeDifferenceGain =
        1 + timeDifferenceNumber(timeDifferenceEffect.properties.contrast, frame, 0) / 25;
      timeDifferenceEffect._zoidiumTimeDifferenceAbs =
        timeDifferenceNumber(timeDifferenceEffect.properties.absoluteDifference, frame, 1) === 1
          ? 1
          : 0;
      timeDifferenceEffect._zoidiumTimeDifferenceAlphaMode = Math.min(
        8,
        Math.max(
          0,
          Math.round(
            timeDifferenceNumber(timeDifferenceEffect.properties.alphaChannel, frame, 0),
          ),
        ),
      );
    },
    prepare: async function prepare() {},
    resize() {},
    unload() {
      timeDifferenceEffect._zoidiumTimeDifferenceMaterial?.dispose?.();
      timeDifferenceEffect._zoidiumTimeDifferenceCopyMaterial?.dispose?.();
      timeDifferenceEffect._zoidiumTimeDifferenceMaterial = null;
      timeDifferenceEffect._zoidiumTimeDifferencePass = null;
      timeDifferenceEffect._zoidiumTimeDifferenceCopyMaterial = null;
      timeDifferenceEffect._zoidiumTimeDifferenceCopyPass = null;
      timeDifferenceEffect.pass = null;
    },
  },
});

// CM3's layer prepare() does not forward its render context to effects.
// Lower-track media preparation still needs the sequence and project rate.
const timeDifferencePrepareWithContext = this.prepare;
if (typeof timeDifferencePrepareWithContext === "function") {
    this.prepare = function (frame, context) {
        if (!context || !context.sequence) {
            context = Object.assign({}, context, { sequence: this.parentProject.sequence });
        }
        return timeDifferencePrepareWithContext.call(this, frame, context);
    };
}
