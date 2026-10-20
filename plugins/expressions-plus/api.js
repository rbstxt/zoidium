"use strict";
const copy = v => Array.isArray(v) ? Array.from(v, copy) : v === null || ["number", "string", "boolean", "undefined"].includes(typeof v) ? v : undefined;
const record = fields => Object.assign(Object.create(null), fields);
const mix = (a, b, t) => Array.isArray(a) ? a.map((v, i) => mix(v, b[i], t)) : a + (b - a) * t;
function interpolate(args, curve = v => v) {
  const [t, lo, hi, a, b] = args;
  return args.length === 5 ? mix(a, b, curve(Math.max(0, Math.min(1, (t - lo) / (hi - lo))))) : mix(lo, hi, curve(Math.max(0, Math.min(1, t))));
}
function ancestor(node, predicate) {
  for (let i = 0; node && i < 256; i++, node = node.parent) if (predicate(node)) return node;
  return null;
}
const named = node => { try { return node?.properties?.name?.get?.() || node?.definition?.name || ""; } catch { return ""; } };
function find(list, name) {
  const items = Array.from(list || []);
  return typeof name === "number" ? items[name - 1] || null : items.find(n => named(n) === String(name)) || null;
}
function propertyOf(node, name) {
  const props = node?.properties || node;
  if (!props || typeof props !== "object") return null;
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p && typeof p.get === "function" && (key === name || p.definition?.name === name || named(p) === name)) return p;
  }
  return find(node?.customProperties, name);
}

// Every public handle contains copied values and closure methods only. Host
// objects, Three objects, DOM nodes and project mutation methods stay private.
function createAPI(options) {
  const { PZ, owner, property, frame, time, base, read, baseAt } = options;
  const is = type => n => typeof type === "function" && n instanceof type;
  const clip = ancestor(owner, is(PZ.clip));
  const sequence = ancestor(owner, is(PZ.sequence)) || options.sequence;
  const rate = sequence?.properties?.rate?.get?.() || 30;
  const absolute = frame + (clip?.start || 0);
  const worldCache = new Map();
  const localFrame = (p, at = absolute) => at - (ancestor(p, is(PZ.clip))?.start || 0);
  function propertyHandle(p) {
    if (!p) throw new Error("Expression property was not found");
    const get = at => copy(read(p, localFrame(p, at)));
    const keys = Array.from(p.keyframes || p.objects?.[0]?.keyframes || []);
    const key = index => {
      const k = keys[index - 1];
      if (!k) throw new Error("Expression key index is out of range");
      return record({ index, time: k.frame / rate, value: copy(k.value) });
    };
    const derivative = () => {
      const dt = 1 / 100, f = localFrame(p);
      const a = p === property ? baseAt(p, f - dt * rate) : read(p, f - dt * rate);
      const b = p === property ? baseAt(p, f + dt * rate) : read(p, f + dt * rate);
      return Array.isArray(a) ? a.map((v, i) => (b[i] - v) / (2 * dt)) : (b - a) / (2 * dt);
    };
    const handle = record({
      name: p.definition?.name || named(p),
      valueAtTime: t => p === property ? copy(baseAt(p, Number(t) * rate)) : get(Number(t) * rate + (ancestor(p, is(PZ.clip))?.start || 0)),
      numKeys: keys.length, key,
      nearestKey(t) {
        if (!keys.length) throw new Error("Expression property has no keys");
        let best = 0;
        keys.forEach((k, i) => { if (Math.abs(k.frame / rate - t) < Math.abs(keys[best].frame / rate - t)) best = i; });
        return key(best + 1);
      },
    });
    Object.defineProperties(handle, {
      value: { enumerable: true, get: () => p === property ? copy(base) : get() },
      velocity: { enumerable: true, get: derivative },
      speed: { enumerable: true, get: () => { const v = derivative(); return Array.isArray(v) ? Math.hypot(...v) : Math.abs(v); } },
    });
    return handle;
  }
  const handles = new WeakMap();
  function objectHandle(node) {
    if (!node) return null;
    if (handles.has(node)) return handles.get(node);
    const handle = name => {
      if (typeof name === "number") { let p = node; for (let i = 1; i < name; i++) p = parentObject(p); return objectHandle(p); }
      return propertyHandle(propertyOf(node, String(name))).value;
    };
    Object.setPrototypeOf(handle, null);
    handles.set(node, handle);
    Object.assign(handle, {
      param: name => propertyHandle(propertyOf(node, String(name))).value,
      property: name => propertyHandle(propertyOf(node, String(name))),
      effect: name => objectHandle(find(node.effects, name)),
      object: name => objectHandle(find(node.objects, name)),
      layer: name => objectHandle(find(layers(node), name)),
    });
    Object.defineProperties(handle, {
      name: { configurable: true, get: () => named(node) },
      parent: { get: () => objectHandle(parentObject(node)) },
    });
    if (options.world) Object.assign(handle, options.world(node, { frame: localFrame(node), absolute, sequence, read, propertyHandle, cache: worldCache }));
    return handle;
  }
  function parentObject(node) {
    return ancestor(node?.parent, n => n !== node && n.properties && !(PZ.propertyList && n instanceof PZ.propertyList));
  }
  function layers(node = sequence) {
    const seq = node?.videoTracks ? node : sequence;
    return Array.from(seq?.videoTracks || []).flatMap(track => {
      const c = track.getCurrentClip?.(absolute) || Array.from(track.clips || []).find(c => absolute >= c.start && absolute < c.start + c.length);
      return c?.object ? [c.object] : [];
    });
  }
  const controls = Object.create(null);
  const controlIds = new Map();
  for (const p of options.controls?.(sequence) || []) {
    Object.defineProperty(controls, named(p) || p.definition?.name, { enumerable: true, get: () => copy(read(p, absolute)) });
    if (p.definition?.zoidiumControlId) controlIds.set(p.definition.zoidiumControlId, p);
  }
  const own = objectHandle(owner);
  const api = record({
    value: copy(base), thisProperty: property ? propertyHandle(property) : record({ value: copy(base) }), thisObject: own,
    thisLayer: objectHandle(ancestor(owner, is(PZ.layer))) || own,
    thisClip: objectHandle(clip), thisSequence: objectHandle(sequence), thisComp: objectHandle(sequence),
    layer: name => objectHandle(find(layers(), name)),
    effect: name => own?.effect(name), object: name => own?.object(name),
    controls, control(name, id) {
      if (id) {
        if (!controlIds.has(id)) throw new Error("Expression control was not found: " + name);
        return copy(read(controlIds.get(id), absolute));
      }
      if (!Object.hasOwn(controls, name)) throw new Error("Expression control was not found: " + name);
      return controls[name];
    },
    prop(path) {
      const segments = String(path).split("/").filter(Boolean);
      let node = String(path).startsWith("/") ? sequence : owner;
      for (let i = 0; i < segments.length - 1; i++) {
        const s = segments[i];
        if (s === "..") node = parentObject(node);
        else if (s !== ".") node = find(layers(node), s) || find(node?.objects, s) || find(node?.effects, s) || node?.properties?.[s];
        if (!node) throw new Error("Expression path was not found: " + path);
      }
      return propertyHandle(propertyOf(node, segments.at(-1))).value;
    },
    easeIn: (...args) => interpolate(args, t => t * t),
    easeOut: (...args) => interpolate(args, t => t * (2 - t)),
    degreesToRadians: x => x * Math.PI / 180,
    radiansToDegrees: x => x * 180 / Math.PI,
    lookAt(from, to) { const d = to.map((v, i) => v - from[i]); return [Math.atan2(-d[1], Math.hypot(d[0], d[2])), Math.atan2(d[0], d[2]), 0]; },
  });
  if (options.world) Object.assign(api, options.world(owner, { frame, absolute, sequence, read, propertyHandle, cache: worldCache }));
  let seed = 0, timeless = false, randomIndex = 0, seeded = false;
  api.seedRandom = (offset = 0, stable = false) => { seed = Number(offset); timeless = !!stable; randomIndex = 0; seeded = true; };
  const methods = options.methods, overrides = new Map();
  const nativeRandom = methods.random;
  // random(seed) retains CM3's exact one-argument meaning. No-argument
  // sampling is reset for every property evaluation and has no frame history.
  overrides.set(nativeRandom, function (...args) {
    if (args.length || !seeded) return nativeRandom.apply(methods, args);
    const n = seed + (timeless ? 0 : frame) * 17.173 + randomIndex++ * 71.137;
    return nativeRandom ? nativeRandom.call(methods, n) : (Math.sin(n) * 10000 + 10000) % 1;
  });
  for (const name of ["linear", "ease", "easeIn", "easeOut"]) {
    const original = methods[name];
    const curve = name === "easeIn" ? t => t * t : name === "easeOut" ? t => t * (2 - t) : name === "ease" ? t => t * t * (3 - 2 * t) : t => t;
    if (original) overrides.set(original, (...args) => args.length === 5 ? interpolate(args, curve) : original.apply(options.methods, args));
  }
  const oldClamp = methods.clamp;
  overrides.set(oldClamp, (v, a, b) => Array.isArray(v) ? oldClamp.call(options.methods, v, a, b) : Math.min(Math.max(v, a), b));
  const privateContext = Object.assign(Object.create(options.methods), { currentFrame: frame, currentValue: base, currentProperty: property });
  for (const [name, fn] of Object.entries(options.wiggleMethods || {})) {
    if (typeof fn === "function") privateContext[name] = fn;
  }
  if (privateContext.wiggle) api.wiggle = (...args) => privateContext.wiggle(...args);
  if (methods.wiggle) overrides.set(methods.wiggle, (...args) => privateContext.wiggle(...args));
  return { api, methods, time, frame, overrides };
}
module.exports = { createAPI, copy, record, interpolate, propertyOf, ancestor, named, find };
