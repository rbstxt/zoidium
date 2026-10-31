"use strict";
const { createCache, layoutKey } = require("./text-cache.js");
const { createLoader, openAsset } = require("./text-engine.js");
const textGeometry = require("./text-geometry.js");
const { coverageStats } = require("./text-shaping.js");
const { axes, holdValue } = require("./text-properties.js");
const { layoutText, contoursStats } = require("./text-layout.js");
function createService(context) {
  const PZ = context.PZ || window.PZ, load = createLoader(context.getAsset), records = new Map();
  const { resolveStaticRef, resolveVariableRef } = require("./preset-variables.js");
  const layouts = createCache(8 * 1024 * 1024);
  function releaseEntry(record, entry) {
    entry.alive = false;
    entry.font?.dispose();
    if (entry.asset) {
      // Preset assets are created by the native font control. Collecting one
      // during a render emits an editor history event outside an operation.
      // Release our reference without triggering that unrelated deletion.
      if (entry.asset.source !== PZ.asset.source.FILE && typeof entry.asset.references === "number") entry.asset.references--;
      else record.project.assets.unload(entry.asset);
    }
  }
  function release(node) {
    const record = records.get(node);
    if (!record) return;
    records.delete(node); record.alive = false;
    for (const entry of record.cache.values()) releaseEntry(record, entry);
  }
  function prepare(node, frame = node.textFrame || 0) {
    const project = node.tryGetParentOfType?.(PZ.project);
    if (!project) return Promise.resolve();
    const properties = [node.properties.font, node.properties.fallbackFont];
    const refs = properties.map(property => holdValue(property, frame));
    let record = records.get(node);
    if (record && record.project !== project) { release(node); record = null; }
    if (!record) {
      record = { project, alive: true, cache: new Map(), generation: 0 };
      records.set(node, record); node.textState = record;
    }
    const used = new Set(refs.filter(Boolean));
    for (const property of properties) for (const key of property.keyframes || property.data?.keyframes || [])
      if (key.value) used.add(key.value);
    for (const [ref, entry] of record.cache) {
      if (!used.has(ref) || entry.asset?.file !== entry.file) {
        record.cache.delete(ref); releaseEntry(record, entry);
      }
    }
    const signature = JSON.stringify(refs);
    if (record.signature === signature && record.activeEntries?.every(entry => entry.alive)) return record.pending;
    record.signature = signature; record.state = "loading"; record.message = "Loading text font";
    const generation = ++record.generation;
    const getEntry = ref => {
      let entry = record.cache.get(ref);
      if (entry) return entry;
      // Built-in presets served at /assets/fonts/2d/<name>.ttf are host-safe
      // static instances. Shape+ loads the variable twin from
      // /assets/fonts/2d-variable/ (preset-variables.js) so axes keep working;
      // keys and the cache stay on the original reference.
      const loadRef = resolveVariableRef(ref);
      entry = { alive: true, asset: project.assets.load(loadRef), font: null };
      entry.file = entry.asset.file; record.cache.set(ref, entry);
      entry.pending = (async () => {
        const engine = await load();
        if (!entry.alive) return;
        record.cacheStats = () => ({ ...engine.stats(), layouts: layouts.stats(), contours: contoursStats(), runCaches: coverageStats(), geometry: textGeometry.stats() });
        const open = async (asset, target) => asset.source === PZ.asset.source.FILE && !asset.file
          ? { state: "missing", message: "The text font is missing from the project." } : openAsset(engine, new PZ.asset.font(asset), target);
        let result = await open(entry.asset, loadRef);
        const staticRef = resolveStaticRef(loadRef);
        if (result.state !== "ready" && staticRef !== loadRef && entry.alive) {
          // The variable twin failed to load (stale stage, bad cache): use the
          // static preset and note it on the record.
          releaseEntry(record, { asset: entry.asset });
          entry.asset = project.assets.load(staticRef); entry.file = entry.asset.file;
          entry.variableFallback = record.variableFallback = true;
          result = await open(entry.asset, staticRef);
        }
        if (!entry.alive) { result.font?.dispose(); return; }
        Object.assign(entry, result);
      })();
      return entry;
    };
    const entries = refs.map(ref => ref ? getEntry(ref) : null);
    record.activeEntries = entries.filter(Boolean);
    record.pending = (async () => {
      if (!entries[0]) { record.state = "missing"; record.message = "The text font is missing from the project."; return; }
      await Promise.all(entries.filter(Boolean).map(entry => entry.pending));
      if (!record.alive || generation !== record.generation) return;
      const failed = entries.filter(Boolean).find(entry => entry.state !== "ready");
      if (failed) { record.state = failed.state; record.message = failed.message; return; }
      record.primary = entries[0].font; record.fallback = entries[1]?.font;
      axes(PZ, node, record.primary);
      record.state = "ready"; record.message = "";
    })().catch(error => { if (record.alive && generation === record.generation) { record.state = "error"; record.message = error.message; } });
    return record.pending;
  }
  function evaluate(node, properties, frame) {
    prepare(node, frame);
    const record = records.get(node);
    if (record?.state !== "ready") return { glyphs: [], rows: [] };
    const instance = node.properties.fontStyle.animated && record.primary.instances.find(instance => instance.name === properties.fontStyle);
    if (instance) for (const [tag, value] of Object.entries(instance.coordinates))
      if (!node.properties["axis_" + tag]?.animated) properties["axis_" + tag] = value;
    const key = layoutKey(record.primary, record.fallback, properties);
    const cached = layouts.get(key);
    if (cached) return cached;
    const result = layoutText(record.primary, record.fallback, properties);
    Object.defineProperty(result, "cacheKey", { value: key });
    const vertices = result.glyphs.reduce((n,g)=>n+g.paths.reduce((sum,path)=>sum+path.vertices.length,0),0);
    return layouts.set(key, result, 256 + result.glyphs.length*512 + vertices*256 + result.rows.length*256);
  }
  context.lifecycle.onDispose(() => { for (const node of records.keys()) release(node); layouts.clear(); textGeometry.clear(); });
  // Variable-axis offset properties follow the primary fonts of the texts
  // above the animator in its own list (union, first text first), including
  // texts in nested groups above it. Inactive channels are preserved like
  // text axisStore so they survive font switches and save/load.
  function prepareAnimator(node) {
    const list = node.parent && Array.from(node.parent);
    if (!Array.isArray(list)) return Promise.resolve();
    const above = list.slice(0, list.indexOf(node));
    const fonts = [];
    const collect = items => {
      for (const child of items || []) {
        if (child.kind === "text") { const font = records.get(child)?.primary; if (font && !fonts.includes(font)) fonts.push(font); }
        else if (child.contents) collect(child.contents);
      }
    };
    collect(above);
    const { animatorAxes } = require("./text-animator-properties.js");
    if (fonts.length) animatorAxes(PZ, node, fonts);
    return Promise.resolve();
  }
  return { prepare, evaluate, release, prepareAnimator };
}
module.exports = { createService };
