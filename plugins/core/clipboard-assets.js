(function installClipboardAssets(global) {
  "use strict";
  const PZ = global.PZ;
  const packagePrototype = PZ?.package?.prototype;
  if (!packagePrototype?.toJSON || packagePrototype.__zoidiumClipboardAssets) return;

  // The native clipboard contains asset keys, not their files. Keep only the
  // latest package's immutable files, without retaining its project or decoders.
  let retained = null;
  const serialize = packagePrototype.toJSON;
  packagePrototype.toJSON = function () {
    const result = serialize.apply(this, arguments);
    const json = JSON.stringify(result);
    const list = global.CM?.project?.assets?.list;
    const files = new Map();
    function collect(value, depth = 0) {
      if (depth > 64 || value == null) return;
      if (typeof value === "string") {
        const asset = list?.[value];
        if (asset?.file && asset.source === PZ.asset.source.FILE) {
          files.set(value, { file: asset.file, filename: asset.filename });
        } else if (/^[\[{]/.test(value.trim())) {
          // Shader text, node graphs, and imported LUTs can keep asset keys
          // inside JSON-valued properties instead of native ASSET properties.
          try { collect(JSON.parse(value), depth + 1); } catch { /* Ordinary text. */ }
        }
      } else if (typeof value === "object") {
        for (const item of Object.values(value)) collect(item, depth + 1);
      }
    }
    collect(JSON.parse(json));
    retained = { json, files };
    return result;
  };
  packagePrototype.__zoidiumClipboardAssets = true;

  async function restore(editor, accepts) {
    if (!retained?.files.size || !editor?.project?.assets) return;
    const text = await global.navigator.clipboard.readText();
    let packages;
    try { packages = JSON.parse(text); } catch { return; }
    if (!Array.isArray(packages) || !packages.some(item =>
      accepts(item.baseType) && JSON.stringify(item) === retained.json)) return;
    const assets = editor.project.assets;
    for (const [key, record] of retained.files) {
      if (assets.list[key]?.file) continue;
      // A fresh asset owns its URL, reference counts, and decoded data. Sharing
      // the immutable Blob is safe when either project's asset is later removed.
      const file = new global.File([record.file], record.filename || "asset", { type: record.file.type });
      await assets.createFromFile(null, file, key);
    }
  }

  function patch(prototype, timeline) {
    if (!prototype?.keydown) return;
    const keydown = prototype.keydown;
    prototype.keydown = function (event) {
      if (!event.ctrlKey || event.key.toLowerCase() !== "v" ||
          PZ.ui.toolbar.prototype.shouldIgnoreKeydown(event.target, event.key)) {
        return keydown.apply(this, arguments);
      }
      const editor = timeline ? this.timeline.editor : this.editor;
      const types = new Set();
      if (timeline) types.add(PZ.track);
      else {
        const selection = this.selection.length ? this.selection : Array.from(this.list.children, row => row.pz_object);
        for (const object of selection) {
          for (const child of object.children || []) if (child instanceof PZ.objectList) types.add(child.type);
          if (object instanceof PZ.objectList) types.add(object.type);
          else if (object.parent instanceof PZ.objectList) types.add(object.parent.type);
        }
      }
      const args = arguments;
      return restore(editor, type => types.has(PZ.object.getType(type)))
        .then(() => keydown.apply(this, args));
    };
  }
  patch(PZ.ui?.edit?.prototype, false);
  patch(PZ.ui?.timeline?.tracks?.prototype, true);
})(typeof window !== "undefined" ? window : globalThis);
