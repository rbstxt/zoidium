"use strict";

// Constraint properties on native 3D objects.
//
// Every 3D object that can rotate (and every spot or directional light) gets
// four native property rows, appended after its own transform rows:
//   zoidiumTrackTo     "Track to"   TEXT, the target's zoidiumId ("" = None)
//   zoidiumTrackAxis   "Track axis" OPTION +X..-Z
//   zoidiumUpAxis      "Up axis"    OPTION X/Y/Z
//   zoidiumInfluence   "Influence"  animatable NUMBER, percent
// plus one hidden TEXT property, zoidiumId, which is the persistent identity
// of an object once something targets it.
//
// The properties serialize inside the object's `properties` record. A value
// equal to its default is omitted, so objects without a constraint serialize
// exactly as before. Older builds ignore the unknown property keys.

const math = require("./track-to-math.js");

const KEYS = Object.freeze({
  target: "zoidiumTrackTo",
  trackAxis: "zoidiumTrackAxis",
  upAxis: "zoidiumUpAxis",
  influence: "zoidiumInfluence",
  id: "zoidiumId",
});
const ROW_KEYS = [KEYS.target, KEYS.trackAxis, KEYS.upAxis, KEYS.influence];
const ALL_KEYS = ROW_KEYS.concat([KEYS.id]);
const CONTROL_IDS = Object.freeze({
  target: "constraints/track-to",
  trackAxis: "constraints/track-axis",
  upAxis: "constraints/up-axis",
});
const CAMERA_PLUS_TYPE = "zoidium:camera-plus/camera";
const SPOT_LIGHT = 1;
const DIRECTIONAL_LIGHT = 3;

function createUuid(cryptoApi) {
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createPropertyStore(options) {
  const PZ = options.PZ;
  const cryptoApi = options.crypto || null;
  const onTargetChanged = options.onTargetChanged || (() => {});
  const onValueChanged = options.onValueChanged || (() => {});
  const T = PZ.property.type;

  // Weak, so deleted objects and replaced projects are released.
  const attached = new WeakSet();
  const loading = new WeakSet();
  const pendingListUpdates = new Set();
  const definitionCache = new Map();
  let listUpdateScheduled = false;
  let batch = null;
  let batchDepth = 0;

  function isObject3d(object) {
    return Boolean(object && PZ.object3d && object instanceof PZ.object3d);
  }

  function isLight(object) {
    return Boolean(PZ.object3d.light && object instanceof PZ.object3d.light);
  }

  function isCameraLike(object) {
    return Boolean(
      (PZ.object3d.camera && object instanceof PZ.object3d.camera) ||
      object?.type === CAMERA_PLUS_TYPE ||
      object?.threeObj?.isCamera
    );
  }

  // "rotation": constrain the local rotation; "light": aim a spot or
  // directional light; "none": the object cannot be constrained.
  function classify(object) {
    if (!isObject3d(object)) return "none";
    if (isLight(object)) {
      return object.objectType === SPOT_LIGHT || object.objectType === DIRECTIONAL_LIGHT ? "light" : "none";
    }
    const rotation = object.properties?.rotation;
    return rotation && typeof rotation.get === "function" && object.threeObj ? "rotation" : "none";
  }

  function definitionsFor(kind, camera) {
    const cacheKey = `${kind}:${camera ? 1 : 0}`;
    if (definitionCache.has(cacheKey)) return definitionCache.get(cacheKey);
    const defaultTrack = kind === "light" || camera ? math.TRACK_NEGATIVE_Z : math.TRACK_POSITIVE_Z;
    const definitions = {
      [KEYS.target]: {
        name: "Track to",
        type: T.TEXT,
        value: "",
        zoidiumControl: CONTROL_IDS.target,
        changed: function () { handleChange(this, true); },
      },
      [KEYS.trackAxis]: {
        name: "Track axis",
        type: T.OPTION,
        value: defaultTrack,
        items: math.TRACK_AXIS_ITEMS,
        zoidiumControl: CONTROL_IDS.trackAxis,
        changed: function () { handleChange(this, false); },
      },
      [KEYS.upAxis]: {
        name: "Up axis",
        type: T.OPTION,
        value: math.UP_Y,
        items: math.UP_AXIS_ITEMS,
        zoidiumControl: CONTROL_IDS.upAxis,
        changed: function () { handleChange(this, false); },
      },
      [KEYS.influence]: {
        dynamic: true,
        name: "Influence",
        type: T.NUMBER,
        value: 100,
        min: 0,
        max: 100,
        step: 1,
        decimals: 1,
      },
      [KEYS.id]: {
        visible: false,
        name: "Constraint ID",
        type: T.TEXT,
        value: "",
      },
    };
    const entry = { definitions, defaults: {} };
    for (const key of ALL_KEYS) {
      const { changed: _changed, ...probeDefinition } = definitions[key];
      const probe = PZ.property.create(probeDefinition);
      probe.load(undefined);
      entry.defaults[key] = JSON.stringify(probe);
    }
    definitionCache.set(cacheKey, entry);
    return entry;
  }

  function handleChange(property, targetChanged) {
    let object = null;
    try {
      object = property.parentObject;
    } catch (_error) {
      object = null;
    }
    if (!object || loading.has(object) || !attached.has(object)) return;
    if (targetChanged) {
      syncVisibility(object, true);
      onTargetChanged(object);
    }
    onValueChanged(object);
  }

  function omitDefault(property, defaultJson, keepDefault) {
    const nativeToJSON = property.toJSON;
    Object.defineProperty(property, "toJSON", {
      configurable: true,
      writable: true,
      value: function toJSON() {
        const json = nativeToJSON.apply(this, arguments);
        try {
          if (!keepDefault && JSON.stringify(json) === defaultJson) return undefined;
        } catch (_error) {
          // An unserializable value is never the default; keep it.
        }
        return json;
      },
    });
  }

  function propertyOf(object, key) {
    const property = object?.properties?.[key];
    return property && typeof property.get === "function" ? property : null;
  }

  function readStatic(object, key, fallback) {
    const property = propertyOf(object, key);
    if (!property) return fallback;
    try {
      const value = property.get();
      return value === undefined || value === null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function readTarget(object) {
    const value = readStatic(object, KEYS.target, "");
    return typeof value === "string" ? value : "";
  }

  function readId(object) {
    const value = readStatic(object, KEYS.id, "");
    return typeof value === "string" ? value : "";
  }

  function readTrackAxis(object) {
    return readStatic(object, KEYS.trackAxis, math.TRACK_POSITIVE_Z);
  }

  function readUpAxis(object) {
    return readStatic(object, KEYS.upAxis, math.UP_Y);
  }

  function readInfluence(object, frame) {
    const property = propertyOf(object, KEYS.influence);
    if (!property) return 100;
    try {
      const value = Number(property.get(frame));
      return Number.isFinite(value) ? value : 100;
    } catch (_error) {
      return 100;
    }
  }

  function isAttached(object) {
    return attached.has(object);
  }

  function scheduleListUpdate(object) {
    pendingListUpdates.add(object);
    if (listUpdateScheduled) return;
    listUpdateScheduled = true;
    // Rebuild the rows after the current edit has finished; the select that
    // triggered the change must not be removed from inside its own handler.
    Promise.resolve().then(() => {
      listUpdateScheduled = false;
      const objects = Array.from(pendingListUpdates);
      pendingListUpdates.clear();
      for (const item of objects) {
        if (attached.has(item)) item.properties?.onListChanged?.update?.();
      }
    });
  }

  // Track axis, up axis and influence are shown only while a target is set.
  function syncVisibility(object, notify) {
    const kind = classify(object);
    const hasTarget = readTarget(object) !== "";
    const wanted = {
      [KEYS.target]: kind !== "none",
      [KEYS.trackAxis]: hasTarget && kind === "rotation",
      [KEYS.upAxis]: hasTarget && kind === "rotation",
      [KEYS.influence]: hasTarget && kind !== "none",
    };
    let changed = false;
    for (const key of ROW_KEYS) {
      const property = propertyOf(object, key);
      if (!property) continue;
      if ((property.visible !== false) !== wanted[key]) {
        property.visible = wanted[key];
        changed = true;
      }
    }
    if (changed && notify) scheduleListUpdate(object);
  }

  function findProject(object) {
    try {
      return object.parentProject || null;
    } catch (_error) {
      return null;
    }
  }

  function idTakenElsewhere(object, id) {
    const project = findProject(object);
    if (!project || typeof project.forEachItemOfType !== "function") return false;
    let taken = false;
    try {
      project.forEachItemOfType(PZ.object3d, (other) => {
        if (!taken && other !== object && attached.has(other) && readId(other) === id) taken = true;
      });
    } catch (_error) {
      return false;
    }
    return taken;
  }

  function setRaw(object, key, value) {
    const property = propertyOf(object, key);
    if (!property || typeof property.set !== "function") return;
    property.set(value);
  }

  // Gives the object a persistent identity the first time it becomes a
  // target. The id is not a history entry: it is inert metadata, kept when
  // the edit that needed it is undone.
  function ensureId(object) {
    if (!attached.has(object)) return "";
    let id = readId(object);
    if (!id || idTakenElsewhere(object, id)) {
      id = createUuid(cryptoApi);
      setRaw(object, KEYS.id, id);
    }
    return id;
  }

  function attach(object, data) {
    if (!isObject3d(object) || attached.has(object)) return false;
    const kind = classify(object);
    const properties = object.properties;
    if (!properties || typeof properties.addAll !== "function") return false;
    if (ALL_KEYS.some((key) => properties[key])) return false;
    const entry = definitionsFor(kind, isCameraLike(object));
    const created = {};
    for (const key of ALL_KEYS) {
      created[key] = PZ.property.create(entry.definitions[key]);
      // The host preserves unknown saved properties before these rows attach.
      // Write an explicit default for previously saved keys so clearing a
      // constraint cannot resurrect that preserved value on the next save.
      const wasSaved = Object.prototype.hasOwnProperty.call(data?.properties || {}, key);
      omitDefault(created[key], entry.defaults[key], wasSaved);
    }
    loading.add(object);
    try {
      properties.addAll(created);
      const saved = data && typeof data === "object" ? data.properties : null;
      for (const key of ALL_KEYS) {
        let value;
        try {
          value = saved ? saved[key] : undefined;
        } catch (_error) {
          value = undefined;
        }
        created[key].load(value);
      }
      // Native rows follow the enumerable property order. Move only the
      // suffix after rotation/order, retaining the same property instances,
      // parent links and watchers.
      const keys = Object.keys(properties).filter((key) => !ALL_KEYS.includes(key));
      const anchor = keys.includes("eulerOrder") ? "eulerOrder" : "rotation";
      const index = keys.indexOf(anchor);
      if (index >= 0) {
        const suffix = keys.slice(index + 1).map((key) => [key, Object.getOwnPropertyDescriptor(properties, key)]);
        const rows = ALL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(properties, key)]);
        for (const [key] of rows.concat(suffix)) delete properties[key];
        for (const [key, descriptor] of rows) Object.defineProperty(properties, key, descriptor);
        for (const [key, descriptor] of suffix) Object.defineProperty(properties, key, descriptor);
      }
      attached.add(object);
      syncVisibility(object, false);
    } finally {
      loading.delete(object);
    }
    const id = readId(object);
    if (id && idTakenElsewhere(object, id)) {
      const next = createUuid(cryptoApi);
      setRaw(object, KEYS.id, next);
      if (batch) batch.remap.set(id, next);
    }
    if (batch) batch.objects.push(object);
    if (readTarget(object)) onTargetChanged(object);
    return true;
  }

  // Objects loaded together (a duplicated group, a pasted or duplicated
  // scene) keep their links to each other: a target whose id had to be
  // regenerated is remapped for the trackers loaded in the same batch.
  function beginLoad() {
    if (batchDepth === 0) batch = { objects: [], remap: new Map() };
    batchDepth += 1;
  }

  function endLoad() {
    batchDepth = Math.max(0, batchDepth - 1);
    if (batchDepth > 0 || !batch) return;
    const finished = batch;
    batch = null;
    if (finished.remap.size === 0) return;
    for (const object of finished.objects) {
      const target = readTarget(object);
      if (target && finished.remap.has(target)) {
        loading.add(object);
        try {
          setRaw(object, KEYS.target, finished.remap.get(target));
        } finally {
          loading.delete(object);
        }
        onTargetChanged(object);
      }
    }
  }

  function detach(object) {
    if (!attached.has(object)) return;
    attached.delete(object);
    const properties = object.properties;
    if (!properties) return;
    for (const key of ALL_KEYS) {
      if (properties[key]) delete properties[key];
    }
    properties.onListChanged?.update?.();
  }

  function detachAll(projects) {
    for (const project of projects) {
      if (!project || typeof project.forEachItemOfType !== "function") continue;
      try {
        project.forEachItemOfType(PZ.object3d, detach);
      } catch (_error) {
        // A half-loaded project keeps the inert properties; they are harmless.
      }
    }
  }

  return {
    KEYS,
    ROW_KEYS,
    CONTROL_IDS,
    classify,
    isCameraLike,
    isAttached,
    attach,
    detach,
    detachAll,
    beginLoad,
    endLoad,
    ensureId,
    readTarget,
    readId,
    readTrackAxis,
    readUpAxis,
    readInfluence,
    propertyOf,
    syncVisibility,
  };
}

module.exports = { createPropertyStore, createUuid, KEYS, CONTROL_IDS };
