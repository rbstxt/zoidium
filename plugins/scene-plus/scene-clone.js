"use strict";

// Render-tree helpers: instance cloning with texture-preserving material
// clones, disposal of echo resources, deformer-tree restoration, and the
// source-to-render node path mapping the deformation walk relies on.

const state = require("./scene-state.js");

function objectSignature(root, output) {
  if (!root) {
    output.push("null");
    return;
  }
  const geometry = root.geometry?.uuid || "";
  const material = Array.isArray(root.material)
    ? root.material.map((item) => item?.uuid || "").join(",")
    : root.material?.uuid || "";
  output.push(`${root.uuid || ""}:${geometry}:${material}:${root.children.length}`);
  for (const child of root.children) objectSignature(child, output);
}

function copyObjectState(source, target) {
  if (!source || !target) return;
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.visible = source.visible;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  if (source.rotation?.order) target.rotation.order = source.rotation.order;
  if (source.layers && target.layers) target.layers.mask = source.layers.mask;
  target.renderDepth = source.renderDepth;
  const length = Math.min(source.children.length, target.children.length);
  for (let index = 0; index < length; index += 1) {
    copyObjectState(source.children[index], target.children[index]);
  }
}

function cloneMaterial(material) {
  const clone = material && typeof material.clone === "function"
    ? material.clone()
    : material;
  if (clone === material || !material?.uniforms || !clone?.uniforms) return clone;

  // ShaderMaterial.clone() in Three.js r91 clones Texture uniforms into new
  // Texture objects whose upload version is zero. Reuse the source textures
  // while keeping scalar and vector uniforms, such as particle time, isolated
  // for each echo.
  for (const [name, sourceUniform] of Object.entries(material.uniforms)) {
    if (sourceUniform?.value?.isTexture && clone.uniforms[name]) {
      clone.uniforms[name].value = sourceUniform.value;
    }
  }
  return clone;
}

function copyRenderCallbacks(source, target) {
  if (!source || !target) return;
  for (const name of ["onBeforeRender", "onAfterRender"]) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      target[name] = source[name];
    }
  }
  const length = Math.min(
    source.children?.length || 0,
    target.children?.length || 0
  );
  for (let index = 0; index < length; index += 1) {
    copyRenderCallbacks(source.children[index], target.children[index]);
  }
}

function cloneRenderTree(source) {
  const clone = source.clone(true);
  clone.traverse((node) => {
    if (node.geometry && typeof node.geometry.clone === "function") {
      node.geometry = node.geometry.clone();
    }
    if (Array.isArray(node.material)) {
      node.material = node.material.map(cloneMaterial);
    } else if (node.material) {
      node.material = cloneMaterial(node.material);
    }
  });
  copyRenderCallbacks(source, clone);
  markGeneratedRenderTree(clone);
  return clone;
}

function disposeClonedResources(root) {
  if (!root?.traverse) return;
  restoreDeformedTree(root);
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : [];
    for (const material of materials) material?.dispose?.();
  });
}

function markGeneratedRenderTree(root) {
  root?.traverse?.((node) => {
    if (node?.isMesh) node.__zoidiumEffectorGeneratedClone = true;
  });
}

function restoreDeformedTree(root) {
  if (state.meshDeformerCache) state.meshDeformerCache.restoreTree(root);
}

function traverseDeformMeshes(root, callback) {
  if (!root?.traverse) return;
  root.traverse((mesh) => {
    if (mesh?.isMesh && mesh.geometry) callback(mesh);
  });
}

function findRenderNodePath(root, target, path = []) {
  if (!root || !target) return null;
  if (root === target) return path;
  if (!Array.isArray(root.children)) return null;
  for (let index = 0; index < root.children.length; index += 1) {
    const result = findRenderNodePath(root.children[index], target, path.concat(index));
    if (result) return result;
  }
  return null;
}

function getRenderNode(root, path) {
  let node = root;
  for (const index of path || []) node = node?.children?.[index];
  return node || null;
}

// Build once for this evaluation. Source or clone topology can change during
// any object update, so no mapping survives into the next evaluation.
function mapRenderNodes(source, rendered, nodes = new Map()) {
  if (!source || !rendered) return nodes;
  nodes.set(source, rendered);
  const children = source.children || [];
  const copies = rendered.children || [];
  for (let index = 0; index < children.length; index += 1) {
    mapRenderNodes(children[index], copies[index], nodes);
  }
  return nodes;
}

module.exports = {
  objectSignature, copyObjectState, cloneMaterial, copyRenderCallbacks,
  cloneRenderTree, disposeClonedResources, markGeneratedRenderTree,
  restoreDeformedTree, traverseDeformMeshes, findRenderNodePath, getRenderNode, mapRenderNodes
};
