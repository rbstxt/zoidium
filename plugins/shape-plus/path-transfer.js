"use strict";
// Transfer contract: the caller evaluates a six-number affine matrix
// [a,b,c,d,tx,ty] at the paste playhead. It maps source layer coordinates
// to destination layer coordinates. The caller must reject perspective before
// supplying the matrix. Hosts expose P1.6 snapshot methods. For a Shape+
// destination, createPainted(group) inserts the supplied group with its default fill;
// its host snapshot must cover the entire contents tree changed by the callback.
// A history object follows P1.6's operation/command interface. The caller
// supplies an ID generator unique within both affected contents trees.
const animation = require("./path-animation.js");
const { createMask } = require("./mask-model.js");
const metadata = require("./mask-metadata.js");
const VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const modes = ["corner", "smooth", "symmetric", "independent"];
function validId(id) { return typeof id === "string" && id.length > 0 && id.length <= 128; }
function validate(envelope) {
  if (!envelope || envelope.type !== "zoidium-path" || envelope.version !== VERSION)
    throw Error("Unsupported path clipboard version or envelope");
  const p = envelope.path;
  if (!p || !validId(p.id) || !Array.isArray(p.vertexIds) || !p.vertexIds.length || p.vertexIds.length > 256 ||
      !p.vertexIds.every(validId) || new Set(p.vertexIds).size !== p.vertexIds.length ||
      !p.vertexModes || typeof p.vertexModes !== "object" || Array.isArray(p.vertexModes) ||
      Object.entries(p.vertexModes).some(([id, mode]) => !p.vertexIds.includes(id) || !modes.includes(mode)) ||
      ![0, 1, false, true].includes(p.closed)) throw Error("Invalid clipboard path topology");
  if (!Array.isArray(p.channels) || p.channels.length !== p.vertexIds.length * 6)
    throw Error("Invalid clipboard path channels");
  for (const channel of p.channels) {
    if (!channel || channel.expression) throw Error("Expression-driven paths cannot be transferred");
    if (!Array.isArray(channel.keyframes) || !channel.keyframes.length) throw Error("Invalid path keyframes");
    const frames = new Set();
    for (const key of channel.keyframes) {
      if (!key || !Number.isFinite(key.frame) || !Number.isFinite(key.value) || frames.has(key.frame))
        throw Error("Invalid path keyframes");
      frames.add(key.frame);
    }
  }
  return clone(envelope);
}
function copyPath(item) {
  const channels = animation.channels(item);
  return validate({ type: "zoidium-path", version: VERSION, path: {
    id: item.id, vertexIds: clone(item.vertexIds), vertexModes: clone(item.vertexModes || {}),
    closed: item.properties.closed, channels,
  } });
}
function matrixValues(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite))
    throw Error("Path transfer requires a finite affine mapping");
  const [a, b, c, d] = matrix;
  if (!Number.isFinite(a * d - b * c) || a * d - b * c === 0)
    throw Error("Path transfer requires an invertible affine mapping");
  return matrix;
}
function keyShape(channel) {
  const result = clone(channel);
  for (const key of result.keyframes) delete key.value;
  return JSON.stringify(result);
}
function mint(nextId, taken) {
  for (let i = 0; i < 1024; i++) {
    const id = nextId();
    if (validId(id) && !taken.has(id)) { taken.add(id); return id; }
  }
  throw Error("Could not create a fresh path ID");
}
function transformPair(x, y, m, translate, adapter) {
  const [a, b, c, d, tx, ty] = m;
  // Mixing channels with distinct key metadata can change interpolation.
  // A native adapter may synchronize and certify the pair before transfer.
  let pair = [x, y];
  if ((c !== 0 || b !== 0) && keyShape(x) !== keyShape(y)) {
    if (typeof adapter?.preparePair !== "function")
      throw Error("Cannot preserve animation across this affine mapping");
    pair = adapter.preparePair(clone(pair), m.slice());
    if (!Array.isArray(pair) || pair.length !== 2 || keyShape(pair[0]) !== keyShape(pair[1]) ||
        adapter.certifyPair?.(clone([x, y]), clone(pair), m.slice()) !== true)
      throw Error("Cannot preserve animation across this affine mapping");
  }
  const [px, py] = pair;
  const out = clone(pair);
  if (c !== 0 || b !== 0) {
    out[0].keyframes.forEach((key, i) => { key.value = a * px.keyframes[i].value + c * py.keyframes[i].value + (translate ? tx : 0); });
    out[1].keyframes.forEach((key, i) => { key.value = b * px.keyframes[i].value + d * py.keyframes[i].value + (translate ? ty : 0); });
  } else {
    out[0].keyframes.forEach(key => { key.value = a * key.value + (translate ? tx : 0); });
    out[1].keyframes.forEach(key => { key.value = d * key.value + (translate ? ty : 0); });
  }
  if (out.some(channel => channel.keyframes.some(key => !Number.isFinite(key.value))))
    throw Error("Affine mapping produced invalid path values");
  return out;
}
function grouped(channels) {
  if (!channels.every(channel => keyShape(channel) === keyShape(channels[0]))) return null;
  const first = channels[0];
  return { animated: !!first.animated, keyframes: first.keyframes.map((key, i) => ({
    ...clone(key), value: channels.map(channel => channel.keyframes[i].value),
  })) };
}
function materialize(envelope, matrix, nextId, existingIds = [], adapter) {
  const p = validate(envelope).path, m = matrixValues(matrix);
  if (typeof nextId !== "function") throw Error("Path transfer needs an ID generator");
  const taken = new Set([...existingIds, p.id, ...p.vertexIds]);
  const id = mint(nextId, taken), vertexIds = p.vertexIds.map(() => mint(nextId, taken));
  const vertexModes = {};
  p.vertexIds.forEach((old, i) => { if (p.vertexModes[old]) vertexModes[vertexIds[i]] = p.vertexModes[old]; });
  const list = [];
  for (let i = 0; i < p.channels.length; i += 2)
    list.push(...transformPair(p.channels[i], p.channels[i + 1], m, i % 6 === 0, adapter));
  const path = grouped(list) || { objects: list };
  return { id, kind: "path", vertexIds, vertexModes, properties: { name: "Path", enabled: 1, closed: Number(p.closed), path } };
}
function restore(payload) {
  const current = payload.hosts.map(host => host.readSnapshot());
  payload.hosts.forEach((host, i) => host.restoreSnapshot(payload.snapshots[i]));
  payload.history.pushCommand(restore, { ...payload, snapshots: current });
}
function execute({ envelope, source = null, pathId = null, destination, matrix, nextId, history, createPainted, adapter }) {
  if (!destination || !["mask", "shape"].includes(destination.kind) || !history || history.operation != null)
    throw Error("Path transfer needs a destination and a free history");
  if (source && (source === destination || source.kind === destination.kind))
    throw Error("Conversion needs different source and destination hosts");
  if (source && source.isLocked(pathId)) throw Error("The source path is locked");
  const hosts = source ? [destination, source] : [destination];
  const snapshots = hosts.map(host => host.readSnapshot());
  const existing = snapshots.flatMap(snapshot => snapshot.flatMap(item => [item.id, ...(item.vertexIds || [])]));
  const item = materialize(envelope, matrix, nextId, existing, adapter);
  if (destination.kind === "mask") {
    if (!item.properties.path.keyframes) throw Error("Cannot preserve separate channel keys in a mask");
    Object.assign(item, { ...createMask(item.id, "Path", [0, 0]), ...item, mode: "add", feather: 0, opacity: 1, invert: 0,
      locked: false, expansion: 0, outlineColor: metadata.nextOutlineColor(snapshots[0]) });
  } else if (typeof createPainted !== "function") throw Error("Shape+ transfer needs a painted group factory");
  history.startOperation();
  try {
    if (destination.kind === "mask") destination.writeSnapshot([...snapshots[0], item]);
    else {
      const taken = new Set([...existing, item.id, ...item.vertexIds]);
      const group = { id: mint(nextId, taken), kind: "group", properties: {},
        contents: [item, { id: mint(nextId, taken), kind: "fill", properties: {} }] };
      createPainted(group);
    }
    if (source) source.deletePath(pathId);
    history.pushCommand(restore, { hosts, snapshots, history });
    history.finishOperation();
    return item.id;
  } catch (error) {
    try { hosts.forEach((host, i) => host.restoreSnapshot(snapshots[i])); }
    finally { history.discardOperation(); }
    throw error;
  }
}
function paste(options) { return execute(options); }
function convert(options) {
  const item = options.source?.readSnapshot().find(entry => entry.id === options.pathId);
  if (!item) throw Error("Unknown source path");
  return execute({ ...options, envelope: copyPath(item) });
}
module.exports = { VERSION, validate, copyPath, materialize, paste, convert };
