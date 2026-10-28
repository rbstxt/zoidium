"use strict";

// Local one-based ranges match Text+'s string layout: spaces count, newlines
// do not. Index offset and Total characters affect transforms, not identity.
const filters = new WeakMap();
const cloneDisposals = new WeakMap();

function trackCharacterCloneDisposal(mesh) {
  if (!mesh.__zoidiumEffectorGeneratedClone) return;
  const geometry = mesh.__zoidiumSourceGeometry || mesh.geometry;
  if (!geometry?.addEventListener || cloneDisposals.get(mesh) === geometry) return;
  const records = [];
  for (let node = mesh; node; node = node.parent) {
    const identity = node.userData?.zoidiumTextPlusCharacter;
    const root = node.userData?.zoidiumTextPlusCharacters;
    if (identity || root) records.push({ node, identity, root });
  }
  if (!records.length) return;
  cloneDisposals.set(mesh, geometry);
  const cleanup = () => {
    geometry.removeEventListener("dispose", cleanup);
    for (const { node, identity, root } of records) {
      if (identity && node.userData.zoidiumTextPlusCharacter === identity) delete node.userData.zoidiumTextPlusCharacter;
      if (root && node.userData.zoidiumTextPlusCharacters === root) delete node.userData.zoidiumTextPlusCharacters;
    }
    if (cloneDisposals.get(mesh) === geometry) cloneDisposals.delete(mesh);
  };
  geometry.addEventListener("dispose", cleanup);
}

function parseCharacterSelection(value) {
  const text = String(value ?? "").trim();
  if (!text) return { all: true, valid: true, ranges: [] };
  const ranges = [];
  for (const token of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);
    if (!match) return { all: false, valid: false, ranges: [] };
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) {
      return { all: false, valid: false, ranges: [] };
    }
    ranges.push([first, last]);
  }
  return { all: false, valid: true, ranges };
}

function matchesCharacter(selection, identity, invert = false) {
  if (selection.all) return true;
  if (!selection.valid) return false;
  if (!identity || !Number.isSafeInteger(identity.index) || identity.index < 0) return false;
  const number = identity.index + 1;
  const included = selection.ranges.some(([first, last]) => number >= first && number <= last);
  return invert ? !included : included;
}

// Own the per-mesh chain filter while fracture instances exist. Both the worker
// and synchronous paths receive the same chain. Empty selections reuse its
// original array, commands and topology keys without extra command fields.
function acquireSelectionFilter(deformer) {
  if (!deformer) return () => {};
  let entry = filters.get(deformer);
  if (!entry) {
    const original = deformer.deformMesh;
    const patched = function deformMesh(mesh, chain, frame, ...options) {
      trackCharacterCloneDisposal(mesh);
      let selected = chain;
      if (chain.some(item => typeof item.effector.acceptsCharacterMesh === "function")) {
        const filtered = chain.filter(item => !item.effector.acceptsCharacterMesh ||
          item.effector.acceptsCharacterMesh(mesh, frame));
        if (filtered.length !== chain.length) selected = filtered;
      }
      return original.call(this, mesh, selected, frame, ...options);
    };
    entry = { original, patched, owners: 0 };
    filters.set(deformer, entry);
    deformer.deformMesh = patched;
  }
  entry.owners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.owners) return;
    if (deformer.deformMesh === entry.patched) deformer.deformMesh = entry.original;
    filters.delete(deformer);
  };
}

function syncCharacterRequests(owner, selection, restoreTree) {
  const previous = owner._fractureCharacterRequests || new Map();
  const current = new Set();
  if (!selection.all) {
    const seen = new Set();
    function visit(object) {
      if (!object || seen.has(object)) return;
      seen.add(object);
      if (typeof object.zoidiumRequestCharacterSplit === "function") {
        current.add(object);
        if (!previous.has(object)) {
          // Restore the pristine whole-text geometry before Text+ captures it.
          // Otherwise clearing selection could restore a fractured working copy.
          restoreTree(object.threeObj);
          previous.set(object, object.zoidiumRequestCharacterSplit(owner));
        }
      }
      for (const child of object.objects || []) visit(child);
    }
    for (const child of owner.objects || []) visit(child);
  }
  for (const [text, release] of previous) if (!current.has(text)) {
    restoreTree(text.threeObj);
    release();
    previous.delete(text);
  }
  owner._fractureCharacterRequests = previous;
}

function releaseCharacterRequests(owner, restoreTree) {
  for (const [text, release] of owner._fractureCharacterRequests || []) {
    restoreTree(text.threeObj);
    release();
  }
  owner._fractureCharacterRequests?.clear();
}

function textSourceForMesh(mesh) {
  for (let node = mesh; node; node = node.parent) {
    const owner = node.__zoidiumEffectorTransformOwner;
    if (owner?.properties?.text) return owner;
  }
  return null;
}

module.exports = {
  trackCharacterCloneDisposal, parseCharacterSelection, matchesCharacter, acquireSelectionFilter,
  syncCharacterRequests, releaseCharacterRequests, textSourceForMesh,
};
