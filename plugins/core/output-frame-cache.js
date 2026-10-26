// Preview-only memoization of finished editor frames. A miss renders live,
// exactly as without the cache; a complete live render is then copied to a
// GPU texture and shown again for the same project state and frame. Exports
// keep their own fresh compositor path.
(function installOutputFrameCache(global) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = { activate(context) {
      context.lifecycle.onDispose(() => context.window.ZoidiumFrameCache?.dispose());
    } };
    return;
  }

  const model = global.ZoidiumOutputFrameStore;
  if (!model) throw new Error("[Zoidium] output-frame-store.js must load before output-frame-cache.js.");
  // Only versions covered by the output oracle matrix opt in. Packs with other
  // render dependencies retain the existing live preview path.
  const approvedPlugins = new Map([
    ["native-fx", "17"], ["ccfx-shader-pack", "2"], ["text-plus", "24"],
    ["repeater", "31"], ["trapcode-suite", "29"], ["optical-flares", "16"],
  ]);
  // Edits arrive through input events and native history operations. Their
  // asynchronous follow-up work (file reads, imports) can land a little later,
  // so the full serialization is rechecked on every draw for this long.
  const HOT_MS = 1500;
  // Projects whose serialization takes longer than this are not serialized
  // on every draw: while input is recent or playback runs they draw live,
  // exactly as without the cache, and are validated once the editor is
  // paused and quiet. A large project takes over 100 ms per serialization.
  const KEY_BUDGET_MS = 8;
  const LIVE = Symbol("live");
  // Idle prefetch renders a private copy of the project after this much
  // quiet time, one frame per task, skipping scenes whose synchronous draw
  // would block input for longer than PREFETCH_SYNC_MS.
  const IDLE_MS = 800;
  const PREFETCH_SYNC_MS = 50;
  const PREFETCH_AHEAD = 150;
  const PREFETCH_BEHIND = 8;
  let idleTimer = null;
  const controllers = new Set();
  const identities = new WeakMap();
  let nextIdentity = 0;
  let controllerId = 0;
  let signalEpoch = 0;
  let lastSignal = -Infinity;
  let pluginEpoch = 0;
  let fontEpoch = 0;
  let disposed = false;
  let settings = {};
  try { settings = JSON.parse(global.localStorage.getItem("zoidium.editor-settings") || "{}"); }
  catch (_error) { /* Storage may be unavailable. */ }
  const store = new model.FrameStore(model.sizeMiB(settings.previewCacheMiB ?? 512) * 1024 * 1024);
  const lostContexts = new Set();
  let memoryNoticeShown = false;
  const debug = {
    disabled: false, assertKeys: false, prefetchDisabled: false, prefetched: 0, prefetchAborted: 0, disposeErrors: 0,
    hits: 0, misses: 0, liveDraws: 0, stores: 0, validations: 0, keyMismatches: 0,
    rejects: {}, validationCauses: {}, signals: {}, resets: {}, shownFrame: null, shownChanges: 0,
    get bytes() { return store.bytes; },
    get limit() { return store.limit; },
    get effectiveLimit() { return store.effectiveLimit; },
    get contextLosses() { return store.contextLosses; },
    get entries() { return store.entries.size; },
  };

  function memoryNotice(message) {
    if (memoryNoticeShown) return;
    memoryNoticeShown = true;
    global.ZoidiumUI?.notify({ title: "Preview cache", message });
  }

  function contextLost(gl) {
    if (lostContexts.has(gl)) return;
    lostContexts.add(gl);
    store.loseContext();
    for (const controller of controllers) reset(controller, "context-lost");
    memoryNotice("The WebGL context was lost; the preview cache has been reduced for this session.");
  }

  function contextAvailable(gl) {
    if (gl.isContextLost?.()) contextLost(gl);
    return !lostContexts.has(gl) && !store.contextLost;
  }

  function allocationFailed(gl) {
    if (!contextAvailable(gl)) return;
    const error = gl.getError();
    if (error === gl.OUT_OF_MEMORY) {
      const usage = store.memoryPressure();
      memoryNotice("The GPU ran out of memory at " + Math.round(usage / 1048576).toLocaleString("en-US") +
        " MiB; the preview cache will stop there for this session.");
    }
    return error !== gl.NO_ERROR;
  }

  function identity(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
    if (!identities.has(value)) identities.set(value, ++nextIdentity);
    return identities.get(value);
  }

  function signal(source) {
    const name = typeof source === "string" ? source : source?.type || "observable";
    debug.signals[name] = (debug.signals[name] || 0) + 1;
    signalEpoch += 1;
    lastSignal = performance.now();
  }

  // Cheap state that can change without an edit: asset replacement and
  // loading, fonts, plugin activation, drawing-buffer size and render settings.
  function cheapKey(viewport) {
    const project = viewport.editor.project;
    const gl = viewport.renderer.context;
    const renderer = viewport.renderer;
    return JSON.stringify([
      // Font and image loading finishes without an edit signal.
      Object.entries(project.assets?.list || {}).map(([id, asset]) =>
        [id, identity(asset), identity(asset.file), asset.url, asset.sha256, asset.size,
          model.assetCompletion(asset, identity)]),
      project.sequence.videoTracks.map(track => track.enabled),
      gl.drawingBufferWidth, gl.drawingBufferHeight,
      viewport.compositor.__zoidiumRenderSettings || null,
      renderer.shadowMap.enabled, renderer.shadowMap.type, renderer.toneMapping, renderer.toneMappingExposure,
      pluginEpoch, fontEpoch, global.document.fonts?.status,
    ]);
  }

  function fullKey(controller) {
    const viewport = controller.viewport;
    controller.keyReason = null;
    const plugins = global.PZ?.zoidium?.getDebugPlugins?.();
    // Booting or failed plugins cannot provide a stable render contract.
    if (!plugins || plugins.some(plugin => plugin.phase === "loading" || plugin.lastError)) {
      controller.keyReason = "Plugins are loading or have errors";
      return null;
    }
    if (global.document?.fonts?.status === "loading") {
      controller.keyReason = "Fonts are loading";
      return null;
    }
    try {
      return model.revisionOf(viewport, plugins, identity, fontEpoch, approvedPlugins,
        reason => { controller.keyReason = reason; });
    } catch (_error) {
      controller.keyReason = "Project state could not be validated";
      return null;
    }
  }

  // The project serialization is recomputed only after a signal, during an
  // open native history operation, or when the cheap state changed. Returns
  // LIVE when a slow serialization has to wait (see KEY_BUDGET_MS).
  function keyFor(controller) {
    const viewport = controller.viewport;
    const cheap = cheapKey(viewport);
    const hot = performance.now() - lastSignal < HOT_MS || viewport.editor.history?.operation;
    if (hot || controller.validated !== signalEpoch || controller.cheap !== cheap) {
      if ((hot || viewport.editor.playback.speed !== 0) && controller.keyCost > KEY_BUDGET_MS) {
        controller.reason = "Project validation is deferred until playback stops and editing is idle";
        debug.liveDraws += 1;
        return LIVE;
      }
      const cause = hot ? "hot" : controller.validated !== signalEpoch ? "signal" : "cheap";
      debug.validationCauses[cause] = (debug.validationCauses[cause] || 0) + 1;
      const start = performance.now();
      controller.full = fullKey(controller);
      controller.keyCost = performance.now() - start;
      controller.cheap = cheap;
      controller.validated = signalEpoch;
      debug.validations += 1;
    } else if (debug.assertKeys) {
      const fresh = fullKey(controller);
      if (fresh !== controller.full) {
        debug.keyMismatches += 1;
        let at = 0;
        const before = controller.full || "";
        while (at < before.length && before[at] === fresh?.[at]) at += 1;
        debug.lastMismatch = [before.slice(Math.max(0, at - 160), at + 160), fresh?.slice(Math.max(0, at - 160), at + 160)];
        controller.full = fresh;
      }
    }
    return controller.full;
  }

  // The validated key, dropping the stored frames when the project changed.
  function currentKey(controller) {
    const key = keyFor(controller);
    if (key === LIVE) return LIVE;
    if (controller.key !== key) {
      reset(controller, key === null ? "unkeyed" : controller.key === null ? "first" : "changed");
      controller.key = key;
    }
    return key;
  }

  function removeEntries(controller) {
    for (const [key, entry] of store.entries) if (entry.owner === controller.id) store.delete(key);
  }

  function reset(controller, reason = "other") {
    debug.resets[reason] = (debug.resets[reason] || 0) + 1;
    if (debug.resetLog) debug.resetLog.push([Math.round(performance.now()), reason, store.entries.size, debug.prefetched]);
    controller.generation += 1;
    controller.key = null;
    controller.settled = null;
    controller.ready = null;
    controller.reason = "Waiting for a complete preview frame";
    controller.prefetchCost = 0;
    controller.prefetchSkipped = new Set();
    removeEntries(controller);
    // A running prefetch still owns its private graph; it disposes it after.
    if (!controller.prefetching) disposeSnapshot(controller);
  }

  function watchProject(controller) {
    controller.projectSignal?.unwatch(signal);
    controller.projectSignal = controller.viewport.editor.project?.ui?.onChanged || null;
    controller.projectSignal?.watch(signal);
  }

  function controllerFor(viewport) {
    let controller = viewport.__zoidiumOutputFrames;
    if (controller) return controller;
    controller = { id: ++controllerId, viewport, generation: 0, key: null, full: null, cheap: null,
      validated: -1, settled: null, settling: null, ready: null, readying: null, snapshot: null,
      prefetching: false, prefetchCost: 0, prefetchSkipped: new Set(), unsupported: null,
      disposed: false, projectSignal: null, keyCost: 0 };
    viewport.__zoidiumOutputFrames = controller;
    controllers.add(controller);
    controller.canvas = viewport.renderer.domElement || viewport.renderer.context.canvas;
    controller.contextLost = () => contextLost(viewport.renderer.context);
    controller.contextRestored = () => {
      lostContexts.delete(viewport.renderer.context);
      if (!lostContexts.size) store.restoreContext();
      signal("context-restored");
      reset(controller, "context-restored");
    };
    controller.canvas?.addEventListener("webglcontextlost", controller.contextLost);
    controller.canvas?.addEventListener("webglcontextrestored", controller.contextRestored);
    controller.projectChanged = () => { signal("project"); reset(controller, "project"); watchProject(controller); };
    viewport.compositor.__zoidiumOutputFrameOwner = viewport;
    viewport.editor.onProjectChanged.watch(controller.projectChanged);
    watchProject(controller);
    controller.resolution = viewport.editor.project.sequence.properties.resolution.onChanged;
    controller.resized = () => { signal("resolution"); reset(controller, "resolution"); };
    controller.resolution.watch(controller.resized);
    // Playback needs the decoders and GPU time; drop the prefetch copy.
    // Starting playback is not an edit, so it does not reopen the window in
    // which every draw serializes the project. A running prefetch frame sees
    // the speed change and stops on its own.
    controller.speedChanged = () => {
      if (!controller.prefetching) disposeSnapshot(controller);
    };
    viewport.editor.playback.onSpeedChanged?.watch(controller.speedChanged);
    return controller;
  }

  async function awaitResources(object, seen = new Set()) {
    if (!object || typeof object !== "object" || seen.has(object)) return;
    seen.add(object);
    await object.loading;
    await object.loadShaders;
    if (object.image) await object.image.loading;
    if (object.font) { await object.font.loading; await object.font.loading3d; }
    if (object.texture) await object.texture.loading;
    for (const child of object.children || []) {
      if (Array.isArray(child)) { for (const item of child) await awaitResources(item, seen); }
      else await awaitResources(child, seen);
    }
  }

  function activeClips(sequence, frame) {
    return (sequence.videoTracks || []).filter(track => track.enabled !== false)
      .map(track => track.getCurrentClip?.(frame)).filter(clip => clip?.object);
  }

  // Objects that load data while a frame updates expose zoidiumFrameReady().
  // CM3 objects only await their static resources, settled per revision.
  function objectsReady(objects, frame) {
    for (const object of objects || []) {
      if (!object || typeof object !== "object") continue;
      if (typeof object.zoidiumFrameReady === "function" && object.zoidiumFrameReady(frame) !== true) return false;
      if (!objectsReady(object.objects, frame)) return false;
    }
    return true;
  }

  // Visible video items at this frame. Padding preloads outside their item
  // range are not drawn.
  function visibleVideos(sequence, frame) {
    return (sequence.videoSchedules || []).map(schedule => schedule.currentItem)
      .filter(item => item && item.media && frame >= item.start && frame < item.start + item.length);
  }

  // The editor's own <video> elements are not frame-exact: playing elements
  // drift and paused ones are re-seeked on every playback tick. A time-effect
  // preview instead draws every visible item from isolated decoders that
  // finished decoding exactly this frame (temporal-render prepareLowerSchedules).
  function previewCoversVideo(viewport, frame, items, fromPreview) {
    const runtime = global.PZ?.zoidium?.temporal?.frameSamplerRuntimes?.get(viewport.compositor);
    if (!runtime || (runtime.previewPending && !fromPreview) || !runtime.previewKey?.startsWith("[" + frame + ",")) return false;
    const decoded = new Set((runtime.previewMedia || []).map(sample => sample.item));
    return items.every(item => decoded.has(item));
  }

  function settle(controller, key) {
    if (controller.settled === key) return true;
    if (controller.settling === key) return false;
    controller.settling = key;
    const sequence = controller.viewport.editor.project.sequence;
    (async () => {
      await awaitResources(sequence);
      await global.document.fonts?.ready;
    })().then(() => {
      if (controller.key === key) controller.settled = key;
    }, () => {}).finally(() => {
      if (controller.settling === key) controller.settling = null;
    });
    return false;
  }

  // While paused, await each visible object's own prepare() for this frame
  // before trusting the live image. The live editor never awaits them.
  function ready(controller, key, frame) {
    const token = key + "\n" + frame;
    if (controller.ready === token) return true;
    if (controller.readying === token) return false;
    controller.readying = token;
    const viewport = controller.viewport;
    const sequence = viewport.editor.project.sequence;
    const temporal = global.PZ?.zoidium?.temporal;
    (async () => {
      for (const clip of activeClips(sequence, frame)) {
        const local = frame - clip.start;
        const mapped = temporal?.mapLayerFrame?.(clip.object, local);
        const contentFrame = mapped?.sourceFrame ?? local;
        await awaitResources(clip.object);
        for (const object of clip.object.objects || []) await object.prepare?.(contentFrame, { sequence });
      }
    })().then(() => {
      if (controller.key === key && viewport.editor.playback.currentFrame === frame) controller.ready = token;
    }, () => {}).finally(() => {
      if (controller.readying === token) controller.readying = null;
    });
    return false;
  }

  function reject(controller, reason, message) {
    debug.rejects[reason] = (debug.rejects[reason] || 0) + 1;
    controller.reason = message;
    return false;
  }

  function complete(controller, key, frame, fromPreview = false) {
    const viewport = controller.viewport;
    const sequence = viewport.editor.project.sequence;
    const playing = viewport.editor.playback.speed !== 0;
    if (!settle(controller, key)) return reject(controller, "resources", "Waiting for scene resources");
    if (global.document.fonts?.status === "loading" || !model.assetsComplete(viewport.editor.project)) {
      return reject(controller, "assets", "Assets or fonts are loading or have errors");
    }
    if (!fromPreview && global.PZ?.zoidium?.temporal?.frameSamplerRuntimes?.get(viewport.compositor)?.previewPending) {
      return reject(controller, "preview", "Waiting for a complete temporal preview");
    }
    if (!activeClips(sequence, frame).every(clip => objectsReady(clip.object.objects, frame - clip.start))) {
      return reject(controller, "objects", "Waiting for procedural objects");
    }
    const videos = visibleVideos(sequence, frame);
    if (videos.length && !previewCoversVideo(viewport, frame, videos, fromPreview)) {
      return reject(controller, "video", "Waiting for exact video frames");
    }
    if (!playing && !ready(controller, key, frame)) return reject(controller, "ready", "Waiting for frame preparation");
    return true;
  }

  function createPass(controller) {
    if (controller.pass) return controller.pass;
    const material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 v; void main(){ v=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 v; void main(){ gl_FragColor=texture2D(tDiffuse,v); }",
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
    controller.pass = new THREE.ShaderPass(material);
    return controller.pass;
  }

  function shown(frame) {
    if (debug.shownFrame !== frame) debug.shownChanges += 1;
    debug.shownFrame = frame;
  }

  function display(controller, entry) {
    const renderer = controller.viewport.renderer;
    const gl = renderer.context;
    if (!contextAvailable(gl)) return;
    const pass = createPass(controller);
    pass.uniforms.tDiffuse.value = entry.target.texture;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    pass.render(renderer, null, null, true);
    controller.viewport.lastFrame = entry.frame;
    shown(entry.frame);
  }

  // Copy the finished opaque default framebuffer verbatim: no readback,
  // resampling, alpha or color conversion and no second compositor pass.
  function capture(controller, frame) {
    const renderer = controller.viewport.renderer;
    const gl = renderer.context;
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const bytes = width * height * 4;
    if (!contextAvailable(gl) || !store.effectiveLimit || allocationFailed(gl)) {
      controller.reason = "GPU memory or context is unavailable";
      return null;
    }
    const format = gl.getContextAttributes().alpha ? THREE.RGBAFormat : THREE.RGBFormat;
    const type = THREE.UnsignedByteType;
    const reservation = store.take(bytes, entry => entry.renderer === renderer &&
      entry.width === width && entry.height === height && entry.format === format && entry.type === type);
    if (!reservation) {
      controller.reason = "One frame exceeds the preview cache memory limit";
      return null;
    }
    const generation = store.generation;
    const target = reservation.recycled?.target || new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format, type, depthBuffer: false, stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    try {
      renderer.setRenderTarget(target);
      renderer.setRenderTarget(null);
      renderer.setTexture2D(target.texture, 0);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
      if (!contextAvailable(gl) || allocationFailed(gl) || generation !== store.generation) {
        controller.reason = "GPU capture failed or was invalidated";
        if (contextAvailable(gl)) target.dispose();
        return null;
      }
    } catch (_error) {
      controller.reason = "GPU capture failed";
      allocationFailed(gl);
      if (contextAvailable(gl)) { renderer.setRenderTarget(null); target.dispose(); }
      return null;
    }
    return { target, frame, bytes, renderer, width, height, format, type,
      owner: controller.id, complete: true, dispose: () => target.dispose() };
  }

  function entryKey(controller, frame) { return controller.id + ":" + frame; }

  function plainTimeProject(viewport) {
    return global.PZ?.zoidium?.temporal?.usesSingleEvaluation?.(viewport.editor.project.sequence, true);
  }

  function render(viewport, fallback) {
    // A clock change needs one live evaluation, with no private project,
    // serialization or speculative renders. Samplers keep their cache path.
    if (plainTimeProject(viewport)) return fallback();
    if (disposed || viewport.__zoidiumImmediateOutput || viewport.renderMode || !store.effectiveLimit ||
      !viewport.options?.widget2dObjects) return fallback();
    const frame = viewport.editor.playback.currentFrame;
    if (!Number.isInteger(frame) || frame < 0) return fallback();
    const controller = controllerFor(viewport);
    if (!contextAvailable(viewport.renderer.context)) return fallback();
    const key = currentKey(controller);
    if (key === LIVE) {
      if (viewport.editor.playback.speed === 0) scheduleIdle();
      return fallback();
    }
    if (!key) {
      controller.reason = controller.keyReason;
      return fallback();
    }
    const hit = !debug.disabled && store.get(entryKey(controller, frame));
    if (hit) {
      controller.reason = null;
      display(controller, hit);
      debug.hits += 1;
      if (viewport.editor.playback.speed === 0) scheduleIdle();
      return;
    }
    debug.misses += 1;
    // Both the native draw and the temporal prepared preview record the frame
    // they drew. A pending temporal preview draws nothing.
    const previous = viewport.lastFrame;
    controller.reason = "Waiting for a complete preview frame";
    viewport.lastFrame = NaN;
    const result = fallback();
    const drew = viewport.lastFrame === frame;
    if (Number.isNaN(viewport.lastFrame)) viewport.lastFrame = previous;
    if (drew) shown(frame);
    if (drew && !debug.disabled && complete(controller, key, frame)) storeFrame(controller, frame);
    return result;
  }

  // temporal-render calls this right after an asynchronous time-effect preview
  // drew a finished frame, which during playback may trail the playhead.
  function capturePreview(viewport, frame) {
    const controller = viewport.__zoidiumOutputFrames;
    if (controller) shown(frame);
    if (disposed || debug.disabled || !store.effectiveLimit || !controller || viewport.renderMode ||
      !Number.isInteger(frame) || frame < 0) return;
    const key = keyFor(controller);
    if (!key || key === LIVE || key !== controller.key || store.entries.has(entryKey(controller, frame))) return;
    if (complete(controller, key, frame, true)) storeFrame(controller, frame);
  }

  function storeFrame(controller, frame) {
    const entry = capture(controller, frame);
    if (entry && store.put(entryKey(controller, frame), entry)) {
      controller.reason = null;
      debug.stores += 1;
    }
  }

  // ---- Idle prefetch -------------------------------------------------------
  // A private object graph keeps async prepare(), time-effect taps and video
  // seeks away from the visible project, its property panel and its decoders.
  function snapshotFor(controller, key) {
    if (controller.snapshot?.key === key) return controller.snapshot;
    disposeSnapshot(controller);
    const viewport = controller.viewport;
    const source = viewport.editor.project;
    const data = JSON.parse(JSON.stringify(source));
    const project = new PZ.project();
    // Asset wrappers and reference counts are private. Files and decoded
    // font/image data are shared; private unload never revokes live Blob URLs.
    project.assets.removeIfUnused = function removePrivateAsset(asset) {
      if (asset.references <= 0 && asset.mediaReferences <= 0) delete this.list[asset.key];
    };
    for (const [id, asset] of Object.entries(source.assets.list)) {
      project.assets.list[id] = Object.assign(new PZ.asset(), asset, { references: 0, mediaReferences: 0 });
    }
    // Loading an editor project broadcasts project-load events and can enable
    // plugins. Construct the private graph directly with the native factories.
    project._zoidiumProjectPlugins = source._zoidiumProjectPlugins;
    for (const dataMedia of data.media || []) {
      const media = new PZ.media();
      project.media.push(media);
      media.loading = media.load(dataMedia);
    }
    project.sequence.load(data.sequence);
    model.restoreLinkKeys(source.sequence, project.sequence);
    source.sequence.videoTracks.forEach((track, index) => {
      project.sequence.videoTracks[index].enabled = track.enabled;
    });
    const gl = viewport.renderer.context;
    const compositor = new PZ.compositor(viewport.renderer, gl.drawingBufferWidth, gl.drawingBufferHeight);
    compositor.sequence = project.sequence;
    compositor.__zoidiumRenderSettings = viewport.compositor.__zoidiumRenderSettings;
    PZ.zoidium.temporal.registerExportCompositor(compositor);
    controller.snapshot = { project, compositor, key, ready: false };
    return controller.snapshot;
  }

  // CM3 objects assume they finished loading before unload(): Displacement
  // Map disposes its texture uniform, which is still null while the map
  // image loads. A private graph can be dropped at any time, so one failing
  // object must not stop the rest of it from being released.
  function release(unload) {
    try { unload(); } catch (_error) { debug.disposeErrors += 1; }
  }

  function disposeSnapshot(controller) {
    const snapshot = controller.snapshot;
    if (!snapshot) return;
    controller.snapshot = null;
    release(() => snapshot.compositor.unload());
    // CM3 does not dispose its floating accumulation buffers in unload().
    snapshot.compositor.canvasTexture?.dispose?.();
    snapshot.compositor.copyPass?.material?.dispose?.();
    snapshot.compositor.mixPass?.material?.dispose?.();
    for (const target of snapshot.compositor.accumBuffers || []) target?.dispose?.();
    const sequence = snapshot.project.sequence;
    for (const track of [...sequence.videoTracks, ...sequence.audioTracks]) {
      for (const clip of track.clips) release(() => clip.unload());
    }
    for (const media of snapshot.project.media) release(() => media.unload?.());
    for (const schedule of [...sequence.videoSchedules, ...sequence.audioSchedules]) {
      release(() => {
        schedule.el?.pause();
        schedule.el?.removeAttribute("src");
        schedule.el?.load();
        schedule.unload();
      });
    }
    controller.viewport.renderer.renderLists?.dispose?.();
  }

  function nextPrefetchFrame(controller, current) {
    const viewport = controller.viewport;
    const length = viewport.editor.project.sequence.length;
    const gl = viewport.renderer.context;
    // Keep the whole window inside the byte budget so the LRU never evicts
    // frames this pass just rendered, nor the frame on screen.
    const fits = Math.floor(store.effectiveLimit / (gl.drawingBufferWidth * gl.drawingBufferHeight * 4)) - 2;
    const ahead = Math.min(PREFETCH_AHEAD, Math.max(0, fits - PREFETCH_BEHIND));
    const wanted = frame => frame >= 0 && frame < length && !controller.prefetchSkipped.has(frame) &&
      !store.entries.has(entryKey(controller, frame));
    for (let offset = 1; offset <= ahead; offset += 1) if (wanted(current + offset)) return current + offset;
    for (let offset = 1; offset <= Math.min(PREFETCH_BEHIND, fits); offset += 1) {
      if (wanted(current - offset)) return current - offset;
    }
    return undefined;
  }

  async function prefetchFrame(controller, key, frame, current) {
    const viewport = controller.viewport;
    const epoch = signalEpoch;
    const valid = () => !disposed && !controller.disposed && !debug.disabled && controller.key === key &&
      signalEpoch === epoch && contextAvailable(viewport.renderer.context) && !!store.effectiveLimit &&
      !plainTimeProject(viewport) && viewport.editor.playback.speed === 0 &&
      viewport.editor.playback.currentFrame === current && !viewport.renderMode;
    const snapshot = snapshotFor(controller, key);
    const sequence = snapshot.project.sequence;
    if (!snapshot.ready) {
      await awaitResources(sequence);
      await global.document.fonts?.ready;
      if (!valid()) return false;
      // The private graph must reproduce the project exactly.
      if (model.canonicalJSON(snapshot.project) !== model.canonicalJSON(viewport.editor.project)) {
        controller.unsupported = key;
        return false;
      }
      snapshot.ready = true;
    }
    sequence.update(frame);
    for (const schedule of sequence.videoSchedules) {
      await schedule.prepare(frame, { sequence, previewFrameCacheStrict: true, compositor: snapshot.compositor,
        frameSamplerRoot: snapshot.compositor });
      if (!valid()) return false;
    }
    const runtime = global.__zoidiumTemporalParts.sampler.getFrameSamplerRuntime(PZ.zoidium.temporal, snapshot.compositor);
    if (!valid() || global.document.fonts?.status === "loading" || !model.assetsComplete(snapshot.project) ||
      ![...sequence.videoSchedules, ...runtime.schedules.values()].every(model.decoderComplete) ||
      !activeClips(sequence, frame).every(clip => objectsReady(clip.object.objects, frame - clip.start))) {
      controller.prefetchSkipped.add(frame);
      return false;
    }
    // The private compositor draws into the shared canvas. Copy the result,
    // then restore the retained on-screen frame before the browser can paint.
    const live = store.get(entryKey(controller, current));
    if (!live) return false;
    const start = performance.now();
    snapshot.compositor.renderSequence(frame);
    controller.prefetchCost = performance.now() - start;
    const entry = capture(controller, frame);
    if (entry && store.put(entryKey(controller, frame), entry)) debug.prefetched += 1;
    // Pressure can evict the retained on-screen entry during capture.
    if (store.entries.get(entryKey(controller, current)) === live) display(controller, live);
    else if (contextAvailable(viewport.renderer.context)) viewport._render();
    return true;
  }

  function hasVideo(sequence) {
    return (sequence.videoSchedules || []).some(schedule => (schedule.items || []).some(item => item?.media));
  }

  function scheduleIdle(delay = IDLE_MS) {
    if (idleTimer !== null || disposed || debug.disabled || debug.prefetchDisabled || !store.effectiveLimit) return;
    idleTimer = setTimeout(() => { idleTimer = null; prefetchStep(); }, delay);
  }

  async function prefetchStep() {
    if (disposed || debug.disabled || debug.prefetchDisabled || !store.effectiveLimit) return;
    const quiet = performance.now() - lastSignal;
    if (quiet < IDLE_MS) { scheduleIdle(IDLE_MS - quiet); return; }
    for (const controller of controllers) {
      const viewport = controller.viewport;
      if (plainTimeProject(viewport)) {
        if (!controller.prefetching) disposeSnapshot(controller);
        continue;
      }
      if (controller.prefetching || controller.disposed || viewport.renderMode || viewport.editor.playback.speed !== 0) continue;
      // Draws that ran live left the key unvalidated; validate it now.
      if (controller.validated !== signalEpoch && currentKey(controller) === LIVE) {
        scheduleIdle(Math.max(50, HOT_MS - quiet));
        continue;
      }
      const key = controller.key;
      if (!key || controller.settled !== key || controller.unsupported === key) continue;
      // Private video decoders compete with the editor's own and slowed later
      // playback, while seek-based decoding filled only ~2 frames per second.
      if (hasVideo(viewport.editor.project.sequence)) continue;
      const current = viewport.editor.playback.currentFrame;
      if (!store.entries.has(entryKey(controller, current)) || controller.prefetchCost > PREFETCH_SYNC_MS) continue;
      const frame = nextPrefetchFrame(controller, current);
      if (frame === undefined) { disposeSnapshot(controller); continue; }
      controller.prefetching = true;
      let rendered = false;
      try {
        rendered = await prefetchFrame(controller, key, frame, current);
      } catch (error) {
        controller.unsupported = key;
        console.error("[Zoidium] preview prefetch failed:", error);
      } finally {
        controller.prefetching = false;
        if (!rendered) debug.prefetchAborted += 1;
        if (controller.key !== key || controller.unsupported === key || viewport.editor.playback.speed !== 0) {
          disposeSnapshot(controller);
        }
      }
      // Yield to input between frames.
      scheduleIdle(0);
      return;
    }
  }

  const inputEvents = ["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "click",
    "dblclick", "contextmenu", "wheel", "input", "change", "drop", "paste", "touchstart", "touchmove", "touchend"];
  function input(event) {
    // Hovering cannot edit; dragging moves with a pressed button.
    if (event.type === "pointermove" && !event.buttons) return;
    signal();
  }
  for (const event of inputEvents) global.addEventListener(event, input, true);
  function invalidate(event) { signal(event?.type); for (const controller of controllers) reset(controller, event?.type || "invalidate"); }
  function pluginsChanged() { pluginEpoch += 1; invalidate(); }
  function fontsChanged(event) { fontEpoch += 1; signal(event?.type ? "fonts." + event.type : "fonts"); }
  global.document.addEventListener("zoidium:plugin-state-change", pluginsChanged);
  global.document.addEventListener("zoidium:project-load-start", invalidate);
  global.document.addEventListener("zoidium:asset-reloaded", invalidate);
  global.document.fonts?.addEventListener("loadingdone", fontsChanged);
  global.document.fonts?.addEventListener("loadingerror", fontsChanged);

  // Every native edit, undo and redo passes through the history object, also
  // from pop-out editor windows whose input events this document never sees.
  const historyPrototype = global.PZ?.ui?.history?.prototype;
  const historyMethods = ["startOperation", "pushCommand", "finishOperation", "discardOperation", "undo", "redo"];
  const originalHistory = new Map();
  for (const name of historyMethods) {
    const original = historyPrototype?.[name];
    if (typeof original !== "function") continue;
    originalHistory.set(name, original);
    historyPrototype[name] = function signalHistory() {
      signal("history." + name);
      try { return original.apply(this, arguments); }
      finally { signal("history." + name); }
    };
  }

  function release(viewport) {
    const controller = viewport.__zoidiumOutputFrames;
    if (!controller) return;
    controller.disposed = true;
    reset(controller, "release");
    if (!controller.prefetching) disposeSnapshot(controller);
    viewport.editor.onProjectChanged.unwatch(controller.projectChanged);
    controller.projectSignal?.unwatch(signal);
    controller.resolution.unwatch(controller.resized);
    viewport.editor.playback.onSpeedChanged?.unwatch(controller.speedChanged);
    controller.canvas?.removeEventListener("webglcontextlost", controller.contextLost);
    controller.canvas?.removeEventListener("webglcontextrestored", controller.contextRestored);
    lostContexts.delete(viewport.renderer.context);
    if (!lostContexts.size) store.restoreContext();
    controller.pass?.material.dispose();
    controller.pass?.quad?.geometry?.dispose?.();
    controllers.delete(controller);
    delete viewport.compositor.__zoidiumOutputFrameOwner;
    delete viewport.__zoidiumOutputFrames;
  }

  // The editor's main viewport is built before Zoidium's subclass exists, so
  // hook the prototype that owns _render (already wrapped by temporal-render).
  let viewportPrototype = PZ.ui.viewport.prototype;
  while (viewportPrototype && !Object.prototype.hasOwnProperty.call(viewportPrototype, "_render")) {
    viewportPrototype = Object.getPrototypeOf(viewportPrototype);
  }
  const originalViewportRender = viewportPrototype._render;
  const originalPickColor = viewportPrototype.pickColor;
  function cachedViewportRender() {
    const args = arguments;
    return render(this, () => originalViewportRender.apply(this, args));
  }
  // CM3's eyedropper reads pixels right after _render(); keep its own draw.
  function immediatePickColor() {
    const previous = this.__zoidiumImmediateOutput;
    this.__zoidiumImmediateOutput = true;
    try { return originalPickColor.apply(this, arguments); }
    finally { this.__zoidiumImmediateOutput = previous; }
  }
  viewportPrototype._render = cachedViewportRender;
  if (typeof originalPickColor === "function") viewportPrototype.pickColor = immediatePickColor;

  const compositorPrototype = PZ.compositor.prototype;
  const originalUnload = compositorPrototype.unload;
  function unloadWithOutputFrames() {
    if (this.__zoidiumOutputFrameOwner) release(this.__zoidiumOutputFrameOwner);
    return originalUnload.apply(this, arguments);
  }
  compositorPrototype.unload = unloadWithOutputFrames;

  function usageReason(viewport) {
    if (disposed) return "Preview cache is unavailable";
    if (!store.limit || debug.disabled) return "Preview caching is disabled";
    if (store.contextLost) return "The WebGL context was lost";
    if (!store.effectiveLimit) return "GPU memory is unavailable for this session";
    if (!viewport) return "Waiting for a preview viewport";
    if (viewport.__zoidiumPlayerPlusPaused) return "Preview drawing is paused";
    if (viewport.renderMode || !viewport.options?.widget2dObjects) return "The 3D editing camera is active";
    if (plainTimeProject(viewport)) return "Time operators use live preview evaluation";
    const frame = viewport.editor.playback.currentFrame;
    if (!Number.isInteger(frame) || frame < 0) return "The playhead is not on a cacheable frame";
    return viewport.__zoidiumOutputFrames?.reason ??
      (viewport.__zoidiumOutputFrames ? null : "Waiting for a complete preview frame");
  }

  const api = {
    debug, render, release, capturePreview,
    usage() {
      const viewport = (global.CM || global.VE)?.mainViewport || controllers.values().next().value?.viewport;
      const gl = viewport?.renderer?.context;
      return { bytes: store.bytes, entries: store.entries.size, limit: store.effectiveLimit,
        width: gl?.drawingBufferWidth || 0, height: gl?.drawingBufferHeight || 0, reason: usageReason(viewport) };
    },
    setSizeMiB(value) {
      const limit = model.sizeMiB(value) * 1024 * 1024;
      if (limit === store.limit) return;
      store.resize(limit);
      for (const controller of controllers) reset(controller, "size");
    },
    clear() { store.clear(); for (const controller of controllers) reset(controller, "clear"); },
    dispose() {
      disposed = true;
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      for (const controller of Array.from(controllers)) release(controller.viewport);
      store.clear();
      if (compositorPrototype.unload === unloadWithOutputFrames) compositorPrototype.unload = originalUnload;
      if (viewportPrototype._render === cachedViewportRender) viewportPrototype._render = originalViewportRender;
      if (viewportPrototype.pickColor === immediatePickColor) viewportPrototype.pickColor = originalPickColor;
      for (const [name, original] of originalHistory) historyPrototype[name] = original;
      for (const event of inputEvents) global.removeEventListener(event, input, true);
      global.document.removeEventListener("zoidium:plugin-state-change", pluginsChanged);
      global.document.removeEventListener("zoidium:project-load-start", invalidate);
      global.document.removeEventListener("zoidium:asset-reloaded", invalidate);
      global.document.fonts?.removeEventListener("loadingdone", fontsChanged);
      global.document.fonts?.removeEventListener("loadingerror", fontsChanged);
    },
  };
  global.ZoidiumFrameCache = api;
  PZ.zoidium.debug = PZ.zoidium.debug || {};
  PZ.zoidium.debug.frameCache = debug;
})(typeof window !== "undefined" ? window : globalThis);
