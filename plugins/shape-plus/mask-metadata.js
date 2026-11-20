"use strict";
// Mask properties model: validated default metadata plus snapshot operations
// for rename, duplicate, reorder, lock, and colour.
//
// A mask collection is a flat JSON array whose order is the combine order.
// Each mask keeps its existing Shape+ path encoding (`id`, `vertexIds`,
// `vertexModes`, `properties.path`) plus the persisted combine parameters
// (`mode`, `feather`, `opacity`, `invert`). This module owns three extra
// display/edit fields on each mask item:
//
// - `outlineColor`: hex `#rrggbb` string used for the overlay outline.
//   Defaults to DEFAULT_OUTLINE_COLOR (the existing editor accent).
// - `locked`: boolean edit lock. A locked mask stays visible and selectable,
//   but geometry, topology, keyframe, and delete mutations are rejected.
//   Unlocking and selection remain available.
// - `expansion`: signed distance in layer pixels applied before feather,
//   opacity, invert, and ordered combination. Positive values expand
//   coverage, negative values contract it, `0` renders through the legacy
//   path unchanged.
//
// Every operation takes a snapshot (a plain array of mask JSON) and returns
// a new snapshot; inputs are never mutated and legacy fields are preserved
// by deep clone. Missing fields read as their defaults without rewriting
// the stored data, so old projects load and render exactly as before.
//
// Dependencies for the integration package (contract notes):
// - Host adapters (P1.6) should call `ensureMetadata` after reading a
//   layer field and `assertEditable(collection, id, action)` before any
//   geometry, topology, keyframe, or delete write. Selection changes and
//   unlocking skip the assertion via the "select"/"unlock" actions.
// - `duplicate` takes a `nextId` callback (`() => string`) supplied by the
//   host so ID minting stays with the host's session. The callback is
//   retried until it yields IDs outside the collection.
// - The supported expansion range is intentionally open: P1.9 measures the
//   coverage budget and documents the finite range. Until then
//   SUPPORTED_EXPANSION_RANGE is null, `setExpansion` accepts any finite
//   number, and values persist unclamped (never silently clamped).
const DEFAULT_OUTLINE_COLOR = "#58a6ff";
const OUTLINE_PALETTE = [
  "#58a6ff",
  "#f0883e",
  "#3fb950",
  "#d2a8ff",
  "#ff7b72",
  "#ff9e69",
  "#79c0ff",
  "#7ee787",
];
// Open until the expansion coverage measurement (P1.9) documents the finite
// supported range. Renderers must reject unsupported values visibly.
const SUPPORTED_EXPANSION_RANGE = null;
const MAX_NAME_LENGTH = 128;
const OUTLINE_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Actions that remain available on a locked mask.
const PASSIVE_ACTIONS = new Set(["select", "unlock"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLocked(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === undefined) return false;
  throw Error("Layer mask locked must be true, false, 1, or 0");
}

function checkOutlineColor(value) {
  if (typeof value !== "string" || !OUTLINE_PATTERN.test(value))
    throw Error("Layer mask outlineColor must be a #rrggbb hex string");
  return value;
}

function checkExpansion(value) {
  if (!isFiniteNumber(value)) throw Error("Layer mask expansion must be a finite number");
  return value;
}

function checkName(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_NAME_LENGTH)
    throw Error("Layer mask name must be a non-empty string of at most " + MAX_NAME_LENGTH + " characters");
  return value;
}

function findIndex(masks, id) {
  const index = masks.findIndex(mask => mask?.id === id);
  if (index < 0) throw Error("Unknown layer mask id");
  return index;
}

function outlineColorOf(mask) {
  if (mask && typeof mask.outlineColor === "string" && OUTLINE_PATTERN.test(mask.outlineColor))
    return mask.outlineColor;
  return DEFAULT_OUTLINE_COLOR;
}

function expansionOf(mask) {
  return isFiniteNumber(mask?.expansion) ? mask.expansion : 0;
}

function isLocked(mask) {
  return mask?.locked === true || mask?.locked === 1;
}

function nameOf(mask) {
  return typeof mask?.properties?.name === "string" ? mask.properties.name : "";
}

function metadataOf(mask) {
  return {
    name: nameOf(mask),
    outlineColor: outlineColorOf(mask),
    locked: isLocked(mask),
    expansion: expansionOf(mask),
  };
}

// Copy with defaults filled; legacy combine and path fields pass through.
function withMetadataDefaults(mask) {
  const copy = clone(mask);
  if (!OUTLINE_PATTERN.test(typeof copy.outlineColor === "string" ? copy.outlineColor : ""))
    copy.outlineColor = outlineColorOf(mask);
  copy.locked = isLocked(mask);
  if (!isFiniteNumber(copy.expansion)) copy.expansion = expansionOf(mask);
  return copy;
}

function ensureMetadata(masks) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  return masks.map(withMetadataDefaults);
}

function validateMetadata(mask) {
  if (!mask || typeof mask !== "object" || Array.isArray(mask)) throw Error("Layer mask must be an object");
  if (mask.outlineColor !== undefined) checkOutlineColor(mask.outlineColor);
  if (mask.locked !== undefined) normalizeLocked(mask.locked);
  if (mask.expansion !== undefined) checkExpansion(mask.expansion);
  if (mask.properties?.name !== undefined && (typeof mask.properties.name !== "string" || !mask.properties.name))
    throw Error("Layer mask name must be a non-empty string");
  return mask;
}

function validateMetadataCollection(masks) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  for (const mask of masks) validateMetadata(mask);
  return masks;
}

function rename(masks, id, name) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  checkName(name);
  const result = clone(masks);
  const item = result[findIndex(result, id)];
  if (!item.properties || typeof item.properties !== "object") throw Error("Layer mask needs properties");
  item.properties.name = name;
  return result;
}

// Deep clone retaining geometry, keys, properties, combine mode, and display
// fields, with fresh mask and vertex IDs. The copy is named "<name> copy"
// (numbered while taken) and appended after the source. Duplicating a locked
// mask is allowed: it mutates nothing on the locked source.
function duplicate(masks, id, nextId) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  if (typeof nextId !== "function") throw Error("Layer mask duplicate needs an id generator");
  const result = clone(masks);
  const source = result[findIndex(result, id)];
  const taken = new Set(result.flatMap(mask => [mask?.id, ...(Array.isArray(mask?.vertexIds) ? mask.vertexIds : [])]));
  const fresh = () => {
    for (let attempt = 0; attempt < 1024; attempt++) {
      const candidate = nextId();
      if (typeof candidate === "string" && candidate && !taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw Error("Layer mask duplicate could not mint a fresh id");
  };
  const freshVertex = () => {
    for (let attempt = 0; attempt < 1024; attempt++) {
      const candidate = nextId();
      if (typeof candidate === "string" && candidate && !taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw Error("Layer mask duplicate could not mint a fresh vertex id");
  };
  const copy = clone(source);
  copy.id = fresh();
  const remap = new Map((copy.vertexIds || []).map(vertexId => [vertexId, freshVertex()]));
  copy.vertexIds = (copy.vertexIds || []).map(vertexId => remap.get(vertexId));
  if (copy.vertexModes && typeof copy.vertexModes === "object") {
    const modes = {};
    for (const [vertexId, mode] of Object.entries(copy.vertexModes)) {
      if (remap.has(vertexId)) modes[remap.get(vertexId)] = mode;
    }
    copy.vertexModes = modes;
  }
  const baseName = nameOf(copy) ? nameOf(copy) + " copy" : "Mask copy";
  const takenNames = new Set(result.map(item => nameOf(item)));
  let name = baseName, n = 2;
  while (takenNames.has(name)) name = baseName + " " + (n++);
  if (!copy.properties || typeof copy.properties !== "object") copy.properties = {};
  copy.properties.name = name;
  const at = findIndex(result, id);
  result.splice(at + 1, 0, copy);
  return { masks: result, id: copy.id };
}

function move(masks, id, toIndex) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  const result = clone(masks);
  const from = findIndex(result, id);
  const [item] = result.splice(from, 1);
  const clamped = Math.max(0, Math.min(result.length, Math.trunc(toIndex) || 0));
  result.splice(clamped, 0, item);
  return result;
}

// Reorder to exactly the given id sequence (same set, no drops or doubles).
function reorder(masks, idsInOrder) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  if (!Array.isArray(idsInOrder) || idsInOrder.length !== masks.length ||
      new Set(idsInOrder).size !== idsInOrder.length ||
      !idsInOrder.every(id => masks.some(mask => mask?.id === id)))
    throw Error("Layer mask reorder needs the same id set in a new order");
  const byId = new Map(clone(masks).map(mask => [mask.id, mask]));
  return idsInOrder.map(id => byId.get(id));
}

function setLocked(masks, id, locked) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  const result = clone(masks);
  result[findIndex(result, id)].locked = normalizeLocked(locked);
  return result;
}

// Throw when a mutation action targets a locked mask. Read-only focus
// ("select") and "unlock" always pass so locked masks stay navigable.
function assertEditable(masks, id, action = "edit") {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  const item = masks[findIndex(masks, id)];
  if (isLocked(item) && !PASSIVE_ACTIONS.has(action))
    throw Error("Layer mask is locked");
}

function setOutlineColor(masks, id, color) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  checkOutlineColor(color);
  const result = clone(masks);
  result[findIndex(result, id)].outlineColor = color;
  return result;
}

// First palette entry not already used by the collection, else cycle.
function nextOutlineColor(masks) {
  const used = new Set((Array.isArray(masks) ? masks : []).map(outlineColorOf));
  for (const color of OUTLINE_PALETTE) if (!used.has(color)) return color;
  return OUTLINE_PALETTE[(Array.isArray(masks) ? masks.length : 0) % OUTLINE_PALETTE.length];
}

function setExpansion(masks, id, value) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  checkExpansion(value);
  const result = clone(masks);
  result[findIndex(result, id)].expansion = value;
  return result;
}

module.exports = {
  DEFAULT_OUTLINE_COLOR, OUTLINE_PALETTE, SUPPORTED_EXPANSION_RANGE, MAX_NAME_LENGTH,
  metadataOf, outlineColorOf, expansionOf, isLocked, nameOf,
  withMetadataDefaults, ensureMetadata, validateMetadata, validateMetadataCollection,
  rename, duplicate, move, reorder, setLocked, assertEditable,
  setOutlineColor, nextOutlineColor, setExpansion,
};
