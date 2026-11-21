(function installRenderTime(global) {
  "use strict";

  const PZ = global.PZ;
  const preference = "zoidium.timeline.render-time";
  const maxQueries = 192;
  const maxPending = 4;
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
      state = { project: editor.project, snapshot: null, serial: 0, shown: 0 };
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
    const timer = pending.size < maxPending ? timerFor(compositor) : null;
    timer?.check();
    const epoch = timer?.epoch;
    const records = new Map();
    const queries = [];
    const stack = [];
    let activeQuery = null;
    let useGpu = !!timer;
    let discarded = false;

    function releaseQueries() {
      for (const { query } of queries) timer.remove(query);
      queries.length = 0;
    }

    function begin(record) {
      if (useGpu && timer.epoch === epoch) {
        if (queries.length < maxQueries) activeQuery = timer.begin();
        if (activeQuery) queries.push({ query: activeQuery, records: Array.from(new Set(stack)) });
        else useGpu = false;
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
      if (!record) records.set(object, record = { cpu: 0, gpu: 0, drew: true });
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

    return {
      editor, state, sequence, frame, records, measure, measureSample,
      budget: Number.isFinite(fps) && fps > 0 ? 1000 / fps : null,
      serial: 0,
      get discarded() { return discarded; },
      reuseLayer(layer) {
        if (discarded) return;
        let record = records.get(layer);
        if (!record) records.set(layer, record = { cpu: 0, gpu: 0 });
        record.cached = true;
      },
      reuseSample(effect, preparedInput) {
        if (discarded) return;
        let record = records.get(effect);
        if (!record) records.set(effect, record = { cpu: 0, gpu: 0 });
        if (!preparedInput || !record.sampled) record.samplesCached = true;
      },
      result(force) {
        if (timer && useGpu && queries.length && !force) {
          timer.check();
          if (timer.epoch === epoch) {
            if (!queries.every(({ query }) => timer.ready(query))) return null;
            let valid = true;
            for (const { query, records } of queries) {
              const ms = timer.milliseconds(query);
              if (!Number.isFinite(ms) || ms < 0) valid = false;
              for (const record of records) record.gpu += ms;
            }
            return valid ? "GPU" : "CPU";
          }
        }
        return "CPU";
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

  function publish(frame, basis) {
    const { editor, state, serial, sequence, budget, records } = frame;
    if (state.project !== editor.project || state.shown >= serial) return;
    const values = new Map();
    const previous = state.snapshot?.sequence === sequence ? state.snapshot.values : null;
    for (const [object, entry] of records) {
      if (entry.cached) {
        values.set(object, { cached: true, budget });
        continue;
      }
      if (!entry.drew) continue;
      const raw = basis === "GPU" ? entry.gpu : entry.cpu;
      const old = previous?.get(object);
      const smooth = old?.basis === basis && old.samplesCached === !!entry.samplesCached;
      const ms = smooth ? old.ms + (raw - old.ms) * 0.25 : raw;
      values.set(object, { ms, basis, budget, samplesCached: !!entry.samplesCached });
    }
    state.shown = serial;
    state.snapshot = { sequence, frame: frame.frame, values };
    global.ZoidiumRenderTimeColumn?.refresh();
  }

  function poll() {
    pollId = null;
    for (const frame of pending) {
      if (frame.state.shown >= frame.serial || frame.editor.project !== frame.state.project) {
        frame.discard();
        continue;
      }
      const result = frame.result(global.performance.now() - frame.submittedAt > 1000);
      if (!result) continue;
      frame.discard();
      publish(frame, result);
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
    const basis = timing.result(false);
    if (basis) {
      timing.discard();
      publish(timing, basis);
    } else {
      timing.submittedAt = global.performance.now();
      pending.add(timing);
      if (pollId === null) pollId = global.requestAnimationFrame(poll);
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
    state.snapshot = { sequence: viewport.compositor._sequence, frame, cached: true };
    global.ZoidiumRenderTimeColumn?.refresh();
  }

  function snapshotFor(editor) {
    const state = editors.get(editor);
    return state?.project === editor.project ? state.snapshot : null;
  }

  function activeLayer(track, sequence, frame) {
    if (track.enabled === false || global.ZoidiumTrackSwitches?.excludedBySolo(track, sequence?.videoTracks)) return null;
    return track.getCurrentClip?.(frame)?.object || null;
  }

  function readTrack(editor, track) {
    const snapshot = snapshotFor(editor);
    if (!snapshot) return null;
    const layer = activeLayer(track, snapshot.sequence, snapshot.frame);
    return layer && (snapshot.cached ? { cached: true } : snapshot.values.get(layer) || null);
  }

  function read(editor, object) {
    const snapshot = snapshotFor(editor);
    if (!snapshot) return null;
    if (!snapshot.cached) return snapshot.values.get(object) || null;
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
