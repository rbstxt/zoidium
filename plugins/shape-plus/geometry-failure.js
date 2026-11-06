"use strict";
const reported = new Set();
function report(id, error) {
  const message = String(error?.message || error), key = id + ":" + message;
  if (reported.has(key)) return;
  // A malformed animated project must not retain an unbounded warning history.
  if (reported.size >= 256) reported.delete(reported.values().next().value);
  reported.add(key);
  console.warn("Shape+ skipped " + id + ": " + message);
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
    globalThis.dispatchEvent(new CustomEvent("zoidium:notification", { detail: {
      title: "Shape+ could not render",
      message: message + (/budget exceeded/.test(message) ? ". Reduce path complexity or split the content across layers." : ""),
    } }));
  }
}
function paint(id, work) {
  try { return work(); } catch (error) { report(id, error); return []; }
}
module.exports = { report, paint };
