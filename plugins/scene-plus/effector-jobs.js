"use strict";

const reportedJobFailures = new Set();

const { fractureErrorText } = require("./effector-fracture.js");

const { byteSize } = require("./effector-evaluate.js");

// Keep each topology on one worker so motion reuses its cached stages.
// New topologies use idle workers within one shared stage-cache budget.
function createMeshJobs(workerSource, host = globalThis, redraw = () => {}) {
  const maxBytes = 96 * 1024 * 1024;
  const entries = new Map();
  const consumers = new Map();
  const concurrency = Math.min(4, Math.max(1, Math.floor(host.navigator?.hardwareConcurrency || 2) - 1));
  const slots = Array.from({ length: concurrency }, () => ({ worker: null, url: null, active: null, built: new Set() }));
  const owners = new Map();
  const sourceOwners = new Map();
  const cacheBytes = Math.floor(64 * 1024 * 1024 / concurrency);
  let disposed = false, serial = 0;
  let bytes = 0;

  function reportFracture(entry, consumer, pending, codes = [], cancelled = false) {
    if (!entry.fracture) return;
    if (!entry.statusTargets) entry.statusTargets = new Map();
    let targets = entry.statusTargets.get(consumer);
    if (!targets) {
      targets = new Set();
      for (let node = consumer; node; node = node.parent) {
        const owner = node.__zoidiumEffectorOwner || node.__zoidiumEffectorTransformOwner;
        if (typeof owner?.setFractureJobStatus === "function" &&
          (!owner.acceptsCharacterMesh || owner.acceptsCharacterMesh(consumer, owner._effectorFrame || 0))) targets.add(owner);
      }
      entry.statusTargets.set(consumer, targets);
    }
    for (const owner of targets) owner.setFractureJobStatus(consumer, pending, codes, cancelled);
  }

  function completeStatus(entry, codes = []) {
    if (!entry.fracture) return;
    for (const consumer of entry.users) reportFracture(entry, consumer, false, codes);
    for (const code of new Set(codes)) {
      const diagnostic = entry.buildKey + ":" + code;
      if (reportedJobFailures.has(diagnostic)) continue;
      reportedJobFailures.add(diagnostic);
      const message = fractureErrorText(code);
      console.warn("[Zoidium] Voronoi Fracture: " + message + ".");
      host.ZoidiumUI?.notify({ title: "Voronoi Fracture warning", message });
    }
  }

  function affinity(entry) { return entry.sourceId === undefined ? "build:" + entry.buildKey : "source:" + entry.sourceId; }

  function stopWorker(slot) {
    slot.built.clear();
    slot.worker?.terminate();
    slot.worker = null;
    if (slot.url) host.URL.revokeObjectURL(slot.url);
    slot.url = null;
    slot.active = null;
  }

  function fail(slot, error) {
    const entry = slot.active;
    stopWorker(slot);
    if (entry) {
      entry.status = "error";
      entry.input = null;
      entry.error = error;
      completeStatus(entry, ["worker failed: " + error.message]);
      entry.reject(error);
      redraw();
    }
  }

  function trim() {
    // Rendered meshes release their jobs after copying the result. Only retain
    // four unused frames, with a strict byte limit on that retained cache.
    const unused = Array.from(entries.values()).filter(entry => entry.status === "done" && !entry.users.size);
    while (unused.length) {
      if (unused.length <= 4 && bytes <= maxBytes) break;
      const entry = unused.shift();
      entries.delete(entry.key);
      bytes -= entry.bytes;
    }
  }

  function startWorker(slot) {
    if (!slot.worker) {
      slot.url = host.URL.createObjectURL(new host.Blob([workerSource], { type: "text/javascript" }));
      const worker = slot.worker = new host.Worker(slot.url);
      worker.onmessage = ({ data }) => {
        if (slot.worker !== worker || !slot.active || data.id !== slot.active.id) return;
        const completed = slot.active;
        slot.active = null;
        if (data.error) {
          completed.status = "error";
          completed.error = new Error("Effector worker failed: " + data.error);
          completeStatus(completed, ["worker failed: " + data.error]);
          completed.reject(completed.error);
          redraw();
        } else {
          completed.status = "done";
          slot.built.add(completed.buildKey);
          // A cancelled frame that was left to finish is only discarded.
          if (entries.get(completed.key) === completed) {
            completed.value = data.value;
            completed.stages = data.stages;
            completeStatus(completed, [...(data.value.errors || []), ...(data.value.warnings || [])]);
            completed.bytes = byteSize({ value: data.value, stages: data.stages });
            bytes += completed.bytes;
            completed.resolve(data.value);
            redraw();
          }
        }
        completed.input = null;
        trim();
        pump();
      };
      worker.onerror = event => {
        if (slot.worker !== worker) return;
        fail(slot, new Error("Effector worker failed: " + event.message));
        pump();
      };
    }
  }

  function dispatch(slot, entry) {
    slot.active = entry;
    entry.slot = slot;
    entry.status = "running";
    owners.delete(entry.buildKey);
    owners.set(entry.buildKey, slot);
    if (owners.size > 256) owners.delete(owners.keys().next().value);
    if (entry.sourceId !== undefined) sourceOwners.set(entry.sourceId, slot);
    try {
      startWorker(slot);
      slot.worker.postMessage({ id: entry.id, input: entry.input, cacheBytes });
    } catch (error) {
      fail(slot, error);
    }
  }

  function pump() {
    if (disposed) return;
    for (const entry of entries.values()) {
      if (entry.status !== "queued") continue;
      const owner = owners.get(entry.buildKey);
      const sourceOwner = sourceOwners.get(entry.sourceId);
      const slot = owner || (sourceOwner && !sourceOwner.active ? sourceOwner : slots.find(item => !item.active));
      if (slot && !slot.active) dispatch(slot, entry);
    }
  }

  function cancel(entry) {
    // Terminating the worker also drops every cached topology, which would turn
    // the next frame of each mesh into a full rebuild. Only abort unwanted first
    // builds; an unwanted motion frame finishes quickly and is discarded.
    if (entry.slot?.active === entry && !entry.slot.built.has(entry.buildKey)) stopWorker(entry.slot);
    entries.delete(entry.key);
    entry.input = null;
    entry.resolve(null);
  }

  function release(consumer, preserveBuildKey) {
    const entry = consumers.get(consumer);
    if (!entry) return;
    consumers.delete(consumer);
    reportFracture(entry, consumer, false, [], true);
    entry.statusTargets?.delete(consumer);
    entry.users.delete(consumer);
    if (!entry.users.size && entry.status !== "done") {
      // Motion edits must not continually restart a valid first topology build.
      // Let that build populate the worker cache, then evaluate the latest motion.
      if (entry.slot?.active !== entry || entry.buildKey !== preserveBuildKey) cancel(entry);
      pump();
    }
    if (preserveBuildKey === undefined) for (const slot of slots) {
      const active = slot.active;
      if (active && !active.users.size && !Array.from(entries.values()).some(item =>
        item.status === "queued" && item.users.size && affinity(item) === affinity(active))) cancel(active);
    }
    trim();
  }

  function request(consumer, key, input) {
    if (disposed) return null;
    const previous = consumers.get(consumer);
    if (previous?.key === key) {
      return previous;
    }
    const buildKey = input.buildKey || key;
    release(consumer, buildKey);
    for (const slot of slots) {
      const active = slot.active;
      if (active && !active.users.size && active.buildKey !== buildKey &&
        (input.sourceId !== undefined ? active.sourceId === input.sourceId : active.buildKey === previous?.buildKey)) cancel(active);
    }
    let entry = entries.get(key);
    if (!entry) {
      entry = { id: ++serial, key, input, buildKey, sourceId: input.sourceId, fracture: input.commands?.some(command => command.kind === "fracture"), status: "queued", users: new Set(), bytes: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      // Interactive preview has no awaiting caller. Export still receives errors.
      entry.promise.catch(error => {
        const diagnostic = String(entry.sourceId ?? entry.buildKey) + ":" + error.message;
        if (reportedJobFailures.has(diagnostic)) return;
        reportedJobFailures.add(diagnostic);
        console.warn("[Zoidium] Effector: mesh job failed", error);
      });
      entries.set(key, entry);
    }
    entry.users.add(consumer);
    consumers.set(consumer, entry);
    if (input.commands?.some(command => command.kind === "fracture")) {
      reportFracture(entry, consumer, entry.status === "queued" || entry.status === "running", [...(entry.value?.errors || []), ...(entry.value?.warnings || [])]);
    }
    pump();
    return entry;
  }

  return {
    available: typeof host.Worker === "function",
    request, release,
    prewarm() {
      if (disposed) return;
      for (const slot of slots) {
        try { startWorker(slot); } catch (_) { stopWorker(slot); }
      }
    },
    latest(buildKey) {
      return Array.from(entries.values()).reverse().find(entry => entry.buildKey === buildKey && entry.status === "done");
    },
    forget(sourceId) {
      for (const slot of slots) if (slot.active?.sourceId === sourceId && !slot.active.users.size) cancel(slot.active);
      for (const [key, entry] of entries) if (entry.sourceId === sourceId && !entry.users.size) {
        bytes -= entry.bytes;
        entries.delete(key);
      }
      // Parameter edits can build on another idle worker. Forget every copy.
      for (const slot of slots) {
        try { slot.worker?.postMessage({ forgetSourceId: sourceId }); }
        catch (error) { fail(slot, error); }
      }
      sourceOwners.delete(sourceId);
      pump();
    },
    pending(consumersToWait) {
      return Array.from(new Set(Array.from(consumersToWait, consumer => consumers.get(consumer))))
        .filter(entry => entry && (entry.status === "queued" || entry.status === "running")).map(entry => entry.promise);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) stopWorker(slot);
      for (const entry of entries.values()) {
        for (const consumer of entry.users) reportFracture(entry, consumer, false, [], true);
        entry.resolve(null);
      }
      consumers.clear(); entries.clear(); owners.clear(); sourceOwners.clear(); bytes = 0;
    },
    stats() { return { entries: entries.size, consumers: consumers.size, bytes, running: slots.some(slot => Boolean(slot.active)), disposed }; },
  };
}

function createWorkerSource(sources) {
  return ZoidiumPluginApis.random.workerSource() + ZoidiumPluginApis.props.workerSource() + ZoidiumPluginApis.color.workerSource() + '"use strict";const sources=' + JSON.stringify(sources) + `;
const modules = new Map();
function load(id) {
  id = id.replace(/^\\.\\//, "");
  if (modules.has(id)) return modules.get(id).exports;
  const module = {exports:{}}; modules.set(id, module);
  new Function("module", "exports", "require", sources[id])(module, module.exports, load);
  return module.exports;
}
const evaluator = load("effector-evaluate.js");
let cache;
const reportedErrors = new Set();
let warnings = new Set();
let sharedStages = null;
function stageCache(maxBytes) {
  const result = evaluator.createStageCache(maxBytes);
  const readStage = result.get;
  result.get = (key, build) => {
    const stage = readStage(key, build);
    if (sharedStages) sharedStages.get(key, () => stage);
    if (stage.warning) warnings.add(stage.warning);
    return stage;
  };
  return result;
}
onmessage = ({data}) => {
  if (!cache) cache = stageCache(data.cacheBytes);
  if (data.forgetSourceId !== undefined) { cache.forget(data.forgetSourceId); return; }
  try {
    warnings = new Set();
    sharedStages = data.input.shareStages ? evaluator.createStageCache() : null;
    const value = evaluator.evaluateMesh(data.input, cache);
    if (warnings.size) value.warnings = Array.from(warnings);
    // Retain the worker's own arrays. The main thread imports these immutable
    // stages into its bounded cache and evaluates ready motion without a queue.
    const stages = sharedStages ? structuredClone(sharedStages.snapshot()) : undefined;
    const buffers = new Set();
    function visit(item) {
      if (!item || typeof item !== "object") return;
      if (ArrayBuffer.isView(item)) buffers.add(item.buffer);
      else for (const child of Object.values(item)) visit(child);
    }
    visit(value);
    visit(stages);
    postMessage({id:data.id, value, stages}, Array.from(buffers));
    sharedStages = null;
  } catch (error) {
    sharedStages = null;
    if (!reportedErrors.has(error.message)) {
      reportedErrors.add(error.message);
      console.warn("[Zoidium] Effector worker: mesh evaluation failed", error);
    }
    postMessage({id:data.id, error:String(error.stack || error)});
  }
};`;
}

module.exports = { createMeshJobs, createWorkerSource };
