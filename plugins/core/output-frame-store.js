// Finished preview pixels. Entries own RGBA8 GPU storage, never editor state.
(function outputFrameStoreModule(global) {
  "use strict";

  const DEFAULT_BYTES = 512 * 1024 * 1024;
  const MAX_MIB = 2048;

  function sizeMiB(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_MIB, Math.floor(number))) : 512;
  }

  class FrameStore {
    constructor(limit = DEFAULT_BYTES, maxEntries = 512) {
      this.limit = limit;
      this.maxEntries = Math.max(1, Math.min(512, Math.floor(maxEntries) || 512));
      this.bytes = 0;
      this.entries = new Map();
      this.generation = 0;
    }
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
      entry.dispose();
    }
    reserve(bytes) {
      if (!(bytes > 0) || bytes > this.limit) return false;
      while (this.bytes + bytes > this.limit) this.delete(this.entries.keys().next().value);
      return true;
    }
    put(key, entry, generation = this.generation) {
      if (generation !== this.generation || entry.complete !== true) {
        entry.dispose();
        return false;
      }
      this.delete(key);
      if (!this.reserve(entry.bytes)) { entry.dispose(); return false; }
      while (this.entries.size >= this.maxEntries) this.delete(this.entries.keys().next().value);
      this.entries.set(key, entry);
      this.bytes += entry.bytes;
      return true;
    }
    resize(limit) {
      this.limit = Math.max(0, limit);
      this.generation += 1;
      while (this.bytes > this.limit) this.delete(this.entries.keys().next().value);
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
      // Chromium exposes currentTime in whole microseconds after a seek.
      Math.abs(video.currentTime - decoded.requestedTime) <= 1e-6;
  }

  // The full project state that a finished frame depends on. The cache decides
  // when to recompute it (see output-frame-cache.js keyFor()).
  function revisionOf(viewport, plugins, assetId, fontEpoch = 0, approvedPlugins = null) {
    const project = viewport.editor.project;
    const sequence = project.sequence;
    const content = typeof project.toJSON === "function" ? project.toJSON() : project;
    if (approvedPlugins && (content.plugins || []).some(requirement => {
      const current = plugins.find(plugin => plugin.id === requirement.id);
      return !current?.enabled || approvedPlugins.get(requirement.id) !== String(current.version);
    })) return null;
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
      plugins.map(plugin => [plugin.id, plugin.version, plugin.enabled, plugin.phase]), fontEpoch,
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

  const api = { assetCompletion, assetsComplete, decoderComplete, restoreLinkKeys, canonicalJSON, DEFAULT_BYTES, FrameStore, revisionOf, sizeMiB };
  global.ZoidiumOutputFrameStore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
