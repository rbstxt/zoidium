(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  // After Effects Project panel organization: nested folders and label
  // colors per item or folder. The metadata lives in a Zoidium-owned project
  // root field that CM3 and older Zoidium builds ignore; every edit is one
  // undo step. Assigning an item to a property and handing footage to CM3's
  // own timeline drag live here too.
  const FIELD = "zoidiumAssets";
  const LABELS = 16;

  parts.createOrganizer = function ({ PZ, refresh }) {
    const metadata = new WeakMap();
    let folderCounter = 0;

    function empty() { return { folders: [], items: {} }; }
    function clean(value) {
      const result = empty();
      if (!value || typeof value !== "object") return result;
      const seen = new Set();
      for (const folder of Array.isArray(value.folders) ? value.folders : []) {
        if (!folder || typeof folder.id !== "string" || !folder.id || seen.has(folder.id)) continue;
        seen.add(folder.id);
        result.folders.push({ id: folder.id, name: String(folder.name || "Folder").slice(0, 200),
          parent: typeof folder.parent === "string" ? folder.parent : null, label: labelOf(folder.label) });
      }
      for (const [id, entry] of Object.entries(value.items && typeof value.items === "object" ? value.items : {})) {
        if (!entry || typeof entry !== "object") continue;
        const folder = typeof entry.folder === "string" && seen.has(entry.folder) ? entry.folder : null;
        const label = labelOf(entry.label);
        if (folder || label) result.items[id] = { folder, label };
      }
      return result;
    }
    function labelOf(value) {
      const label = Math.round(Number(value) || 0);
      return label >= 0 && label <= LABELS ? label : 0;
    }
    function metaOf(project) {
      if (!project) return empty();
      let meta = metadata.get(project);
      if (!meta) metadata.set(project, meta = empty());
      return meta;
    }
    function copy(meta) { return { folders: meta.folders.map(folder => ({ ...folder })), items: JSON.parse(JSON.stringify(meta.items)) }; }

    // Saved form: folders as they are, item entries only for items that still
    // exist. Entries of removed items stay in memory so undo brings them back.
    function serialize(project, json) {
      const meta = metadata.get(project);
      if (!meta || (!meta.folders.length && !Object.keys(meta.items).length)) return;
      const live = new Set(Object.keys(project.assets?.list || {}));
      for (const media of project.media || []) if (media.comp?.id) live.add("comp:" + media.comp.id);
      const items = {};
      for (const [id, entry] of Object.entries(meta.items)) if (live.has(id) || id.startsWith("ies:")) items[id] = { ...entry };
      json[FIELD] = { version: 1, folders: meta.folders.map(folder => ({ ...folder })), items };
    }

    const prototype = PZ.project?.prototype;
    const originalToJSON = prototype?.toJSON, originalLoad = prototype?.load;
    function toJSON() {
      const json = originalToJSON.apply(this, arguments);
      if (json && typeof json === "object") serialize(this, json);
      return json;
    }
    function load(data) {
      metadata.set(this, clean(data && data[FIELD]));
      return originalLoad.apply(this, arguments);
    }
    if (prototype && originalToJSON && originalLoad) {
      prototype.toJSON = toJSON;
      prototype.load = load;
    }

    // ---- Snapshot decoration ----------------------------------------------

    function decorate(project, items) {
      const meta = metaOf(project);
      const folders = new Set(meta.folders.map(folder => folder.id));
      for (const item of items) {
        const entry = meta.items[item.id];
        item.folder = entry && folders.has(entry.folder) ? entry.folder : null;
        item.label = entry ? entry.label || 0 : 0;
      }
      return meta.folders.map(folder => ({ ...folder, parent: folders.has(folder.parent) ? folder.parent : null }));
    }

    // ---- Undoable edits ----------------------------------------------------

    function setMeta(editor, project, next) {
      const previous = metaOf(project);
      metadata.set(project, next);
      editor.history.pushCommand(() => setMeta(editor, project, previous));
      project.ui?.onChanged?.update?.();
      refresh();
    }
    // Applies `change` to a copy; an unchanged result records nothing.
    function edit(change) {
      const editor = global.CM, project = editor?.project;
      if (!project || !editor.history) return false;
      const before = metaOf(project), next = copy(before);
      if (change(next) === false || JSON.stringify(next) === JSON.stringify(before)) return false;
      const history = editor.history, opened = !history.operation;
      if (opened) history.startOperation();
      const operation = history.operation;
      try { setMeta(editor, project, next); }
      finally { if (opened && editor.project === project && history.operation === operation) history.finishOperation(); }
      return true;
    }
    function folderIds(meta) { return new Set(meta.folders.map(folder => folder.id)); }
    function descendants(meta, id) {
      const result = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const folder of meta.folders) if (result.has(folder.parent) && !result.has(folder.id)) { result.add(folder.id); grew = true; }
      }
      return result;
    }
    function createFolder(name, parent = null) {
      let id = null;
      edit(meta => {
        do id = "f" + Date.now().toString(36) + (folderCounter++).toString(36);
        while (folderIds(meta).has(id));
        meta.folders.push({ id, name: String(name || "Untitled").slice(0, 200), parent: folderIds(meta).has(parent) ? parent : null, label: 0 });
      });
      return id;
    }
    function renameFolder(id, name) {
      const text = String(name || "").trim().slice(0, 200);
      return !!text && edit(meta => {
        const folder = meta.folders.find(entry => entry.id === id);
        if (!folder) return false;
        folder.name = text;
      });
    }
    // Contents move to the deleted folder's parent; no asset is deleted.
    function deleteFolder(id) {
      return edit(meta => {
        const folder = meta.folders.find(entry => entry.id === id);
        if (!folder) return false;
        for (const child of meta.folders) if (child.parent === id) child.parent = folder.parent;
        for (const entry of Object.values(meta.items)) if (entry.folder === id) entry.folder = folder.parent;
        meta.folders = meta.folders.filter(entry => entry !== folder);
      });
    }
    function moveItems(ids, folderId) {
      return edit(meta => {
        const folders = folderIds(meta), target = folders.has(folderId) ? folderId : null;
        if (folderId != null && !target) return false;
        for (const id of ids || []) {
          if (folders.has(id)) {
            if (target && descendants(meta, id).has(target)) return false;
            meta.folders.find(folder => folder.id === id).parent = target;
          } else {
            const entry = meta.items[id] || (meta.items[id] = { folder: null, label: 0 });
            entry.folder = target;
            if (!entry.folder && !entry.label) delete meta.items[id];
          }
        }
      });
    }
    function setLabel(ids, label) {
      const value = labelOf(label);
      return edit(meta => {
        const folders = folderIds(meta);
        for (const id of ids || []) {
          if (folders.has(id)) { meta.folders.find(folder => folder.id === id).label = value; continue; }
          const entry = meta.items[id] || (meta.items[id] = { folder: null, label: 0 });
          entry.label = value;
          if (!entry.folder && !entry.label) delete meta.items[id];
        }
      });
    }

    // ---- Drop on a property row and timeline drag --------------------------

    const ASSET = () => PZ.property?.type?.ASSET ?? 8;
    function propertyKind(property) {
      const definition = property?.definition || {};
      const name = String(definition.name || "");
      const types = PZ.asset?.type || {};
      if (/geometry|model|obj/i.test(name) || definition.assetType === types.GEOMETRY) return "geometry";
      if (definition.assetType === types.FONT || /font/i.test(name)) return "font";
      if (definition.assetType === types.IMAGE || /image|texture|map|matcap|sprite|layer/i.test(name)) return "image";
      if (/lut/i.test(name)) return "lut";
      if (definition.assetType === types.AV || /media|audio|video/i.test(name)) return "av";
      return null;
    }
    function matches(kind, item) {
      if (!kind) return true;
      if (kind === "av") return item.kind === "video" || item.kind === "audio";
      return kind === item.kind;
    }
    function propertyAt(element) {
      const row = element?.closest?.("li");
      const property = row?.pz_object;
      if (!property || property.definition?.type !== ASSET() || typeof property.getAddress !== "function") return null;
      const kind = propertyKind(property);
      return { address: property.getAddress(), name: property.definition.name || "Property", kind: kind === "av" ? null : kind };
    }
    // Mirrors the native property panel (PZ.ui.controls.editStart/editFinish):
    // the edit frame is the playhead minus the property's frameOffset (its
    // clip start), an animated property first gets a keyframe there through
    // propertyOps.startEdit, and the value is then written at that frame.
    function editFrame(editor, property) {
      const offset = Number(property.frameOffset);
      const current = Number(editor.playback?.currentFrame);
      return Number.isFinite(offset) && Number.isFinite(current) ? current - offset : undefined;
    }
    function assign(item, address, frame) {
      const editor = global.CM, project = editor?.project;
      if (!project || !editor.history || !item?.key) return { ok: false, reason: "item" };
      let property = null;
      try { property = project.addressLookup(address); } catch (_error) { property = null; }
      if (!property || property.definition?.type !== ASSET()) return { ok: false, reason: "property" };
      if (!matches(propertyKind(property), item)) return { ok: false, reason: "kind" };
      if (property.expression) {
        return { ok: false, reason: "expression", error: "This property is driven by an expression." };
      }
      const at = frame != null ? frame : editFrame(editor, property);
      const animated = !!property.animated;
      if (property.get?.(at) === item.key && (!animated || property.hasKeyframe?.(at) !== false)) return { ok: true, frame: at };
      const history = editor.history, opened = !history.operation;
      if (opened) history.startOperation();
      const operation = history.operation;
      try {
        const ops = new PZ.ui.properties(editor);
        const current = property.get?.(at);
        const oldValue = current === undefined ? undefined : JSON.parse(JSON.stringify(current));
        if (animated) ops.startEdit(property, at);
        ops.setValue({ property: address, value: item.key, frame: at, oldValue });
      } finally {
        if (opened && editor.project === project && history.operation === operation) history.finishOperation();
        refresh();
      }
      return { ok: true, frame: at };
    }
    function dragMedia(item) {
      const project = global.CM?.project;
      if (!project || !item?.key || !["video", "audio", "image"].includes(item.kind)) return null;
      return (project.media || []).find(media => !media.preset && !media.comp &&
        (media.assets || []).some(asset => (typeof asset === "string" ? asset : asset?.key) === item.key)) || null;
    }

    function dispose() {
      if (prototype?.toJSON === toJSON) prototype.toJSON = originalToJSON;
      if (prototype?.load === load) prototype.load = originalLoad;
    }

    return { decorate, createFolder, renameFolder, deleteFolder, moveItems, setLabel, propertyAt, assign, dragMedia, dispose,
      metadataOf: project => copy(metaOf(project)) };
  };
})(globalThis);
