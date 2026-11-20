"use strict";
// Host adapters for the shared path controller (P1.1): one mask adapter and
// one Shape+ adapter, plus atomic creation requests.
//
// Consumed contracts (already merged, required directly):
// - `path-controller.js`: an adapter needs `id` plus `hasPath`/`listPathIds`
//   for prune-on-undo; `listVertexIds` filters vertex reads; `syncSelection`
//   mirrors activation and selection; `isLocked` is never called by the
//   controller (locked paths select exactly like unlocked ones).
// - `mask-metadata.js`: `isLocked`, `assertEditable`,
//   `nextOutlineColor`, `validateMetadataCollection`; adapters call
//   `ensureMetadata`-style tolerant readers and `assertEditable` before
//   geometry, topology, keyframe, or delete writes.
// - `mask-model.js`: `createMask`, `validateMasks`, `ensureNames` for the
//   mask collection encoding (`zoidiumMasks` field, combine order).
//
// Store seam (both adapters; the integration package P1.7 wires the real
// backends, tests use in-memory fakes):
// - `store.read()` returns an array of path JSON (mask collection or Shape+
//   path records); null/undefined reads as an empty collection.
// - `store.write(array)` persists it. The adapter always passes a fresh
//   clone, so implementations may keep the reference.
// - `store.nextId()` mints candidate ids; the adapter retries past
//   collisions, so generators may be random or sequential.
//
// P1.7 wiring sketches (not done here; this module stays native-free):
// - Mask: `read: () => host.readHistory(layer) || []`,
//   `write: data => host.writeHistory(layer, data)`,
//   `nextId: session.nextId`, `mirror: session`, where `host` is a real
//   `mask-host.js` host and `session` its `createMaskSession` state.
// - Shape+: `read`/`write` over the layer contents' path records (walk
//   groups in draw order), `nextId` from the content model, `mirror` from
//   the editor session, `isLocked` from the layer lock when one exists.
//
// Lock policy: a locked mask/Shape+ path stays visible and selectable.
// `writeSnapshot` rejects any change to a locked entry (mask entries may
// still flip only their `locked` flag, so unlocking keeps working);
// `deletePath` rejects locked ids; `restoreSnapshot` writes verbatim with
// no lock check because it is the undo/project-load path, not an edit.
//
// Creation routing (design: first click on a selected Scene/Adjustment
// layer creates a mask; on a Shape+ layer a Shape+ path; with no compatible
// selected layer -- including an incompatible selection -- one history
// operation creates a Shape+ layer and path): `requestCreation` picks the
// request from the available adapters, `applyCreation` performs it inside
// at most one history operation and activates the new path.
//
// Deferred to later packages: evaluated geometry and screen projection
// (P2.1 reads host matrices), timeline operations (P3.x bridge), and the
// overlay/panel wiring (P1.7).
const {
  isLocked: isMaskLocked,
  assertEditable,
  nextOutlineColor,
  validateMetadataCollection,
  MAX_NAME_LENGTH,
} = require("./mask-metadata.js");
const { createMask, validateMasks, ensureNames, getMasks } = require("./mask-model.js");
const { createPathController } = require("./path-controller.js");
const { createPathInput } = require("./path-input.js");
const { bindPathSession, writePathRecords } = require("./editor-model.js");

const HOST_KINDS = ["mask", "shape"];
const MINT_ATTEMPTS = 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Key-order-insensitive equality for lock diffing: caller-built snapshots
// may order keys differently from stored ones without changing meaning.
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function assertHostId(id) {
  if (typeof id !== "string" || !id) throw Error("Path host needs a string id");
  return id;
}

function assertStore(store) {
  if (!store || typeof store.read !== "function" ||
      typeof store.write !== "function" || typeof store.nextId !== "function")
    throw Error("Path host store needs read, write, and nextId functions");
  return store;
}

function readRecords(store) {
  const data = store.read();
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw Error("Path host store must read an array");
  return data;
}

// Mint an id outside `taken`, retrying past generator collisions.
function mintId(nextId, taken) {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const candidate = nextId();
    if (typeof candidate === "string" && candidate && !taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw Error("Path host could not mint a fresh id");
}

function checkPoint(point) {
  if (!Array.isArray(point) || point.length < 2 ||
      !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
    throw Error("Path creation point must hold two finite numbers");
  return [point[0], point[1]];
}

function checkName(name) {
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH)
    throw Error("Layer mask name must be a non-empty string of at most " + MAX_NAME_LENGTH + " characters");
  return name;
}

// Mirror controller selection into a session-shaped object. Only fields
// that exist are touched, so partial mirrors keep working.
function mirrorSelection(mirror, hostId, pathId, vertices) {
  if (!mirror) return;
  if ("activeId" in mirror) mirror.activeId = pathId;
  if (mirror.selection instanceof Set) {
    mirror.selection.clear();
    for (const vertex of vertices) mirror.selection.add(vertex);
  }
  if (mirror.treeSelection instanceof Set) {
    mirror.treeSelection.clear();
    if (pathId !== null) mirror.treeSelection.add(pathId);
  }
}

function isAdapter(value) {
  return !!value && typeof value.listPathIds === "function" &&
    typeof value.createPath === "function" && typeof value.readSnapshot === "function";
}

function createMaskPathHost({ id, store, mirror = null, controller = null } = {}) {
  assertHostId(id);
  assertStore(store);

  function current() {
    return clone(readRecords(store));
  }

  function notify() {
    if (controller && typeof controller.handlePathsChanged === "function")
      controller.handlePathsChanged(api);
  }

  const live = () => store.live?.() || readRecords(store);

  function hasPath(pathId) {
    return live().some(mask => mask?.id === pathId);
  }

  function listPathIds() {
    return live().map(mask => mask.id);
  }

  function listVertexIds(pathId) {
    const mask = live().find(entry => entry?.id === pathId);
    return Array.isArray(mask?.vertexIds) ? mask.vertexIds.slice() : [];
  }

  function isLocked(pathId) {
    const mask = readRecords(store).find(entry => entry?.id === pathId);
    return mask ? isMaskLocked(mask) : false;
  }

  function syncSelection(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw Error("Path selection needs a snapshot");
    if (snapshot.hostId !== id) throw Error("Path selection host mismatch");
    const pathId = snapshot.pathId === undefined ? null : snapshot.pathId;
    const vertices = Array.isArray(snapshot.vertices) ? snapshot.vertices : [];
    if (pathId !== null && !hasPath(pathId)) throw Error("Unknown path " + pathId);
    if (store.syncSelection) store.syncSelection({ hostId: id, pathId, vertices });
    else mirrorSelection(mirror, id, pathId, vertices);
    return { hostId: id, pathId, vertices: vertices.slice() };
  }

  function readSnapshot() {
    return current();
  }

  // Editing write: locked entries must round-trip unchanged except that
  // their own `locked` flag may be cleared (unlocking stays available).
  function writeSnapshot(masks) {
    if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
    const incoming = clone(masks);
    validateMasks(incoming);
    validateMetadataCollection(incoming);
    const before = readRecords(store);
    const nextById = new Map(incoming.map(mask => [mask?.id, mask]));
    for (const mask of before) {
      if (!isMaskLocked(mask)) continue;
      const next = nextById.get(mask.id);
      if (!next) throw Error("Layer mask is locked");
      const { locked: _before, ...beforeRest } = mask;
      const { locked: _after, ...afterRest } = next;
      if (stableStringify(beforeRest) !== stableStringify(afterRest))
        throw Error("Layer mask is locked");
    }
    store.write(incoming);
    notify();
    return clone(incoming);
  }

  // Undo/project-load write: verbatim, no lock check.
  function restoreSnapshot(snapshot) {
    if (!Array.isArray(snapshot)) throw Error("Layer masks must be an array");
    const data = clone(snapshot);
    validateMasks(data);
    validateMetadataCollection(data);
    store.write(data);
    notify();
    return clone(data);
  }

  function createPath({ point = [0, 0], name } = {}) {
    const at = checkPoint(point);
    const before = current();
    validateMasks(before);
    const taken = new Set(before.flatMap(mask => [mask.id, ...mask.vertexIds]));
    const freshId = mintId(store.nextId, taken);
    const item = createMask(freshId, "Path", at);
    let vertexId = "v1", suffix = 1;
    while (taken.has(vertexId)) vertexId = "v" + (++suffix);
    item.vertexIds = [vertexId];
    item.outlineColor = nextOutlineColor(before);
    item.locked = false;
    item.expansion = 0;
    if (name !== undefined) item.properties.name = checkName(name);
    const next = ensureNames([...before, item]);
    validateMasks(next);
    store.write(next);
    notify();
    return freshId;
  }

  function deletePath(pathId) {
    const before = current();
    assertEditable(before, pathId, "delete");
    store.write(before.filter(mask => mask.id !== pathId));
    notify();
    return pathId;
  }

  const api = {
    id,
    kind: "mask",
    hasPath,
    listPathIds,
    listVertexIds,
    isLocked,
    syncSelection,
    readSnapshot,
    writeSnapshot,
    restoreSnapshot,
    createPath,
    deletePath,
  };
  return api;
}

function checkShapeRecords(records) {
  if (!Array.isArray(records)) throw Error("Shape+ paths must be an array");
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw Error("Shape+ path must be an object");
    if (typeof record.id !== "string" || !record.id)
      throw Error("Shape+ path needs a short string id");
    if (ids.has(record.id)) throw Error("Duplicate Shape+ path id");
    ids.add(record.id);
    if (record.vertexIds !== undefined &&
        (!Array.isArray(record.vertexIds) ||
          !record.vertexIds.every(vertex => typeof vertex === "string" && vertex)))
      throw Error("Shape+ path needs string vertex ids");
  }
  return records;
}

function checkShapeTopology(vertexIds) {
  if (!Array.isArray(vertexIds) || vertexIds.length < 1 || vertexIds.length > 256 ||
      new Set(vertexIds).size !== vertexIds.length ||
      !vertexIds.every(vertex => typeof vertex === "string" && vertex && vertex.length <= 128))
    throw Error("Shape+ path needs 1-256 unique vertex ids");
  return vertexIds.slice();
}

function createShapePathHost({ id, store, mirror = null, controller = null, isLocked = null } = {}) {
  assertHostId(id);
  assertStore(store);
  const lockedBy = isLocked === null || isLocked === undefined ? () => false : isLocked;
  if (typeof lockedBy !== "function") throw Error("Shape+ host lock needs a function");

  function current() {
    return clone(readRecords(store));
  }

  function notify() {
    if (controller && typeof controller.handlePathsChanged === "function")
      controller.handlePathsChanged(api);
  }

  function hasPath(pathId) {
    return readRecords(store).some(record => record?.id === pathId);
  }

  function listPathIds() {
    return readRecords(store).map(record => record.id);
  }

  function listVertexIds(pathId) {
    const record = readRecords(store).find(entry => entry?.id === pathId);
    return Array.isArray(record?.vertexIds) ? record.vertexIds.slice() : [];
  }

  function locked(pathId) {
    const record = readRecords(store).find(entry => entry?.id === pathId);
    return record ? !!lockedBy(record.id) : false;
  }

  function syncSelection(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw Error("Path selection needs a snapshot");
    if (snapshot.hostId !== id) throw Error("Path selection host mismatch");
    const pathId = snapshot.pathId === undefined ? null : snapshot.pathId;
    const vertices = Array.isArray(snapshot.vertices) ? snapshot.vertices : [];
    if (pathId !== null && !hasPath(pathId)) throw Error("Unknown path " + pathId);
    if (store.syncSelection) store.syncSelection({ hostId: id, pathId, vertices });
    else mirrorSelection(mirror, id, pathId, vertices);
    return { hostId: id, pathId, vertices: vertices.slice() };
  }

  function readSnapshot() {
    return current();
  }

  function writeSnapshot(records) {
    const incoming = clone(records);
    checkShapeRecords(incoming);
    const before = readRecords(store);
    const nextById = new Map(incoming.map(record => [record?.id, record]));
    for (const record of before) {
      if (!lockedBy(record.id)) continue;
      const next = nextById.get(record.id);
      if (!next || stableStringify(next) !== stableStringify(record))
        throw Error("Shape+ path is locked");
    }
    store.write(incoming);
    notify();
    return clone(incoming);
  }

  function restoreSnapshot(snapshot) {
    if (!Array.isArray(snapshot)) throw Error("Shape+ paths must be an array");
    const data = clone(snapshot);
    checkShapeRecords(data);
    store.write(data);
    notify();
    return clone(data);
  }

  function createPath({ vertexIds = ["v1"], fields = {}, point } = {}) {
    if (store.createPath) return store.createPath(checkPoint(point));
    const vertices = checkShapeTopology(vertexIds);
    const before = current();
    checkShapeRecords(before);
    const taken = new Set(before.flatMap(record => [record.id, ...(record.vertexIds || [])]).concat(vertices));
    const freshId = mintId(store.nextId, taken);
    const record = { ...clone(fields), id: freshId, kind: "path", vertexIds: vertices };
    const next = [...before, record];
    checkShapeRecords(next);
    store.write(next);
    notify();
    return freshId;
  }

  function deletePath(pathId) {
    const before = current();
    if (!before.some(record => record?.id === pathId)) throw Error("Unknown Shape+ path " + pathId);
    if (lockedBy(pathId)) throw Error("Shape+ path is locked");
    store.write(before.filter(record => record.id !== pathId));
    notify();
    return pathId;
  }

  const api = {
    id,
    kind: "shape",
    hasPath,
    listPathIds,
    listVertexIds,
    isLocked: locked,
    syncSelection,
    readSnapshot,
    writeSnapshot,
    restoreSnapshot,
    createPath,
    deletePath,
  };
  return api;
}

// Pick the creation target: a mask request on a selected maskable layer, a
// Shape+ request on a selected Shape+ layer, otherwise a new-layer request
// (null and incompatible selections follow the same rule by design).
function requestCreation({ mask = null, shape = null } = {}) {
  for (const candidate of [mask, shape]) {
    if (candidate !== null && candidate !== undefined && !isAdapter(candidate))
      throw Error("Path creation needs a host adapter");
  }
  if (mask) return { kind: "mask", host: mask };
  if (shape) return { kind: "shape", host: shape };
  return { kind: "new-shape-layer", host: null };
}

function restoreHostSnapshot(payload) {
  payload.host.restoreSnapshot(payload.before);
}

function historyIsBusy(history) {
  return !!history && history.operation !== null && history.operation !== undefined;
}

// Perform a creation request inside at most one history operation, then
// activate the new path when a controller is supplied. Undo restores the
// pre-creation snapshot for mask/Shape+ requests; new-layer requests undo
// through the caller-supplied `rollback` (usually removing the layer),
// which is required because only the layer factory owns that object.
function applyCreation(request, options = {}) {
  if (!request || typeof request.kind !== "string") throw Error("Path creation needs a request");
  const {
    point = [0, 0],
    history = null,
    controller = null,
    createShapeLayer = null,
    rollback = null,
  } = options;
  if (historyIsBusy(history)) throw Error("Path creation needs a free history");
  if (request.kind === "mask" || request.kind === "shape") {
    const host = request.host;
    if (!isAdapter(host)) throw Error("Path creation needs a host adapter");
    const before = host.readSnapshot();
    if (history) history.startOperation();
    try {
      const pathId = host.createPath({ point });
      if (history) {
        history.pushCommand(restoreHostSnapshot, { host, before });
        history.finishOperation();
      }
      if (controller && typeof controller.activate === "function")
        controller.activate(host, pathId);
      return { kind: request.kind, host, pathId };
    } catch (error) {
      if (history && typeof history.discardOperation === "function") history.discardOperation();
      throw error;
    }
  }
  if (request.kind === "new-shape-layer") {
    if (typeof createShapeLayer !== "function")
      throw Error("Path creation needs a Shape+ layer factory");
    if (typeof rollback !== "function" && history)
      throw Error("Path creation needs a rollback for a new Shape+ layer");
    if (history) history.startOperation();
    try {
      const created = createShapeLayer();
      const host = created && created.host ? created.host : created;
      if (!isAdapter(host)) throw Error("Path creation needs a Shape+ layer factory");
      const pathId = host.createPath({ point });
      if (history) {
        history.pushCommand(rollback, { host, pathId, before: [] });
        history.finishOperation();
      }
      if (controller && typeof controller.activate === "function")
        controller.activate(host, pathId);
      return { kind: request.kind, host, pathId };
    } catch (error) {
      if (history && typeof history.discardOperation === "function") history.discardOperation();
      throw error;
    }
  }
  throw Error("Unknown path creation kind " + request.kind);
}

// The runtime owns this registry. A project change discards both the
// controller and the adapters, including adapters for closed overlays.
function createEditorPathRegistry(editor, viewport) {
  let controller, input;
  function reset() {
    controller?.dispose();
    controller = createPathController({ project: editor.project, viewport });
    input = createPathInput({ controller });
  }
  reset();
  let hosts = new WeakMap(), nextHostId = 0;
  function register(kind, layer, session) {
    let entry = hosts.get(layer);
    if (!entry || entry.kind !== kind) {
      entry = { kind, session, maskHost: session.pathHost };
      const slots = new Map(), Content = session.Content;
      const read = () => {
        if (kind === "mask") return getMasks(layer);
        const paths = [];
        const visit = items => items.forEach(item => {
          if (item.kind === "path") paths.push(item);
          if (Array.isArray(item.contents)) visit(item.contents);
        });
        visit(layer.contents || entry.session?.read() || []);
        return paths;
      };
      const store = {
        read,
        write(data) {
          if (kind === "mask") entry.maskHost.writeHistory(layer, data);
          else {
            const active = entry.session?.active?.();
            writePathRecords(layer, Content, data, slots, active?.kind === "group" ? active.id : null);
            entry.session?.preview?.();
          }
        },
        nextId: session.nextId,
        syncSelection(snapshot) {
          const target = entry.session;
          if (target?.applyPathSelection) target.applyPathSelection(snapshot);
          else if (snapshot.pathId !== null) target?.selectItem(snapshot.pathId);
        },
      };
      if (kind === "mask") store.live = () => entry.maskHost.contents();
      else if (session.addItem) store.createPath = point => {
        if (!entry.session?.valid()) throw Error("Shape+ path editing is unavailable");
        return entry.session.addItem("path", point, { groupsOnly: false }).id;
      };
      const options = { id: "editor-path-host-" + (++nextHostId), store, controller };
      entry.host = kind === "mask" ? createMaskPathHost(options) : createShapePathHost(options);
      hosts.set(layer, entry);
    }
    if (entry.session !== session || session.sharedPathHost !== entry.host) {
      entry.session = session;
      if (kind === "mask") entry.maskHost = session.pathHost;
      if (session.selection instanceof Set) {
        bindPathSession(session, controller, entry.host);
        session.pathInput = input;
      }
      if (controller.activeHost === entry.host) controller.handlePathsChanged(entry.host);
    }
    return entry.host;
  }
  function unregister(layer, session) {
    const entry = hosts.get(layer);
    if (entry?.session === session) entry.session = null;
  }
  function changed() {
    hosts = new WeakMap();
    reset();
  }
  editor.onProjectChanged.watch(changed);
  return {
    get controller() { return controller; },
    get input() { return input; },
    hostForLayer: layer => hosts.get(layer)?.host,
    register,
    unregister,
    activate(kind, layer, pathId) {
      const entry = hosts.get(layer);
      if (!entry || entry.kind !== kind || !entry.host.hasPath(pathId)) return false;
      controller.activate(entry.host, pathId);
      return true;
    },
    dispose() { editor.onProjectChanged.unwatch(changed); controller.dispose(); hosts = new WeakMap(); },
  };
}

module.exports = {
  HOST_KINDS,
  createMaskPathHost,
  createShapePathHost,
  requestCreation,
  applyCreation,
  createEditorPathRegistry,
};
