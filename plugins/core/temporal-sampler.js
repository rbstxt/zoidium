// Zoidium Core — temporal sampler (split from temporal-render.js).
// Frame sampler runtime. Loads after temporal-math.js and temporal-layers.js.
(function temporalSamplerPart(global) {
  "use strict";

  var registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});

  var math = registry.math;
  var layers = registry.layers;
  if ((!math || !layers) && typeof module === "object" && module.exports) {
    math = require("./temporal-math.js");
    layers = require("./temporal-layers.js");
    registry.math = math;
    registry.layers = layers;
  }
  if (!math || !layers) {
    throw new Error("[Zoidium] temporal-math.js and temporal-layers.js must load before temporal-sampler.js.");
  }
  var EPSILON = math.EPSILON;
  var MAX_FRAME_SAMPLER_DEPTH = math.MAX_FRAME_SAMPLER_DEPTH;
  var finiteNumber = math.finiteNumber;
  var buildFrameSamplePlan = math.buildFrameSamplePlan;
  var planExplicitFrameSamples = math.planExplicitFrameSamples;
  var getSequenceForLayer = layers.getSequenceForLayer;
  var getClipForLayer = layers.getClipForLayer;
  var getProjectRate = layers.getProjectRate;
  var isAdjustmentLayer = layers.isAdjustmentLayer;
  var findScheduleItemAtFrame = layers.findScheduleItemAtFrame;
  var getScheduleSourceFrame = layers.getScheduleSourceFrame;
  var canRenderLayer = layers.canRenderLayer;
  var findFrameSamplerStage = layers.findFrameSamplerStage;
  var getAdjustmentEffectFrame = layers.getAdjustmentEffectFrame;

  function getFrameSamplerPrefix(stage, projectFrame) {
    // Before 430a52c taps used their raw requested clock, without replaying
    // prefix quantizers or bounding the adjustment scope to this sampler.
    if (math.temporalMode(stage.effect) === "legacy") return [];
    return layers.readTemporalOperatorsBeforeIndex(stage.layer, stage.effectIndex,
      projectFrame - finiteNumber(stage.clip.start, 0));
  }

  function hasFrameSamplerQuantizer(operators) {
    return operators.some(operator => operator?.enabled !== false && operator?.kind === "posterize-time");
  }

  function getFrameSamplerInputFrame(stage, projectFrame) {
    const start = finiteNumber(stage.clip.start, 0);
    const adjustment = isAdjustmentLayer(stage.layer);
    const frame = adjustment ? projectFrame : projectFrame - start;
    const mapped = math.mapFrameSamplerInputFrame(frame,
      getProjectRate(stage.layer, getSequenceForLayer(stage.layer)),
      getFrameSamplerPrefix(stage, projectFrame),
      adjustment ? undefined : finiteNumber(stage.clip.length, 0),
      layers.isExtrapolatableLayer(stage.layer));
    return adjustment ? mapped : start + mapped;
  }

  function getFrameSamplerControlFrame(stage, frame, scope) {
    if (math.temporalMode(stage.effect) === "legacy") return getAdjustmentEffectFrame(stage.layer, stage.effect, frame);
    if (!isAdjustmentLayer(stage.layer) || scope?.layer === stage.layer) return frame;
    const start = finiteNumber(stage.clip.start, 0);
    const prefix = getFrameSamplerPrefix(stage, start + frame);
    if (!hasFrameSamplerQuantizer(prefix)) return getAdjustmentEffectFrame(stage.layer, stage.effect, frame);
    // Adjustment time operators act on the accumulated input in project time.
    // Use its mapped clock for tap spacing, just as ordinary layer samplers do.
    return math.applyTemporalOperators(start + frame,
      getProjectRate(stage.layer, getSequenceForLayer(stage.layer)),
      layers.readTemporalOperators(stage.layer, frame), undefined, true) - start;
  }

  function withFrameSamplerInputContext(state, stage, frame, context, callback) {
    if (math.temporalMode(stage.effect) === "legacy") return callback();
    const parent = state.contexts[state.contexts.length - 1];
    const evaluating = state.evaluatingLayers.has(stage.layer);
    state.evaluatingLayers.add(stage.layer);
    state.contexts.push(Object.assign({}, parent, context, {
      outputFrame: frame,
      renderingSequence: true,
      frameSamplerScope: hasFrameSamplerQuantizer(getFrameSamplerPrefix(stage, frame))
        ? stage : context?.frameSamplerScope || parent?.frameSamplerScope,
    }));
    try { return callback(); }
    finally {
      state.contexts.pop();
      if (!evaluating) state.evaluatingLayers.delete(stage.layer);
    }
  }

  function registerCompositor(state, compositor) {
    const sequence = compositor?._sequence;
    if (!sequence) return;
    const previous = state.rootSequences.get(compositor);
    if (previous && previous !== sequence) {
      disposeFrameSamplerRuntime(state, compositor);
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
      schedules: new Map(),
      prepared: new WeakMap(),
      records: new WeakMap(),
      targetOwners: new WeakMap(),
      reservations: new Set(),
      publishedReservations: new Map(),
      targetBytes: 0,
      inputClock: 0,
      generation: 0,
      targets: new Set(),
      inputCache: new WeakMap(),
    };
    state.frameSamplerRuntimes.set(root, runtime);
    runtime.resolutionObservable = root._sequence?.properties?.resolution?.onChanged;
    runtime.resolutionWatcher = () => clearFrameSamplerTargets(runtime);
    runtime.resolutionObservable?.watch?.(runtime.resolutionWatcher);
    runtime.pluginWatcher = () => {
      disposeFrameSamplerRuntime(state, root);
      registerCompositor(state, root);
    };
    if (typeof document !== "undefined") {
      document.addEventListener?.("zoidium:plugin-state-change", runtime.pluginWatcher);
    }
    return runtime;
  }

  function disposeFrameSamplerRuntime(state, root) {
    const runtime = root && state.frameSamplerRuntimes.get(root);
    if (runtime) {
      runtime.disposed = true;
      runtime.resolutionObservable?.unwatch?.(runtime.resolutionWatcher);
      if (typeof document !== "undefined") {
        document.removeEventListener?.("zoidium:plugin-state-change", runtime.pluginWatcher);
      }
      clearFrameSamplerTargets(runtime);
      for (const capture of runtime.captures) {
        if (!capture) continue;
        for (const watcher of capture.frameSamplerResolutionWatchers || []) {
          capture._sequence?.properties?.resolution?.onChanged?.unwatch?.(watcher);
        }
        capture.unload?.();
        capture.canvasTexture?.dispose?.();
        for (const target of capture.accumBuffers || []) target?.dispose?.();
        capture.copyPass?.material?.dispose?.();
        capture.mixPass?.material?.dispose?.();
      }
      for (const schedule of runtime.schedules.values()) {
        schedule.el?.pause?.();
        schedule.el?.removeAttribute?.("src");
        schedule.el?.load?.();
        schedule.decoder?.process?.kill?.();
        schedule.unload?.();
      }
      runtime.schedules.clear();
      runtime.targets.clear();
      runtime.captures.length = 0;
      state.frameSamplerRuntimes.delete(root);
    }
    const sequence = state.rootSequences.get(root);
    state.compositorsBySequence.get(sequence)?.delete(root);
    state.rootSequences.delete(root);
  }

  // A sampler request uses either the legacy evenly spaced Echo plan
  // (count/offsetFrames/startOpacity/decay) or, when `request.frames` is a
  // non-empty array of frame offsets, an explicit per-tap plan. Both clamp
  // to the clip bounds; only the caps differ (16 vs 64 taps).
  function planRequestSamples(request, controlFrame, maximum) {
    if (request && Array.isArray(request.frames) && request.frames.length > 0) {
      return planExplicitFrameSamples(controlFrame, request.frames, 0, maximum);
    }
    return buildFrameSamplePlan(
      controlFrame,
      request.count,
      request.offsetFrames,
      request.startOpacity,
      request.decay,
      0,
      maximum,
    );
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
      runtime.captures[index] = capture;
    } else {
      if (capture.readBuffer?.width !== width || capture.readBuffer?.height !== height) {
        capture.setSize(width, height);
      }
    }
    if (capture._sequence !== sequence) {
      for (const watcher of capture.frameSamplerResolutionWatchers || []) {
        capture._sequence?.properties?.resolution?.onChanged?.unwatch?.(watcher);
      }
      const observable = sequence?.properties?.resolution?.onChanged;
      const before = new Set(observable?.watchers || []);
      capture.sequence = sequence;
      capture.frameSamplerResolutionWatchers = (observable?.watchers || [])
        .filter((watcher) => !before.has(watcher));
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
      // Shared scratch target (zoidium/shared/gl.js).
      target = ZoidiumPluginApis.gl.createRenderTarget(THREE, width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      record.targets[index] = target;
      runtime.targets.add(target);
      runtime.targetOwners.set(target, record);
      runtime.targetBytes += width * height * 4;
    } else {
      runtime.targetBytes += (width * height - target.width * target.height) * 4;
      ZoidiumPluginApis.gl.ensureSize(target, width, height);
    }
    return target;
  }

  // RGBA8, no depth/stencil or mipmaps. The reuse pool is capped at 256 MiB
  // per root compositor and 128 slots per effect/input-depth. A single active request
  // may require more than the byte cap; only its mandatory slots are allowed
  // then, with no extra history allocation.
  const FRAME_SAMPLER_CACHE_BYTES = 256 * 1024 * 1024;

  function clearFrameSamplerTargets(runtime) {
    runtime.generation += 1;
    for (const target of runtime.targets) target.dispose?.();
    runtime.targets.clear();
    runtime.targetBytes = 0;
    runtime.records = new WeakMap();
    runtime.targetOwners = new WeakMap();
    runtime.publishedReservations.clear();
    runtime.prepared = new WeakMap();
    runtime.inputCache = new WeakMap();
    runtime.inputCacheKey = null;
    runtime.previewKey = null;
  }

  // An edit expires every memoized input but keeps the allocated targets, so
  // dragging a property does not reallocate GPU memory on each change. The
  // pool and its byte bound are unchanged.
  function invalidateFrameSamplerInputs(runtime) {
    runtime.generation += 1;
    for (const target of runtime.targets) target.inputStamp = {};
    runtime.publishedReservations.clear();
    runtime.prepared = new WeakMap();
    runtime.inputCache = new WeakMap();
    runtime.inputCacheKey = null;
    runtime.previewKey = null;
  }

  function frameSamplerCacheDepth(stage, depth) {
    // Depth changes the pixels only if evaluating the input can recurse into
    // another sampler. Keep adjustment scopes conservative: lower tracks can
    // contain samplers even when the owner's prefix is empty.
    return !isAdjustmentLayer(stage.layer) &&
      !stage.layer.effects.slice(0, stage.effectIndex).some(effect => effect?._zoidiumFrameSampler)
      ? 1 : depth;
  }

  function selectFrameSamplerTarget(runtime, effect, depth, reserved, width, height, capacity = 128, revision) {
    const record = runtime.records.get(effect)?.[Math.max(0, depth - 1)];
    const targets = record?.targets || [];
    const pinned = target => reserved.has(target) ||
      Array.from(runtime.reservations).concat(Array.from(runtime.publishedReservations.values()))
        .some(batch => batch.has(target));
    const available = Array.from(runtime.targets).filter(target => !pinned(target) &&
      (targets.length < capacity || targets.includes(target)));
    // After an edit, refill this effect's own expired slots before allocating.
    const expired = available.filter(target => targets.includes(target) &&
      target.inputGeneration !== undefined && (target.inputGeneration !== runtime.generation ||
        (revision !== undefined && target.inputRevision !== revision)) &&
      target.width === width && target.height === height)
      .sort((a, b) => (a.inputUsed || 0) - (b.inputUsed || 0))[0];
    if (expired) return expired;
    if (!available.length || (targets.length < capacity &&
      runtime.targetBytes + width * height * 4 <= FRAME_SAMPLER_CACHE_BYTES)) {
      return getFrameSamplerTarget(runtime, effect, depth, targets.length, width, height);
    }
    const target = available.reduce((oldest, candidate) =>
      (candidate.inputUsed || 0) < (oldest.inputUsed || 0) ? candidate : oldest);
    const previous = runtime.targetOwners.get(target);
    if (previous !== record) {
      // Transfer an expired slot instead of keeping an idle effect's history
      // while another effect has to recapture every source frame.
      previous.targets.splice(previous.targets.indexOf(target), 1);
      if (!record) {
        let records = runtime.records.get(effect);
        if (!records) { records = []; runtime.records.set(effect, records); }
        records[Math.max(0, depth - 1)] = { targets: [target] };
        runtime.targetOwners.set(target, records[Math.max(0, depth - 1)]);
      } else {
        targets.push(target);
        runtime.targetOwners.set(target, record);
      }
    }
    return target;
  }

  function copyRenderTarget(compositor, target, source, uvX = 1, uvY = 1) {
    if (!compositor?.copyPass || !target || !source) return;
    const uniforms = compositor.copyPass.uniforms;
    uniforms.tDiffuse.value = source.texture;
    uniforms.opacity.value = 1;
    uniforms.uvScale?.value?.set?.(uvX, uvY);
    uniforms.uvOffset?.value?.set?.(0, 0);
    try {
      compositor.copyPass.render(compositor.renderer, target, null, true);
    } finally {
      uniforms.uvScale?.value?.set?.(1, 1);
    }
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

  function bindSampleTextures(mediaSamples) {
    const restored = [];
    for (const sample of mediaSamples) {
      const item = sample.item;
      const owner = item.obj?.threeObj || item.clip?.object;
      const key = item.obj ? "map" : "texture";
      if (!owner) continue;
      restored.push({ owner, key, texture: owner[key] });
      owner[key] = sample.texture;
    }
    return () => {
      for (const entry of restored) entry.owner[entry.key] = entry.texture;
    };
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
    mediaSamples = [],
    inputContext = null,
  ) {
    const sequence = root?._sequence;
    const requestedFrame = projectFrame;
    projectFrame = getFrameSamplerInputFrame(stage, projectFrame);
    const capture = getFrameSamplerCapture(runtime, root, depth, sequence);
    if (!capture || !sequence) return false;

    const renderer = root.renderer;
    const parentContext = state.contexts[state.contexts.length - 1];
    const currentFrame = finiteNumber(restoreFrame, parentContext?.outputFrame);
    const wasEvaluatingOwner = state.evaluatingLayers.has(stage.layer);
    const evaluateOwner = math.temporalMode(stage.effect) !== "legacy" || !isAdjustmentLayer(stage.layer);
    const changedLayers = new Set();
    const previousClearColor = renderer.getClearColor
      ? renderer.getClearColor(new THREE.Color())
      : null;
    const previousClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : null;

    const preparedLayers = inputContext?.frameSamplerPreparedLayers;
    const restoreTextures = bindSampleTextures(mediaSamples);
    renderer.setClearColor(0, 0);
    capture.clear(0);
    state.contexts.push({
      compositor: capture,
      frameSamplerDepth: depth,
      outputFrame: projectFrame,
      renderingSequence: true,
      rootCompositor: root,
      frameSamplerScope: hasFrameSamplerQuantizer(getFrameSamplerPrefix(stage, requestedFrame))
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
        changedLayers.add(layer);
        if (!Number.isFinite(preparedLayers?.get(layer)) ||
          preparedLayers.get(layer) !== layer.__zoidiumTemporalUpdateRevision) {
          layer.update(projectFrame - finiteNumber(clip.start, 0));
        }
        capture.renderLayer(layer, 0, false);
      }

      changedLayers.add(stage.layer);
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
      capture.renderEffects = function (effects, uvX, uvY) {
        if (effects !== stage.layer.effects) {
          return renderEffects.call(this, effects, uvX, uvY);
        }
        const prefix = Array.prototype.slice.call(effects, 0, stage.effectIndex);
        renderEffects.call(this, prefix, uvX, uvY);
        const viewport = this.readBuffer.viewport;
        target.viewport.set(0, 0, viewport.z, viewport.w);
        copyRenderTarget(this, target, this.readBuffer, uvX, uvY);
        throw captured;
      };
      try {
        capture.renderLayer(stage.layer, 0, false);
      } catch (error) {
        if (error !== captured) throw error;
      } finally {
        capture.renderEffects = renderEffects;
      }
      return true;
    } catch (error) {
      console.error("[Zoidium] frame sampler capture failed:", error);
      return false;
    } finally {
      state.contexts.pop();
      restoreTextures();
      for (const layer of changedLayers) {
        if (inputContext?.frameSamplerChangedLayers) inputContext.frameSamplerChangedLayers.add(layer);
        else restoreLayerAtContextFrame(layer, currentFrame);
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

  async function prepareLowerSchedules(sequence, stage, projectFrame, context, runtime, allTracks = false, state = null) {
    const activeClips = new Set();
    const tracks = sequence?.videoTracks || [];
    const start = allTracks || isAdjustmentLayer(stage.layer) ? 0 : stage.trackIndex;
    const end = allTracks ? tracks.length : stage.trackIndex + (isAdjustmentLayer(stage.layer) ? 0 : 1);
    for (let index = start; index < end; index += 1) {
      const track = tracks[index];
      if (!track || track.enabled === false) continue;
      const clip = track.getCurrentClip?.(projectFrame);
      if (clip) activeClips.add(clip);
    }
    const samples = [];
    for (const schedule of sequence.videoSchedules || []) {
      const found = findScheduleItemAtFrame(schedule, projectFrame);
      const item = found?.item;
      if (!item?.clip || !activeClips.has(item.clip) || !item.media) continue;
      // Never seek the playback/export schedule to obtain another frame.
      // Its shared texture must remain the current input until capture finishes.
      let isolated = runtime.schedules.get(schedule);
      if (!isolated) {
        isolated = new PZ.schedule(schedule.type);
        runtime.schedules.set(schedule, isolated);
      }
      const clone = Object.assign({}, item);
      Object.defineProperty(clone, "texture", {
        configurable: true, get: () => isolated.texture, set() {},
      });
      if (isolated.currentItem?.clip !== item.clip || isolated.currentItem?.obj !== item.obj ||
        isolated.sourceUrl !== item.media.url) isolated.currentItem = null;
      isolated.sourceUrl = item.media.url;
      isolated.items = [clone];
      const mapSource = () => getScheduleSourceFrame(schedule, projectFrame);
      const sourceFrame = !allTracks && !isAdjustmentLayer(stage.layer)
        ? projectFrame : state
          ? withFrameSamplerInputContext(state, stage, projectFrame, context, mapSource) : mapSource();
      isolated.update(sourceFrame, getProjectRate(stage.layer, sequence));
      if (isolated.currentItem) {
        const time = item.clip.properties.time.get(sourceFrame - item.start);
        if (typeof ISNODE !== "undefined" && ISNODE) {
          await isolated.ffDecodeFrame(Math.round(time * getProjectRate(stage.layer, sequence)),
            getProjectRate(stage.layer, sequence));
        } else {
          await isolated.decodeFrame(time);
        }
        samples.push({ item, texture: isolated.texture });
      }
    }
    return samples;
  }

  async function prepareInputEffects(sequence, stage, frame, context, state) {
    const preparedLayers = new Map();
    const tracks = sequence.videoTracks || [];
    const start = isAdjustmentLayer(stage.layer) ? 0 : stage.trackIndex;
    for (let index = start; index <= stage.trackIndex; index += 1) {
      if (tracks[index]?.enabled === false) continue;
      const clip = index === stage.trackIndex ? stage.clip : tracks[index]?.getCurrentClip?.(frame);
      const layer = clip?.object;
      if (!layer) continue;
      const localFrame = frame - finiteNumber(clip.start, 0);
      const scoped = callback => state
        ? withFrameSamplerInputContext(state, stage, frame, context, callback) : callback();
      scoped(() => layer.update(localFrame));
      preparedLayers.set(layer, layer.__zoidiumTemporalUpdateRevision);
      context?.frameSamplerChangedLayers?.add(layer);
      const count = index === stage.trackIndex ? stage.effectIndex : layer.effects?.length || 0;
      for (let i = 0; i < count; i += 1) {
        await scoped(() => layer.effects[i]?.prepare?.(localFrame, context));
      }
    }
    return preparedLayers;
  }

  async function prepareFrameSamples(state, effect, localFrame, context) {
    if (!effect?._zoidiumFrameSampler || state.preparingEffects.has(effect)) return;
    let layer = null;
    try {
      layer = effect.tryGetParentOfType?.(PZ.layer) || null;
    } catch (_error) {
      // A detached effect prepares no frame samples.
      return;
    }
    const clip = getClipForLayer(layer);
    const sequence = getSequenceForLayer(layer);
    if (!layer || !clip || !sequence) return;

    const projectFrame = finiteNumber(clip.start, 0) + finiteNumber(localFrame, 0);
    const stage = findFrameSamplerStage(sequence, effect, projectFrame);
    const roots = state.compositorsBySequence.get(sequence);
    if (!stage || !roots?.size) return;

    const parentContext = state.contexts[state.contexts.length - 1];
    const depth = finiteNumber(context?.frameSamplerDepth ?? parentContext?.frameSamplerDepth, 0) + 1;
    if (depth > MAX_FRAME_SAMPLER_DEPTH) return;
    const controlFrame = getFrameSamplerControlFrame(stage, localFrame,
      context?.frameSamplerScope || parentContext?.frameSamplerScope);
    let request;
    try {
      request = effect._zoidiumFrameSampler.getRequest(effect, controlFrame);
    } catch (error) {
      console.error("[Zoidium] frame sampler request failed during prepare:", error);
      return;
    }
    if (!request || request.enabled === false) return;

    const maximum = Math.max(0, finiteNumber(clip.length, 0) - EPSILON);
    const plan = planRequestSamples(request, controlFrame, maximum);
    if (plan.length === 0) return;

    const changedLayers = new Set();
    const reservations = [];
    const cacheDepth = frameSamplerCacheDepth(stage, depth);
    // Retain the interleaved playback window and a small scrub margin without
    // allocating new GPU targets on every frame until the byte cap is full.
    const frames = plan.map(item => item.frame);
    const capacity = plan.length === 1 ? 1 : Math.min(128, plan.length +
      Math.ceil(Math.max(...frames) - Math.min(...frames)) + 4);
    state.preparingEffects.add(effect);
    try {
      const requestedRoot = context?.frameSamplerRoot || context?.compositor;
      for (const root of requestedRoot ? [requestedRoot] : Array.from(roots)) {
        if (!root?.renderer || root._sequence !== sequence) continue;
        const runtime = getFrameSamplerRuntime(state, root);
        // Export or an explicit prepare can seek this root's isolated decoder.
        // Its old preview-media binding then needs a fresh current-frame decode.
        if (runtime && !runtime.previewPending) runtime.previewKey = null;
        const width = root.readBuffer?.width;
        const height = root.readBuffer?.height;
        if (!runtime || !(width > 0) || !(height > 0)) continue;

        if (depth === 1) runtime.publishedReservations.delete(effect);
        const samples = [];
        const capturedFrames = new Map();
        // Source inputs are immutable for a project revision and sample time.
        // Reuse neighbouring taps and segment anchors across output frames.
        // A target stamp prevents reading a slot after it has been overwritten.
        const scope = context?.frameSamplerScope || parentContext?.frameSamplerScope;
        const revision = frameSamplerInputKey(sequence, root, stage, scope);
        if (Array.from(runtime.targets).some(target => target.width !== width || target.height !== height)) {
          clearFrameSamplerTargets(runtime);
        }
        const generation = runtime.generation;
        const batchCache = runtime.inputCache;
        let revisions = batchCache.get(effect);
        if (!revisions) {
          revisions = new Map();
          batchCache.set(effect, revisions);
        }
        // Store the exact content string once per resident revision, rather
        // than copying an entire project into every source-frame map key.
        const inputCache = revisions.get(revision) || new Map();
        const reservedTargets = new Set();
        runtime.reservations.add(reservedTargets);
        reservations.push({ runtime, reservedTargets });
        const cacheKey = frame => JSON.stringify([frame, cacheDepth,
          scope?.effect ? frameSamplerIdentity(scope.effect) : 0]);
        const wantedFrames = new Set(plan.map(item => cacheKey(finiteNumber(clip.start, 0) + item.frame)));
        for (const [frame, cached] of inputCache) {
          const target = cached.sample.target;
          if (cached.stamp !== target.inputStamp || target.width !== width || target.height !== height) {
            inputCache.delete(frame);
          } else if (wantedFrames.has(frame)) {
            reservedTargets.add(target);
          }
        }
        runtime.prepared.delete(effect);
        for (let index = 0; index < plan.length; index += 1) {
          const item = plan[index];
          const sourceProjectFrame = finiteNumber(clip.start, 0) + item.frame;
          const cached = inputCache?.get(cacheKey(sourceProjectFrame));
          const reusable = !frameSamplerReuseDisabled() && cached && cached.stamp === cached.sample.target.inputStamp &&
            cached.sample.target.width === width && cached.sample.target.height === height;
          const reused = capturedFrames.get(sourceProjectFrame) || (reusable && cached.sample);
          if (reused) {
            reused.target.inputUsed = ++runtime.inputClock;
            samples.push(Object.assign({}, reused, { index: item.index, opacity: item.opacity }));
            continue;
          }
          const inputFrame = getFrameSamplerInputFrame(stage, sourceProjectFrame);
          const inputContext = Object.assign({}, context, {
            frameSamplerRoot: root, frameSamplerDepth: depth,
            frameSamplerScope: hasFrameSamplerQuantizer(getFrameSamplerPrefix(stage, sourceProjectFrame))
              ? stage : context?.frameSamplerScope || parentContext?.frameSamplerScope,
          });
          inputContext.frameSamplerChangedLayers = changedLayers;
          inputContext.frameSamplerPreparedLayers =
            await prepareInputEffects(sequence, stage, inputFrame, inputContext, state);
          const mediaSamples = await prepareLowerSchedules(sequence, stage, inputFrame, inputContext,
            runtime, false, state);
          if (runtime.disposed || runtime.generation !== generation ||
            revision !== frameSamplerInputKey(sequence, root, stage, scope)) return;
          const target = selectFrameSamplerTarget(runtime, effect, cacheDepth, reservedTargets, width, height, capacity, revision);
          // Any synchronous fallback or another nested plan using this slot
          // invalidates the old memoized value before writing into it.
          target.inputStamp = {};
          forgetFrameSamplerInput(target);
          target.inputGeneration = runtime.generation;
          target.inputRevision = revision;
          target.inputUsed = ++runtime.inputClock;
          reservedTargets.add(target);
          if (
            captureFrameSamplerInput(
              state,
              root,
              runtime,
              stage,
              sourceProjectFrame,
              projectFrame,
              depth,
              target,
              mediaSamples,
              inputContext,
            )
          ) {
            const sample = {
              frame: sourceProjectFrame,
              index: item.index,
              opacity: item.opacity,
              target,
              stamp: target.inputStamp,
              texture: target.texture,
            };
            const key = cacheKey(sourceProjectFrame);
            inputCache.set(key, { sample, stamp: target.inputStamp });
            revisions.set(revision, inputCache);
            target.inputEntry = { cache: inputCache, key, revisions, revision };
            capturedFrames.set(sourceProjectFrame, sample);
            samples.push(sample);
          }
        }
        if (samples.length > 0) {
          if (depth === 1) runtime.publishedReservations.set(effect, new Set(samples.map(sample => sample.target)));
          runtime.prepared.set(effect, {
            projectFrame,
            depth,
            revision,
            scope,
            samples,
          });
        }
      }
    } catch (error) {
      console.error("[Zoidium] frame sampler preparation failed:", error);
    } finally {
      try {
        const tracks = sequence.videoTracks || [];
        const currentLayers = new Set([stage.layer]);
        for (let i = 0; i < stage.trackIndex; i += 1) {
          if (tracks[i]?.enabled !== false) currentLayers.add(tracks[i]?.getCurrentClip?.(projectFrame)?.object);
        }
        for (const changedLayer of changedLayers) {
          if (!currentLayers.has(changedLayer)) restoreLayerAtContextFrame(changedLayer, projectFrame);
        }
        await prepareInputEffects(sequence, stage, projectFrame, context);
      } finally {
        for (const { runtime, reservedTargets } of reservations) runtime.reservations.delete(reservedTargets);
        state.preparingEffects.delete(effect);
      }
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
    const controlFrame = math.temporalMode(effect) === "legacy"
      ? finiteNumber(effect._zoidiumFrameSamplerFrame, getAdjustmentEffectFrame(stage.layer, effect, lastLayerFrame))
      : isAdjustmentLayer(stage.layer)
      ? getFrameSamplerControlFrame(stage, lastLayerFrame, context?.frameSamplerScope)
      : finiteNumber(effect._zoidiumFrameSamplerFrame, lastLayerFrame);
    let request;
    try {
      request = descriptor.getRequest(effect, controlFrame);
    } catch (error) {
      console.error("[Zoidium] frame sampler request failed:", error);
      return [];
    }
    if (!request || request.enabled === false) return [];

    const maximum = Math.max(0, finiteNumber(stage.clip.length, 0) - EPSILON);
    const plan = planRequestSamples(request, controlFrame, maximum);
    if (plan.length === 0) return [];

    const runtime = getFrameSamplerRuntime(state, root);
    const width = root.readBuffer?.width;
    const height = root.readBuffer?.height;
    if (!runtime || !(width > 0) || !(height > 0)) return [];
    const prepared = runtime.prepared.get(effect);
    const scope = context?.frameSamplerScope;
    const revision = frameSamplerInputKey(sequence, root, stage, scope);
    if (
      prepared && prepared.revision === revision && prepared.depth === depth &&
      prepared.scope === scope &&
      Math.abs(finiteNumber(prepared.projectFrame, NaN) - currentProjectFrame) <= EPSILON &&
      prepared.samples.length === plan.length &&
      prepared.samples.every((sample, index) => {
        const item = plan[index];
        const frame = finiteNumber(stage.clip.start, 0) + item.frame;
        return (
          Math.abs(finiteNumber(sample.frame, NaN) - frame) <= EPSILON &&
          Math.abs(finiteNumber(sample.opacity, NaN) - item.opacity) <= EPSILON &&
          sample.stamp === sample.target.inputStamp &&
          sample.target.width === width && sample.target.height === height
        );
      })
    ) {
      return prepared.samples;
    }

    // A later nested prepare may replace prepared.get(effect), even though
    // every input for this earlier stage is still resident. Resolve that pure
    // plan before falling back to synchronous captures without media prepare.
    {
      const cache = runtime.inputCache?.get(effect)?.get(revision);
      const scopeId = context?.frameSamplerScope?.effect
        ? frameSamplerIdentity(context.frameSamplerScope.effect) : 0;
      const cacheDepth = frameSamplerCacheDepth(stage, depth);
      const cachedSamples = plan.map(item => {
        const frame = finiteNumber(stage.clip.start, 0) + item.frame;
        const cached = cache?.get(JSON.stringify([frame, cacheDepth, scopeId]));
        if (!cached || cached.stamp !== cached.sample.target.inputStamp ||
          cached.sample.target.width !== width || cached.sample.target.height !== height) return null;
        cached.sample.target.inputUsed = ++runtime.inputClock;
        return Object.assign({}, cached.sample, { index: item.index, opacity: item.opacity });
      });
      if (cachedSamples.every(Boolean)) return cachedSamples;
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
        target.inputStamp = {};
        forgetFrameSamplerInput(target);
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

  let pluginStateEpoch = 0;
  let lastLocalKey = null;
  if (typeof document !== "undefined") {
    document.addEventListener?.("zoidium:plugin-state-change", () => { pluginStateEpoch += 1; });
  }

  function frameSamplerReuseDisabled() {
    return typeof PZ !== "undefined" && PZ.zoidium?.debugDisableFrameSamplerInputReuse === true;
  }

  function forgetFrameSamplerInput(target) {
    const entry = target.inputEntry;
    if (entry) {
      // A fresh oracle capture can replace the same key in another slot.
      // Reclaiming the old slot must not unlink that newer capture.
      if (entry.cache.get(entry.key)?.sample.target === target) entry.cache.delete(entry.key);
      if (entry.cache.size === 0) entry.revisions.delete(entry.revision);
    }
    target.inputEntry = null;
  }

  function frameSamplerInputKey(sequence, compositor, stage, scope) {
    const scoped = !frameSamplerReuseDisabled() && layers.frameSamplerScopedContent(sequence, stage, scope);
    const assets = Object.entries(sequence.parentProject?.assets?.list || {}).map(([id, asset]) =>
      [id, asset.url, asset.sha256, asset.filename, asset.size, frameSamplerIdentity(asset),
        asset.file ? frameSamplerIdentity(asset.file) : 0]);
    // Plugin state changes also dispose every runtime; the epoch keeps a stale
    // preview key from matching across one without reading every plugin state.
    const settings = [compositor.__zoidiumRenderSettings,
      [compositor.renderer?.shadowMap?.type, compositor.renderer?.shadowMap?.enabled], pluginStateEpoch,
      frameSamplerReuseDisabled(), math.temporalMode(stage?.effect), math.temporalMode(scope?.effect)];
    if (scoped) {
      const serialized = JSON.stringify(["layer-prefix", compositor.readBuffer.width, compositor.readBuffer.height,
        scoped, sequence.videoTracks[stage.trackIndex].enabled, assets, settings]);
      // Rechecks after each awaited tap usually see the same content again.
      if (serialized === lastLocalKey) return serialized;
      if (layers.frameSamplerSerializedContentIsLocal(serialized)) return (lastLocalKey = serialized);
    }
    const whole = () => JSON.stringify([compositor.readBuffer.width, compositor.readBuffer.height,
      sequence, sequence.videoTracks.map(track => track.enabled),
      assets, settings]);
    const layer = stage?.layer;
    if (!layer || frameSamplerReuseDisabled() || typeof layer.toJSON !== "function") return whole();
    // The sampler and later effects never feed its own input. Serialize the
    // whole sequence with this layer cut before the sampler, so editing the
    // time effect keeps inputs even when other tracks are in the key. A
    // synchronous own-property override leaves the live serializer untouched.
    const prefix = Object.assign({}, layer.toJSON(), {
      effects: Array.from(layer.effects || []).slice(0, stage.effectIndex),
    });
    const own = Object.prototype.hasOwnProperty.call(layer, "toJSON") ? layer.toJSON : null;
    let serialized;
    layer.toJSON = () => prefix;
    try {
      serialized = "effect-prefix" + whole();
    } finally {
      if (own) layer.toJSON = own;
      else delete layer.toJSON;
    }
    // Expressions, layer inputs and compositions can read the cut effects.
    return layers.frameSamplerSerializedReadsNoLayer(serialized) ? serialized : whole();
  }

  function renderPreparedPreview(viewport, runtime, frame) {
    const sequence = viewport.compositor._sequence;
    const liveFrame = finiteNumber(viewport.editor?.playback?.currentFrame, frame);
    const restoreTextures = bindSampleTextures(runtime.previewMedia || []);
    try {
      sequence.update(frame);
      viewport.compositor.renderSequence(frame);
      viewport.lastFrame = frame;
    } finally {
      restoreTextures();
      sequence.update(liveFrame);
      for (const track of sequence.videoTracks || []) {
        const layer = track.getCurrentClip?.(frame)?.object;
        if (layer) restoreLayerAtContextFrame(layer, liveFrame);
      }
    }
  }

  const frameSamplerIdentities = new WeakMap();
  let nextFrameSamplerIdentity = 1;
  function frameSamplerIdentity(effect) {
    let id = frameSamplerIdentities.get(effect);
    if (!id) {
      id = nextFrameSamplerIdentity++;
      frameSamplerIdentities.set(effect, id);
    }
    return id;
  }

  registry.sampler = {
    FRAME_SAMPLER_CACHE_BYTES,
    frameSamplerCacheDepth,
    clearFrameSamplerTargets,
    invalidateFrameSamplerInputs,
    selectFrameSamplerTarget,
    getFrameSamplerInputFrame: getFrameSamplerInputFrame,
    getFrameSamplerControlFrame: getFrameSamplerControlFrame,
    registerCompositor: registerCompositor,
    getFrameSamplerRuntime: getFrameSamplerRuntime,
    disposeFrameSamplerRuntime: disposeFrameSamplerRuntime,
    getFrameSamplerCapture: getFrameSamplerCapture,
    getFrameSamplerTarget: getFrameSamplerTarget,
    copyRenderTarget: copyRenderTarget,
    restoreLayerAtContextFrame: restoreLayerAtContextFrame,
    bindSampleTextures: bindSampleTextures,
    captureFrameSamplerInput: captureFrameSamplerInput,
    prepareLowerSchedules: prepareLowerSchedules,
    prepareInputEffects: prepareInputEffects,
    prepareFrameSamples: prepareFrameSamples,
    resolveFrameSamples: resolveFrameSamples,
    frameSamplerInputKey: frameSamplerInputKey,
    renderPreparedPreview: renderPreparedPreview,
    frameSamplerIdentity: frameSamplerIdentity,
  };
  if (typeof module === "object" && module.exports) module.exports = registry.sampler;
})(typeof globalThis !== "undefined" ? globalThis : this);

