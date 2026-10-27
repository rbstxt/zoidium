// Zoidium Core temporal capture and export failure policy.
(function temporalCapturePart(global) {
  "use strict";
  const registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});
  function safeMessage(error) {
    return String(error?.message || error || "Unknown failure")
      .replace(/(?:blob:|file:|https?:)[^\s<>"']+/gi, "[media source]");
  }
  function objectName(object, fallback) {
    try { return object?.properties?.name?.get?.() || object?.name || fallback; }
    catch (_error) { return fallback; }
  }
  function sampleError(stage, frame, error) {
    const effect = objectName(stage.effect, "frame sampler");
    const clip = objectName(stage.clip, objectName(stage.clip?.object, "video clip"));
    return new Error(`Temporal sample failed for effect "${safeMessage(effect)}", clip "${safeMessage(clip)}", requested frame ${frame}: ${safeMessage(error)}`, { cause: error });
  }
  function checkPolicy(context) { context?.exportPolicy?.check?.(); context?.resourcePolicy?.check?.(); }
  function captureFrameSamplerInput(
    state,
    root,
    runtime,
    stage,
    projectFrame,
    restoreFrame,
    depth,
    target,
    mediaSamples = [],
    inputContext = null,
    preserveInputRGB = false,
  ) {
    const { finiteNumber, temporalMode } = registry.math;
    const { usesSingleEvaluation, installSingleEvaluation, canRenderLayer, getClipForLayer, isAdjustmentLayer } = registry.layers;
    const { getFrameSamplerInputFrame, getFrameSamplerCapture, copyRenderTarget,
      bindSampleTextures, restoreLayerAtContextFrame, ownsFrameSamplerScope } = registry.sampler;
    const sequence = root?._sequence;
    checkPolicy(inputContext);
    inputContext?.resourcePolicy?.assertStage(sequence, stage, projectFrame);
    const requestedFrame = projectFrame;
    projectFrame = getFrameSamplerInputFrame(stage, projectFrame);
    const capture = getFrameSamplerCapture(runtime, root, depth, sequence);
    if (!capture || !sequence) {
      if (inputContext?.exportPolicy) throw sampleError(stage, requestedFrame, "Capture unavailable");
      return false;
    }
    checkPolicy(inputContext);

    const renderer = root.renderer;
    const parentContext = state.contexts[state.contexts.length - 1];
    const currentFrame = finiteNumber(restoreFrame, parentContext?.outputFrame);
    const singleEvaluation = inputContext?.singleEvaluation ?? parentContext?.singleEvaluation ?? usesSingleEvaluation(sequence);
    if (singleEvaluation && !inputContext?.singleEvaluation && !parentContext?.singleEvaluation) installSingleEvaluation(state, sequence);
    const wasEvaluatingOwner = state.evaluatingLayers.has(stage.layer);
    const evaluateOwner = temporalMode(stage.effect) !== "legacy" || !isAdjustmentLayer(stage.layer);
    const changedLayers = new Map();
    const previousClearColor = renderer.getClearColor
      ? renderer.getClearColor(new THREE.Color())
      : null;
    const previousClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : null;

    const preparedLayers = inputContext?.frameSamplerPreparedLayers;
    const restoreTextures = bindSampleTextures(mediaSamples);
    // The sequence starts opaque black; individual layer inputs start transparent.
    renderer.setClearColor(0, isAdjustmentLayer(stage.layer) ? 1 : 0);
    capture.clear(0);
    renderer.setClearColor(0, 0);
    state.contexts.push({
      exportPolicy: inputContext?.exportPolicy || parentContext?.exportPolicy,
      resourcePolicy: inputContext?.resourcePolicy || parentContext?.resourcePolicy,
      compositor: capture,
      singleEvaluation,
      frameSamplerDepth: depth,
      outputFrame: projectFrame,
      renderingSequence: true,
      rootCompositor: root,
      frameSamplerScope: ownsFrameSamplerScope(stage, requestedFrame)
        ? stage : inputContext?.frameSamplerScope || parentContext?.frameSamplerScope,
    });
    try {
      const tracks = sequence.videoTracks || [];
      for (let index = 0; index < (isAdjustmentLayer(stage.layer) ? stage.trackIndex : 0); index += 1) {
        const track = tracks[index];
        if (!track || track.enabled === false) continue;
        const clip = track.getCurrentClip?.(projectFrame);
        const layer = clip?.object;
        if (!clip || !canRenderLayer(layer)) continue;
        changedLayers.set(layer, layer.__zoidiumTemporalLastUpdateFrame);
        if (!Number.isFinite(preparedLayers?.get(layer)) ||
          preparedLayers.get(layer) !== layer.__zoidiumTemporalUpdateRevision) {
          layer.update(projectFrame - finiteNumber(clip.start, 0));
        }
        capture.renderLayer(layer, 0, false);
      }

      changedLayers.set(stage.layer, stage.layer.__zoidiumTemporalLastUpdateFrame);
      if (evaluateOwner) state.evaluatingLayers.add(stage.layer);
      // Decoding and prefix preparation can yield to live playback updates.
      // Skip the duplicate evaluation only if the prepared layer is untouched.
      if (!Number.isFinite(preparedLayers?.get(stage.layer)) ||
        preparedLayers.get(stage.layer) !== stage.layer.__zoidiumTemporalUpdateRevision) {
        stage.layer.update(projectFrame - finiteNumber(stage.clip.start, 0));
      }
      // Render the owner's content with the host's viewport and UV rules, then
      // stop before its composite transform. Samples represent effect input,
      // not a transformed layer or the last screen buffer.
      const renderEffects = capture.renderEffects;
      const captured = {};
      let didCapture = false;
      capture.renderEffects = function (effects, uvX, uvY) {
        if (effects !== stage.layer.effects) {
          return renderEffects.call(this, effects, uvX, uvY);
        }
        const prefix = Array.prototype.slice.call(effects, 0, stage.effectIndex);
        renderEffects.call(this, prefix, uvX, uvY);
        const viewport = this.readBuffer.viewport;
        target.viewport.set(0, 0, viewport.z, viewport.w);
        copyRenderTarget(this, target, this.readBuffer, uvX, uvY, preserveInputRGB);
        didCapture = true;
        throw captured;
      };
      try {
        capture.renderLayer(stage.layer, 0, false);
      } catch (error) {
        if (error !== captured) throw error;
      } finally {
        capture.renderEffects = renderEffects;
      }
      if (!didCapture && inputContext?.exportPolicy) throw new Error("Required input capture did not complete");
      checkPolicy(inputContext);
      return true;
    } catch (error) {
      if (inputContext?.exportPolicy || parentContext?.exportPolicy) throw sampleError(stage, requestedFrame, error);
      if (inputContext?.resourcePolicy || parentContext?.resourcePolicy) throw error;
      console.error("[Zoidium] frame sampler capture failed:", error);
      return false;
    } finally {
      state.contexts.pop();
      restoreTextures();
      for (const [layer, previousFrame] of changedLayers) {
        if (inputContext?.frameSamplerChangedLayers) inputContext.frameSamplerChangedLayers.add(layer);
        else if (singleEvaluation) {
          // The content is already in the captured texture. Only the owner's
          // transforms/effect uniforms can still be read by the current pass.
          // Restore their actual input clock, without walking Scene/Composite
          // children or applying the time operators for a second time.
          const input = finiteNumber(previousFrame,
            currentFrame - finiteNumber(getClipForLayer(layer)?.start, 0));
          delete layer.__zoidiumTemporalEvaluationStamp;
          state.evaluationEpoch += 1;
          state.originalLayerUpdate.call(layer, input);
          layer.__zoidiumTemporalLastUpdateFrame = input;
          layer.__zoidiumTemporalUpdateRevision = ++state.layerUpdateRevision;
        } else restoreLayerAtContextFrame(layer, currentFrame);
      }
      if (!wasEvaluatingOwner && evaluateOwner) state.evaluatingLayers.delete(stage.layer);
      if (previousClearColor) {
        renderer.setClearColor(
          previousClearColor,
          previousClearAlpha == null ? 1 : previousClearAlpha,
        );
      }
    }
  }

  // Only the shutter request opts in. Keep the ordinary temporal-input cache
  // and all of its per-tap/export reservations on the existing path.
  function reductionKey(plan, depth, scope) {
    return JSON.stringify(["reduced", depth, scope?.effect
      ? registry.layers.frameSamplerIdentity(scope.effect) : 0, plan]);
  }
  function cachedReduction(runtime, effect, revision, key, width, height, depth) {
    if (registry.layers.frameSamplerReuseDisabled()) return null;
    const cached = runtime.inputCache.get(effect)?.get(revision)?.get(key);
    const sample = cached?.sample, target = sample?.target;
    if (!target || cached.stamp !== target.inputStamp || target.width !== width || target.height !== height) return null;
    target.inputUsed = ++runtime.inputClock;
    runtime.exportPins?.add(target);
    trimReductionTargets(runtime, effect, depth, 8 + sample.reducedCount / 8, new Set([target]));
    return [sample];
  }
  function trimReductionTargets(runtime, effect, depth, capacity, reserved) {
    const sampler = registry.sampler;
    const record = runtime.records.get(effect)?.[Math.max(0, depth - 1)];
    // Drop idle slots left by a larger request or a previous reconstruction.
    // Published results and outer export clocks must stay valid until consumed.
    for (const value of record?.targets.slice() || []) {
      if (record.targets.length <= capacity) break;
      if (reserved.has(value) || Array.from(runtime.reservations)
        .concat(Array.from(runtime.publishedReservations.values())).some(batch => batch.has(value))) continue;
      sampler.forgetFrameSamplerInput(value);
      record.targets.splice(record.targets.indexOf(value), 1);
      runtime.targets.delete(value);
      runtime.targetOwners.delete(value);
      runtime.targetBytes -= value.width * value.height * 4;
      value.dispose?.();
    }
  }
  function createReduction(runtime, root, effect, depth, reserved, width, height, plan, reduce, revision, key, release) {
    const sampler = registry.sampler;
    const capacity = 8 + Math.ceil(plan.length / 8);
    trimReductionTargets(runtime, effect, depth, capacity, reserved);
    let batch = [], groups = [], count = 0;
    function target() {
      const value = sampler.selectFrameSamplerTarget(runtime, effect, depth, reserved, width, height, capacity, revision);
      sampler.forgetFrameSamplerInput(value);
      value.inputStamp = {};
      value.inputGeneration = runtime.generation;
      value.inputRevision = revision;
      value.inputUsed = ++runtime.inputClock;
      value.viewport.set(0, 0, width, height);
      reserved.add(value);
      return value;
    }
    function combine(samples) {
      const output = target();
      reduce(root.renderer, output, samples);
      return { target: output, texture: output.texture, stamp: output.inputStamp };
    }
    return {
      capacity,
      append(sample) {
        batch.push(sample);
        count++;
        if (batch.length !== 8) return;
        const group = combine(batch);
        for (const item of batch) reserved.delete(item.target);
        batch = [];
        release();
        groups.push(group);
      },
      finish() {
        // A partial preview must never silently change the shutter weights.
        if (batch.length || count !== plan.length) return [];
        const sample = combine(groups);
        for (const item of groups) reserved.delete(item.target);
        groups = [];
        sample.reducedCount = count;
        let revisions = runtime.inputCache.get(effect);
        if (!revisions) runtime.inputCache.set(effect, revisions = new Map());
        let cache = revisions.get(revision);
        if (!cache) revisions.set(revision, cache = new Map());
        cache.set(key, { sample, stamp: sample.stamp });
        sample.target.inputEntry = { cache, key, revisions, revision };
        runtime.exportPins?.add(sample.target);
        return [sample];
      },
    };
  }
  function frameSamplerAuthority(state, stage, controlFrame, context, depth) {
    const layers = registry.layers;
    const root = context?.frameSamplerRoot || context?.rootCompositor || context?.compositor;
    const scope = context?.frameSamplerScope;
    return { ...context, controlFrame, frameSamplerRoot: root, frameSamplerDepth: depth,
      scopeId: scope?.effect ? layers.frameSamplerIdentity(scope.effect) : 0,
      stageId: layers.frameSamplerIdentity(stage.effect) };
  }

  function drawAuthority(state, effect) {
    const layers = registry.layers, math = registry.math;
    const context = state.contexts[state.contexts.length - 1];
    const root = context?.rootCompositor || context?.compositor;
    const stage = layers.findFrameSamplerStage(root?._sequence, effect, context?.outputFrame);
    if (!stage) return null;
    const local = math.finiteNumber(stage.layer.__zoidiumTemporalLastUpdateFrame,
      context.outputFrame - math.finiteNumber(stage.clip.start, 0));
    const frame = layers.isAdjustmentLayer(stage.layer)
      ? registry.sampler.getFrameSamplerControlFrame(stage, local, context.frameSamplerScope)
      : math.finiteNumber(effect._zoidiumFrameSamplerFrame, local);
    return frameSamplerAuthority(state, stage, frame, context, math.finiteNumber(context.frameSamplerDepth, 0) + 1);
  }

  async function prepareChildren(layer, frame, context) {
    const children = layer.nestedTracks
      ? layer.nested.flatMap(track => track.enabled === false ? [] : [track.getCurrentClip(frame + (layer.offset || 0))].filter(Boolean))
      : Array.from(layer.objects || [], object => ({ object }));
    for (const child of children) {
      if (!(child.object instanceof PZ.layer)) continue;
      const local = frame + (layer.nestedTracks ? (layer.offset || 0) - child.start : 0);
      const input = PZ.zoidium?.temporal?.mapLayerFrame(child.object, local)?.sourceFrame ?? local;
      context.resourcePolicy.assertLayer(child.object);
      await prepareChildren(child.object, input, context);
      for (const effect of child.object.effects || []) await context.resourcePolicy.prepareEffect(effect, input, context);
    }
  }

  registry.capture = { frameSamplerAuthority, drawAuthority, prepareChildren, captureFrameSamplerInput, safeMessage, sampleError, checkPolicy,
    reductionKey, cachedReduction, createReduction };
})(typeof globalThis !== "undefined" ? globalThis : this);
