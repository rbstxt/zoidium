"use strict";

function valueOf(property) { return property?.get ? property.get() : property?.value ?? property; }
// Two independent 32-bit lanes keep the embedded-text id stable without an
// asynchronous digest, new bytes, asset retention or saved metadata.
function hash(text) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
function pathOf(owner) {
  const names = [], seen = new Set();
  for (let node = owner; node && !seen.has(node); node = node.parent) {
    seen.add(node);
    const name = valueOf(node.properties?.name);
    if (name) names.unshift(String(name));
  }
  return names;
}
function collectLive(node, visit, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node); visit(node);
  for (const child of Array.isArray(node) ? node : node.children || []) {
    if (node.type === 2 && node.compId && child === node.objects) continue;
    collectLive(child, visit, seen);
  }
}
function collectLight(owner, path, emit, composition = null) {
  const text = valueOf(owner.properties?.iesData);
  if (typeof text !== "string" || !text) return;
  const filename = valueOf(owner.properties.iesFilename) || "Embedded IES profile";
  emit({ key: "ies:" + hash(text), path: path.concat("IES File"), owner: composition ? undefined : owner,
    address: composition ? null : owner.properties.iesFilename?.getAddress?.() || null,
    composition, revealable: !composition, bytes: text,
    item: { kind: "ies", source: "embedded", name: String(filename), size: new TextEncoder().encode(text).length, mime: "text/plain" } });
}
function collectStored(value, path, composition, emit) {
  if (!value || typeof value !== "object") return;
  const name = valueOf(value.properties?.name);
  if (name) path = path.concat(String(name));
  if (value.properties?.iesData) collectLight(value, path, emit, composition);
  for (const child of Object.values(value)) if (child && typeof child === "object") collectStored(child, path, composition, emit);
}
module.exports = {
  activate(context) {
    const api = context.apis?.assets || context.window.ZoidiumAssets;
    if (!api) return;
    const PZ = context.PZ || context.window.PZ;
    const dispose = api.registerReferences({ id: "trapcode-suite/ies", label: "Embedded IES profiles",
      clear(key) {
        const editor = context.window.CM;
        if (!editor?.project) return;
        const ops = new PZ.ui.properties(editor);
        collectLive(editor.project.sequence, owner => {
          const text = valueOf(owner.properties?.iesData);
          if (!text || "ies:" + hash(text) !== key) return;
          for (const [name, value] of [["iesProfile", "Downlight"], ["iesData", ""], ["iesFilename", ""]]) {
            const property = owner.properties[name];
            if (property) ops.setValue({ property: property.getAddress(), value });
          }
        });
      },
      collect(project, emit) {
        collectLive(project.sequence, owner => {
          if (owner.properties?.iesData) collectLight(owner, pathOf(owner), emit);
        });
        const editor = context.window.CM;
        if (editor?.project !== project) return;
        for (const source of PZ.precomp?.referenceSources?.(editor) || []) {
          if (source.editing) continue;
          collectStored(source.tracks, ['Comp "' + source.name + '"'], { id: source.id, name: source.name }, emit);
        }
      },
    });
    context.lifecycle.onDispose(dispose);
  },
};
