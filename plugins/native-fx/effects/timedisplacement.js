"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).

const timeDisplacementEffect = this;
const timeDisplacementVertexShader = [
  "uniform vec2 uvScale;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vUvScaled = uv * uvScale;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

const TIME_DISPLACEMENT_SHADER_URL = "/plugins/native-fx/shaders/fx_timedisplacement.glsl";
const TIME_DISPLACEMENT_MIN_SLICES = 2;
const TIME_DISPLACEMENT_MAX_SLICES = 64;

function timeDisplacementNumber(property, frame, fallback) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function timeDisplacementRate(effect) {
  try {
    const rate = Number(effect?.parentProject?.sequence?.properties?.rate?.get?.());
    return rate > 0 ? rate : 30;
  } catch (_error) {
    return 30;
  }
}

// Pure plan shared by getRequest (tap offsets) and update/render (slice
// count): N evenly spaced slices spanning [-maxSeconds, +maxSeconds].
// Deterministic in (properties, frame, project rate).
function timeDisplacementPlan(properties, frame, rate) {
  const maxSeconds = timeDisplacementNumber(properties.maxTime, frame, 1);
  const slices = Math.min(
    TIME_DISPLACEMENT_MAX_SLICES,
    Math.max(
      TIME_DISPLACEMENT_MIN_SLICES,
      Math.round(
        timeDisplacementNumber(properties.resolution, frame, 16),
      ),
    ),
  );
  const maxFrames = maxSeconds * (rate > 0 ? rate : 30);
  const offsets = [];
  for (let index = 0; index < slices; index += 1) {
    offsets.push(-maxFrames + (2 * maxFrames * index) / (slices - 1));
  }
  return { maxSeconds, slices, offsets };
}

// Shared GL helpers (zoidium/shared/gl.js, loaded before any plugin code
// runs). Pinned by test/shared-helpers.test.js.
function timeDisplacementTarget(width, height) {
  return ZoidiumPluginApis.gl.createRenderTarget(THREE, width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function timeDisplacementTargetMatches(target, width, height) {
  return ZoidiumPluginApis.gl.sameSize(target, width, height);
}

function timeDisplacementEnsureTargets(effect, width, height) {
  for (let index = 0; index < 2; index += 1) {
    let target = effect._zoidiumTimeDisplacementTargets[index];
    if (!target) {
      target = timeDisplacementTarget(width, height);
      effect._zoidiumTimeDisplacementTargets[index] = target;
    } else if (!timeDisplacementTargetMatches(target, width, height)) {
      target.setSize(width, height);
    }
  }
}

async function timeDisplacementShaderText(fetchAsset) {
  if (typeof fetchAsset === "function") {
    let bundled;
    try {
      bundled = fetchAsset("text", TIME_DISPLACEMENT_SHADER_URL);
    } catch (_error) {
      bundled = undefined;
    }
    if (typeof bundled === "string") return bundled;
  }
  throw new Error(
    "Missing bundled asset: fx_timedisplacement.glsl (/plugins/native-fx/shaders/fx_timedisplacement.glsl)",
  );
}

function timeDisplacementReleaseImage(effect) {
  if (effect._zoidiumSourceImage) {
    effect.parentProject.assets.unload(effect._zoidiumSourceImage);
    effect._zoidiumSourceImageTexture?.dispose?.();
  }
  effect._zoidiumSourceImage = null;
  effect._zoidiumSourceImageTexture = null;
}

function timeDisplacementLoadImage(effect, value) {
  timeDisplacementReleaseImage(effect);
  if (!value) return;
  const image = new PZ.asset.image(effect.parentProject.assets.load(value));
  effect._zoidiumSourceImage = image;
  const texture = image.getTexture(true);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  effect._zoidiumSourceImageTexture = texture;
}

async function timeDisplacementSourceChanged(property) {
  const effect = property.parentObject;
  if (effect?._zoidiumLoading) return;
  if (property.value === "other-layer") {
    // Restore synchronously so the temporary action is never serialized.
    property.set(effect._zoidiumPreviousSource || "");
    if (effect._zoidiumSourceRequest) return;
    effect._zoidiumSourceRequest = true;
    try {
      const approved = await PZ.zoidium?.requestPlugin?.(
        "layer-input",
        "Choosing another layer as the Time Displacement map needs the Layer Input plugin."
      );
      if (approved) PZ.layerInput?.registerConsumer?.(effect);
    } finally {
      effect._zoidiumSourceRequest = false;
    }
    return;
  }
  effect._zoidiumPreviousSource = property.value || "";
  PZ.layerInput?.setSource?.(effect, property.value || "");
}

ZoidiumPluginApis.defineFrameSampler.call(timeDisplacementEffect, {
  displayName: "Time Displacement",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    source: {
      name: "Displacement Map Source",
      type: PZ.property.type.LIST,
      value: "",
      items: [
        { name: "The Layer Itself", value: "" },
        { name: "Image", value: "image" },
        { name: "Other Layer…", value: "other-layer" },
      ],
      _zoidiumLayerSource: true,
      changed: function () {
        // Native property callbacks do not await promises.
        timeDisplacementSourceChanged(this).catch((error) => {
          console.error("[Zoidium] Could not request Layer Input:", error);
        });
      },
    },
    sourceImage: {
      name: "Source Image",
      type: PZ.property.type.ASSET,
      assetType: PZ.asset.type.IMAGE,
      value: null,
      accept: "image/*",
      changed: function () {
        timeDisplacementLoadImage(this.parentObject, this.value);
      },
    },
    maxTime: {
      dynamic: true,
      name: "Max Displacement Time (sec)",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: -30,
      max: 30,
      step: 0.1,
      decimals: 3,
    },
    resolution: {
      dynamic: true,
      name: "Time Resolution (slices)",
      type: PZ.property.type.NUMBER,
      value: 16,
      min: TIME_DISPLACEMENT_MIN_SLICES,
      max: TIME_DISPLACEMENT_MAX_SLICES,
      step: 1,
      decimals: 0,
    },
    stretchMap: {
      dynamic: true,
      name: "Stretch Map To Fit",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
  },
  getRequest(effect, frame) {
    const plan = timeDisplacementPlan(
      effect.properties,
      frame,
      timeDisplacementRate(effect),
    );
    return {
      preserveInputRGB: true,
      enabled:
        timeDisplacementNumber(effect.properties.enabled, frame, 1) === 1 &&
        plan.maxSeconds !== 0,
      frames: plan.offsets,
    };
  },
  lifecycle: {
    async load(data) {
      timeDisplacementEffect._zoidiumLoading = true;
      const fragmentShader = await timeDisplacementShaderText(
        timeDisplacementEffect._zoidiumGetAsset?.bind?.(timeDisplacementEffect),
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tAcc: { type: "t", value: null },
          tSlice: { type: "t", value: null },
          tMap: { type: "t", value: null },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          uSlice: { type: "i", value: 0 },
          uSlices: { type: "i", value: 16 },
          uMapScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          uMapOffset: { type: "v2", value: new THREE.Vector2(0, 0) },
        },
        vertexShader: timeDisplacementVertexShader,
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

      timeDisplacementEffect._zoidiumTimeDisplacementMaterial = material;
      timeDisplacementEffect._zoidiumTimeDisplacementPass = pass;
      timeDisplacementEffect._zoidiumTimeDisplacementCopyMaterial = copyMaterial;
      timeDisplacementEffect._zoidiumTimeDisplacementCopyPass = copyPass;
      timeDisplacementEffect._zoidiumTimeDisplacementTargets = [];
      timeDisplacementEffect._zoidiumTimeDisplacementSlices = 16;
      timeDisplacementEffect._zoidiumTimeDisplacementStretch = 1;
      timeDisplacementEffect.pass = {
        enabled: true,
        uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
        needsSwap: true,
        clear: false,
        renderToScreen: false,
        render(renderer, writeBuffer, readBuffer) {
          const temporal = PZ.zoidium?.temporal;
          const samples = temporal?.resolveFrameSamples?.(timeDisplacementEffect) || [];
          timeDisplacementEffect._zoidiumTimeDisplacementLastSamples = samples.length;
          const uvScale = timeDisplacementEffect.pass.uniforms.uvScale.value;
          const copy = timeDisplacementEffect._zoidiumTimeDisplacementCopyPass;
          const gather = timeDisplacementEffect._zoidiumTimeDisplacementPass;
          const slices = timeDisplacementEffect._zoidiumTimeDisplacementSlices;
          if (samples.length === 0 || !gather) {
            copy.uniforms.uvScale.value.copy(uvScale);
            copy.uniforms.uvOffset.value.set(0, 0);
            copy.uniforms.opacity.value = 1;
            copy.render(renderer, writeBuffer, readBuffer, true);
            return;
          }

          // A direct image works without Layer Input. Track maps use that
          // plugin; an empty or unavailable map keeps the layer's own input.
          let mapTexture = readBuffer.texture;
          let mapWidth = readBuffer.width;
          let mapHeight = readBuffer.height;
          try {
            const imageSource = timeDisplacementEffect.properties.source.get() === "image";
            const texture = timeDisplacementEffect._zoidiumSourceImageTexture;
            const resolved = imageSource
              ? (texture ? { texture, target: texture.image } : null)
              : PZ.layerInput?.resolveEffect?.(timeDisplacementEffect);
            if (resolved?.texture) {
              mapTexture = resolved.texture;
              mapWidth = Number(resolved.target?.width) || readBuffer.width;
              mapHeight = Number(resolved.target?.height) || readBuffer.height;
            }
          } catch (_error) {
            mapTexture = readBuffer.texture;
            mapWidth = readBuffer.width;
            mapHeight = readBuffer.height;
          }
          const stretch = timeDisplacementEffect._zoidiumTimeDisplacementStretch !== 0;
          let mapScaleX = 1;
          let mapScaleY = 1;
          if (!stretch && mapWidth > 0 && mapHeight > 0) {
            const bufferAspect = readBuffer.width / Math.max(1, readBuffer.height);
            const mapAspect = mapWidth / Math.max(1, mapHeight);
            mapScaleX = Math.min(1, mapAspect / Math.max(1e-6, bufferAspect));
            mapScaleY = Math.min(1, bufferAspect / Math.max(1e-6, mapAspect));
          }

          timeDisplacementEnsureTargets(
            timeDisplacementEffect,
            readBuffer.width,
            readBuffer.height,
          );
          gather.uniforms.uvScale.value.copy(uvScale);
          gather.uniforms.tMap.value = mapTexture;
          gather.uniforms.uSlices.value = slices;
          gather.uniforms.uMapScale.value.set(mapScaleX, mapScaleY);
          gather.uniforms.uMapOffset.value.set((1 - mapScaleX) / 2, (1 - mapScaleY) / 2);
          // Only taps whose plan index still matches the current slice count
          // take part; anything else keeps the running accumulation, which
          // starts as the current input (the zero-offset slice needs no tap).
          const valid = samples.filter(
            (sample) =>
              Number.isInteger(sample?.index) &&
              sample.index >= 0 &&
              sample.index < slices,
          );
          if (valid.length === 0) {
            copy.uniforms.uvScale.value.copy(uvScale);
            copy.uniforms.uvOffset.value.set(0, 0);
            copy.uniforms.opacity.value = 1;
            copy.render(renderer, writeBuffer, readBuffer, true);
            return;
          }
          let accTexture = readBuffer.texture;
          for (let index = 0; index < valid.length; index += 1) {
            const sample = valid[index];
            const isLast = index === valid.length - 1;
            // Alternating scratch targets never read and write the same
            // target in one pass; the final pass lands in writeBuffer.
            const target = isLast
              ? writeBuffer
              : timeDisplacementEffect._zoidiumTimeDisplacementTargets[index % 2];
            gather.uniforms.tAcc.value = accTexture;
            gather.uniforms.tSlice.value = sample.texture;
            gather.uniforms.uSlice.value = sample.index;
            gather.render(renderer, target, null, true);
            accTexture = target.texture;
          }
        },
      };
      timeDisplacementEffect.properties.load(data && data.properties);
      timeDisplacementEffect._zoidiumLoading = false;
      timeDisplacementEffect._zoidiumPreviousSource = timeDisplacementEffect.properties.source.get() || "";
      try {
        PZ.layerInput?.registerConsumer?.(timeDisplacementEffect);
      } catch (_error) {
        // The Layer Input plugin is optional.
      }
    },
    update(frame) {
      if (!timeDisplacementEffect.pass) return;
      timeDisplacementEffect._zoidiumLocalFrame = Number.isFinite(Number(frame))
        ? Number(frame)
        : 0;
      const plan = timeDisplacementPlan(
        timeDisplacementEffect.properties,
        timeDisplacementEffect._zoidiumLocalFrame,
        timeDisplacementRate(timeDisplacementEffect),
      );
      timeDisplacementEffect._zoidiumTimeDisplacementSlices = plan.slices;
      timeDisplacementEffect._zoidiumTimeDisplacementStretch =
        timeDisplacementNumber(timeDisplacementEffect.properties.stretchMap, frame, 1) === 1
          ? 1
          : 0;
      timeDisplacementEffect.pass.enabled =
        timeDisplacementNumber(timeDisplacementEffect.properties.enabled, frame, 1) === 1 &&
        plan.maxSeconds !== 0;
    },
    prepare: async function prepare() {
      await timeDisplacementEffect._zoidiumSourceImage?.loading;
    },
    resize() {},
    toJSON() {
      try {
        if (PZ.layerInput?.serializeConsumer) {
          return PZ.layerInput.serializeConsumer(timeDisplacementEffect);
        }
      } catch (_error) {
        // Fall through to the default serialization below.
      }
      return { type: timeDisplacementEffect.type, properties: timeDisplacementEffect.properties };
    },
    unload() {
      timeDisplacementReleaseImage(timeDisplacementEffect);
      try {
        PZ.layerInput?.unregisterConsumer?.(timeDisplacementEffect);
      } catch (_error) {
        // The Layer Input plugin is optional.
      }
      for (const target of timeDisplacementEffect._zoidiumTimeDisplacementTargets || []) {
        target?.dispose?.();
      }
      timeDisplacementEffect._zoidiumTimeDisplacementMaterial?.dispose?.();
      timeDisplacementEffect._zoidiumTimeDisplacementCopyMaterial?.dispose?.();
      timeDisplacementEffect._zoidiumTimeDisplacementTargets = [];
      timeDisplacementEffect._zoidiumTimeDisplacementMaterial = null;
      timeDisplacementEffect._zoidiumTimeDisplacementPass = null;
      timeDisplacementEffect._zoidiumTimeDisplacementCopyMaterial = null;
      timeDisplacementEffect._zoidiumTimeDisplacementCopyPass = null;
      timeDisplacementEffect.pass = null;
    },
  },
});

ZoidiumPluginApis.installFrameSamplerContext(this);
