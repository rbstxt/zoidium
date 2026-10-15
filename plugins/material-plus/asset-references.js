"use strict";

function pathOf(owner) {
  const names = [], seen = new Set();
  for (let node = owner; node && !seen.has(node); node = node.parent) {
    seen.add(node);
    const property = node.properties?.name;
    const name = property && (property.value ?? property.keyframes?.[0]?.value);
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
function graphOf(properties) {
  const property = properties?.graph;
  const raw = property?.get ? property.get() : property?.value ?? property;
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_error) { return null; }
}
function collectGraph(owner, path, emit, composition = null) {
  const graph = graphOf(owner.properties);
  if (!Array.isArray(graph?.nodes)) return;
  for (const node of graph.nodes) {
    if (typeof node.params?.asset !== "string" || !node.params.asset) continue;
    emit({ key: node.params.asset, path: path.concat(node.name || node.label || "Image node " + node.id),
      owner: composition ? undefined : owner, address: composition ? null : owner.properties.graph.getAddress(),
      composition, revealable: !composition });
  }
}
function collectStored(value, path, composition, emit) {
  if (!value || typeof value !== "object") return;
  const name = value.properties?.name;
  const label = typeof name === "string" ? name : name?.value;
  if (label) path = path.concat(label);
  if (value.properties?.graph) collectGraph(value, path, emit, composition);
  for (const child of Object.values(value)) if (child && typeof child === "object") collectStored(child, path, composition, emit);
}
module.exports = {
  activate(context) {
    const api = context.apis?.assets || context.window.ZoidiumAssets;
    if (!api) return;
    const PZ = context.PZ || context.window.PZ;
    const dispose = api.registerReferences({ id: "material-plus/graph-images", label: "Material+ graph images",
      clear(key) {
        const editor = context.window.CM;
        if (!editor?.project) return;
        const ops = new PZ.ui.properties(editor);
        collectLive(editor.project.sequence, owner => {
          const graph = graphOf(owner.properties);
          if (!graph?.nodes?.some(node => node.params?.asset === key)) return;
          for (const node of graph.nodes) if (node.params?.asset === key) node.params.asset = null;
          ops.setValue({ property: owner.properties.graph.getAddress(), value: JSON.stringify(graph) });
          if (owner.properties.nodeImage?.get() === key) owner.properties.nodeImage.set(null);
        });
      },
      collect(project, emit) {
        collectLive(project.sequence, owner => {
          if (owner.properties?.graph) collectGraph(owner, pathOf(owner), emit);
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
