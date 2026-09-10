"use strict";

const echoEffect = this;
const echoVertexShader = [
  "uniform vec2 uvScale;",
  "varying vec2 vUvScaled;",
  "void main() {",
  "  vUvScaled = uv * uvScale;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");
const echoFragmentShader = [
  "precision highp float;",
  "uniform sampler2D tBase;",
  "uniform sampler2D tEcho;",
  "uniform float echoOpacity;",
  "uniform int compositeMode;",
  "varying vec2 vUvScaled;",
  "vec4 over(vec4 top, vec4 bottom) {",
  "  return top + bottom * (1.0 - top.a);",
  "}",
  "vec3 straightColor(vec4 color) {",
  "  return color.a > 0.00001 ? color.rgb / color.a : vec3(0.0);",
  "}",
  "vec4 screenBlend(vec4 base, vec4 echo) {",
  "  float alpha = base.a + echo.a - base.a * echo.a;",
  "  vec3 blend = 1.0 - (1.0 - straightColor(base)) * (1.0 - straightColor(echo));",
  "  vec3 rgb = base.rgb * (1.0 - echo.a) +",
  "    echo.rgb * (1.0 - base.a) + blend * base.a * echo.a;",
  "  return vec4(rgb, alpha);",
  "}",
  "void main() {",
  "  vec4 base = texture2D(tBase, vUvScaled);",
  "  vec4 echo = texture2D(tEcho, vUvScaled) * echoOpacity;",
  "  if (compositeMode == 0) {",
  "    gl_FragColor = over(echo, base);",
  "  } else if (compositeMode == 1) {",
  "    gl_FragColor = over(base, echo);",
  "  } else if (compositeMode == 2) {",
  "    gl_FragColor = vec4(base.rgb + echo.rgb, min(1.0, base.a + echo.a));",
  "  } else if (compositeMode == 3) {",
  "    gl_FragColor = screenBlend(base, echo);",
  "  } else {",
  "    gl_FragColor = max(base, echo);",
  "  }",
  "}",
].join("\n");

function echoNumber(property, frame, fallback) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
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

function ensureTargets(effect, width, height) {
  for (let index = 0; index < 2; index += 1) {
    let target = effect._zoidiumEchoTargets[index];
    if (!target) {
      target = createTarget(width, height);
      effect._zoidiumEchoTargets[index] = target;
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
  }
}

ZoidiumPluginApis.defineFrameSampler.call(echoEffect, {
  displayName: "Echo",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    echoes: {
      dynamic: true,
      name: "Echoes",
      type: PZ.property.type.NUMBER,
      value: 4,
      min: 1,
      max: 16,
      step: 1,
      decimals: 0,
    },
    delay: {
      dynamic: true,
      name: "Echo delay (frames)",
      type: PZ.property.type.NUMBER,
      value: 3,
      min: 0,
      max: 100000,
      step: 1,
      decimals: 3,
    },
    opacity: {
      dynamic: true,
      name: "First echo opacity",
      type: PZ.property.type.NUMBER,
      value: 0.75,
      min: 0,
      max: 1,
      step: 0.05,
      decimals: 3,
    },
    decay: {
      dynamic: true,
      name: "Opacity decay",
      type: PZ.property.type.NUMBER,
      value: 0.75,
      min: 0,
      max: 1,
      step: 0.05,
      decimals: 3,
    },
    composite: {
      dynamic: true,
      name: "Composite",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "over;behind (alpha);add;screen;maximum",
    },
  },
  getRequest(effect, frame) {
    return {
      enabled: echoNumber(effect.properties.enabled, frame, 1) === 1,
      count: echoNumber(effect.properties.echoes, frame, 4),
      offsetFrames: -Math.max(0, echoNumber(effect.properties.delay, frame, 3)),
      startOpacity: echoNumber(effect.properties.opacity, frame, 0.75),
      decay: echoNumber(effect.properties.decay, frame, 0.75),
    };
  },
  lifecycle: {
    load(data) {
      const blendMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tBase: { type: "t", value: null },
          tEcho: { type: "t", value: null },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          echoOpacity: { type: "f", value: 1 },
          compositeMode: { type: "i", value: 0 },
        },
        vertexShader: echoVertexShader,
        fragmentShader: echoFragmentShader,
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
      const blendPass = new THREE.ShaderPass(blendMaterial);
      const copyPass = new THREE.ShaderPass(copyMaterial);

      echoEffect._zoidiumEchoBlendMaterial = blendMaterial;
      echoEffect._zoidiumEchoCopyMaterial = copyMaterial;
      echoEffect._zoidiumEchoBlendPass = blendPass;
      echoEffect._zoidiumEchoCopyPass = copyPass;
      echoEffect._zoidiumEchoTargets = [];
      echoEffect._zoidiumEchoComposite = 0;
      echoEffect.pass = {
        enabled: true,
        uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
        needsSwap: true,
        clear: false,
        renderToScreen: false,
        render(renderer, writeBuffer, readBuffer) {
          const temporal = PZ.zoidium?.temporal;
          const samples = temporal?.resolveFrameSamples?.(echoEffect) || [];
          const uvScale = echoEffect.pass.uniforms.uvScale.value;
          if (samples.length === 0) {
            copyPass.uniforms.uvScale.value.copy(uvScale);
            copyPass.uniforms.uvOffset.value.set(0, 0);
            copyPass.uniforms.opacity.value = 1;
            copyPass.render(renderer, writeBuffer, readBuffer, true);
            return;
          }

          ensureTargets(echoEffect, readBuffer.width, readBuffer.height);
          let baseTexture = readBuffer.texture;
          blendPass.uniforms.uvScale.value.copy(uvScale);
          blendPass.uniforms.compositeMode.value = echoEffect._zoidiumEchoComposite;
          for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index];
            const isLast = index === samples.length - 1;
            const target = isLast
              ? writeBuffer
              : echoEffect._zoidiumEchoTargets[index % 2];
            blendPass.uniforms.tBase.value = baseTexture;
            blendPass.uniforms.tEcho.value = sample.texture;
            blendPass.uniforms.echoOpacity.value = sample.opacity;
            blendPass.render(renderer, target, null, true);
            baseTexture = target.texture;
          }
        },
      };
      echoEffect.properties.load(data && data.properties);
    },
    update(frame) {
      if (!echoEffect.pass) return;
      echoEffect.pass.enabled =
        echoNumber(echoEffect.properties.enabled, frame, 1) === 1 &&
        echoNumber(echoEffect.properties.echoes, frame, 4) >= 1;
      echoEffect._zoidiumEchoComposite = Math.min(
        4,
        Math.max(0, Math.round(echoNumber(echoEffect.properties.composite, frame, 0))),
      );
    },
    prepare: async function prepare() {},
    resize() {},
    unload() {
      for (const target of echoEffect._zoidiumEchoTargets || []) target?.dispose?.();
      echoEffect._zoidiumEchoBlendMaterial?.dispose?.();
      echoEffect._zoidiumEchoCopyMaterial?.dispose?.();
      echoEffect._zoidiumEchoTargets = [];
      echoEffect._zoidiumEchoBlendMaterial = null;
      echoEffect._zoidiumEchoCopyMaterial = null;
      echoEffect._zoidiumEchoBlendPass = null;
      echoEffect._zoidiumEchoCopyPass = null;
      echoEffect.pass = null;
    },
  },
});
