(function installTemporalRenderPatch(global) {
  "use strict";

  const EPSILON = 1e-9;
  const PATCH_MARKER = "__zoidiumTemporalRenderPatch";
  const LAYER_UPDATE_MARKER = "__zoidiumTemporalLayerUpdatePatch";
  const EFFECT_UPDATE_MARKER = "__zoidiumTemporalEffectUpdatePatch";
  const SCHEDULE_PREPARE_MARKER = "__zoidiumTemporalSchedulePreparePatch";
  const PLAYBACK_SCHEDULE_MARKER = "__zoidiumTemporalPlaybackSchedulePatch";
  const VIEWPORT_RENDER_MARKER = "__zoidiumTemporalViewportRenderPatch";
  const EXPORT_FRAME_MARKER = "__zoidiumTemporalExportFramePatch";
  const MAX_FRAME_SAMPLES = 16;
  const MAX_FRAME_SAMPLER_DEPTH = 8;

  function finiteNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clampLocalFrame(frame, clipLength, extrapolate) {
    const value = finiteNumber(frame, 0);
    if (extrapolate) return value;
    const clamped = Math.max(0, value);
    if (!(clipLength > 0)) return clamped;
    return Math.min(clamped, Math.max(0, clipLength - EPSILON));
  }

  function quantizeLocalFrame(localFrame, projectRate, targetRate, extrapolate) {
    const rate = finiteNumber(projectRate, 30);
    const fps = finiteNumber(targetRate, 0);
    const input = finiteNumber(localFrame, 0);
    if (!(rate > 0) || !(fps > 0)) return extrapolate ? input : Math.max(0, input);

    const seconds = (extrapolate ? input : Math.max(0, input)) / rate;
    const quantizedSeconds = Math.floor(seconds * fps + EPSILON) / fps;
    return quantizedSeconds * rate;
  }

  function applyTemporalOperators(localFrame, projectRate, operators, clipLength, extrapolate) {
    let result = clampLocalFrame(localFrame, clipLength, extrapolate);
    for (const operator of operators || []) {
      if (!operator || operator.enabled === false) continue;
      if (operator.kind === "time-offset") {
        result += finiteNumber(operator.offsetFrames, 0);
      } else if (operator.kind === "posterize-time") {
        result = quantizeLocalFrame(result, projectRate, operator.fps, extrapolate);
      }
      result = clampLocalFrame(result, clipLength, extrapolate);
    }
    return result;
  }

  function clampUnit(value, fallback) {
    return Math.min(1, Math.max(0, finiteNumber(value, fallback)));
  }

  function buildFrameSamplePlan(
    outputFrame,
    count,
    offsetFrames,
    startOpacity,
    decay,
    minimumFrame,
    maximumFrame,
  ) {
    const total = Math.min(
      MAX_FRAME_SAMPLES,
      Math.max(0, Math.round(finiteNumber(count, 0))),
    );
    const output = finiteNumber(outputFrame, 0);
    const offset = finiteNumber(offsetFrames, 0);
    const opacity = clampUnit(startOpacity, 1);
    const attenuation = clampUnit(decay, 1);
    const minimum = finiteNumber(minimumFrame, Number.NEGATIVE_INFINITY);
    const maximum = finiteNumber(maximumFrame, Number.POSITIVE_INFINITY);
    const lower = Math.min(minimum, maximum);
    const upper = Math.max(minimum, maximum);
    const samples = [];

    for (let index = 1; index <= total; index += 1) {
      const frame = Math.min(upper, Math.max(lower, output + offset * index));
      samples.push({
        frame,
        index,
        opacity: opacity * Math.pow(attenuation, index - 1),
      });
    }
    return samples;
  }

  function mapTemporalFrameWithScopes(
    localFrame,
    projectRate,
    operators,
    scopeOperators,
    clipLength,
    clipStart,
    extrapolate,
  ) {
    const start = finiteNumber(clipStart, 0);
    const sourceLocalFrame = applyTemporalOperators(
      localFrame,
      projectRate,
      operators,
      clipLength,
      extrapolate,
    );
    const sourceProjectFrame = applyTemporalOperators(
      start + sourceLocalFrame,
      projectRate,
      scopeOperators,
      undefined,
      extrapolate,
    );
    return clampLocalFrame(sourceProjectFrame - start, clipLength, extrapolate);
  }

  function getSequenceForLayer(layer) {
    try {
      return layer?.getParentOfType?.(PZ.sequence) || layer?.parentProject?.sequence || null;
    } catch (_error) {
      return null;
    }
  }

  function getClipForLayer(layer) {
    try {
      return layer?.tryGetParentOfType?.(PZ.clip) || null;
    } catch (_error) {
      return null;
    }
  }

  function isTopLevelClipLayer(layer, clip) {
    return Boolean(layer && clip && clip.object === layer);
  }

  function getProjectRate(layer, sequence) {
    const value = sequence?.properties?.rate?.get?.();
    return finiteNumber(value, 30);
  }

  function isAdjustmentLayer(layer) {
    const AdjustmentLayer = typeof PZ !== "undefined" ? PZ.layer?.adjustment : null;
    return Boolean(AdjustmentLayer && layer instanceof AdjustmentLayer);
  }

  function isSceneLayer(layer) {
    const SceneLayer = typeof PZ !== "undefined" ? PZ.layer?.scene : null;
    return Boolean(SceneLayer && layer instanceof SceneLayer);
  }

  function isExtrapolatableLayer(layer) {
    // Procedural layers (Scene, Adjustment) can evaluate beyond their clip
    // out-point: shader time keeps running and keyframed properties hold
    // their end values. Media-backed content still clamps (freeze) because
    // there are no frames beyond the media duration. Video texture seeks
    // clamp independently in video-frame-export.js.
    return isSceneLayer(layer) || isAdjustmentLayer(layer);
  }

  function findScheduleItemAtFrame(schedule, projectFrame) {
    const items = schedule?.items;
    if (!items || typeof items.length !== "number") return null;
    if (!Number.isFinite(projectFrame)) return null;
    const padding = finiteNumber(schedule?.padding, 0);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const start = finiteNumber(item.start, 0);
      const length = finiteNumber(item.length, 0);
      if (projectFrame >= start - padding && projectFrame < start + length) {
        return { item, index };
      }
    }
    return null;
  }

  function getVideoTrackIndex(sequence, layer) {
    const tracks = sequence?.videoTracks;
    if (!tracks || !layer) return -1;
    for (let index = 0; index < tracks.length; index += 1) {
      if (tracks[index]?.layer === layer) return index;
    }
    return -1;
  }

  function isClipActiveAtProjectFrame(clip, projectFrame) {
    const start = finiteNumber(clip?.start, 0);
    const length = finiteNumber(clip?.length, 0);
    return projectFrame >= start && projectFrame < start + length;
  }

  function readTemporalOperators(layer, controlFrame) {
    const effects = layer?.effects;
    if (!effects || typeof effects.length !== "number") return [];

    const operators = [];
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      const descriptor = effect?._zoidiumTemporal;
      if (!descriptor || typeof descriptor.getOperator !== "function") continue;
      try {
        const operator = descriptor.getOperator(effect, controlFrame);
        if (operator) operators.push(operator);
      } catch (error) {
        console.error("[Zoidium] temporal effect evaluation failed:", error);
      }
    }
    return operators;
  }

  function readTemporalOperatorsAfterIndex(layer, index, controlFrame) {
    const effects = layer?.effects;
    if (!effects || typeof effects.length !== "number") return [];

    const operators = [];
    for (let effectIndex = index + 1; effectIndex < effects.length; effectIndex += 1) {
      const effect = effects[effectIndex];
      const descriptor = effect?._zoidiumTemporal;
      if (!descriptor || typeof descriptor.getOperator !== "function") continue;
      try {
        const operator = descriptor.getOperator(effect, controlFrame);
        if (operator) operators.push(operator);
      } catch (error) {
        console.error("[Zoidium] temporal effect evaluation failed:", error);
      }
    }
    return operators;
  }

  function getAdjustmentEffectFrame(layer, effect, frame) {
    if (!isAdjustmentLayer(layer)) return frame;

    const effects = layer?.effects;
    const index = effects?.indexOf?.(effect) ?? -1;
    if (index < 0) return frame;

    const scopeOperators = readTemporalOperatorsAfterIndex(layer, index, frame);
    if (scopeOperators.length === 0) return frame;

    const clip = getClipForLayer(layer);
    const sequence = getSequenceForLayer(layer);
    return mapTemporalFrameWithScopes(
      frame,
      getProjectRate(layer, sequence),
      [],
      scopeOperators,
      finiteNumber(clip?.length, 0),
      finiteNumber(clip?.start, 0),
      true,
    );
  }

  function installEffectUpdatePatches(state, layer) {
    const effects = layer?.effects;
    if (!effects || typeof effects.length !== "number") return;

    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      if (!effect || effect[EFFECT_UPDATE_MARKER] || typeof effect.update !== "function") {
        continue;
      }

      const originalUpdate = effect.update;
      effect.update = function temporalEffectUpdate(frame) {
        const evaluationFrame = getAdjustmentEffectFrame(layer, effect, frame);
        return originalUpdate.call(this, evaluationFrame);
      };
      Object.defineProperty(effect, EFFECT_UPDATE_MARKER, {
        configurable: true,
        value: true,
      });
    }
  }

  function readAdjustmentScopeOperators(sequence, targetLayer, projectFrame) {
    const targetIndex = getVideoTrackIndex(sequence, targetLayer);
    if (targetIndex < 0) return [];

    const operators = [];
    const tracks = sequence?.videoTracks || [];
    // CM3 renders videoTracks from low to high index. A later Adjustment
    // layer is therefore above the target and sees the accumulated result
    // from every lower track.
    for (let index = targetIndex + 1; index < tracks.length; index += 1) {
      const adjustmentLayer = tracks[index]?.layer;
      if (!isAdjustmentLayer(adjustmentLayer)) continue;

      const adjustmentClip = getClipForLayer(adjustmentLayer);
      if (!isTopLevelClipLayer(adjustmentLayer, adjustmentClip)) continue;
      if (!isClipActiveAtProjectFrame(adjustmentClip, projectFrame)) continue;

      const controlFrame = projectFrame - finiteNumber(adjustmentClip.start, 0);
      operators.push(...readTemporalOperators(adjustmentLayer, controlFrame));
    }
    return operators;
  }

  function getTemporalLayerFrame(layer, localFrame, sequence) {
    const clip = getClipForLayer(layer);
    if (!isTopLevelClipLayer(layer, clip)) return null;

    const rawLocalFrame = finiteNumber(localFrame, 0);
    const outputProjectFrame = finiteNumber(clip.start, 0) + rawLocalFrame;
    // The clip contributes nothing when the output frame is outside its
    // range (its track layer is null and the compositor skips it). Mapping
    // such frames would make hidden clips visible at a warped end-state.
    if (!isClipActiveAtProjectFrame(clip, outputProjectFrame)) return null;

    const projectRate = getProjectRate(layer, sequence);
    const outputLocalFrame = rawLocalFrame;
    const operators = isAdjustmentLayer(layer)
      ? []
      : readTemporalOperators(layer, outputLocalFrame);
    const scopeOperators = readAdjustmentScopeOperators(
      sequence,
      layer,
      outputProjectFrame,
    );
    if (operators.length === 0 && scopeOperators.length === 0) return null;

    const extrapolate = isExtrapolatableLayer(layer);
    const sourceFrame = mapTemporalFrameWithScopes(
      rawLocalFrame,
      projectRate,
      operators,
      scopeOperators,
      finiteNumber(clip.length, 0),
      finiteNumber(clip.start, 0),
      extrapolate,
    );
    return {
      clip,
      localFrame: outputLocalFrame,
      sourceFrame,
      projectFrame: clip.start + sourceFrame,
      projectRate,
    };
  }

  function getScheduleSourceFrame(schedule, projectFrame) {
    if (!Number.isFinite(projectFrame)) return projectFrame;
    // Use the item active at the output frame. Reading currentItem here
    // would return the previous frame's item because the original prepare()
    // has not run yet for this frame, which breaks mappings at clip
    // boundaries.
    const found = findScheduleItemAtFrame(schedule, projectFrame);
    const clip = found?.item?.clip || schedule?.currentItem?.clip;
    if (!found || !clip) return projectFrame;
    const layer = clip?.object;
    if (!layer) return projectFrame;
    const sequence = clip?.parentProject?.sequence || null;
    const localFrame = projectFrame - finiteNumber(clip.start, 0);
    const mapped = getTemporalLayerFrame(layer, localFrame, sequence);
    return mapped ? mapped.projectFrame : projectFrame;
  }

  function canRenderLayer(layer) {
    if (!layer) return false;
    if (isSceneLayer(layer) && !layer.pass?.camera) return false;
    if (layer instanceof PZ.layer.composite && !layer.objects?.length) return false;
    return true;
  }

  function findFrameSamplerStage(sequence, effect, projectFrame) {
    const tracks = sequence?.videoTracks || [];
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!track || track.enabled === false) continue;
      const clip = track.getCurrentClip?.(projectFrame);
      const layer = clip?.object;
      if (!clip || !isAdjustmentLayer(layer)) continue;
      const effectIndex = layer.effects?.indexOf?.(effect) ?? -1;
      if (effectIndex < 0) continue;
      return { clip, effect, effectIndex, layer, trackIndex };
    }
    return null;
  }

  function registerCompositor(state, compositor) {
    const sequence = compositor?._sequence;
    if (!sequence) return;
    const previous = state.rootSequences.get(compositor);
    if (previous && previous !== sequence) {
      state.compositorsBySequence.get(previous)?.delete(compositor);
    }
    let compositors = state.compositorsBySequence.get(sequence);
    if (!compositors) {
      compositors = new Set();
      state.compositorsBySequence.set(sequence, compositors);
    }
    compositors.add(compositor);
    state.rootSequences.set(compositor, sequence);
  }

  function getFrameSamplerRuntime(state, root) {
    if (!root) return null;
    let runtime = state.frameSamplerRuntimes.get(root);
    if (runtime) return runtime;
    runtime = {
      captures: [],
      prepared: new WeakMap(),
      records: new WeakMap(),
      targets: new Set(),
    };
    state.frameSamplerRuntimes.set(root, runtime);
    return runtime;
  }

  function disposeFrameSamplerRuntime(state, root) {
    const runtime = root && state.frameSamplerRuntimes.get(root);
    if (runtime) {
      for (const target of runtime.targets) target?.dispose?.();
      for (const capture of runtime.captures) {
        if (!capture) continue;
        capture.unload?.();
        for (const target of capture.accumBuffers || []) target?.dispose?.();
        capture.copyPass?.material?.dispose?.();
        capture.mixPass?.material?.dispose?.();
      }
      runtime.targets.clear();
      runtime.captures.length = 0;
      state.frameSamplerRuntimes.delete(root);
    }
    const sequence = state.rootSequences.get(root);
    state.compositorsBySequence.get(sequence)?.delete(root);
    state.rootSequences.delete(root);
  }

  function getFrameSamplerCapture(runtime, root, depth, sequence) {
    if (!runtime || !root?.renderer || depth > MAX_FRAME_SAMPLER_DEPTH) return null;
    const width = root.readBuffer?.width;
    const height = root.readBuffer?.height;
    if (!(width > 0) || !(height > 0)) return null;
    const index = Math.max(0, depth - 1);
    let capture = runtime.captures[index];
    if (!capture) {
      capture = new PZ.compositor(root.renderer, width, height);
      capture.sequence = sequence;
      runtime.captures[index] = capture;
    } else {
      if (capture.readBuffer?.width !== width || capture.readBuffer?.height !== height) {
        capture.setSize(width, height);
      }
      if (capture._sequence !== sequence) capture.sequence = sequence;
    }
    const resolution = sequence?.properties?.resolution?.get?.() || [width, height];
    capture.ratio = width / (finiteNumber(resolution[0], width) || width);
    return capture;
  }

  function getFrameSamplerTarget(runtime, effect, depth, index, width, height) {
    let depthRecords = runtime.records.get(effect);
    if (!depthRecords) {
      depthRecords = [];
      runtime.records.set(effect, depthRecords);
    }
    const depthIndex = Math.max(0, depth - 1);
    let record = depthRecords[depthIndex];
    if (!record) {
      record = { targets: [] };
      depthRecords[depthIndex] = record;
    }
    let target = record.targets[index];
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.generateMipmaps = false;
      record.targets[index] = target;
      runtime.targets.add(target);
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
    return target;
  }

  function copyRenderTarget(compositor, target, source) {
    if (!compositor?.copyPass || !target || !source) return;
    const uniforms = compositor.copyPass.uniforms;
    uniforms.tDiffuse.value = source.texture;
    uniforms.opacity.value = 1;
    uniforms.uvScale?.value?.set?.(1, 1);
    uniforms.uvOffset?.value?.set?.(0, 0);
    compositor.copyPass.render(compositor.renderer, target, null, true);
  }

  function restoreLayerAtContextFrame(layer, projectFrame) {
    const clip = getClipForLayer(layer);
    if (!clip || typeof layer?.update !== "function") return;
    try {
      layer.update(projectFrame - finiteNumber(clip.start, 0));
    } catch (_error) {
      // A failed restoration must not stop the main compositor pass.
    }
  }

  function captureFrameSamplerInput(
    state,
    root,
    runtime,
    stage,
    projectFrame,
    restoreFrame,
    depth,
    target,
  ) {
    const sequence = root?._sequence;
    const capture = getFrameSamplerCapture(runtime, root, depth, sequence);
    if (!capture || !sequence) return false;

    const renderer = root.renderer;
    const parentContext = state.contexts[state.contexts.length - 1];
    const currentFrame = finiteNumber(restoreFrame, parentContext?.outputFrame);
    const changedLayers = new Set();
    const previousClearColor = renderer.getClearColor
      ? renderer.getClearColor(new THREE.Color())
      : null;
    const previousClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : null;

    renderer.setClearColor(0, 0);
    capture.clear(0);
    state.contexts.push({
      compositor: capture,
      frameSamplerDepth: depth,
      outputFrame: projectFrame,
      renderingSequence: true,
      rootCompositor: root,
    });
    try {
      const tracks = sequence.videoTracks || [];
      for (let index = 0; index < stage.trackIndex; index += 1) {
        const track = tracks[index];
        if (!track || track.enabled === false) continue;
        const clip = track.getCurrentClip?.(projectFrame);
        const layer = clip?.object;
        if (!clip || !canRenderLayer(layer)) continue;
        changedLayers.add(layer);
        layer.update(projectFrame - finiteNumber(clip.start, 0));
        capture.renderLayer(layer, 0, false);
      }

      changedLayers.add(stage.layer);
      stage.layer.update(projectFrame - finiteNumber(stage.clip.start, 0));
      capture.readBuffer.viewport.set(
        0,
        0,
        capture.readBuffer.width,
        capture.readBuffer.height,
      );
      copyRenderTarget(capture, capture.readBuffer, capture.screenBuffers[0]);
      const prefix = Array.prototype.slice.call(stage.layer.effects, 0, stage.effectIndex);
      if (prefix.length > 0) capture.renderEffects(prefix, 1, 1);
      copyRenderTarget(capture, target, capture.readBuffer);
      return true;
    } catch (error) {
      console.error("[Zoidium] frame sampler capture failed:", error);
      return false;
    } finally {
      state.contexts.pop();
      for (const layer of changedLayers) restoreLayerAtContextFrame(layer, currentFrame);
      if (previousClearColor) {
        renderer.setClearColor(
          previousClearColor,
          previousClearAlpha == null ? 1 : previousClearAlpha,
        );
      }
    }
  }

  async function prepareLowerSchedules(sequence, stage, projectFrame, context) {
    const activeClips = new Set();
    const tracks = sequence?.videoTracks || [];
    for (let index = 0; index < stage.trackIndex; index += 1) {
      const track = tracks[index];
      if (!track || track.enabled === false) continue;
      const clip = track.getCurrentClip?.(projectFrame);
      if (clip) activeClips.add(clip);
    }
    if (activeClips.size === 0) return;

    for (const schedule of sequence.videoSchedules || []) {
      const found = findScheduleItemAtFrame(schedule, projectFrame);
      if (!found?.item?.clip || !activeClips.has(found.item.clip)) continue;
      await schedule.prepare(projectFrame, context);
    }
  }

  async function prepareFrameSamples(state, effect, localFrame, context) {
    if (!effect?._zoidiumFrameSampler || state.preparingEffects.has(effect)) return;
    let layer = null;
    try {
      layer = effect.tryGetParentOfType?.(PZ.layer.adjustment) || null;
    } catch (_error) {
      return;
    }
    const clip = getClipForLayer(layer);
    const sequence = getSequenceForLayer(layer);
    if (!layer || !clip || !sequence) return;

    const projectFrame = finiteNumber(clip.start, 0) + finiteNumber(localFrame, 0);
    const stage = findFrameSamplerStage(sequence, effect, projectFrame);
    const roots = state.compositorsBySequence.get(sequence);
    if (!stage || !roots?.size) return;

    const controlFrame = finiteNumber(effect._zoidiumFrameSamplerFrame, localFrame);
    let request;
    try {
      request = effect._zoidiumFrameSampler.getRequest(effect, controlFrame);
    } catch (error) {
      console.error("[Zoidium] frame sampler request failed during prepare:", error);
      return;
    }
    if (!request || request.enabled === false) return;

    const maximum = Math.max(0, finiteNumber(clip.length, 0) - EPSILON);
    const plan = buildFrameSamplePlan(
      controlFrame,
      request.count,
      request.offsetFrames,
      request.startOpacity,
      request.decay,
      0,
      maximum,
    );
    if (plan.length === 0) return;

    state.preparingEffects.add(effect);
    try {
      for (const root of Array.from(roots)) {
        if (!root?.renderer || root._sequence !== sequence) continue;
        const runtime = getFrameSamplerRuntime(state, root);
        const width = root.readBuffer?.width;
        const height = root.readBuffer?.height;
        if (!runtime || !(width > 0) || !(height > 0)) continue;

        const samples = [];
        runtime.prepared.delete(effect);
        for (let index = 0; index < plan.length; index += 1) {
          const item = plan[index];
          const sourceProjectFrame = finiteNumber(clip.start, 0) + item.frame;
          await prepareLowerSchedules(sequence, stage, sourceProjectFrame, context);
          const target = getFrameSamplerTarget(
            runtime,
            effect,
            1,
            index,
            width,
            height,
          );
          if (
            captureFrameSamplerInput(
              state,
              root,
              runtime,
              stage,
              sourceProjectFrame,
              projectFrame,
              1,
              target,
            )
          ) {
            samples.push({
              frame: sourceProjectFrame,
              index: item.index,
              opacity: item.opacity,
              target,
              texture: target.texture,
            });
          }
        }
        if (samples.length > 0) {
          runtime.prepared.set(effect, {
            projectFrame,
            samples,
          });
        }
      }
    } catch (error) {
      console.error("[Zoidium] frame sampler preparation failed:", error);
    } finally {
      try {
        await prepareLowerSchedules(sequence, stage, projectFrame, context);
      } catch (_error) {
        // The outer sequence prepare continues and restores remaining schedules.
      }
      state.preparingEffects.delete(effect);
    }
  }

  function resolveFrameSamples(state, effect) {
    const context = state.contexts[state.contexts.length - 1];
    const root = context?.rootCompositor || context?.compositor;
    const sequence = root?._sequence;
    const descriptor = effect?._zoidiumFrameSampler;
    const outputFrame = finiteNumber(context?.outputFrame, NaN);
    if (!sequence || !descriptor || !Number.isFinite(outputFrame)) return [];

    const depth = finiteNumber(context?.frameSamplerDepth, 0) + 1;
    if (depth > MAX_FRAME_SAMPLER_DEPTH || state.samplingEffects.has(effect)) return [];
    const stage = findFrameSamplerStage(sequence, effect, outputFrame);
    if (!stage) return [];

    const lastLayerFrame = finiteNumber(
      stage.layer.__zoidiumTemporalLastUpdateFrame,
      outputFrame - finiteNumber(stage.clip.start, 0),
    );
    const currentProjectFrame = finiteNumber(stage.clip.start, 0) + lastLayerFrame;
    const controlFrame = finiteNumber(
      effect._zoidiumFrameSamplerFrame,
      getAdjustmentEffectFrame(stage.layer, effect, lastLayerFrame),
    );
    let request;
    try {
      request = descriptor.getRequest(effect, controlFrame);
    } catch (error) {
      console.error("[Zoidium] frame sampler request failed:", error);
      return [];
    }
    if (!request || request.enabled === false) return [];

    const maximum = Math.max(0, finiteNumber(stage.clip.length, 0) - EPSILON);
    const plan = buildFrameSamplePlan(
      controlFrame,
      request.count,
      request.offsetFrames,
      request.startOpacity,
      request.decay,
      0,
      maximum,
    );
    if (plan.length === 0) return [];

    const runtime = getFrameSamplerRuntime(state, root);
    const width = root.readBuffer?.width;
    const height = root.readBuffer?.height;
    if (!runtime || !(width > 0) || !(height > 0)) return [];
    const prepared = runtime.prepared.get(effect);
    if (
      prepared &&
      Math.abs(finiteNumber(prepared.projectFrame, NaN) - currentProjectFrame) <= EPSILON &&
      prepared.samples.length === plan.length &&
      prepared.samples.every((sample, index) => {
        const item = plan[index];
        const frame = finiteNumber(stage.clip.start, 0) + item.frame;
        return (
          Math.abs(finiteNumber(sample.frame, NaN) - frame) <= EPSILON &&
          Math.abs(finiteNumber(sample.opacity, NaN) - item.opacity) <= EPSILON
        );
      })
    ) {
      return prepared.samples;
    }

    const samples = [];
    state.samplingEffects.add(effect);
    try {
      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        const target = getFrameSamplerTarget(
          runtime,
          effect,
          depth,
          index,
          width,
          height,
        );
        const projectFrame = finiteNumber(stage.clip.start, 0) + item.frame;
        if (
          captureFrameSamplerInput(
            state,
            root,
            runtime,
            stage,
            projectFrame,
            currentProjectFrame,
            depth,
            target,
          )
        ) {
          samples.push({
            frame: projectFrame,
            index: item.index,
            opacity: item.opacity,
            target,
            texture: target.texture,
          });
        }
      }
    } finally {
      state.samplingEffects.delete(effect);
    }
    return samples;
  }

  function getTemporalState() {
    const PZRoot = typeof PZ !== "undefined" ? PZ : null;
    if (!PZRoot) return null;
    PZRoot.zoidium = PZRoot.zoidium || {};
    if (PZRoot.zoidium.temporal) return PZRoot.zoidium.temporal;

    const state = {
      contexts: [],
      compositorsBySequence: new WeakMap(),
      evaluatingLayers: new WeakSet(),
      frameSamplerRuntimes: new WeakMap(),
      preparingEffects: new WeakSet(),
      restoringLayers: new WeakSet(),
      rootSequences: new WeakMap(),
      samplingEffects: new WeakSet(),
      originalLayerUpdate: null,
      originalCompositorUnload: null,
      originalExportGetVideoFrame: null,
      originalRenderSequence: null,
      originalRenderLayer: null,
      originalSchedulePrepare: null,
      originalPlaybackUpdateSchedule: null,
      originalViewportRender: null,
      layerPrototype: null,
      compositorPrototype: null,
      schedulePrototype: null,
      playbackPrototype: null,
      viewportPrototype: null,
      exportPrototype: null,
      resolveFrameSamples(effect) {
        return resolveFrameSamples(this, effect);
      },
      prepareFrameSamples(effect, frame, context) {
        return prepareFrameSamples(this, effect, frame, context);
      },
      mapLayerFrame(layer, localFrame) {
        const sequence = getSequenceForLayer(layer);
        return getTemporalLayerFrame(layer, localFrame, sequence);
      },
      mapProjectFrame(layer, projectFrame) {
        const clip = getClipForLayer(layer);
        if (!clip || !Number.isFinite(projectFrame)) return null;
        return this.mapLayerFrame(layer, projectFrame - clip.start);
      },
    };

    PZRoot.zoidium.temporal = state;
    return state;
  }

  function installLayerUpdatePatch(state) {
    const prototype = PZ.layer?.prototype;
    if (!prototype || prototype[LAYER_UPDATE_MARKER]) return;

    state.layerPrototype = prototype;
    state.originalLayerUpdate = prototype.update;
    prototype.update = function temporalTrackedLayerUpdate(frame) {
      installEffectUpdatePatches(state, this);
      const context = state.contexts[state.contexts.length - 1];
      const mapped =
        context?.renderingSequence &&
        !state.evaluatingLayers.has(this) &&
        !state.restoringLayers.has(this)
          ? state.mapLayerFrame(this, frame)
          : null;

      if (mapped && Math.abs(mapped.sourceFrame - frame) > EPSILON) {
        const renderOnly = isSceneLayer(this);
        this.__zoidiumTemporalLastUpdateFrame = renderOnly
          ? frame
          : mapped.sourceFrame;
        this.__zoidiumTemporalSequenceMapping = {
          localFrame: finiteNumber(frame, 0),
          sourceFrame: mapped.sourceFrame,
          renderOnly,
        };
        if (renderOnly) return state.originalLayerUpdate.apply(this, arguments);
        return state.originalLayerUpdate.call(this, mapped.sourceFrame);
      }

      delete this.__zoidiumTemporalSequenceMapping;
      this.__zoidiumTemporalLastUpdateFrame = frame;
      return state.originalLayerUpdate.apply(this, arguments);
    };
    Object.defineProperty(prototype, LAYER_UPDATE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installCompositorPatch(state) {
    const prototype = PZ.compositor?.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return;

    state.compositorPrototype = prototype;
    state.originalRenderSequence = prototype.renderSequence;
    state.originalRenderLayer = prototype.renderLayer;
    state.originalCompositorUnload = prototype.unload;

    prototype.renderSequence = function temporalRenderSequence(frame) {
      registerCompositor(state, this);
      state.contexts.push({
        compositor: this,
        frameSamplerDepth: 0,
        outputFrame: frame,
        renderingSequence: true,
        rootCompositor: this,
      });
      try {
        return state.originalRenderSequence.apply(this, arguments);
      } finally {
        state.contexts.pop();
      }
    };

    prototype.unload = function temporalCompositorUnload() {
      disposeFrameSamplerRuntime(state, this);
      return state.originalCompositorUnload.apply(this, arguments);
    };

    prototype.renderLayer = function temporalRenderLayer(layer) {
      const sequenceMapping = layer?.__zoidiumTemporalSequenceMapping;
      if (sequenceMapping && !state.evaluatingLayers.has(layer)) {
        if (sequenceMapping.renderOnly) {
          state.evaluatingLayers.add(layer);
          state.restoringLayers.add(layer);
          try {
            layer.update(sequenceMapping.sourceFrame);
            return state.originalRenderLayer.apply(this, arguments);
          } finally {
            try {
              layer.update(sequenceMapping.localFrame);
              layer.__zoidiumTemporalLastUpdateFrame = sequenceMapping.localFrame;
            } finally {
              delete layer.__zoidiumTemporalSequenceMapping;
              state.restoringLayers.delete(layer);
              state.evaluatingLayers.delete(layer);
            }
          }
        }

        try {
          return state.originalRenderLayer.apply(this, arguments);
        } finally {
          delete layer.__zoidiumTemporalSequenceMapping;
          state.restoringLayers.add(layer);
          try {
            state.originalLayerUpdate.call(layer, sequenceMapping.localFrame);
            layer.__zoidiumTemporalLastUpdateFrame = sequenceMapping.localFrame;
          } finally {
            state.restoringLayers.delete(layer);
          }
        }
      }

      const lastFrame = finiteNumber(layer?.__zoidiumTemporalLastUpdateFrame, NaN);
      const mapped =
        !state.evaluatingLayers.has(layer) && Number.isFinite(lastFrame)
          ? state.mapLayerFrame(layer, lastFrame)
          : null;

      if (!mapped || Math.abs(mapped.sourceFrame - lastFrame) <= EPSILON) {
        return state.originalRenderLayer.apply(this, arguments);
      }

      state.evaluatingLayers.add(layer);
      try {
        layer.update(mapped.sourceFrame);
        return state.originalRenderLayer.apply(this, arguments);
      } finally {
        state.evaluatingLayers.delete(layer);
        layer.update(mapped.localFrame);
      }
    };

    Object.defineProperty(prototype, PATCH_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installSchedulePreparePatch(state) {
    const prototype = PZ.schedule?.prototype;
    if (!prototype || prototype[SCHEDULE_PREPARE_MARKER]) return;

    state.schedulePrototype = prototype;
    state.originalSchedulePrepare = prototype.prepare;
    prototype.prepare = async function temporalSchedulePrepare(projectFrame) {
      const args = Array.prototype.slice.call(arguments, 1);
      const found = findScheduleItemAtFrame(this, projectFrame);
      if (found?.item?.clip) {
        const clip = found.item.clip;
        const layer = clip?.object;
        const sequence = clip?.parentProject?.sequence || null;
        const localFrame = projectFrame - finiteNumber(clip.start, 0);
        const mapped = layer ? getTemporalLayerFrame(layer, localFrame, sequence) : null;
        const isProceduralSchedule =
          this.type === PZ.schedule?.type?.NONE || !found.item.media;
        if (mapped && isProceduralSchedule) {
          // Procedural clips (Scene/Adjustment) can render beyond their
          // out-point. The original prepare() would look up the schedule at
          // the warped source frame, find no item, and leave the previous
          // frame on screen (a long freeze). Evaluate the output-active
          // clip directly at the warped source frame instead.
          this.currentItem = found.item;
          const itemIndex = Array.prototype.indexOf.call(this.items, found.item);
          if (Number.isInteger(itemIndex) && itemIndex >= 0) this.index = itemIndex;
          try {
            clip.update(mapped.projectFrame);
          } catch (_error) {
            // A failing procedural update must not break the export loop.
          }
          try {
            if (typeof clip.prepare === "function") await clip.prepare(mapped.projectFrame, args[0]);
          } catch (_error) {
            // Ignore prepare failures here; the compositor still renders.
          }
          return;
        }
        if (mapped) {
          return state.originalSchedulePrepare.call(this, mapped.projectFrame, ...args);
        }
      }
      const sourceFrame = getScheduleSourceFrame(this, projectFrame);
      return state.originalSchedulePrepare.call(this, sourceFrame, ...args);
    };
    Object.defineProperty(prototype, SCHEDULE_PREPARE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installPlaybackPatch(state) {
    const prototype = PZ.ui?.playback?.prototype;
    if (!prototype || prototype[PLAYBACK_SCHEDULE_MARKER]) return;

    state.playbackPrototype = prototype;
    state.originalPlaybackUpdateSchedule = prototype.updateSchedule;
    prototype.updateSchedule = function temporalUpdateSchedule(schedule, delta) {
      if (schedule?.type !== PZ.schedule?.type?.VIDEO || !schedule.currentItem) {
        return state.originalPlaybackUpdateSchedule.apply(this, arguments);
      }

      const outputFrame = finiteNumber(this._exactFrame, NaN);
      const nextOutputFrame = outputFrame + finiteNumber(delta, 0);
      const layer = schedule.currentItem.clip?.object;
      const current = state.mapProjectFrame(layer, outputFrame);
      const next = state.mapProjectFrame(layer, nextOutputFrame);
      if (!current || !next) {
        return state.originalPlaybackUpdateSchedule.apply(this, arguments);
      }

      const previousExactFrame = this._exactFrame;
      this._exactFrame = current.projectFrame;
      try {
        return state.originalPlaybackUpdateSchedule.call(
          this,
          schedule,
          next.projectFrame - current.projectFrame,
        );
      } finally {
        this._exactFrame = previousExactFrame;
      }
    };
    Object.defineProperty(prototype, PLAYBACK_SCHEDULE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installViewportPatch(state) {
    const prototype = PZ.ui?.viewport?.prototype;
    if (!prototype || prototype[VIEWPORT_RENDER_MARKER]) return;

    state.viewportPrototype = prototype;
    state.originalViewportRender = prototype._render;
    prototype._render = function temporalViewportRender() {
      registerCompositor(state, this.compositor);
      if (!this.renderMode || !this.layer) {
        return state.originalViewportRender.apply(this, arguments);
      }

      // The 3D editing viewport must remain on the live editing frame. Temporal
      // operators are applied only when the Scene is rendered as a layer in
      // the sequence compositor.
      if (isSceneLayer(this.layer)) {
        return state.originalViewportRender.apply(this, arguments);
      }

      const outputFrame = finiteNumber(this.editor?.playback?.currentFrame, NaN);
      const mapped = state.mapProjectFrame(this.layer, outputFrame);
      if (!mapped || Math.abs(mapped.sourceFrame - mapped.localFrame) <= EPSILON) {
        return state.originalViewportRender.apply(this, arguments);
      }

      this.layer.update(mapped.sourceFrame);
      try {
        this.renderer.render(this.scene, this.camera);
        this.lastFrame = -1;
      } finally {
        this.layer.update(mapped.localFrame);
      }
    };
    Object.defineProperty(prototype, VIEWPORT_RENDER_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installExportPatch(state) {
    const prototype = PZ.export?.prototype;
    if (!prototype || prototype[EXPORT_FRAME_MARKER]) return;

    state.exportPrototype = prototype;
    state.originalExportGetVideoFrame = prototype.getVideoFrame;
    prototype.getVideoFrame = function temporalExportGetVideoFrame() {
      registerCompositor(state, this.compositor);
      return state.originalExportGetVideoFrame.apply(this, arguments);
    };
    Object.defineProperty(prototype, EXPORT_FRAME_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function install(globalObject) {
    if (typeof PZ === "undefined" || !PZ.compositor || !PZ.layer || !PZ.schedule) return null;
    const state = getTemporalState();
    if (!state) return null;
    installLayerUpdatePatch(state);
    installCompositorPatch(state);
    installSchedulePreparePatch(state);
    installPlaybackPatch(state);
    installViewportPatch(state);
    installExportPatch(state);
    if (globalObject) globalObject.ZOIDIUM_TEMPORAL = state;
    return state;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      applyTemporalOperators,
      buildFrameSamplePlan,
      clampLocalFrame,
      findScheduleItemAtFrame,
      isClipActiveAtProjectFrame,
      mapTemporalFrameWithScopes,
      quantizeLocalFrame,
    };
    return;
  }

  install(global);
})(typeof window !== "undefined" ? window : null);
