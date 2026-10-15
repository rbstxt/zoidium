(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.createActions = function ({ PZ, snapshot, refresh, adapters, usageRecords, decoder }) {
    const reloaders = new Map(), pending = new WeakMap(), adapterStates = new WeakMap();
    let alive = true;
    function lookup(id) { refresh(); return snapshot().items.find(item => item.id === id); }
    function references(item) { return (item.usages || []).map(usage => usageRecords.get(usage)).filter(Boolean); }
    function hooks(item) { return new Set((item.usages || []).map(usage => adapters.get(usage.plugin)).filter(adapter => typeof adapter?.reload === "function")); }
    function embeddedText(item) { return references(item).find(ref => typeof ref.bytes === "string")?.bytes; }
    function capabilities(item) {
      const asset = item?.asset;
      return { reload: !!item && (!!asset && ["font", "image", "video", "audio", "geometry", "lut", "shader"].includes(item.kind) || hooks(item).size > 0),
        locate: !!asset && item.source === "file" && item.status === "missing" && asset.source === (PZ.asset.source.FILE ?? 1),
        exportFile: !!asset?.file || typeof embeddedText(item || { usages: [] }) === "string" || !!asset?.url && (item.source === "preset" || item.source === "plugin") };
    }
    function state(asset, status, error = null, id) {
      if (!asset) {
        const project = global.CM?.project;
        if (project) {
          if (!adapterStates.has(project)) adapterStates.set(project, new Map());
          adapterStates.get(project).set(id, { status, error });
        }
        refresh(); return;
      }
      Object.defineProperty(asset, "zoidiumRecovery", { value: { status, error }, configurable: true });
      parts.fetch.changed(asset); refresh();
    }
    async function recover(item) {
      const project = global.CM?.project, asset = item.asset;
      if (asset && item.source === "file" && !asset.file && !asset.external) throw new Error("The file is missing from the project.");
      state(asset, "loading", null, item.id);
      if (asset) await decoder.reload(asset, item.kind);
      if (!alive || global.CM?.project !== project) throw new Error("The project changed while loading the asset.");
      const jobs = [];
      for (const hook of hooks(item)) jobs.push(hook.reload(item.key || item.id, asset));
      if (asset) for (const reloader of reloaders.values()) jobs.push(reloader.reload(item.key, asset));
      await Promise.all(jobs);
      if (asset) await parts.rebuildConsumers?.(PZ, project, asset, item.kind);
      state(asset, null, null, item.id);
      parts.fetch.changed(asset);
      refresh();
      const current = snapshot().items.find(value => value.id === item.id);
      if (current?.status === "failed" || current?.status === "missing") throw new Error(current.error || "Asset loading failed.");
      state(asset, "ready", null, item.id);
      return { ok: true, status: "ready", error: null };
    }
    function reload(id) {
      const item = lookup(id);
      if (!item || !capabilities(item).reload) return Promise.resolve({ ok: false, status: item?.status || "unknown", error: "This item cannot be reloaded." });
      const key = item.asset || item;
      if (pending.has(key)) return pending.get(key);
      const operation = recover(item).catch(error => {
        state(item.asset, "failed", error?.message || String(error), item.id);
        refresh();
        return { ok: false, status: snapshot().items.find(value => value.id === id)?.status || "failed", error: error?.message || String(error) };
      }).finally(() => { pending.delete(key); refresh(); });
      pending.set(key, operation);
      return operation;
    }
    async function locate(id, file) {
      const item = lookup(id), project = global.CM?.project;
      if (!item || !capabilities(item).locate) return { ok: false, reason: "not-missing", error: null };
      try {
        // Hash first. Native locate only mutates the matching placeholder.
        const key = await PZ.asset.hash(file);
        if (key !== item.key) return { ok: false, reason: "different", error: null };
        if (global.CM?.project !== project || project.assets.list[item.key] !== item.asset || item.asset.file) return { ok: false, reason: "not-missing", error: null };
        await project.assets.locate(file);
        if (!item.asset.file) throw new Error("The file could not be attached to the project.");
        await recover(item);
        return { ok: true, reason: null, error: null };
      } catch (error) { state(item.asset, "failed", error?.message || String(error), item.id); refresh(); return { ok: false, reason: "failed", error: error?.message || String(error) }; }
    }
    async function exportFile(id) {
      const item = lookup(id);
      if (!item) return null;
      if (item.asset?.file) return { blob: item.asset.file, filename: item.asset.filename || item.asset.file.name || item.name };
      const text = embeddedText(item);
      if (typeof text === "string") return { blob: new global.Blob([text], { type: item.mime || "text/plain" }),
        filename: /\.ies$/i.test(item.name) ? item.name : item.name + ".ies" };
      if (!item.asset?.url) return null;
      if (item.source === "plugin" && /^data:/i.test(item.asset.url)) {
        try {
          const bytes = await parts.fetch.response(item.asset);
          return { blob: new global.Blob([bytes]), filename: item.asset.filename || item.name + ".png" };
        } catch (_error) { return null; }
      }
      if (item.source !== "preset") return null;
      try {
        const url = new global.URL(parts.fetch.urlOf(item.asset), global.location.href);
        if (url.origin !== global.location.origin) return null;
        const bytes = await parts.fetch.retry(() => parts.fetch.response(item.asset));
        const filename = decodeURIComponent(url.pathname.split("/").pop()) || item.name;
        return { blob: new global.Blob([bytes]), filename };
      } catch (_error) { return null; }
    }
    return { capabilities, reload, locate, exportFile,
      decorate(item, project) {
        const state = adapterStates.get(project)?.get(item.id);
        if (state?.status && (state.status !== "ready" || item.status === "unknown")) {
          item.status = state.status; item.error = state.error;
        }
      },
      registerReloader(reloader) {
        if (typeof reloader?.id !== "string" || !reloader.id || typeof reloader.reload !== "function") throw new TypeError("Asset reloaders require an id and reload(key, asset).");
        if (reloaders.has(reloader.id)) throw new Error("Asset reloader already registered: " + reloader.id);
        reloaders.set(reloader.id, reloader);
        return () => { if (reloaders.get(reloader.id) === reloader) reloaders.delete(reloader.id); };
      },
      dispose() { alive = false; reloaders.clear(); },
    };
  };
})(globalThis);
