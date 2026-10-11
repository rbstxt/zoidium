"use strict";

const { byteSize } = require("./effector-evaluate.js");

// One persistent worker reuses topology across motion frames. Unused work is
// terminated immediately; queued inputs have no copied large buffers yet.
function createMeshJobs(workerSource, host = globalThis, redraw = () => {}) {
  const maxBytes = 96 * 1024 * 1024;
  const entries = new Map();
  const consumers = new Map();
  // Topologies the worker has finished at least once. Its stage cache holds
  // them, so later jobs of the same topology are cheap motion frames.
  const built = new Set();
  let worker = null, url = null, active = null, disposed = false, serial = 0;
  let bytes = 0;

  function stopWorker() {
    built.clear();
    worker?.terminate();
    worker = null;
    if (url) host.URL.revokeObjectURL(url);
    url = null;
    active = null;
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

  function pump() {
    if (disposed || active) return;
    const entry = Array.from(entries.values()).find(item => item.status === "queued");
    if (!entry) return;
    try {
      if (!worker) {
        url = host.URL.createObjectURL(new host.Blob([workerSource], { type: "text/javascript" }));
        worker = new host.Worker(url);
        const currentWorker = worker;
        worker.onmessage = ({ data }) => {
          if (worker !== currentWorker) return;
          if (!active || data.id !== active.id) return;
          const completed = active;
          active = null;
          if (data.error) {
            completed.status = "error";
            completed.error = new Error("Effector worker failed: " + data.error);
            completed.reject(completed.error);
          } else {
            completed.status = "done";
            built.add(completed.buildKey);
            // A cancelled frame that was left to finish is only discarded.
            if (entries.get(completed.key) === completed) {
              completed.value = data.value;
              completed.bytes = byteSize(data.value);
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
          if (worker !== currentWorker) return;
          const failed = active;
          stopWorker();
          if (failed) {
            failed.status = "error";
            failed.input = null;
            failed.error = new Error("Effector worker failed: " + event.message);
            failed.reject(failed.error);
          }
          pump();
        };
      }
      active = entry;
      entry.status = "running";
      worker.postMessage({ id: entry.id, input: entry.input });
    } catch (error) {
      stopWorker();
      entry.status = "error";
      entry.input = null;
      entry.error = error;
      entry.reject(error);
      pump();
    }
  }

  function cancel(entry) {
    // Terminating the worker also drops every cached topology, which would turn
    // the next frame of each mesh into a full rebuild. Only abort unwanted first
    // builds; an unwanted motion frame finishes quickly and is discarded.
    if (active === entry && !built.has(entry.buildKey)) stopWorker();
    entries.delete(entry.key);
    entry.input = null;
    entry.resolve(null);
  }

  function release(consumer, preserveBuildKey) {
    const entry = consumers.get(consumer);
    if (!entry) return;
    consumers.delete(consumer);
    entry.users.delete(consumer);
    if (!entry.users.size && entry.status !== "done") {
      // Motion edits must not continually restart a valid first topology build.
      // Let that build populate the worker cache, then evaluate the latest motion.
      if (active !== entry || entry.buildKey !== preserveBuildKey) cancel(entry);
      pump();
    }
    if (preserveBuildKey === undefined && active && !active.users.size &&
      !Array.from(entries.values()).some(item => item.status === "queued" && item.users.size)) cancel(active);
    trim();
  }

  function request(consumer, key, input) {
    if (disposed) return null;
    const previous = consumers.get(consumer);
    if (previous?.key === key) {
      if (previous.error) throw previous.error;
      return previous;
    }
    const buildKey = input.buildKey || key;
    release(consumer, buildKey);
    if (active && !active.users.size && active.buildKey !== buildKey) cancel(active);
    let entry = entries.get(key);
    if (!entry) {
      entry = { id: ++serial, key, input, buildKey, sourceId: input.sourceId, status: "queued", users: new Set(), bytes: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      // Interactive preview has no awaiting caller. Export still receives errors.
      entry.promise.catch(() => {});
      entries.set(key, entry);
    }
    entry.users.add(consumer);
    consumers.set(consumer, entry);
    pump();
    return entry;
  }

  return {
    request, release,
    latest(buildKey) {
      return Array.from(entries.values()).reverse().find(entry => entry.buildKey === buildKey && entry.status === "done");
    },
    forget(sourceId) {
      if (active?.sourceId === sourceId && !active.users.size) cancel(active);
      for (const [key, entry] of entries) if (entry.sourceId === sourceId && !entry.users.size) {
        bytes -= entry.bytes;
        entries.delete(key);
      }
      worker?.postMessage({ forgetSourceId: sourceId });
      pump();
    },
    pending(consumersToWait) {
      return Array.from(new Set(Array.from(consumersToWait, consumer => consumers.get(consumer))))
        .filter(entry => entry && entry.status !== "done").map(entry => entry.promise);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWorker();
      for (const entry of entries.values()) entry.resolve(null);
      consumers.clear(); entries.clear(); bytes = 0;
    },
    stats() { return { entries: entries.size, consumers: consumers.size, bytes, running: Boolean(active), disposed }; },
  };
}

function createWorkerSource(sources) {
  return '"use strict";const sources=' + JSON.stringify(sources) + `;
const modules = new Map();
function load(id) {
  id = id.replace(/^\\.\\//, "");
  if (modules.has(id)) return modules.get(id).exports;
  const module = {exports:{}}; modules.set(id, module);
  new Function("module", "exports", "require", sources[id])(module, module.exports, load);
  return module.exports;
}
const evaluator = load("effector-evaluate.js");
const cache = evaluator.createStageCache();
onmessage = ({data}) => {
  if (data.forgetSourceId !== undefined) { cache.forget(data.forgetSourceId); return; }
  try {
    const value = evaluator.evaluateMesh(data.input, cache);
    const buffers = new Set();
    function visit(item) {
      if (!item || typeof item !== "object") return;
      if (ArrayBuffer.isView(item)) buffers.add(item.buffer);
      else for (const child of Object.values(item)) visit(child);
    }
    visit(value);
    postMessage({id:data.id, value}, Array.from(buffers));
  } catch (error) { postMessage({id:data.id, error:String(error.stack || error)}); }
};`;
}

module.exports = { createMeshJobs, createWorkerSource };
