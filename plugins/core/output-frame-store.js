// Finished preview pixels. Entries own RGBA8 GPU storage, never editor state.
(function outputFrameStoreModule(global) {
  "use strict";

  const DEFAULT_BYTES = 512 * 1024 * 1024;
  const MAX_MIB = 16384;
  const MAX_ENTRIES = 8192;

  function sizeMiB(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_MIB, Math.floor(number))) : 512;
  }

  class FrameStore {
    constructor(limit = DEFAULT_BYTES, maxEntries = MAX_ENTRIES) {
      this.limit = limit;
      this.maxEntries = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(maxEntries) || MAX_ENTRIES));
      this.ceiling = Infinity;
      this.contextLost = false;
      this.contextLosses = 0;
      this.bytes = 0;
      this.entries = new Map();
      this.generation = 0;
    }
    get effectiveLimit() { return this.contextLost ? 0 : Math.min(this.limit, this.ceiling); }
    get(key) {
      const entry = this.entries.get(key);
      if (entry) {
        this.entries.delete(key);
        this.entries.set(key, entry);
      }
      return entry;
    }
    delete(key) {
      const entry = this.entries.get(key);
      if (!entry) return;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      if (!this.contextLost) entry.dispose();
    }
    reserve(bytes) { return Boolean(this.take(bytes)); }
    take(bytes, matches) {
      if (!(bytes > 0) || bytes > this.effectiveLimit) return null;
      let recycled = null;
      while (this.bytes + bytes > this.effectiveLimit || this.entries.size >= this.maxEntries) {
        const key = this.entries.keys().next().value;
        const entry = this.entries.get(key);
        if (!recycled && matches?.(entry)) {
          // Remove ownership before overwriting. No key may display these pixels
          // until the caller completes a fresh full-frame copy and put().
          this.entries.delete(key);
          this.bytes -= entry.bytes;
          entry.complete = false;
          recycled = entry;
        } else this.delete(key);
      }
      return { recycled };
    }
    put(key, entry, generation = this.generation) {
      if (generation !== this.generation || entry.complete !== true) {
        if (!this.contextLost) entry.dispose();
        return false;
      }
      this.delete(key);
      if (!this.reserve(entry.bytes)) { if (!this.contextLost) entry.dispose(); return false; }
      while (this.entries.size >= this.maxEntries) this.delete(this.entries.keys().next().value);
      this.entries.set(key, entry);
      this.bytes += entry.bytes;
      return true;
    }
    resize(limit) {
      this.limit = Math.max(0, limit);
      this.generation += 1;
      this.trim();
    }
    trim() {
      while (this.bytes > this.effectiveLimit) this.delete(this.entries.keys().next().value);
    }
    memoryPressure() {
      const usage = this.bytes;
      this.ceiling = Math.min(this.ceiling, Math.floor(usage * 0.9));
      this.generation += 1;
      this.trim();
      return usage;
    }
    loseContext() {
      if (this.contextLost) return;
      this.contextLosses += 1;
      // Allow one conservative recovery. A second loss disables optional
      // captures for this session rather than repeatedly risking the renderer.
      this.ceiling = this.contextLosses > 1 ? 0 : Math.min(this.ceiling, Math.floor(this.bytes / 2));
      this.contextLost = true;
      this.clear();
    }
    restoreContext() {
      this.contextLost = false;
    }
    clear() {
      this.generation += 1;
      for (const key of this.entries.keys()) this.delete(key);
    }
  }

  function assetCompletion(asset, identity) {
    return Array.from(asset.data?.values?.() || [], data => {
      if (!data || typeof data !== "object") return null;
      const image = data.image || data.el;
      const img = image?.tagName === "IMG" ? image : null;
      return [data.zoidiumAssetRevision || 0, data.zoidiumDecodeError, data.zoidiumFont3dState, data.zoidiumFont3dError?.message,
        identity(data.font3d), identity(data.font2d),
        img ? [identity(img), img.complete, img.naturalWidth, img.naturalHeight] : null];
    });
  }

  function assetsComplete(project) {
    return Object.values(project.assets?.list || {}).every(asset =>
      // Media-only holds and the editor's retention pin store footage; they
      // do not make its decoder a dependency of this rendered frame.
      (global.ZoidiumAssets?.renderNeeded ? !global.ZoidiumAssets.renderNeeded(asset, project) : asset.references === 0) ||
      Array.from(asset.data?.values?.() || []).every(data => {
        if (!data || typeof data !== "object") return true;
        if (data.zoidiumDecodeError) return false;
        if (data.zoidiumFont3dState === "loading" || data.zoidiumFont3dState === "failed") return false;
        const image = data.image || data.el;
        return image?.tagName !== "IMG" || (image.complete === true && image.naturalWidth > 0);
      }));
  }

  function decoderComplete(schedule) {
    const item = schedule.currentItem, video = schedule.el;
    if (!video || !item?.media || schedule.lastFrame < item.start) return true;
    const decoded = schedule.__zoidiumVideoExportState;
    return video.paused === true && !video.seeking && video.readyState >= 2 &&
      !!decoded && decoded.sourceId === (video.currentSrc || video.src || "") &&
      // Compare with the clock value accepted by the decoder after the seek.
      // It may be rounded differently from the requested time.
      Math.abs(video.currentTime - decoded.observedTime) <= 1e-7;
  }

  function videoPrefetchBlocked(sequence, frame, temporalSampling) {
    return (sequence.videoSchedules || []).some(schedule => (schedule.items || []).some(item => {
      if (!item?.media) return false;
      // No private decoder may start, including schedule.update()'s padded
      // preload. Temporal taps and multisample blur can cross these bounds.
      if (temporalSampling || sequence.properties?.motionBlur?.get?.()) return true;
      const { start, length } = item, { padding } = schedule;
      if (![start, length, padding].every(Number.isFinite) || length < 0 || padding < 0) return true;
      return frame >= start - padding && frame < start + length;
    }));
  }

  // The full project state that a finished frame depends on. The cache decides
  // when to recompute it (see output-frame-cache.js keyFor()).
  function containsCommunity(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (typeof value.type === "string" && value.type.startsWith("community-")) return true;
    return Object.values(value).some(child => containsCommunity(child, seen));
  }

  function revisionOf(viewport, plugins, assetId, fontEpoch = 0, approvedPlugins = null, onReject = () => {}) {
    const project = viewport.editor.project;
    const sequence = project.sequence;
    const content = typeof project.toJSON === "function" ? project.toJSON() : project;
    const required = new Set((content.plugins || []).map(plugin => plugin.id));
    // A failed bundle fetch cannot have patched rendering. Once registration
    // started, an unrelated error still blocks: rollback is not proof that
    // every global patch was restored. Core scripts run before registration.
    if (plugins.some(plugin => plugin.lastError && (required.has(plugin.id) ||
        plugin.activationStarted !== false || plugin.enabled || plugin.kind === "core" || plugin.id === "core"))) {
      onReject("Plugins are loading or have errors");
      return null;
    }
    // Isolated receipts have their own exact preparation contract. Finished
    // frame caching and private prefetch clones have no approval for them.
    if (containsCommunity(content)) {
      onReject("Community content is not verified for preview caching");
      return null;
    }
    for (const requirement of approvedPlugins ? content.plugins || [] : []) {
      const current = plugins.find(plugin => plugin.id === requirement.id);
      if (!current?.enabled || approvedPlugins.get(requirement.id) !== String(current.version)) {
        onReject("Plugin " + requirement.id + (current ? " version " + current.version : "") +
          " is not verified for preview caching");
        return null;
      }
    }
    const gl = viewport.renderer.context;
    return JSON.stringify([
      content,
      sequence.videoTracks.map(track => track.enabled),
      Object.entries(project.assets.list).map(([id, asset]) =>
        [id, assetId(asset), assetId(asset.file), asset.url, asset.sha256, asset.size, asset.filename,
          assetCompletion(asset, assetId)]),
      gl.drawingBufferWidth, gl.drawingBufferHeight,
      viewport.compositor.__zoidiumRenderSettings || null,
      viewport.renderer.shadowMap.enabled, viewport.renderer.shadowMap.type,
      viewport.renderer.gammaInput, viewport.renderer.gammaOutput,
      viewport.renderer.toneMapping, viewport.renderer.toneMappingExposure,
      plugins.map(plugin => [plugin.id, plugin.version, plugin.enabled, plugin.phase,
        plugin.activationStarted, !!plugin.lastError]), fontEpoch,
    ]);
  }

  function restoreLinkKeys(source, target) {
    // CM3 rebuilds link keys from Object.keys(), which coerces freshly created
    // numeric keys to strings. Preserve the source representation in the clone.
    for (const [id, link] of Object.entries(source.clipLinks?.links || {})) {
      if (target.clipLinks?.links[id]) target.clipLinks.links[id].key = link.key;
    }
  }

  function canonicalJSON(value) {
    const sort = item => {
      if (Array.isArray(item)) return item.map(sort);
      if (!item || typeof item !== "object") return item;
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
    };
    return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
  }

  const api = { assetCompletion, assetsComplete, decoderComplete, videoPrefetchBlocked, restoreLinkKeys, canonicalJSON,
    DEFAULT_BYTES, MAX_MIB, MAX_ENTRIES, FrameStore, revisionOf, sizeMiB };
  global.ZoidiumOutputFrameStore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
