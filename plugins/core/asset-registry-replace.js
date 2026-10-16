(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.createReplacement = function ({ PZ, snapshot, refresh, adapters, usageRecords, retention, edits }) {
    function current() { retention?.attach(); refresh(); return snapshot(); }
    function result(ok, values = {}) {
      return { ok, replaced: 0, newId: null, removed: false, skipped: [], reason: null, error: null, ...values };
    }
    function builtInFonts() {
      return (PZ.asset.font.preset || []).map(name => {
        const key = "/assets/fonts/2d/" + name + ".ttf";
        return { id: key, key, name };
      });
    }
    function rewrite(value, oldKey, newKey) {
      if (value === oldKey) return newKey;
      if (Array.isArray(value)) return value.map(child => rewrite(child, oldKey, newKey));
      if (!value || typeof value !== "object") return value;
      const next = {};
      for (const [key, child] of Object.entries(value)) {
        // Graph images live in a serialized TEXT property in Media templates.
        if (key === "graph" && typeof child === "string") {
          try { next[key] = JSON.stringify(rewrite(JSON.parse(child), oldKey, newKey)); continue; } catch (_error) { /* Keep unparsed text. */ }
        }
        next[key] = rewrite(child, oldKey, newKey);
      }
      return next;
    }
    function setMedia(editor, project, media, data, assets) {
      const previousData = media.data, previousAssets = media.assets;
      for (const asset of previousAssets) if (!assets.includes(asset)) project.assets.unload(asset, true);
      for (const asset of assets) if (!previousAssets.includes(asset)) project.assets.load(asset, true);
      media.data = data; media.assets = assets;
      editor.history.pushCommand(() => setMedia(editor, project, media, previousData, previousAssets));
      refresh();
    }
    function mediaReplacements(editor, oldKey, asset) {
      const project = editor.project;
      let count = 0;
      for (const media of project.media || []) {
        // Closed compositions are deliberately left intact. Precomp serializes
        // the open timeline itself when saving, including its current holds.
        if (media.comp) continue;
        const data = rewrite(media.data, oldKey, asset.key);
        const assets = [...new Set((media.assets || []).map(held => (held.key || held) === oldKey ? asset : held))];
        if (JSON.stringify(data) === JSON.stringify(media.data) && assets.every((held, i) => held === media.assets[i]) && assets.length === media.assets.length) continue;
        setMedia(editor, project, media, data, assets); count++;
      }
      return count;
    }
    function fileKind(file, item) {
      if (/\.ies$/i.test(file.name)) return "ies";
      if (/\.json$/i.test(file.name) && ["font", "geometry"].includes(item.kind)) return item.kind;
      const status = parts.createStatus(PZ, () => {});
      try { return status.inspect({ filename: file.name, file, data: new Map() }).kind; }
      finally { status.dispose(); }
    }
    async function replace(id, target) {
      const view = current(), editor = global.CM, project = editor?.project;
      if (!project || !editor.history) return result(false, { reason: "no-project" });
      const item = view.items.find(entry => entry.id === id);
      if (!item || item.kind === "composition") return result(false, { reason: "item", error: "The item is no longer available." });
      const builtin = builtInFonts().find(font => font.id === target?.itemId || font.key === target?.itemId);
      let next = view.items.find(entry => entry.id === target?.itemId);
      const kind = target?.file ? fileKind(target.file, item) : builtin ? "font" : next?.kind;
      if (!kind) return result(false, { reason: "target", error: "Choose a file or an existing project item." });
      if (item.kind !== kind) return result(false, { reason: "kind" });
      const skipped = item.usages.filter(usage => usage.composition).map(usage => ({ path: usage.path, reason: "closed-composition" }));
      const live = item.usages.filter(usage => !usage.composition);
      const hooks = new Set();
      for (const usage of live) if (usage.plugin) {
        const adapter = adapters.get(usage.plugin);
        if (!adapter?.replace) return result(false, { skipped, reason: "unsupported-reference", error: "This plugin cannot replace its asset references." });
        hooks.add(adapter);
      }
      const history = editor.history, opened = !history.operation;
      if (opened) history.startOperation();
      const operation = history.operation;
      try {
        if (target.file) {
          const imported = await edits.importFiles([target.file]);
          if (!imported.ok) return result(false, { skipped, reason: "import", error: imported.errors.map(entry => entry.message).join(" ") });
          next = current().items.find(entry => entry.id === imported.items[0]?.id);
        } else if (builtin && !next) {
          const asset = project.assets.createFromPreset(PZ.asset.type.FONT, builtin.key);
          next = { ...builtin, asset };
        }
        if (editor.project !== project || history.operation !== operation) return result(false, { reason: "project-changed" });
        const newKey = next?.key || next?.id;
        if (!newKey) return result(false, { reason: "target", error: "The replacement item is unavailable." });
        if (newKey === id) return result(true, { newId: newKey, skipped });
        // FILE assets must stay addressable before property inverses run.
        if (item.asset) retention.retain(item.asset);
        if (next.asset) retention.retain(next.asset);
        const ops = new PZ.ui.properties(editor), properties = new Set();
        for (const usage of live) {
          const record = usageRecords.get(usage);
          if (record?.property && !usage.plugin) properties.add(record.property);
        }
        for (const property of properties) {
          const address = property.getAddress();
          if (property.keyframes?.length) {
            for (const kf of property.keyframes) if (kf.value === id) {
              ops.setValue({ property: address, frame: kf.frame, value: newKey });
            }
          } else if (property.value === id) {
            ops.setValue({ property: address, value: newKey });
          }
        }
        for (const adapter of hooks) {
          await adapter.replace(id, newKey);
          if (editor.project !== project || history.operation !== operation) return result(false, { reason: "project-changed" });
        }
        if (next.asset) mediaReplacements(editor, id, next.asset);
        // Count what actually moved, as the Uses column shows it.
        const after = current().items.find(entry => entry.id === id);
        const replaced = live.length - (after ? after.usages.filter(usage => !usage.composition).length : 0);
        // AE Replace Footage swaps the item itself: a project file nothing
        // uses any more leaves the project in the same undo step. Uses in
        // closed compositions keep it.
        let removed = false;
        if (item.source === "file" && after && !after.usages.length) {
          removed = edits.removeUnused([id]).removed.length > 0;
        }
        return result(true, { replaced, newId: newKey, removed, skipped });
      } catch (error) {
        return result(false, { skipped, reason: "failed", error: error?.message || String(error) });
      } finally {
        if (opened && editor.project === project && history.operation === operation) history.finishOperation();
        refresh();
      }
    }
    return { replace, builtInFonts };
  };
})(globalThis);
