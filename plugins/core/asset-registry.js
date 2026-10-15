(function (global) {
  "use strict";
  if (global.ZoidiumAssets) return;
  const PZ = global.PZ, parts = global.ZoidiumAssetRegistryParts;
  const { collectProperties, walkStored, addressOf } = parts.walk;
  const signalKeys = ["onChanged", "onListChanged", "onKeyframeCreated", "onKeyframeDeleted", "onKeyframeMoved", "onKeyframeChanged", "onExpressionChanged", "onAnimatedChanged"];
  const adapters = new Map(), states = new Map(), listeners = new Map();
  const usageRecords = new WeakMap();
  let revision = 0, frame = 0, scheduled = null, disposed = false;
  const request = fn => global.requestAnimationFrame(fn);
  function schedule(unlock = false) {
    if (disposed || (!unlock && !listeners.size) || scheduled !== null) return;
    scheduled = request(() => {
      scheduled = null;
      frame += 1;
      if (!listeners.size) return;
      const current = snapshot();
      for (const [listener, published] of listeners) {
        if (published === current.revision) continue;
        listeners.set(listener, current.revision);
        try { listener(current); } catch (error) { global.console?.error("[Zoidium] Asset registry listener failed.", error); }
      }
    });
  }
  function dirty(state) { if (disposed) return; state.dirty = true; schedule(); }
  function observe(state, observable) {
    if (!observable?.watch || !observable?.unwatch) return;
    let record = state.hooks.get(observable);
    if (!record) {
      observable.watch(state.onChange);
      state.hooks.set(observable, record = { scan: state.scan });
    }
    record.scan = state.scan;
  }
  function observeNode(state, node) {
    // Native edits to other property types are already reported by project UI
    // at operation finish, including undo/redo. Direct reference and text/name
    // writes also need their own signals, including plugin graph/IES payloads.
    if (node.definition && node.definition.type !== (PZ.property?.type?.ASSET ?? 8) &&
        node.definition.type !== (PZ.property?.type?.TEXT ?? 7)) return;
    let observables = state.nodeHooks.get(node);
    if (!observables) {
      observables = [];
      for (const key of signalKeys) if (node[key]?.watch && node[key]?.unwatch) observables.push(node[key]);
      state.nodeHooks.set(node, observables);
    }
    for (const observable of observables) observe(state, observable);
  }
  function stateOf(editor) {
    let state = states.get(editor);
    if (!state) {
      state = { editor, project: null, dirty: true, builtFrame: -1, snapshot: null,
        scan: 0, hooks: new Map(), nodeHooks: new WeakMap(), precomp: null, stopPrecomp: null };
      state.status = parts.createStatus(PZ, () => dirty(state));
      state.onChange = () => dirty(state);
      states.set(editor, state);
    }
    if (state.project !== editor?.project) { state.project = editor?.project; state.dirty = true; }
    if (state.precomp !== PZ.precomp) state.dirty = true;
    return state;
  }
  function readableName(asset, key, source) {
    if (source === "file" && asset?.filename) return asset.filename;
    if (source === "plugin") return asset?.filename || "Plugin image";
    const last = String(asset?.url || key).split(/[?#]/)[0].split("/").pop();
    try { return decodeURIComponent(last).replace(/\.[^.]+$/, "") || key; } catch (_error) { return last || key; }
  }
  function rebuild(state) {
    const project = state.project, editor = state.editor;
    state.dirty = false;
    state.builtFrame = frame;
    state.scan += 1;
    observe(state, editor?.onProjectChanged);
    observe(state, editor?.onSequenceChanged);
    observe(state, project?.ui?.onChanged);
    observe(state, project?.assets?.onAssetCreated);
    observe(state, project?.assets?.onAssetRemoved);
    observeNode(state, project?.media || {});
    const precomp = PZ.precomp;
    if (state.precomp !== precomp) {
      state.stopPrecomp?.();
      state.precomp = precomp;
      state.stopPrecomp = precomp?.subscribe?.(() => dirty(state));
    }
    const items = new Map(), list = project?.assets?.list || {};
    const images = new Set();
    for (const [key, asset] of Object.entries(list)) {
      const status = state.status.inspect(asset);
      const item = { id: key, key, ...status, name: readableName(asset, key, status.source),
        size: asset.file?.size ?? (asset.size > 0 ? asset.size : null), mime: asset.file?.type || null,
        url: asset.url || null, inMedia: false, usages: [] };
      Object.defineProperty(item, "asset", { value: asset, enumerable: false });
      items.set(key, item);
      for (const data of asset.data?.values?.() || []) if (data?.image) images.add(data.image);
    }
    state.status.prune(images);
    const entries = project ? precomp?.entries?.(editor) || [] : [];
    for (const entry of entries) {
      // Like AE, the open root timeline is the project itself, not an item.
      if (entry.isMain) continue;
      items.set("comp:" + entry.id, { id: "comp:" + entry.id, key: null, kind: "composition", name: entry.name,
        source: "composition", status: "ready", error: null, size: null, mime: null, url: null,
        info: { frames: entry.length }, inMedia: !entry.isMain, usages: [] });
    }
    const owners = new WeakMap();
    function emit(reference, plugin = null) {
      const key = reference.key;
      if (typeof key !== "string" || !key) return;
      let item = items.get(key);
      if (!item) {
        if (reference.item) {
          item = { id: key, key: null, kind: "file", source: "embedded", name: key, status: "ready", error: null,
            size: null, mime: null, url: null, info: {}, inMedia: false, usages: [], ...reference.item };
        } else {
          const status = state.status.inspect(null, reference);
          item = { id: key, key, ...status, name: key, size: null, mime: null, url: null, inMedia: false, usages: [] };
        }
        items.set(key, item);
      }
      if (item.kind === "file" && list[key]) item.kind = state.status.inspect(list[key], reference).kind;
      const context = reference.owner && owners.get(reference.owner);
      const path = reference.path || context?.path || [item.name];
      const address = reference.address || null;
      const composition = reference.composition || null;
      const usage = { id: key + ":" + item.usages.length, path: Array.from(path), composition,
        kind: reference.kind || (plugin ? "plugin" : "property"), frame: reference.frame ?? null,
        plugin, address, revealable: !composition && reference.revealable !== false && !!(reference.owner || address) };
      item.usages.push(usage);
      usageRecords.set(usage, { ...reference, ...usage, clip: reference.clip || context?.clip,
        property: reference.property, editor, project });
      const lutError = reference.owner?._looksCubeError;
      if (lutError && /lut/i.test(reference.propertyName || "")) { item.status = "failed"; item.error = String(lutError); }
    }
    if (project?.sequence) {
      collectProperties(project, PZ, emit, node => observeNode(state, node), entry => {
        if (!entry.property) owners.set(entry.node, entry);
        if (!entry.property && entry.node.type === 2 && entry.node.compId) {
          emit({ key: "comp:" + entry.node.compId, ...entry, kind: "composition", address: addressOf(entry.node), revealable: true });
        }
      });
      for (const media of project.media || []) {
        observeNode(state, media.properties?.name || {});
        for (const asset of media.assets || []) {
          const key = typeof asset === "string" ? asset : asset.key;
          if (items.has(key)) items.get(key).inMedia = true;
        }
      }
      for (const source of precomp?.referenceSources?.(editor) || []) {
        if (source.editing) continue;
        const composition = { id: source.id, name: source.name };
        walkStored(source.tracks, new Set(Object.keys(list)), emit, composition, ['Comp "' + source.name + '"']);
      }
      for (const adapter of adapters.values()) {
        try { adapter.collect(project, ref => emit(ref, adapter.id)); }
        catch (error) { global.console?.error("[Zoidium] Asset reference adapter failed: " + adapter.id, error); }
      }
    }
    for (const [observable, record] of state.hooks) if (record.scan !== state.scan) {
      observable.unwatch(state.onChange); state.hooks.delete(observable);
    }
    // Built-in and plugin files are listed only while something uses them;
    // unused ones are internal dependencies (shader presets, decoders), not
    // items the user imported.
    const array = Array.from(items.values()).filter(item => item.usages.length || item.inMedia ||
      (item.source !== "preset" && item.source !== "plugin"));
    for (const item of array) if (!Object.prototype.hasOwnProperty.call(item, "asset")) {
      Object.defineProperty(item, "asset", { value: null, enumerable: false });
    }
    for (const item of array) actions?.decorate(item, project);
    const used = array.filter(item => item.usages.length).length;
    const problems = array.filter(item => (item.status === "failed" || item.status === "missing") &&
      (item.usages.length || (item.status === "missing" && item.source === "file"))).length;
    state.snapshot = { revision: ++revision, items: array, counts: { all: array.length, used, unused: array.length - used, problems } };
    // One bounded callback releases this frame's cache. It never polls or
    // rebuilds an idle registry, including when there are no subscribers.
    schedule(true);
    return state.snapshot;
  }
  function snapshot(editor = global.CM) {
    const state = stateOf(editor);
    return !state.snapshot || (state.dirty && state.builtFrame !== frame) ? rebuild(state) : state.snapshot;
  }
  function invalidate() { for (const state of states.values()) state.dirty = true; schedule(); }
  function refresh() {
    for (const state of states.values()) { state.dirty = true; state.builtFrame = -1; }
    schedule();
  }
  function registerReferences(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id || typeof adapter.collect !== "function") throw new TypeError("Asset adapters require an id and collect(project, emit).");
    if (adapters.has(adapter.id)) throw new Error("Asset adapter already registered: " + adapter.id);
    adapters.set(adapter.id, adapter); invalidate();
    return () => { if (adapters.get(adapter.id) === adapter) { adapters.delete(adapter.id); invalidate(); } };
  }
  const decoder = parts.createDecoder?.(PZ, invalidate);
  const actions = parts.createActions?.({ PZ, snapshot, refresh, adapters, usageRecords, decoder });
  const api = { snapshot, refresh, registerReferences,
    capabilities: actions?.capabilities, reload: actions?.reload, locate: actions?.locate,
    exportFile: actions?.exportFile, registerReloader: actions?.registerReloader,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Asset listeners must be functions.");
      snapshot(); listeners.set(listener, -1); schedule();
      return () => { listeners.delete(listener); };
    },
    reveal(usage) {
      const record = usageRecords.get(usage);
      if (!record || record.project !== record.editor?.project) return false;
      return parts.reveal(record, record.editor);
    },
  };
  // Pre-init core scripts have application lifetime. The explicit cleanup also
  // lets embedders/tests dispose every observer without changing CM3 methods.
  Object.defineProperty(api, "dispose", { value() {
    disposed = true;
    if (scheduled !== null) global.cancelAnimationFrame(scheduled);
    global.removeEventListener?.("zoidium:ready", invalidate);
    global.removeEventListener?.("zoidium:asset-status", invalidate);
    for (const state of states.values()) {
      state.hooks.forEach((_record, observable) => observable.unwatch(state.onChange));
      state.stopPrecomp?.(); state.status.dispose();
    }
    actions?.dispose(); decoder?.dispose();
    states.clear(); adapters.clear(); listeners.clear();
    if (global.ZoidiumAssets === api) delete global.ZoidiumAssets;
    if (global.ZoidiumPluginApis?.assets === api) delete global.ZoidiumPluginApis.assets;
  } });
  global.addEventListener?.("zoidium:ready", invalidate);
  global.addEventListener?.("zoidium:asset-status", invalidate);
  global.ZoidiumAssets = api;
  if (global.ZoidiumPluginApis) global.ZoidiumPluginApis.assets = api;
})(globalThis);
