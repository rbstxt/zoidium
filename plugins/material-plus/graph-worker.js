"use strict";

// Node graph worker source: builds a self-contained Web Worker that evaluates
// graphs off the main thread. `files` maps module ids ("graph-buffers.js")
// to their sources; the entry id is graph-runtime.js. The worker carries a
// small require shim that resolves the sibling names in the same bundle,
// mirroring the shared bundle module loader.
const GRAPH_MODULES = [
  "graph-buffers.js",
  "graph-spectra.js",
  "graph-images.js",
  "graph-types.js",
  "graph-runtime.js",
];

function createGraphWorkerSource(files) {
  for (const name of GRAPH_MODULES) {
    if (typeof files[name] !== "string") {
      throw new Error("Material+ graph worker is missing its bundled source: " + name);
    }
  }
  return ZoidiumPluginApis.color.workerSource() + '"use strict";const sources=' + JSON.stringify(files) + `;
const modules = new Map();
function load(id) {
  id = String(id).replace(/^\\.\\//, "");
  if (modules.has(id)) return modules.get(id).exports;
  const module = {exports:{}}; modules.set(id, module);
  new Function("module", "exports", "require", sources[id])(module, module.exports, load);
  return module.exports;
}
const nodes = load("graph-runtime.js")({}, null);
const reportedErrors = new Set();
onmessage = e => { const {id,graph,size,time,images}=e.data; try { const started=performance.now(); const outputs=nodes.evaluate(graph,size,time,{images}); postMessage({id,outputs,duration:performance.now()-started}, [...new Set(Object.values(outputs).filter(p => ArrayBuffer.isView(p)).map(p => p.buffer))]); } catch(error) {
  if (!reportedErrors.has(error.message)) {
    reportedErrors.add(error.message);
    console.warn("[Zoidium] Material+ graph worker: evaluation failed", error);
  }
  postMessage({id,error:error.message});
} };`;
}

module.exports = { GRAPH_MODULES, createGraphWorkerSource };
