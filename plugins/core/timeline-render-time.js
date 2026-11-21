(function installRenderTime(global) {
  "use strict";

  const PZ = global.PZ;
  const preference = "zoidium.timeline.render-time";
  const maxQueries = 192;
  const maxPending = 4;
  const queryTimeout = 1000;
  let editors = new WeakMap();
  const liveDraws = new WeakMap();
  const prepared = new Set();
  const pending = new Set();
  let gpuContexts = new WeakMap();
  let pollId = null;
  let enabled = false;
  try { enabled = global.localStorage.getItem(preference) === "true"; } catch (_error) {}

  function stateFor(editor) {
    let state = editors.get(editor);
    if (!state || state.project !== editor.project) {
      // CPU submission and GPU elapsed samples publish on their own schedules.
      // Each snapshot keeps the frame and serial it belongs to.
      state = { project: editor.project, cpu: null, gpu: null, statuses: new WeakMap(), serial: 0, shown: 0 };
      editors.set(editor, state);
    }
    return state;
  }

  function canMeasure(viewport) {
    return enabled && viewport?.editor?.mainViewport === viewport && !!viewport.compositor &&
      !viewport.renderMode && !viewport.__zoidiumCommunityPrepared && !viewport.renderer?.__zoidiumExportRenderer;
  }

  function timerFor(compositor) {
    const gl = compositor.renderer?.context;
    if (!gl) return null;
    if (!gpuContexts.has(gl)) gpuContexts.set(gl, global.ZoidiumRenderTimeGpu.create(gl));
    return gpuContexts.get(gl);
  }

  function createFrame(viewport, frame) {
    const { editor, compositor } = viewport;
    const sequence = compositor._sequence;
    const fps = sequence?.properties?.rate?.get?.() || editor.playback?.frameRate;
    const state = stateFor(editor);
    const saturated = pending.size >= maxPending;
    const timer = saturated ? null : timerFor(compositor);
    let gpuStatus = timer ? null : saturated ? "busy" : "unavailable";
    timer?.check();
    const epoch = timer?.epoch;
    const records = new Map();
    const queries = [];
    const stack = [];
    let activeQuery = null;
    let discarded = false;

    function releaseQueries() {
      if (!timer) return;
      for (const { query } of queries) timer.remove(query);
      queries.length = 0;
    }

    // The first failure explains the whole frame. A partial query set is never
    // reported as a numeric GPU total.
    function fail(status) {
      if (!gpuStatus) gpuStatus = status;
    }

    function begin(record) {
      if (timer && !gpuStatus) {
        if (timer.epoch !== epoch) fail("disjoint");
        else if (queries.length >= maxQueries) fail("limit");
        else {
          activeQuery = timer.begin();
          if (!activeQuery) fail(timer.active?.() ? "busy" : "unavailable");
          else {
            const owners = Array.from(new Set(stack));
            queries.push({ query: activeQuery, records: owners });
            for (const owner of owners) owner.timed = true;
          }
        }
      }
      if (record) record.started = global.performance.now();
    }

    function end(record) {
      if (record) {
        const elapsed = global.performance.now() - record.started;
        for (const ancestor of new Set(stack)) ancestor.cpu += elapsed;
      }
      if (activeQuery) {
        timer.end();
        activeQuery = null;
      }
    }

    function measure(object, callback, self, args) {
      if (discarded) return callback.apply(self, args);
      let record = records.get(object);
      if (!record) records.set(object, record = { object, cpu: 0, gpu: 0, drew: true });
      record.drew = true;
      const previous = stack.at(-1);
      end(previous);
      stack.push(record);
      begin(record);
      try { return callback.apply(self, args); }
      finally {
        end(record);
        stack.pop();
        if (previous) begin(previous);
        if (discarded && !stack.length) releaseQueries();
      }
    }

    // A temporal input capture can span several asynchronous preparations.
    // Only time synchronous draw work and charge it to the requesting effect.
    function measureSample(effect, layer, callback, self, args) {
      if (discarded) return callback.apply(self, args);
      const owners = [];
      for (let owner = effect.parent && effect.parentObject; owner instanceof PZ.effect;
        owner = owner.parent && owner.parentObject) owners.push(owner);
      for (let owner = layer; owner; owner = owner.tryGetParentOfType?.(PZ.layer)) owners.push(owner);
      function drawOwner(index) {
        if (index < 0) return measure(effect, callback, self, args);
        return measure(owners[index], () => drawOwner(index - 1));
      }
      const result = drawOwner(owners.length - 1);
      records.get(effect).sampled = true;
      return result;
    }

    // Resolve once: `null` means the queries are still pending, an object
    // carries the explicit status. Accumulation stays on the records so a
    // nested layer keeps every segment it owns.
    function resolve(force) {
      if (!timer || gpuStatus || !queries.length) return { status: gpuStatus || "unavailable" };
      timer.check();
      if (timer.epoch !== epoch) return { status: "disjoint" };
      if (!queries.every(({ query }) => timer.ready(query))) {
        return force ? { status: "timeout" } : null;
      }
      let valid = true;
      for (const { query, records: owners } of queries) {
        const ms = timer.milliseconds(query);
        if (!Number.isFinite(ms) || ms < 0) { valid = false; continue; }
        for (const owner of owners) owner.gpu += ms;
      }
      return { status: valid ? "available" : "disjoint" };
    }

    return {
      editor, state, sequence, frame, records, measure, measureSample,
      budget: Number.isFinite(fps) && fps > 0 ? 1000 / fps : null,
      serial: 0,
      get discarded() { return discarded; },
      get gpuStatus() { return gpuStatus; },
      get gpuPending() { return !gpuStatus && !!timer && queries.length > 0; },
      resolve,
      reuseLayer(layer) {
        if (discarded) return;
        let record = records.get(layer);
        if (!record) records.set(layer, record = { object: layer, cpu: 0, gpu: 0 });
        record.cached = true;
      },
      reuseSample(effect, preparedInput) {
        if (discarded) return;
        let record = records.get(effect);
        if (!record) records.set(effect, record = { object: effect, cpu: 0, gpu: 0 });
        if (!preparedInput || !record.sampled) record.samplesCached = true;
      },
      discard() {
        discarded = true;
        prepared.delete(this);
        pending.delete(this);
        if (!stack.length) releaseQueries();
      },
    };
  }

  function replace(target, name, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    target[name] = replacement;
    return () => {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    };
  }

  function measureCompositor(frame, compositor, callback, self, args) {
    const renderLayer = compositor.renderLayer;
    const renderEffects = compositor.renderEffects;
    const groups = new WeakMap();
    let inPass = false;
    const restoreLayer = replace(compositor, "renderLayer", function (layer) {
      return frame.measure(layer, renderLayer, this, arguments);
    });
    const restoreEffects = replace(compositor, "renderEffects", function (effects) {
      if (!effects || inPass) return renderEffects.apply(this, arguments);
      const byPass = new Map();
      for (const effect of effects) {
        if (PZ.zoidium?.effectBypass?.bypassed(effect)) continue;
        if (effect instanceof PZ.effect.group) {
          groups.set(effect.objects, effect);
        } else if (effect.pass?.enabled && typeof effect.pass.render === "function") {
          if (!byPass.has(effect.pass)) byPass.set(effect.pass, []);
          byPass.get(effect.pass).push(effect);
        }
      }
      const restores = [];
      try {
        for (const [pass, effects] of byPass) {
          const render = pass.render;
          restores.push(replace(pass, "render", function () {
            if (inPass) return render.apply(this, arguments);
            const effect = effects.shift();
            if (!effect) return render.apply(this, arguments);
            inPass = true;
            try { return frame.measure(effect, render, this, arguments); }
            finally { inPass = false; }
          }));
        }
        const group = groups.get(effects);
        return group ? frame.measure(group, renderEffects, this, arguments) : renderEffects.apply(this, arguments);
      } finally {
        for (const restore of restores) restore();
      }
    });
    try { return callback.apply(self, args); }
    finally {
      restoreEffects();
      restoreLayer();
    }
  }

  function recordStatus(state, object, sequence, frame, status) {
    const old = state.statuses.get(object);
    if (old && old.sequence === sequence && old.frame > frame) return;
    state.statuses.set(object, { sequence, frame, status });
  }

  function statusFor(state, object, sequence) {
    const record = state.statuses.get(object);
    return record && record.sequence === sequence ? record.status : "unavailable";
  }

  function publishCpu(frame) {
    const { editor, state, serial, sequence, budget, records } = frame;
    if (state.project !== editor.project || state.shown >= serial) return;
    const previous = state.cpu?.sequence === sequence ? state.cpu.values : null;
    const status = frame.gpuStatus || (frame.gpuPending ? "pending" : "unavailable");
    const values = new Map();
    for (const [object, entry] of records) {
      if (entry.cached) {
        values.set(object, { cached: true });
        continue;
      }
      if (!entry.drew) continue;
      const old = previous?.get(object);
      const smooth = old && typeof old.ms === "number" && old.samplesCached === !!entry.samplesCached;
      values.set(object, {
        ms: smooth ? old.ms + (entry.cpu - old.ms) * 0.25 : entry.cpu,
        samplesCached: !!entry.samplesCached,
      });
      recordStatus(state, object, sequence, frame.frame, status);
    }
    state.shown = serial;
    state.cpu = { sequence, frame: frame.frame, serial, budget, values };
    global.ZoidiumRenderTimeColumn?.refresh();
  }

  function publishGpu(frame, status) {
    const { state, records, sequence } = frame;
    if (state.project !== frame.editor.project) return;
    const frameNumber = frame.frame;
    if (status !== "available") {
      for (const [object, entry] of records) {
        if (entry.drew) recordStatus(state, object, sequence, frameNumber, status);
      }
      return;
    }
    // Keep the newest completed sample by submission order; a late, older
    // result must not replace it, and a looped sequence keeps publishing.
    const previous = state.gpu?.sequence === sequence ? state.gpu : null;
    if (previous && frame.serial < previous.serial) return;
    const values = new Map();
    for (const [object, entry] of records) {
      if (!entry.timed) continue;
      const old = previous?.values.get(object);
      const smooth = old && typeof old.ms === "number" && old.samplesCached === !!entry.samplesCached;
      values.set(object, {
        ms: smooth ? old.ms + (entry.gpu - old.ms) * 0.25 : entry.gpu,
        samplesCached: !!entry.samplesCached,
      });
      recordStatus(state, object, sequence, frameNumber, "available");
    }
    if (!values.size && previous) return;
    state.gpu = { sequence, frame: frameNumber, serial: frame.serial, values };
    global.ZoidiumRenderTimeColumn?.refresh();
  }

  function poll() {
    pollId = null;
    for (const frame of pending) {
      if (frame.editor.project !== frame.state.project) {
        frame.discard();
        continue;
      }
      const resolution = frame.resolve(global.performance.now() - frame.submittedAt > queryTimeout);
      if (!resolution) continue;
      frame.discard();
      publishGpu(frame, resolution.status);
    }
    if (pending.size) pollId = global.requestAnimationFrame(poll);
  }

  function prepare(viewport, frame) {
    if (!canMeasure(viewport)) return null;
    const sample = createFrame(viewport, frame);
    prepared.add(sample);
    return sample;
  }

  function draw(viewport, frame, callback, self, args, sample) {
    if (!canMeasure(viewport)) return callback.apply(self, args);
    const state = stateFor(viewport.editor);
    const timing = sample && !sample.discarded && sample.state === state
      ? sample : createFrame(viewport, frame);
    prepared.delete(timing);
    let result;
    const compositor = viewport.compositor;
    liveDraws.set(compositor, timing);
    try {
      result = measureCompositor(timing, compositor, callback, self, args);
    } catch (error) {
      timing.discard();
      throw error;
    } finally {
      liveDraws.delete(compositor);
    }
    if (timing.discarded) return result;
    timing.serial = ++state.serial;
    publishCpu(timing);
    if (timing.gpuPending) {
      const resolution = timing.resolve(false);
      if (resolution) {
        timing.discard();
        publishGpu(timing, resolution.status);
      } else {
        timing.submittedAt = global.performance.now();
        pending.add(timing);
        if (pollId === null) pollId = global.requestAnimationFrame(poll);
      }
    } else {
      const status = timing.gpuStatus || "unavailable";
      timing.discard();
      publishGpu(timing, status);
    }
    return result;
  }

  function drawNative(viewport, original, args) {
    const compositor = viewport.compositor;
    if (!canMeasure(viewport) || !compositor.renderSequence) return original.apply(viewport, args);
    const renderSequence = compositor.renderSequence;
    const restore = replace(compositor, "renderSequence", function (frame) {
      return draw(viewport, frame, renderSequence, this, arguments);
    });
    try { return original.apply(viewport, args); }
    finally { restore(); }
  }

  function cached(viewport, frame) {
    if (!canMeasure(viewport)) return;
    const state = stateFor(viewport.editor);
    state.shown = ++state.serial;
    state.cpu = { sequence: viewport.compositor._sequence, frame, serial: state.shown, cached: true };
    // Reused pixels are not a measurement; do not smooth or pair across them.
    state.gpu = null;
    global.ZoidiumRenderTimeColumn?.refresh();
  }

  function snapshotFor(editor) {
    const state = editors.get(editor);
    return state?.project === editor.project ? state.cpu : null;
  }

  function activeLayer(track, sequence, frame) {
    if (track.enabled === false || global.ZoidiumTrackSwitches?.excludedBySolo(track, sequence?.videoTracks)) return null;
    return track.getCurrentClip?.(frame)?.object || null;
  }

  function metricFor(state, snapshot, object) {
    const entry = snapshot.values.get(object);
    if (!entry || entry.cached) return entry || null;
    const gpu = state.gpu?.sequence === snapshot.sequence ? state.gpu : null;
    const sample = gpu?.values.get(object) || null;
    return {
      cpuMs: entry.ms,
      cpuFrame: snapshot.frame,
      gpuMs: sample ? sample.ms : null,
      gpuStatus: sample ? "available" : statusFor(state, object, snapshot.sequence),
      gpuFrame: sample ? gpu.frame : null,
      gpuAge: sample ? Math.max(0, snapshot.frame - gpu.frame) : null,
      budget: snapshot.budget,
      samplesCached: !!entry.samplesCached,
    };
  }

  function readTrack(editor, track) {
    const state = editors.get(editor);
    const snapshot = snapshotFor(editor);
    if (!state || !snapshot) return null;
    const layer = activeLayer(track, snapshot.sequence, snapshot.frame);
    if (!layer) return null;
    return snapshot.cached ? { cached: true } : metricFor(state, snapshot, layer);
  }

  function read(editor, object) {
    const state = editors.get(editor);
    const snapshot = snapshotFor(editor);
    if (!state || !snapshot) return null;
    if (!snapshot.cached) return metricFor(state, snapshot, object);
    if (PZ.zoidium?.effectBypass?.bypassed(object)) return null;
    const track = object.tryGetParentOfType?.(PZ.track);
    if (!track || track.getCurrentClip?.(snapshot.frame) === object.tryGetParentOfType?.(PZ.clip) &&
        activeLayer(track, snapshot.sequence, snapshot.frame)) return { cached: true };
    return null;
  }

  function setEnabled(value) {
    enabled = !!value;
    global.ZoidiumRenderTimeActive = enabled ? api : null;
    try { global.localStorage.setItem(preference, String(enabled)); } catch (_error) {}
    if (!enabled) {
      if (pollId !== null) global.cancelAnimationFrame(pollId);
      pollId = null;
      for (const timing of prepared) timing.discard();
      for (const timing of pending) timing.discard();
      editors = new WeakMap();
      gpuContexts = new WeakMap();
    }
    global.ZoidiumRenderTimeColumn?.refresh(true);
  }

  const api = {
    get enabled() { return enabled; },
    setEnabled, prepare, draw, drawNative, cached, read, readTrack,
    current: compositor => liveDraws.get(compositor),
  };
  global.ZoidiumRenderTime = api;
  global.ZoidiumRenderTimeActive = enabled ? api : null;
})(window);
