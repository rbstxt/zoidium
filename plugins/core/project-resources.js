(function installProjectResources(global) {
  "use strict";
  const PZ = global.PZ;
  if (!PZ?.project || PZ.zoidium?.projectResources) return;
  PZ.zoidium = PZ.zoidium || {};
  const states = new WeakMap();
  const editors = new WeakSet();
  const editorRefs = new Set();
  const deferredReleases = new Set();
  const wrapped = new WeakSet();

  function stateFor(project) {
    let state = states.get(project);
    if (!state) {
      state = { pending: 0, owners: new Set(), observed: new WeakSet(), retired: false, queued: false, revoked: new Set() };
      states.set(project, state);
    }
    return state;
  }

  // Only GPU allocations are released. Native/plugin preparation can retain
  // model arrays after a timeout, so retirement never unloads the graph.
  function gpuResources(project) {
    const resources = new Set(), seen = new WeakSet(), targetTextures = new Set();
    const skip = new Set(["parent", "_parent", "editor", "renderer", "context", "canvas", "domElement", "properties", "ui", "assets", "playback"]);
    function visit(value) {
      if (!value || typeof value !== "object" || seen.has(value) || ArrayBuffer.isView(value) ||
          value instanceof ArrayBuffer || (global.Node && value instanceof global.Node) ||
          (global.Blob && value instanceof global.Blob) || (PZ.observable && value instanceof PZ.observable)) return;
      seen.add(value);
      if (value.isWebGLRenderTarget) {
        resources.add(value);
        targetTextures.add(value.texture);
        return;
      }
      if (value.isTexture || value.isGeometry || value.isBufferGeometry) { resources.add(value); return; }
      if (value.isMaterial) resources.add(value);
      for (const key of Object.keys(value)) {
        if (skip.has(key)) continue;
        // Do not follow computed ownership accessors or serialized properties.
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && "value" in descriptor) visit(descriptor.value);
      }
    }
    visit(project);
    for (const texture of targetTextures) resources.delete(texture);
    return resources;
  }

  function objectUrlAssets(project) {
    return Object.values(project?.assets?.list || {}).filter(asset =>
      asset?.file && typeof asset.url === "string" && asset.url.startsWith("blob:"));
  }

  // Native replacement never unloads a project, so its assets keep their
  // object URLs, and each URL keeps its file alive in the browser's blob store
  // for the rest of the session. That memory is outside the JS heap.
  function revokeObjectUrls(project, state, liveUrls) {
    if (typeof global.URL?.revokeObjectURL !== "function") return;
    for (const asset of objectUrlAssets(project)) {
      if (liveUrls.has(asset.url) || state.revoked.has(asset)) continue;
      global.URL.revokeObjectURL(asset.url);
      state.revoked.add(asset);
    }
  }

  function restoreObjectUrls(state) {
    for (const asset of state.revoked) {
      if (asset.file) asset.url = global.URL.createObjectURL(asset.file);
    }
    state.revoked.clear();
  }

  function liveResources() {
    const live = new Set(), liveUrls = new Set();
    let exporting = false;
    for (const ref of editorRefs) {
      const editor = ref.deref();
      if (!editor) { editorRefs.delete(ref); continue; }
      if (editor.enabled === false) exporting = true;
      if (editor.project) {
        for (const resource of gpuResources(editor.project)) live.add(resource);
        for (const asset of objectUrlAssets(editor.project)) liveUrls.add(asset.url);
      }
    }
    return { live, liveUrls, exporting };
  }

  function queueRelease(project, state) {
    if (!state.retired || state.pending || state.owners.size || state.queued) return;
    state.queued = true;
    Promise.resolve().then(() => {
      state.queued = false;
      if (!state.retired || state.pending || state.owners.size) return;
      observeGraph(project);
      if (state.pending) return;
      // Export can still load media after its project leaves the editor.
      const { live, liveUrls, exporting } = liveResources();
      for (const resource of gpuResources(project)) {
        if (live.has(resource)) continue;
        try { resource.dispose(); }
        catch (error) { global.console.warn("[Zoidium] Could not release a retired project's GPU resource.", error); }
      }
      if (exporting) {
        if (!state.releaseRef) {
          state.releaseRef = { project: new WeakRef(project), urls: new Set() };
          deferredReleases.add(state.releaseRef);
        }
        for (const asset of objectUrlAssets(project)) state.releaseRef.urls.add(asset.url);
      } else {
        deferredReleases.delete(state.releaseRef);
        state.releaseRef = null;
        revokeObjectUrls(project, state, liveUrls);
      }
    });
  }

  function observePromise(project, promise, rescan = false) {
    if (!promise || typeof promise.then !== "function") return;
    const state = stateFor(project);
    if (state.observed.has(promise)) return;
    state.observed.add(promise);
    state.pending += 1;
    function settled() {
      // Async factories can install their prepare method and children only
      // after loading. Observe those before dropping the loading reservation.
      if (rescan) observeGraph(project);
      state.pending -= 1;
      queueRelease(project, state);
    }
    Promise.resolve(promise).then(settled, settled);
  }

  function prepare(project, operation) {
    if (!project) return operation();
    const state = stateFor(project);
    state.pending += 1;
    try {
      const result = operation();
      observePromise(project, result);
      return result;
    } finally {
      state.pending -= 1;
      queueRelease(project, state);
    }
  }

  function wrapPrepare(object, project) {
    const original = object.prepare;
    if (typeof original !== "function" || wrapped.has(original)) return;
    const replacement = function () {
      const args = arguments;
      return prepare(project, () => original.apply(this, args));
    };
    wrapped.add(replacement);
    Object.defineProperty(object, "prepare", { configurable: true, writable: true, value: replacement });
  }

  function observeGraph(project) {
    if (!project) return;
    const seen = new WeakSet();
    function visit(object) {
      if (!object || typeof object !== "object" || seen.has(object)) return;
      seen.add(object);
      wrapPrepare(object, project);
      observePromise(project, object.loading, true);
      const children = Array.isArray(object) ? object : object.children;
      for (const child of children || []) visit(child);
    }
    visit(project);
    observePromise(project, project._zoidiumPluginActivationPending, true);
  }

  function retire(project) {
    if (!project) return;
    const state = stateFor(project);
    state.retired = true;
    observeGraph(project);
    queueRelease(project, state);
  }

  function observeEditor(editor) {
    if (!editor?.onProjectChanged || editors.has(editor)) return;
    editors.add(editor);
    editorRefs.add(new WeakRef(editor));
    // The native export pages return editor.enabled on completion or cancel.
    // Keep only weak references while waiting, so this retry cannot pin a project.
    editor.onEnabledChanged?.watch(() => {
      if (!deferredReleases.size) return;
      const { liveUrls, exporting } = liveResources();
      for (const entry of deferredReleases) {
        const project = entry.project.deref();
        if (project) queueRelease(project, stateFor(project));
        else if (!exporting) {
          // Blob URLs outlive the JS graph. Retain their strings so collection
          // cannot erase the only record needed for eventual revocation.
          for (const url of entry.urls) if (!liveUrls.has(url)) global.URL?.revokeObjectURL?.(url);
          deferredReleases.delete(entry);
        }
      }
    });
    let previous = editor.project;
    if (previous) { stateFor(previous).owners.add(editor); observeGraph(previous); }
    editor.onProjectChanged.watch(() => {
      const current = editor.project;
      if (current === previous) return;
      const old = previous;
      previous = current;
      if (current) {
        const state = stateFor(current);
        state.owners.add(editor);
        state.retired = false;
        deferredReleases.delete(state.releaseRef);
        state.releaseRef = null;
        restoreObjectUrls(state);
        observeGraph(current);
      }
      if (old) { stateFor(old).owners.delete(editor); retire(old); }
    });
  }

  // Schedule.prepare is also called directly by temporal and frame-cache
  // preparation. Its context identifies private snapshots without depending
  // on the currently visible editor project.
  const schedule = PZ.schedule?.prototype;
  if (typeof schedule?.prepare === "function") {
    const original = schedule.prepare;
    schedule.prepare = function (frame, context) {
      const sequence = context?.sequence;
      const project = sequence?.parentProject || this.currentItem?.clip?.parentProject || this.items?.[0]?.clip?.parentProject;
      const args = arguments;
      return prepare(project, () => original.apply(this, args));
    };
  }
  const originalLoad = PZ.project.prototype.load;
  PZ.project.prototype.load = function () {
    const result = originalLoad.apply(this, arguments);
    observeGraph(this);
    return result;
  };
  PZ.zoidium.projectResources = { prepare, observeGraph, observeEditor, retire };
})(typeof window !== "undefined" ? window : globalThis);
