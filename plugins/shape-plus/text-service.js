"use strict";
const { createLoader, openAsset } = require("./text-engine.js");
const { axes } = require("./text-properties.js");
const { layoutText } = require("./text-layout.js");
function createService(context) {
  const PZ = context.PZ || window.PZ, load = createLoader(context.getAsset), records = new Map();
  function release(node) {
    const record = records.get(node);
    if (!record) return;
    records.delete(node); record.alive = false;
    for (const entry of record.entries) { entry.font?.dispose(); if (entry.asset) record.project.assets.unload(entry.asset); }
  }
  function prepare(node) {
    const project = node.tryGetParentOfType?.(PZ.project);
    if (!project) return Promise.resolve();
    const refs = [node.properties.font.get(), node.properties.fallbackFont.get()];
    const signature = JSON.stringify(refs), previous = records.get(node);
    if (previous?.project === project && previous.signature === signature && previous.entries.every(entry => entry.file === entry.asset.file)) return previous.pending;
    release(node);
    const record = { project, signature, alive: true, entries: [], state: "loading", message: "Loading text font" };
    records.set(node, record); node.textState = record;
    record.pending = (async () => {
      const engine = await load();
      if (!record.alive) return;
      for (const [index, ref] of refs.entries()) {
        if (!ref && index === 1) continue;
        if (!ref) { record.state = "missing"; record.message = "The text font is missing from the project."; return; }
        const entry = { asset: project.assets.load(ref), font: null }; entry.file = entry.asset.file; record.entries.push(entry);
        const wrapper = new PZ.asset.font(entry.asset);
        const result = entry.asset.source === PZ.asset.source.FILE && !entry.asset.file
          ? { state: "missing", message: "The text font is missing from the project." } : await openAsset(engine, wrapper, ref);
        if (!record.alive) { result.font?.dispose(); return; }
        if (result.state !== "ready") { record.state = result.state; record.message = result.message; return; }
        entry.font = result.font;
      }
      if (!record.alive) return;
      record.primary = record.entries[0].font; record.fallback = record.entries[1]?.font;
      axes(PZ, node, record.primary);
      record.state = "ready"; record.message = "";
    })().catch(error => { if (record.alive) { record.state = "error"; record.message = error.message; } });
    return record.pending;
  }
  function evaluate(node, properties) {
    prepare(node);
    const record = records.get(node);
    if (record?.state !== "ready") return { glyphs: [], rows: [] };
    return layoutText(record.primary, record.fallback, properties);
  }
  context.lifecycle.onDispose(() => { for (const node of records.keys()) release(node); });
  return { prepare, evaluate, release };
}
module.exports = { createService };
