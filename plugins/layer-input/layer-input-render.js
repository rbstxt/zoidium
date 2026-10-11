"use strict";

// Layer Input frame rendering: runtimes, capture compositors, Loaded through the shared bundle loader; created per activation
// by the plugin entry with (state, deps), where deps carries the sibling
// parts once the entry has wired them.

const shared = require("./layer-input-state.js");
const state = shared.state;

module.exports = function createRender(state, deps) {
  function frameKey(frame) {
    return Number.isFinite(frame) ? Math.round(frame * 1000000) / 1000000 : 0;
  }

  function getRuntime(root) {
    if (!root || typeof root !== "object") return null;
    let runtime = root.__zoidiumLayerInputRuntime;
    if (!runtime) {
      runtime = {
        root,
        cache: new Map(),
        inProgress: new Set(),
        targetPool: new Map(),
        captures: [],
        copyPass: null,
      };
      Object.defineProperty(root, "__zoidiumLayerInputRuntime", {
        configurable: true,
        value: runtime,
        writable: true,
      });
      state.runtimes.add(root);
    }
    return runtime;
  }

  function createCopyPass() {
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.CopyShader.uniforms),
      vertexShader: THREE.CopyShader.vertexShader,
      fragmentShader: THREE.CopyShader.fragmentShader,
      transparent: true,
    });
    material.premultipliedAlpha = true;
    return new THREE.ShaderPass(material);
  }

  function getCopyPass(runtime) {
    if (!runtime.copyPass) runtime.copyPass = createCopyPass();
    return runtime.copyPass;
  }

  function isLayerMaskEffect(effect) {
    return effect?.type === "mask" || effect?.__zoidiumLayerInputMask === true;
  }

  function renderSelectedEffects(compositor, effects, width, height, mode) {
    if (mode === "source") return;

    for (const effect of effects || []) {
      const Group = state.PZ?.effect?.group;
      if (Group && effect instanceof Group) {
        if (effect.enabled) {
          renderSelectedEffects(compositor, effect.objects, width, height, mode);
        }
        continue;
      }
      if (mode === "masks" && !isLayerMaskEffect(effect)) continue;

      const pass = effect?.pass;
      if (!pass || !pass.enabled) continue;
      if (pass.uniforms?.uvScale) pass.uniforms.uvScale.value.set(width, height);
      pass.render(compositor.renderer, compositor.writeBuffer, compositor.readBuffer, true);
      if (pass.needsSwap) compositor.swapBuffers();
    }
  }

  function getSourceTarget(runtime, track, width, height, sourceMode) {
    const targetKey = `${deps.trackToken(track)}|${deps.normalizeSourceMode(sourceMode)}`;
    let target = runtime.targetPool.get(targetKey);
    if (!target) {
      // Shared scratch target (zoidium/shared/gl.js).
      target = ZoidiumPluginApis.gl.createRenderTarget(THREE, width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      runtime.targetPool.set(targetKey, target);
    } else {
      ZoidiumPluginApis.gl.ensureSize(target, width, height);
    }
    return target;
  }

  function getCaptureCompositor(runtime, depth, width, height, sequence) {
    if (depth > shared.MAX_SOURCE_DEPTH) return null;
    const index = depth - 1;
    let compositor = runtime.captures[index];
    if (!compositor) {
      compositor = new state.PZ.compositor(runtime.root.renderer, width, height);
      runtime.captures[index] = compositor;
    } else if (compositor.readBuffer.width !== width || compositor.readBuffer.height !== height) {
      compositor.setSize(width, height);
    }
    if (compositor._sequence !== sequence) compositor.sequence = sequence;
    compositor.ratio = runtime.root.ratio || width / (sequence.properties.resolution.get()[0] || width);
    return compositor;
  }

  function pushContext(context) {
    state.contextStack.push(context);
  }

  function popContext() {
    state.contextStack.pop();
  }

  function currentContext() {
    return state.contextStack[state.contextStack.length - 1] || null;
  }

  function renderTrackSource(
    root,
    track,
    projectFrame,
    parentContext,
    sourceMode = shared.DEFAULT_SOURCE_MODE
  ) {
    const runtime = getRuntime(root);
    if (!runtime || !root.renderer || !root.readBuffer || !root._sequence) return null;
    if (parentContext.depth >= shared.MAX_SOURCE_DEPTH) return null;

    const mode = deps.normalizeSourceMode(sourceMode);
    const width = root.readBuffer.width;
    const height = root.readBuffer.height;
    const key = `${deps.trackToken(track)}|${mode}|${frameKey(projectFrame)}|${width}x${height}`;
    if (runtime.cache.has(key)) return runtime.cache.get(key);
    if (runtime.inProgress.has(key)) {
      console.warn("[Layer Input] runtime cycle guard blocked", key);
      runtime.cache.set(key, null);
      return null;
    }

    const clip = track.getCurrentClip?.(projectFrame);
    if (!clip?.object) {
      runtime.cache.set(key, null);
      return null;
    }

    const target = getSourceTarget(runtime, track, width, height, mode);
    const capture = getCaptureCompositor(runtime, parentContext.depth + 1, width, height, root._sequence);
    if (!capture) {
      runtime.cache.set(key, null);
      return null;
    }

    const previousClearColor = root.renderer.getClearColor
      ? root.renderer.getClearColor(new THREE.Color())
      : null;
    const previousClearAlpha = root.renderer.getClearAlpha
      ? root.renderer.getClearAlpha()
      : null;
    const previousSourceMode = capture.__zoidiumLayerInputMode;
    runtime.inProgress.add(key);
    try {
      root.renderer.setClearColor(0, 0);
      capture.clear(0);
      capture.__zoidiumLayerInputMode = mode;
      const context = {
        root,
        compositor: capture,
        frame: projectFrame,
        depth: parentContext.depth + 1,
      };
      pushContext(context);
      try {
        clip.object.update(projectFrame - clip.start);
        capture.renderLayer(clip.object, 0, false);
      } finally {
        popContext();
      }

      const rendered = capture.screenBuffers[0];
      if (!rendered) throw new Error("Source capture produced no render target");
      const copyPass = getCopyPass(runtime);
      copyPass.uniforms.uvScale.value.set(1, 1);
      if (copyPass.uniforms.uvOffset) copyPass.uniforms.uvOffset.value.set(0, 0);
      copyPass.uniforms.opacity.value = 1;
      copyPass.render(root.renderer, target, rendered, true);
      const result = { texture: target.texture, target, track, clip, layer: clip.object };
      runtime.cache.set(key, result);
      return result;
    } catch (error) {
      console.error("[Layer Input] failed to render source track:", error);
      runtime.cache.set(key, null);
      return null;
    } finally {
      if (typeof previousSourceMode === "undefined") {
        delete capture.__zoidiumLayerInputMode;
      } else {
        capture.__zoidiumLayerInputMode = previousSourceMode;
      }
      if (previousClearColor) {
        root.renderer.setClearColor(
          previousClearColor,
          previousClearAlpha == null ? 1 : previousClearAlpha
        );
      }
      runtime.inProgress.delete(key);
    }
  }

  function resolveConsumer(consumer) {
    const context = currentContext();
    if (!context) return null;
    const track = deps.getConsumerTrack(consumer);
    if (!track) return null;
    const frame = deps.getConsumerFrame(consumer, context);
    return renderTrackSource(
      context.root,
      track,
      frame,
      context,
      deps.getSourceMode(consumer)
    );
  }

  function resolveMaterial(material, localFrame) {
    const context = currentContext();
    if (!context) return null;
    const track = deps.getConsumerTrack(material);
    if (!track) return null;
    const clip = material?.tryGetParentOfType?.(state.PZ?.clip);
    const frame = clip && Number.isFinite(localFrame) ? clip.start + localFrame : context.frame;
    return renderTrackSource(context.root, track, frame, context);
  }

  function resolveShaderSource(shader, sourceProperty, frame) {
    const context = currentContext();
    if (!context) return null;
    const track = deps.getConsumerTrack(shader, sourceProperty);
    if (!track) return null;
    const clip = shader?.tryGetParentOfType?.(state.PZ?.clip);
    const projectFrame = clip && Number.isFinite(frame) ? clip.start + frame : context.frame;
    return renderTrackSource(
      context.root,
      track,
      projectFrame,
      context,
      deps.getSourceMode(shader, sourceProperty)
    );
  }

  function serializeConsumer(consumer) {
    const properties = JSON.parse(JSON.stringify(consumer.properties));
    const track = deps.getConsumerTrack(consumer);
    if (track) properties.source = deps.trackToken(track);
    return { type: consumer.type, properties };
  }

  function registerConsumer(consumer) {
    if (!consumer) return;
    const sourceProperties = deps.getSourceProperties(consumer);
    if (consumer.type === 1 && sourceProperties.length === 0) {
      state.consumers.delete(consumer);
      return;
    }
    state.consumers.add(consumer);
    for (const property of sourceProperties) {
      if (property?.get?.()) deps.setConsumerSource(consumer, property.get(), { sourceProperty: property });
    }
  }

  function unregisterConsumer(consumer) {
    state.consumers.delete(consumer);
  }

  function validateProject(project) {
    if (!project) return;
    for (const consumer of state.consumers) {
      if (deps.getProject(consumer) !== project) continue;
      for (const property of deps.getSourceProperties(consumer)) {
        const target = deps.getConsumerTrack(consumer, property);
        if (!target) continue;
        if (deps.wouldCreateCycle(consumer, target, property)) {
          const sourceState = deps.getSourceState(consumer, property);
          sourceState._zoidiumSourceTrack = null;
          sourceState._zoidiumSourceError = "cycle";
          deps.clearSourceProperty(consumer, property);
          sourceState._zoidiumSourceError = "cycle";
        }
      }
    }
  }

  return {
    createCopyPass,
    currentContext,
    frameKey,
    getCaptureCompositor,
    getCopyPass,
    getRuntime,
    getSourceTarget,
    isLayerMaskEffect,
    popContext,
    pushContext,
    registerConsumer,
    renderSelectedEffects,
    renderTrackSource,
    resolveConsumer,
    resolveMaterial,
    resolveShaderSource,
    serializeConsumer,
    unregisterConsumer,
    validateProject,
  };
};
