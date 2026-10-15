(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.createEdits = function ({ PZ, snapshot, refresh, adapters, usageRecords, retention }) {
    function current() { retention?.attach(); refresh(); return snapshot(); }
    function begin(editor) {
      const history = editor.history, opened = !history.operation;
      if (opened) history.startOperation();
      const operation = history.operation, project = editor.project;
      return () => {
        if (opened && editor.project === project && history.operation === operation) history.finishOperation();
        refresh();
      };
    }
    // Explicit inverse commands put the same object/bytes back before native
    // clip, Media and property inverses run. Redo removes consumers first.
    function removeAsset(editor, project, asset) {
      if (project.assets.list[asset.key] !== asset) return;
      retention.remove(asset, project.assets);
      editor.history.pushCommand(() => restoreAsset(editor, project, asset));
      refresh();
    }
    function restoreAsset(editor, project, asset) {
      project.assets.restore(asset);
      retention.retain(asset);
      editor.history.pushCommand(() => removeAsset(editor, project, asset));
      refresh();
    }
    function summary(item) { return { id: item.id, name: item.name, size: item.size || 0 }; }
    function mediaHolds(media, keys) {
      return (media.assets || []).some(asset => keys.has(typeof asset === "string" ? asset : asset.key));
    }
    function setMediaAssets(editor, project, media, next) {
      const previous = media.assets;
      for (const asset of previous) if (!next.includes(asset)) project.assets.unload(asset, true);
      for (const asset of next) if (!previous.includes(asset)) project.assets.load(asset, true);
      media.assets = next;
      editor.history.pushCommand(() => setMediaAssets(editor, project, media, previous));
    }
    function deleteMedia(editor, keys) {
      const mediaOps = { editor };
      for (let index = editor.project.media.length - 1; index >= 0; index--) {
        const media = editor.project.media[index];
        if (media.preset || !mediaHolds(media, keys)) continue;
        if (media.comp) {
          // Precomp's cached hold list can outlive its authored references.
          // Remove stale holds without deleting the composition itself or
          // letting native reopen resurrect a missing FILE placeholder.
          const next = media.assets.filter(asset => !keys.has(typeof asset === "string" ? asset : asset.key));
          setMediaAssets(editor, editor.project, media, next);
        } else PZ.ui.media.prototype.deleteMedia.call(mediaOps, { address: [1, index] });
      }
    }
    function removeUnused(ids) {
      const view = current(), editor = global.CM, project = editor?.project;
      if (!project || !editor.history) return { ok: false, removed: [], freed: 0, skipped: [], reason: "no-project" };
      const selected = ids ? new Set(ids) : null;
      const candidates = view.items.filter(item => item.source === "file" && item.retained && (!selected || selected.has(item.id)));
      const unused = candidates.filter(item => !item.usages.length);
      const skipped = candidates.filter(item => item.usages.length).map(summary);
      if (!unused.length) return { ok: true, removed: [], freed: 0, skipped };
      const finish = begin(editor);
      try {
        deleteMedia(editor, new Set(unused.map(item => item.id)));
        for (const item of unused) removeAsset(editor, project, item.asset);
      } finally { finish(); }
      const removed = unused.map(summary);
      return { ok: true, removed, freed: unused.reduce((sum, item) => sum + (item.asset.file?.size || 0), 0), skipped };
    }
    function imageClip(record, key) {
      const clip = record.clip;
      return clip && (clip.properties?.media?.get() === key ||
        (PZ.layer?.image && clip.object instanceof PZ.layer.image && clip.object.imageProperties?.image?.get() === key));
    }
    async function removeItems(ids) {
      const view = current(), editor = global.CM, project = editor?.project;
      if (!project || !editor.history) return { ok: false, removed: [], clearedUses: 0, reason: "no-project" };
      const selected = new Set(ids || []);
      const items = view.items.filter(item => selected.has(item.id) && (item.source === "file" || item.source === "embedded"));
      const usages = items.flatMap(item => item.usages.map(usage => ({ item, usage, record: usageRecords.get(usage) })));
      const closed = usages.find(entry => entry.usage.composition);
      if (closed) return { ok: false, reason: "in-closed-composition", composition: closed.usage.composition, removed: [], clearedUses: 0 };
      const clips = new Set(usages.filter(({ item, record }) => record && imageClip(record, item.id)).map(entry => entry.record.clip));
      const panels = clips.size ? parts.panelsOf(editor) : null;
      if (clips.size && !panels?.tracks) return { ok: false, reason: "timeline-unavailable", removed: [], clearedUses: 0 };
      const pluginKeys = new Map();
      for (const { item, usage } of usages) if (usage.plugin) {
        const adapter = adapters.get(usage.plugin);
        if (!adapter?.clear) return { ok: false, reason: "unsupported-reference", removed: [], clearedUses: 0 };
        if (!pluginKeys.has(adapter)) pluginKeys.set(adapter, new Set());
        pluginKeys.get(adapter).add(item.id);
      }
      const finish = begin(editor);
      try {
        const ops = new PZ.ui.properties(editor), properties = new Map();
        for (const { item, record } of usages) if (record?.property && !clips.has(record.clip)) {
          if (!properties.has(record.property)) properties.set(record.property, new Set());
          properties.get(record.property).add(item.id);
        }
        for (const [property, keys] of properties) {
          const address = property.getAddress();
          if (property.keyframes?.length) {
            for (const kf of Array.from(property.keyframes).reverse()) if (keys.has(kf.value)) {
              ops.deleteKeyframe({ property: address, frame: kf.frame });
            }
          } else ops.setValue({ property: address, value: null });
        }
        for (const [adapter, keys] of pluginKeys) for (const key of keys) {
          await adapter.clear(key);
          if (editor.project !== project) return { ok: false, reason: "project-changed", removed: [], clearedUses: 0 };
        }
        for (const [type, tracks] of [[0, project.sequence.videoTracks], [1, project.sequence.audioTracks]]) {
          for (let trackIndex = tracks.length - 1; trackIndex >= 0; trackIndex--) {
            for (let index = tracks[trackIndex].clips.length - 1; index >= 0; index--) {
              if (clips.has(tracks[trackIndex].clips[index])) {
                panels.tracks.deleteClip({ type, oldTrackIdx: trackIndex, oldIdx: index });
              }
            }
          }
        }
        deleteMedia(editor, new Set(items.map(item => item.id)));
        for (const item of items) if (item.asset) removeAsset(editor, project, item.asset);
      } finally { finish(); }
      return { ok: true, removed: items.map(summary), clearedUses: usages.length };
    }
    function typeOf(file) {
      if (/^(video|audio)\//i.test(file.type)) return PZ.asset.type.AV;
      if (/^image\//i.test(file.type)) return PZ.asset.type.IMAGE;
      if (/\.(ttf|otf|woff2?|json)$/i.test(file.name)) return PZ.asset.type.FONT;
      if (/\.obj$/i.test(file.name)) return PZ.asset.type.GEOMETRY;
      return PZ.asset.type.MISC;
    }
    async function importMedia(mediaOps, file) {
      let timer;
      try {
        // Native image/AV import has no rejection on several decoder failures.
        // Keep the FILE item and finish the command with an actionable error.
        return await Promise.race([mediaOps.importFile(file), new Promise((_resolve, reject) => {
          timer = global.setTimeout(() => reject(new Error("Media decoding timed out for " + file.name + ". The file is retained in the project.")), 30000);
        })]);
      } finally { global.clearTimeout(timer); }
    }
    async function importFiles(files) {
      current();
      const editor = global.CM, project = editor?.project, items = [], errors = [];
      if (!project || !editor.history) return { ok: false, items, errors: [{ message: "There is no project to import into." }] };
      const finish = begin(editor), mediaOps = Object.assign(Object.create(PZ.ui.media.prototype), { editor });
      try {
        for (const file of files || []) {
          try {
            const key = await PZ.asset.hash(file);
            if (editor.project !== project) throw new Error("The project changed while importing files.");
            const created = !project.assets.list[key];
            const asset = await project.assets.createFromFile(typeOf(file), file, key);
            retention.retain(asset);
            // Record before Media's inverse so undo deletes Media holds first.
            if (created) editor.history.pushCommand(() => removeAsset(editor, project, asset));
            items.push({ id: asset.key, name: asset.filename || file.name, created });
            if (/^(video|audio|image)\//i.test(file.type) && !project.media.some(media => mediaHolds(media, new Set([key])))) {
              const data = await importMedia(mediaOps, file);
              if (editor.project !== project) throw new Error("The project changed while importing files.");
              if (!data) throw new Error("This browser cannot decode " + file.name + ". The file is retained in the project.");
              const index = project.media.length;
              mediaOps.createMedia({ address: [1, index], data });
              await project.media[index].loading;
            }
          } catch (error) {
            errors.push({ name: file.name, message: error?.message || String(error) });
            if (editor.project !== project) break;
          }
        }
      } finally { finish(); }
      return { ok: !errors.length, items, errors };
    }
    function missingUnused(project) {
      if (project !== global.CM?.project) return [];
      return current().items.filter(item => item.retained && item.source === "file" &&
        !item.asset.file && !item.asset.external && !item.usages.length).map(item => item.id);
    }
    return { importFiles, removeUnused, removeItems, missingUnused };
  };
})(globalThis);
