"use strict";
const nativeSource = Function.prototype.toString;
const apply = Reflect.apply;
const construct = Reflect.construct;
const constructors = /^function\s+(?:Function|AsyncFunction|GeneratorFunction|AsyncGeneratorFunction|eval)\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
const nativeName = /^function\s+([^ (]*)\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
const callbackSlots = new Map([
  ["map", 0], ["flatMap", 0], ["filter", 0], ["forEach", 0], ["some", 0], ["every", 0],
  ["find", 0], ["findIndex", 0], ["findLast", 0], ["findLastIndex", 0], ["sort", 0],
  ["toSorted", 0], ["reduce", 0], ["reduceRight", 0], ["from", 1], ["groupBy", 1],
  ["replace", 1], ["replaceAll", 1],
]);

function createCallGuard(limit = 10000000) {
  let remaining = limit, depth = 0;
  let overrides = new Map();
  const info = new WeakMap(), wrappers = new WeakMap(), receivers = new WeakMap();
  function tick() { if (--remaining < 0) throw new Error("Expression iteration/call budget exceeded"); }
  function describe(fn) {
    if (typeof fn !== "function") return {};
    if (info.has(fn)) return info.get(fn);
    const source = apply(nativeSource, fn, []);
    const value = { forbidden: constructors.test(source), native: nativeName.exec(source)?.[1] };
    info.set(fn, value);
    return value;
  }
  function wrap(fn, receiver, bound = false) {
    if (typeof fn !== "function") return fn;
    if (!bound && wrappers.has(fn)) return wrappers.get(fn);
    const proxy = new Proxy(fn, {
      apply(target, own, args) { return invoke(target, bound ? receiver : own, args); },
      construct(target, args, newTarget) { return invoke(target, null, args, newTarget === proxy ? target : newTarget); },
    });
    // Store the target, including its native identity. Passing an already
    // guarded callable through call/apply must not erase that identity.
    info.set(proxy, { ...describe(fn), target: fn, receiver, bound });
    if (!bound) wrappers.set(fn, proxy);
    return proxy;
  }
  function invoke(fn, receiver, args, newTarget) {
    if (++depth > 256) { depth--; throw new Error("Expression recursion budget exceeded"); }
    try { return dispatch(fn, receiver, args, newTarget); }
    finally { depth--; }
  }
  function dispatch(fn, receiver, args, newTarget) {
    tick();
    let meta = describe(fn);
    while (meta.target) {
      if (meta.bound) receiver = meta.receiver;
      fn = meta.target; meta = describe(fn);
    }
    if (meta.forbidden) throw new Error("Expression cannot call Function constructors or eval");
    if (overrides.has(fn)) return apply(overrides.get(fn), receiver, args);
    if (meta.native === "call") return invoke(receiver, args[0], args.slice(1));
    if (meta.native === "apply") return invoke(receiver, args[0], args[1] == null ? [] : Array.from(args[1]));
    if (meta.native === "bind") {
      // A native callback can invoke a bound target without passing a
      // compiler call site. Bind the guarded callable, including other realms.
      return apply(fn, wrap(receiver), args);
    }
    const slot = callbackSlots.get(meta.native);
    if (slot !== undefined && typeof args[slot] === "function") { args = args.slice(); args[slot] = wrap(args[slot]); }
    if (meta.native === "__defineGetter__" || meta.native === "__defineSetter__") { args = args.slice(); args[1] = wrap(args[1]); }
    if (meta.native === "defineProperty" && args[2]) {
      args = args.slice(); args[2] = { ...args[2] };
      for (const key of ["get", "set"]) if (typeof args[2][key] === "function") args[2][key] = wrap(args[2][key]);
    }
    if (meta.native === "defineProperties" && args[1]) {
      args = args.slice(); const descriptors = {};
      for (const key of Object.keys(args[1])) {
        descriptors[key] = { ...args[1][key] };
        for (const k of ["get", "set"]) if (typeof descriptors[key][k] === "function") descriptors[key][k] = wrap(descriptors[key][k]);
      }
      args[1] = descriptors;
    }
    return newTarget ? construct(fn, args, newTarget) : apply(fn, receiver, args);
  }
  return {
    tick,
    invoke,
    swapOverrides(next) { const previous = overrides; overrides = next; return previous; },
    reset() { remaining = limit; },
    guard: fn => wrap(fn),
    receiver(value) {
      if (value == null) return value;
      const object = Object(value);
      if (receivers.has(object)) return receivers.get(object);
      const proxy = new Proxy(Object.create(null), { get(_target, key) { return wrap(Reflect.get(object, key, value), value, true); } });
      receivers.set(object, proxy);
      return proxy;
    },
  };
}
module.exports = { createCallGuard };
