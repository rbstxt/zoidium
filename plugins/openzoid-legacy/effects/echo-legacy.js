// OpenZoid Legacy — Echo (Legacy).
// The OpenZoid echo blended a rolling history of rendered frames, so its image
// depended on playback history. This port keeps the same look (smear,
// maximum, additive and screen modes, decay, threshold, strength) but reads
// each echo as an explicitly evaluated earlier frame through the core frame
// sampler. The result for a given frame is the same however the timeline was
// reached. The core sampler evaluates at most 16 echoes per frame.
// The blend shader comes from the plugin bundle; the vertex shader comes from
// the host asset pipeline, so no runtime fetch is issued.
const echo = this;
const ECHO_MAX = 16;
const ECHO_MODES = 4;

function echoNumber(property, frame, fallback) {
  try {
    const value = Number(property.get(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function echoClamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function createTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

const MIX_FRAGMENT = [
  "uniform sampler2D tDry;",
  "uniform sampler2D tWet;",
  "uniform float strength;",
  "varying vec2 vUv;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vec4 dry = texture2D(tDry, vUvScaled);",
  "  vec4 wet = texture2D(tWet, vUv);",
  "  gl_FragColor = mix(dry, wet, clamp(strength, 0.0, 1.0));",
  "}",
].join("\n");

// Builds the blend pass. The pass is assigned only after both shaders exist;
// prepare() waits for this promise so no frame is rendered against a
// half-built effect.
async function buildEchoPass(data) {
  const getAsset = echo._zoidiumGetAsset;
  const stepFragment =
    typeof getAsset === "function"
      ? getAsset("text", "./plugins/openzoid-legacy/shaders/fx_echo.glsl")
      : undefined;
  if (typeof stepFragment !== "string") {
    throw new Error("Echo (Legacy) blend shader is missing from the plugin bundle.");
  }
  const vertPreset = echo.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    "/assets/shaders/vertex/common.glsl",
  );
  const vertShader = new PZ.asset.shader(echo.parentProject.assets.load(vertPreset));
  const vertexShader = await vertShader.getShader();

  const stepMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { type: "t", value: null },
      tTap: { type: "t", value: null },
      uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
      weight: { type: "f", value: 0 },
      threshold: { type: "f", value: 0 },
      wsum: { type: "f", value: 1 },
      finalize: { type: "f", value: 0 },
      useScaledBase: { type: "f", value: 0 },
    },
    vertexShader,
    fragmentShader: stepFragment,
  });
  stepMaterial.premultipliedAlpha = true;
  stepMaterial.defines.ECHO_MODE = 1;

  const mixMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDry: { type: "t", value: null },
      tWet: { type: "t", value: null },
      uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
      strength: { type: "f", value: 1 },
    },
    vertexShader,
    fragmentShader: MIX_FRAGMENT,
  });
  mixMaterial.premultipliedAlpha = true;

  const quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const state = {
    stepMaterial,
    mixMaterial,
    scene,
    camera,
    quad,
    targets: [],
    strength: 1,
  };
  echo._zoidiumEcho = state;
  echo.pass = {
    enabled: true,
    needsSwap: true,
    clear: false,
    renderToScreen: false,
    uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
    render(renderer, writeBuffer, readBuffer) {
      const temporal = PZ.zoidium && PZ.zoidium.temporal;
      const samples = (temporal && temporal.resolveFrameSamples
        ? temporal.resolveFrameSamples(echo)
        : null) || [];
      const width = readBuffer.width;
      const height = readBuffer.height;
      for (let index = 0; index < 2; index += 1) {
        const target = state.targets[index];
        if (!target) {
          state.targets[index] = createTarget(width, height);
        } else if (target.width !== width || target.height !== height) {
          target.setSize(width, height);
        }
      }
      const output = writeBuffer || readBuffer;
      let wsum = 1;
      for (const sample of samples) wsum += sample.opacity;

      let previous = null;
      const su = state.stepMaterial.uniforms;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        su.tBase.value = index === 0 ? readBuffer.texture : previous.texture;
        su.useScaledBase.value = index === 0 ? 1 : 0;
        su.tTap.value = sample.texture;
        su.weight.value = sample.opacity;
        su.wsum.value = wsum;
        su.finalize.value = index === samples.length - 1 ? 1 : 0;
        state.quad.material = state.stepMaterial;
        const target = state.targets[index % 2];
        renderer.render(state.scene, state.camera, target, true);
        previous = target;
      }

      const mu = state.mixMaterial.uniforms;
      mu.tDry.value = readBuffer.texture;
      mu.tWet.value = previous ? previous.texture : readBuffer.texture;
      mu.strength.value = previous ? state.strength : 0;
      state.quad.material = state.mixMaterial;
      renderer.render(state.scene, state.camera, output, true);
    },
  };
  echo.properties.load(data && data.properties);
}

ZoidiumPluginApis.defineFrameSampler.call(echo, {
  displayName: "Echo (Legacy)",
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
      value: 1,
      items: "smear;maximum;additive;screen",
    },
    echoes: {
      dynamic: true,
      name: "Number of Echoes",
      type: PZ.property.type.NUMBER,
      value: 6,
      min: 0,
      max: ECHO_MAX,
      step: 1,
      decimals: 0,
    },
    decay: {
      dynamic: true,
      name: "Decay",
      type: PZ.property.type.NUMBER,
      value: 0.88,
      min: 0,
      max: 0.99,
      step: 0.01,
      decimals: 3,
    },
    strength: {
      dynamic: true,
      name: "Strength",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 3,
    },
    threshold: {
      dynamic: true,
      name: "Threshold",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 3,
    },
  },
  // Echo k (1-based) samples the input k frames earlier with opacity decay^k,
  // which matches the weights of the legacy history steps.
  getRequest(effect, frame) {
    const props = effect.properties;
    const strength = echoClamp01(echoNumber(props.strength, frame, 1));
    const echoes = Math.min(
      ECHO_MAX,
      Math.max(0, Math.round(echoNumber(props.echoes, frame, 6))),
    );
    const decay = Math.min(0.99, Math.max(0, echoNumber(props.decay, frame, 0.88)));
    return {
      enabled:
        echoNumber(props.enabled, frame, 1) === 1 &&
        strength > 0.0005 &&
        echoes >= 1,
      count: echoes,
      offsetFrames: -1,
      startOpacity: decay,
      decay,
    };
  },
  lifecycle: {
    load(data) {
      echo._zoidiumLoading = buildEchoPass(data);
      return echo._zoidiumLoading;
    },
    update(frame) {
      const state = echo._zoidiumEcho;
      if (!state || !echo.pass) return;
      const props = echo.properties;
      const strength = echoClamp01(echoNumber(props.strength, frame, 1));
      const echoes = Math.round(echoNumber(props.echoes, frame, 6));
      echo.pass.enabled =
        echoNumber(props.enabled, frame, 1) === 1 &&
        strength > 0.0005 &&
        echoes >= 1;
      state.strength = strength;
      state.stepMaterial.uniforms.threshold.value = echoClamp01(
        echoNumber(props.threshold, frame, 0),
      );
      const mode = Math.min(
        ECHO_MODES - 1,
        Math.max(0, Math.round(echoNumber(props.mode, frame, 1))),
      );
      if (state.stepMaterial.defines.ECHO_MODE !== mode) {
        state.stepMaterial.defines.ECHO_MODE = mode;
        state.stepMaterial.needsUpdate = true;
      }
    },
    async prepare() {
      if (!echo._zoidiumLoading) return;
      try {
        await echo._zoidiumLoading;
      } catch (error) {
        console.error("[Zoidium] Echo (Legacy) could not load its pass:", error);
      }
    },
    unload() {
      const state = echo._zoidiumEcho;
      if (state) {
        for (const target of state.targets) target.dispose();
        state.stepMaterial.dispose();
        state.mixMaterial.dispose();
        state.quad.geometry.dispose();
      }
      echo._zoidiumEcho = null;
      echo._zoidiumLoading = null;
      echo.pass = null;
    },
  },
});

// CM3's layer prepare() does not forward its render context to effects.
// Lower-track media preparation still needs the sequence and project rate.
const prepareWithContext = this.prepare;
if (typeof prepareWithContext === "function") {
    this.prepare = function (frame, context) {
        if (!context || !context.sequence) {
            context = Object.assign({}, context, { sequence: this.parentProject.sequence });
        }
        return prepareWithContext.call(this, frame, context);
    };
}
