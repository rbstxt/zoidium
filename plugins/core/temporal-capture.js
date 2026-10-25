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
  function checkPolicy(context) { context?.exportPolicy?.check?.(); }
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
  ) {
    const { finiteNumber, temporalMode } = registry.math;
    const { usesSingleEvaluation, installSingleEvaluation, canRenderLayer, getClipForLayer, isAdjustmentLayer } = registry.layers;
    const { getFrameSamplerInputFrame, getFrameSamplerCapture, copyRenderTarget,
      bindSampleTextures, restoreLayerAtContextFrame, ownsFrameSamplerScope } = registry.sampler;
    const sequence = root?._sequence;
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
    renderer.setClearColor(0, 0);
    capture.clear(0);
    state.contexts.push({
      exportPolicy: inputContext?.exportPolicy || parentContext?.exportPolicy,
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
        copyRenderTarget(this, target, this.readBuffer, uvX, uvY);
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

  registry.capture = { captureFrameSamplerInput, safeMessage, sampleError, checkPolicy };
})(typeof globalThis !== "undefined" ? globalThis : this);
