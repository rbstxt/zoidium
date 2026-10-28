(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  // After Effects File > Dependencies: Collect Files packs every project file
  // into one archive with the Project panel's folders, and Consolidate merges
  // items whose bytes are identical but whose keys differ.
  const REPORT = "Collect Files Report.txt";

  parts.createCollector = function ({ PZ, snapshot, refresh, retention, replacement, edits, actions }) {
    function current() { retention?.attach(); refresh(); return snapshot(); }

    function safeName(value) {
      const name = String(value || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
      return !name || name === "." || name === ".." ? "Untitled" : name.slice(0, 200);
    }
    // "name.png", "name (2).png", ... compared case-insensitively, because
    // archives are often extracted on case-insensitive file systems.
    function unique(taken, name) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : "";
      let candidate = name;
      for (let index = 2; taken.has(candidate.toLowerCase()); index++) candidate = stem + " (" + index + ")" + extension;
      taken.add(candidate.toLowerCase());
      return candidate;
    }
    function folderPaths(folders, taken) {
      const byId = new Map(folders.map(folder => [folder.id, folder]));
      const names = new Map(), paths = new Map();
      for (const folder of folders) {
        const parent = byId.has(folder.parent) ? folder.parent : null;
        if (!taken.has(parent)) taken.set(parent, new Set());
        names.set(folder.id, unique(taken.get(parent), safeName(folder.name)));
      }
      function pathOf(id, seen = new Set()) {
        if (paths.has(id)) return paths.get(id);
        const folder = byId.get(id);
        if (!folder || seen.has(id)) return "";
        seen.add(id);
        const path = pathOf(byId.has(folder.parent) ? folder.parent : null, seen) + names.get(id) + "/";
        paths.set(id, path);
        return path;
      }
      for (const folder of folders) pathOf(folder.id);
      return paths;
    }

    async function bytesOf(item) {
      if (item.asset?.file) return { blob: item.asset.file, filename: item.name };
      if (item.source !== "embedded") return null;
      const exported = await actions?.exportFile(item.id);
      return exported?.blob ? exported : null;
    }
    function reportText(name, collected, missing, folders) {
      const total = collected.reduce((sum, entry) => sum + entry.size, 0);
      const lines = ["Collect Files report", "Project: " + name, "",
        "Collected " + collected.length + (collected.length === 1 ? " file" : " files") + " (" + total + " bytes) in " +
          folders + (folders === 1 ? " folder." : " folders."), ""];
      for (const entry of collected) lines.push("  " + entry.path + "  (" + entry.size + " bytes)");
      lines.push("", "Missing items: " + missing.length);
      if (missing.length) lines.push("These files have no bytes in the project. Use Locate in the Assets panel to attach them.");
      for (const entry of missing) lines.push("  " + entry.path + "  (used " + entry.uses + (entry.uses === 1 ? " time)" : " times)"));
      return lines.join("\n") + "\n";
    }

    // Every file item with bytes, named by its item name, in folders that
    // match the Assets panel. Missing files are listed in the report.
    async function collectFiles(options = {}) {
      const view = current(), project = global.CM?.project;
      if (!project) return { ok: false, reason: "no-project", error: "There is no project to collect." };
      const name = safeName(options.name || project.name || "project");
      const taken = new Map([[null, new Set([REPORT.toLowerCase()])]]);
      const folders = view.folders || [], paths = folderPaths(folders, taken);
      const entries = Array.from(paths.values()).sort().map(path => ({ path }));
      const collected = [], missing = [];
      for (const item of view.items) {
        if (item.source !== "file" && item.source !== "embedded") continue;
        const parent = paths.has(item.folder) ? item.folder : null;
        const folder = paths.get(parent) || "";
        const bytes = await bytesOf(item);
        if (global.CM?.project !== project) return { ok: false, reason: "project-changed", error: "The project changed while collecting files." };
        if (!bytes) {
          missing.push({ id: item.id, name: item.name, path: folder + safeName(item.name), uses: item.usages.length });
          continue;
        }
        if (!taken.has(parent)) taken.set(parent, new Set());
        const path = folder + unique(taken.get(parent), safeName(bytes.filename || item.name));
        entries.push({ path, blob: bytes.blob });
        collected.push({ id: item.id, name: item.name, path, size: bytes.blob.size });
      }
      const report = reportText(name, collected, missing, folders.length);
      entries.push({ path: REPORT, blob: new global.Blob([report], { type: "text/plain" }) });
      try {
        const blob = await parts.zip.create(entries);
        return { ok: true, blob, filename: name + " folder.zip", collected, missing, report };
      } catch (error) {
        return { ok: false, reason: "failed", error: error?.message || String(error), collected, missing, report };
      }
    }

    // Item sources whose bytes are reachable: attached files, built-in
    // presets and plugin data URLs. Embedded plugin data has no shared key.
    const MERGEABLE = { preset: 0, file: 1, plugin: 2 };
    async function digest(blob) {
      const bytes = await blob.arrayBuffer();
      if (global.crypto?.subtle) {
        const hash = new Uint8Array(await global.crypto.subtle.digest("SHA-256", bytes));
        return Array.from(hash, value => value.toString(16).padStart(2, "0")).join("");
      }
      return parts.zip.crc32(new Uint8Array(bytes)).toString(16) + ":" + bytes.byteLength;
    }
    async function duplicateGroups(view) {
      const candidates = view.items.filter(item => item.key && item.asset && item.kind !== "composition" &&
        Object.prototype.hasOwnProperty.call(MERGEABLE, item.source));
      const byKind = new Map();
      for (const item of candidates) {
        if (!byKind.has(item.kind)) byKind.set(item.kind, []);
        byKind.get(item.kind).push(item);
      }
      const groups = [];
      for (const items of byKind.values()) {
        if (items.length < 2) continue;
        // Sizes first: only items of equal length are hashed.
        const bySize = new Map();
        for (const item of items) {
          const exported = item.asset.file ? { blob: item.asset.file } : await actions?.exportFile(item.id);
          if (!exported?.blob) continue;
          const size = exported.blob.size;
          if (!bySize.has(size)) bySize.set(size, []);
          bySize.get(size).push({ item, blob: exported.blob });
        }
        for (const same of bySize.values()) {
          if (same.length < 2) continue;
          const byHash = new Map();
          for (const entry of same) {
            const hash = await digest(entry.blob);
            if (!byHash.has(hash)) byHash.set(hash, []);
            byHash.get(hash).push(entry.item);
          }
          for (const group of byHash.values()) if (group.length > 1) groups.push(group);
        }
      }
      return groups;
    }
    // The kept item: a working one, then a built-in preset (its native
    // dropdown name stays and the project stores no copy), then an attached
    // file, then the most used; ties keep panel order.
    function keeper(group) {
      const rank = item => [item.status === "failed" || item.status === "missing" ? 1 : 0, MERGEABLE[item.source], -item.usages.length];
      return group.slice().sort((a, b) => {
        const x = rank(a), y = rank(b);
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
      })[0];
    }

    async function consolidate() {
      const editor = global.CM, project = editor?.project;
      if (!project || !editor.history) return { ok: false, consolidated: 0, groups: [], removed: [], skipped: [], reason: "no-project" };
      const groups = await duplicateGroups(current());
      if (editor.project !== project) return { ok: false, consolidated: 0, groups: [], removed: [], skipped: [], reason: "project-changed" };
      if (!groups.length) return { ok: true, consolidated: 0, groups: [], removed: [], skipped: [] };
      const history = editor.history, opened = !history.operation;
      if (opened) history.startOperation();
      const operation = history.operation, merged = [], skipped = [], duplicates = [];
      let removed = [];
      try {
        for (const group of groups) {
          const keep = keeper(group), entry = { keep: { id: keep.id, name: keep.name }, merged: [] };
          for (const item of group) {
            if (item === keep) continue;
            const result = item.usages.length ? await replacement.replace(item.id, { itemId: keep.id }) : { ok: true, skipped: [] };
            if (editor.project !== project || history.operation !== operation) {
              return { ok: false, consolidated: 0, groups: [], removed: [], skipped: [], reason: "project-changed" };
            }
            if (!result.ok) { skipped.push({ id: item.id, name: item.name, reason: result.reason, error: result.error }); continue; }
            if (result.skipped?.length) skipped.push({ id: item.id, name: item.name, reason: "closed-composition" });
            entry.merged.push({ id: item.id, name: item.name });
            // Replace already removes a project file it left unused.
            if (result.removed) removed.push({ id: item.id, name: item.name, size: item.size || 0 });
            else duplicates.push(item.id);
          }
          if (entry.merged.length) merged.push(entry);
        }
        // Like Remove Unused: duplicates that nothing uses any more go.
        if (duplicates.length) removed = removed.concat(edits.removeUnused(duplicates).removed || []);
      } finally {
        if (opened && editor.project === project && history.operation === operation) history.finishOperation();
        refresh();
      }
      const consolidated = merged.reduce((sum, entry) => sum + entry.merged.length, 0);
      return { ok: true, consolidated, groups: merged, removed, skipped };
    }

    return { collectFiles, consolidate };
  };
})(globalThis);
