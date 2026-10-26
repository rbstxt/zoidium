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
  if (typeof module === "object" && module.exports) require("./temporal-capture.js");
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
  var frameSamplerInputKey = layers.frameSamplerInputKey;
  var frameSamplerIdentity = layers.frameSamplerIdentity;
  var frameSamplerReuseDisabled = layers.frameSamplerReuseDisabled;

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
    // The complete adjustment input clock includes translations on either
    // side of the sampler. Lower tracks must not apply that scope again.
    return math.applyTemporalOperators(start + frame,
      getProjectRate(stage.layer, getSequenceForLayer(stage.layer)),
      layers.readTemporalOperators(stage.layer, frame), undefined, true) - start;
  }

  function ownsFrameSamplerScope(stage, frame) {
    return math.temporalMode(stage.effect) !== "legacy" &&
      (isAdjustmentLayer(stage.layer) || hasFrameSamplerQuantizer(getFrameSamplerPrefix(stage, frame)));
  }

  function withFrameSamplerInputContext(state, stage, frame, context, callback) {
    const parent = state.contexts[state.contexts.length - 1];
    const sequence = getSequenceForLayer(stage.layer);
    const singleEvaluation = context?.singleEvaluation ?? parent?.singleEvaluation ?? layers.usesSingleEvaluation(sequence);
    if (singleEvaluation && !context?.singleEvaluation && !parent?.singleEvaluation) layers.installSingleEvaluation(state, sequence);
    const evaluating = state.evaluatingLayers.has(stage.layer);
    state.evaluatingLayers.add(stage.layer);
    state.contexts.push(Object.assign({}, parent, context, {
      outputFrame: frame,
      singleEvaluation,
      renderingSequence: true,
      frameSamplerScope: ownsFrameSamplerScope(stage, frame)
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
      !stage.layer.effects.slice(0, stage.effectIndex).some(effect => effect?._zoidiumFrameSampler) &&
      !layers.hasNestedFrameSampler(stage.layer) ? 1 : depth;
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

  function restoreLayerAtContextFrame(layer, projectFrame, state, exportPolicy) {
    const clip = getClipForLayer(layer);
    if (!clip || typeof layer?.update !== "function") return;
    try {
      const frame = projectFrame - finiteNumber(clip.start, 0);
      if (state && layers.usesSingleEvaluation(getSequenceForLayer(layer))) {
        const input = state.mapLayerFrame(layer, frame)?.sourceFrame ?? frame;
        delete layer.__zoidiumTemporalEvaluationStamp;
        state.evaluationEpoch += 1;
        state.originalLayerUpdate.call(layer, input);
        layer.__zoidiumTemporalLastUpdateFrame = input;
        layer.__zoidiumTemporalUpdateRevision = ++state.layerUpdateRevision;
      } else layer.update(frame);
    } catch (_error) {
      if (exportPolicy) throw _error;
      // Preview can retain its current layer state if restoration fails.
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

  function captureFrameSamplerInput(...args) {
    return registry.capture.captureFrameSamplerInput(...args);
  }

  function frameSamplerMediaInputs(sequence, stage, projectFrame, allTracks = false) {
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
    const inputs = [];
    for (const schedule of sequence.videoSchedules || []) {
      const item = findScheduleItemAtFrame(schedule, projectFrame)?.item;
      if (item?.clip && activeClips.has(item.clip) && item.media) inputs.push({ schedule, item });
    }
    return inputs;
  }

  async function prepareLowerSchedules(sequence, stage, projectFrame, context, runtime, allTracks = false, state = null) {
    const samples = [];
    registry.capture.checkPolicy(context);
    context?.resourcePolicy?.assertStage(sequence, stage, projectFrame, allTracks);
    for (const { schedule, item } of frameSamplerMediaInputs(sequence, stage, projectFrame, allTracks)) {
      // Never seek the playback/export schedule to obtain another frame.
      // Its shared texture must remain the current input until capture finishes.
      context?.resourcePolicy?.assertMedia(item.media);
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
      registry.capture.checkPolicy(context);
      context?.resourcePolicy?.assertMedia(item.media);
      isolated.update(sourceFrame, getProjectRate(stage.layer, sequence));
      if (isolated.currentItem) {
        context?.resourcePolicy?.assertMedia(item.media);
        const time = item.clip.properties.time.get(sourceFrame - item.start);
        if (typeof ISNODE !== "undefined" && ISNODE) {
          await isolated.ffDecodeFrame(Math.round(time * getProjectRate(stage.layer, sequence)),
            getProjectRate(stage.layer, sequence));
        } else {
          await isolated.decodeFrame(time, context);
        }
        registry.capture.checkPolicy(context);
        samples.push({ item, texture: isolated.texture });
      } else if (context?.exportPolicy) {
        throw new Error(`Required video sample at requested frame ${sourceFrame} is unavailable`);
      }
    }
    return samples;
  }

  async function prepareInputEffects(sequence, stage, frame, context, state, restoreOnly = false) {
    context?.resourcePolicy?.assertStage(sequence, stage, frame);
    const preparedLayers = new Map();
    const tracks = sequence.videoTracks || [];
    const start = isAdjustmentLayer(stage.layer) ? 0 : stage.trackIndex;
    for (let index = start; index <= stage.trackIndex; index += 1) {
      registry.capture.checkPolicy(context);
      if (tracks[index]?.enabled === false) continue;
      const clip = index === stage.trackIndex ? stage.clip : tracks[index]?.getCurrentClip?.(frame);
      const layer = clip?.object;
      if (!layer) continue;
      context?.resourcePolicy?.assertLayer(layer);
      const localFrame = frame - finiteNumber(clip.start, 0);
      const scoped = callback => state
        ? withFrameSamplerInputContext(state, stage, frame, context, callback) : callback();
      scoped(() => {
        if (restoreOnly && state && context?.singleEvaluation) {
          const input = layer === stage.layer ? localFrame
            : state.mapLayerFrame(layer, localFrame)?.sourceFrame ?? localFrame;
          delete layer.__zoidiumTemporalEvaluationStamp;
          state.evaluationEpoch += 1;
          state.originalLayerUpdate.call(layer, input);
          layer.__zoidiumTemporalLastUpdateFrame = input;
          layer.__zoidiumTemporalUpdateRevision = ++state.layerUpdateRevision;
        } else layer.update(localFrame);
      });
      preparedLayers.set(layer, layer.__zoidiumTemporalUpdateRevision);
      context?.frameSamplerChangedLayers?.add(layer);
      if (context?.resourcePolicy) await scoped(() => registry.capture.prepareChildren(layer,
        finiteNumber(layer.__zoidiumTemporalLastUpdateFrame, localFrame), context));
      const count = index === stage.trackIndex ? stage.effectIndex : layer.effects?.length || 0;
      for (let i = 0; i < count; i += 1) {
        const input = finiteNumber(layer.__zoidiumTemporalLastUpdateFrame, localFrame);
        await scoped(() => context?.resourcePolicy
          ? context.resourcePolicy.prepareEffect(layer.effects[i], input, context)
          : layer.effects[i]?.prepare?.(input, context));
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

    const singleEvaluation = context?.singleEvaluation ?? layers.usesSingleEvaluation(sequence);
    if (singleEvaluation && !context?.singleEvaluation) layers.installSingleEvaluation(state, sequence);
    context = Object.assign({}, context, { singleEvaluation });
    const parentContext = state.contexts[state.contexts.length - 1];
    context.exportPolicy ||= parentContext?.exportPolicy;
    context.resourcePolicy ||= parentContext?.resourcePolicy;
    context.resourcePolicy ||= effect._zoidiumFrameSampler.resourcePolicy;
    registry.capture.checkPolicy(context);
    const depth = finiteNumber(context?.frameSamplerDepth ?? parentContext?.frameSamplerDepth, 0) + 1;
    if (depth > MAX_FRAME_SAMPLER_DEPTH) {
      if (context.resourcePolicy) throw new Error("LOCAL_DEPENDENCY_UNAVAILABLE: maximum sampler nesting depth exceeded");
      if (context.exportPolicy) throw registry.capture.sampleError(stage, projectFrame, "Maximum sampler nesting depth exceeded");
      return;
    }
    const controlFrame = getFrameSamplerControlFrame(stage, localFrame,
      context?.frameSamplerScope || parentContext?.frameSamplerScope);
    const authority = frameSamplerAuthority(state, stage, controlFrame, context, depth);
    let request;
    try {
      await effect._zoidiumFrameSampler.preflight?.(effect, controlFrame, authority);
      registry.capture.checkPolicy(context);
      request = effect._zoidiumFrameSampler.getRequest(effect, controlFrame, authority);
    } catch (error) {
      if (context.resourcePolicy) throw error;
      if (context.exportPolicy) throw registry.capture.sampleError(stage, projectFrame, error);
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
    const reducing = typeof request.reduceSamples === "function" && (plan.length === 32 || plan.length === 64);
    const capacity = reducing ? 8 + Math.ceil(plan.length / 8) : plan.length === 1 ? 1 : Math.min(128, plan.length +
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
        const reductionKey = registry.capture.reductionKey(plan, depth, scope);
        const reduced = reducing && registry.capture.cachedReduction(runtime, effect, revision, reductionKey, width, height, cacheDepth);
        if (reduced) {
          if (depth === 1) runtime.publishedReservations.set(effect, new Set(reduced.map(sample => sample.target)));
          continue;
        }
        const batchCache = runtime.inputCache;
        let revisions = batchCache.get(effect);
        if (!revisions) {
          revisions = new Map();
          batchCache.set(effect, revisions);
        }
        // Store the exact content string once per resident revision, rather
        // than copying an entire project into every source-frame map key.
        const inputCache = !reducing && revisions.get(revision) || new Map();
        const reservedTargets = new Set();
        runtime.reservations.add(reservedTargets);
        reservations.push({ runtime, reservedTargets });
        const reduction = reducing && registry.capture.createReduction(runtime, root, effect, cacheDepth,
          reservedTargets, width, height, plan, request.reduceSamples, revision, reductionKey, () => capturedFrames.clear());
        const append = sample => { samples.push(sample); reduction && reduction.append(sample); };
        const cacheKey = frame => JSON.stringify([getFrameSamplerInputFrame(stage, frame), cacheDepth,
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
          context.exportPolicy && (context.exportPolicy.requestedSampleFrame = sourceProjectFrame);
          registry.capture.checkPolicy(context);
          const inputFrame = getFrameSamplerInputFrame(stage, sourceProjectFrame);
          const cached = inputCache?.get(cacheKey(sourceProjectFrame));
          const reusable = !frameSamplerReuseDisabled() && cached && cached.stamp === cached.sample.target.inputStamp &&
            cached.sample.target.width === width && cached.sample.target.height === height;
          const reused = capturedFrames.get(inputFrame) || (reusable && cached.sample);
          if (reused) {
            reused.target.inputUsed = ++runtime.inputClock;
            append(Object.assign({}, reused, { frame: sourceProjectFrame, index: item.index, opacity: item.opacity }));
            continue;
          }
          const inputContext = Object.assign({}, context, {
            frameSamplerRoot: root, frameSamplerDepth: depth,
            frameSamplerScope: ownsFrameSamplerScope(stage, sourceProjectFrame)
              ? stage : context?.frameSamplerScope || parentContext?.frameSamplerScope,
          });
          inputContext.frameSamplerChangedLayers = changedLayers;
          inputContext.frameSamplerPreparedLayers =
            await prepareInputEffects(sequence, stage, inputFrame, inputContext, state);
          registry.capture.checkPolicy(context);
          const mediaSamples = await prepareLowerSchedules(sequence, stage, inputFrame, inputContext,
            runtime, false, state);
          if (runtime.disposed || runtime.generation !== generation ||
            revision !== frameSamplerInputKey(sequence, root, stage, scope)) {
            if (context.exportPolicy) throw new Error("Sample input changed during export preparation");
            return;
          }
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
            if (!reducing) {
              inputCache.set(key, { sample, stamp: target.inputStamp });
              revisions.set(revision, inputCache);
              target.inputEntry = { cache: inputCache, key, revisions, revision };
            }
            capturedFrames.set(inputFrame, sample);
            append(sample);
          }
        }
        if (context.exportPolicy && samples.length !== plan.length) {
          throw new Error(`Incomplete required sample set: ${samples.length} of ${plan.length}`);
        }
        if (reduction) samples.splice(0, samples.length, ...reduction.finish());
        for (const sample of samples) runtime.exportPins?.add(sample.target);
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
      if (context.exportPolicy) throw registry.capture.sampleError(stage, context.exportPolicy.requestedSampleFrame ?? projectFrame, error);
      if (context.resourcePolicy) throw error;
      console.error("[Zoidium] frame sampler preparation failed:", error);
    } finally {
      try {
        if (!context?.exportPolicy?.signal?.aborted) {
          context.resourcePolicy?.check?.();
          const tracks = sequence.videoTracks || [];
          const currentLayers = new Set([stage.layer]);
          for (let i = 0; i < stage.trackIndex; i += 1) {
            if (tracks[i]?.enabled !== false) currentLayers.add(tracks[i]?.getCurrentClip?.(projectFrame)?.object);
          }
          for (const changedLayer of changedLayers) {
            if (!currentLayers.has(changedLayer)) restoreLayerAtContextFrame(changedLayer, projectFrame, state, context?.exportPolicy);
          }
          await prepareInputEffects(sequence, stage, projectFrame, context, state, true);
        }
      } finally {
        for (const { runtime, reservedTargets } of reservations) runtime.reservations.delete(reservedTargets);
        state.preparingEffects.delete(effect);
      }
    }
  }

  const frameSamplerAuthority = registry.capture.frameSamplerAuthority;
  const drawAuthority = registry.capture.drawAuthority;

  function resolveFrameSamples(state, effect) {
    const context = state.contexts[state.contexts.length - 1];
    const root = context?.rootCompositor || context?.compositor;
    const sequence = root?._sequence;
    const descriptor = effect?._zoidiumFrameSampler;
    const outputFrame = finiteNumber(context?.outputFrame, NaN);
    if (!sequence || !descriptor || !Number.isFinite(outputFrame)) return [];
    registry.capture.checkPolicy(context);

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
      request = descriptor.getRequest(effect, controlFrame, frameSamplerAuthority(state, stage, controlFrame, context, depth));
    } catch (error) {
      if (context?.exportPolicy) throw registry.capture.sampleError(stage, currentProjectFrame, error);
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
    const reducing = typeof request.reduceSamples === "function" && (plan.length === 32 || plan.length === 64);
    const reductionKey = registry.capture.reductionKey(plan, depth, scope);
    if (reducing) {
      const reduced = registry.capture.cachedReduction(runtime, effect, revision, reductionKey, width, height,
        frameSamplerCacheDepth(stage, depth));
      if (reduced) return reduced;
    }
    if (
      !reducing && prepared && prepared.revision === revision && prepared.depth === depth &&
      prepared.scope === scope &&
      (descriptor.preflight ? prepared.projectFrame === currentProjectFrame
        : Math.abs(finiteNumber(prepared.projectFrame, NaN) - currentProjectFrame) <= EPSILON) &&
      prepared.samples.length === plan.length &&
      prepared.samples.every((sample, index) => {
        const item = plan[index];
        const frame = finiteNumber(stage.clip.start, 0) + item.frame;
        return (
          (descriptor.preflight ? sample.frame === frame : Math.abs(finiteNumber(sample.frame, NaN) - frame) <= EPSILON) &&
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
        const cached = cache?.get(JSON.stringify([getFrameSamplerInputFrame(stage, frame), cacheDepth, scopeId]));
        if (!cached || cached.stamp !== cached.sample.target.inputStamp ||
          cached.sample.target.width !== width || cached.sample.target.height !== height) return null;
        cached.sample.target.inputUsed = ++runtime.inputClock;
        return Object.assign({}, cached.sample, { frame, index: item.index, opacity: item.opacity });
      });
      if (cachedSamples.every(Boolean)) return cachedSamples;
    }

    // Isolated plans consume only prepared GPU inputs. Synchronous drawing
    // cannot acquire resources or recover a missing plan by capturing live.
    if (descriptor.preflight || context?.resourcePolicy) return [];

    const needsVideo = context?.exportPolicy && plan.some(item => {
      const frame = finiteNumber(stage.clip.start, 0) + item.frame;
      return frameSamplerMediaInputs(sequence, stage, getFrameSamplerInputFrame(stage, frame)).length > 0;
    });
    if (needsVideo) {
      throw registry.capture.sampleError(stage, currentProjectFrame,
        "Required exact media sample was not prepared before the synchronous draw");
    }
    const samples = [];
    const capturedFrames = new Map();
    const reserved = new Set();
    if (reducing) runtime.reservations.add(reserved);
    const reduction = reducing && registry.capture.createReduction(runtime, root, effect,
      frameSamplerCacheDepth(stage, depth), reserved, width, height, plan, request.reduceSamples,
      revision, reductionKey, () => capturedFrames.clear());
    const append = sample => { samples.push(sample); reduction && reduction.append(sample); };
    state.samplingEffects.add(effect);
    try {
      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        const projectFrame = finiteNumber(stage.clip.start, 0) + item.frame;
        const inputFrame = getFrameSamplerInputFrame(stage, projectFrame);
        const reused = capturedFrames.get(inputFrame);
        if (reused) {
          append(Object.assign({}, reused, { frame: projectFrame, index: item.index, opacity: item.opacity }));
          continue;
        }
        const target = reducing
          ? selectFrameSamplerTarget(runtime, effect, frameSamplerCacheDepth(stage, depth),
            reserved, width, height, reduction.capacity, revision)
          : context?.exportPolicy
          ? selectFrameSamplerTarget(runtime, effect, frameSamplerCacheDepth(stage, depth),
            runtime.exportPins || new Set(), width, height, plan.length, revision)
          : getFrameSamplerTarget(runtime, effect, depth, index, width, height);
        if (reducing) reserved.add(target);
        else if (context?.exportPolicy) runtime.exportPins?.add(target);
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
            [],
            context,
          )
        ) {
          const sample = {
            frame: projectFrame,
            index: item.index,
            opacity: item.opacity,
            target,
            texture: target.texture,
          };
          capturedFrames.set(inputFrame, sample);
          append(sample);
        }
      }
      if (reduction) samples.splice(0, samples.length, ...reduction.finish());
    } finally {
      if (reducing) runtime.reservations.delete(reserved);
      state.samplingEffects.delete(effect);
    }
    return samples;
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
      if (!layers.usesSingleEvaluation(sequence)) {
        for (const track of sequence.videoTracks || []) {
          const layer = track.getCurrentClip?.(frame)?.object;
          const stamp = layer?.__zoidiumTemporalEvaluationStamp;
          const state = typeof PZ !== "undefined" ? PZ.zoidium?.temporal : null;
          const localFrame = liveFrame - finiteNumber(getClipForLayer(layer)?.start, 0);
          if (layer && (!stamp || stamp.frame !== localFrame || stamp.epoch !== state?.evaluationEpoch)) {
            restoreLayerAtContextFrame(layer, liveFrame);
          }
        }
      }
    }
  }

  registry.sampler = {
    drawAuthority,
    ownsFrameSamplerScope,
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
    forgetFrameSamplerInput,
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

