"use strict";
const nativeSource = Function.prototype.toString;
const apply = Reflect.apply;
const construct = Reflect.construct;
const constructors = /^function\s+(?:Function|AsyncFunction|GeneratorFunction|AsyncGeneratorFunction|eval)\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
// Functions the constructors create report "anonymous" as their source name.
const dynamic = /^(?:async\s+)?function\s*\*?\s*anonymous\s*\(/;
const nativeName = /^function\s+([^ (]*)\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
const callbackSlots = new Map([
  ["map", [0]], ["flatMap", [0]], ["filter", [0]], ["forEach", [0]], ["some", [0]], ["every", [0]],
  ["find", [0]], ["findIndex", [0]], ["findLast", [0]], ["findLastIndex", [0]], ["sort", [0]],
  ["toSorted", [0]], ["reduce", [0]], ["reduceRight", [0]], ["from", [1]], ["fromAsync", [1]],
  ["groupBy", [1]], ["replace", [1]], ["replaceAll", [1]], ["parse", [1]], ["stringify", [1]],
  ["then", [0, 1]], ["catch", [0]], ["finally", [0]],
]);
// String methods that hand their argument to its Symbol.replace/match/...
// method. That method runs natively, so it is checked before the call.
const protocolMethods = new Map([
  ["replace", "replace"], ["replaceAll", "replace"], ["match", "match"],
  ["matchAll", "matchAll"], ["search", "search"], ["split", "split"],
]);

function createCallGuard(limit = 10000000) {
  let remaining = limit, depth = 0, bounded = true;
  let overrides = new Map();
  const info = new WeakMap(), wrappers = new WeakMap(), receivers = new WeakMap();
  function tick() { if (bounded && --remaining < 0) throw new Error("Expression iteration/call budget exceeded"); }
  function describe(fn) {
    if (typeof fn !== "function") return Object.create(null);
    if (info.has(fn)) return info.get(fn);
    const source = apply(nativeSource, fn, []);
    const value = Object.assign(Object.create(null), { forbidden: constructors.test(source) || dynamic.test(source), native: nativeName.exec(source)?.[1] });
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
    info.set(proxy, Object.assign(Object.create(null), describe(fn), { target: fn, receiver, bound }));
    if (!bound) wrappers.set(fn, proxy);
    return proxy;
  }
  function protocolTarget(fn) {
    let meta = describe(fn);
    while (meta.target) { fn = meta.target; meta = describe(fn); }
    return fn;
  }
  function invoke(fn, receiver, args, newTarget) {
    if (++depth > 256 && bounded) { depth--; throw new Error("Expression recursion budget exceeded"); }
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
    if (meta.forbidden) throw new Error("Expression cannot call Function constructors or eval, or functions they create");
    if (overrides.has(fn)) return apply(overrides.get(fn), receiver, args);
    if (meta.native === "call") return invoke(receiver, args[0], args.slice(1));
    if (meta.native === "apply") return invoke(receiver, args[0], args[1] == null ? [] : Array.from(args[1]));
    if (meta.native === "bind") {
      // A native callback can invoke a bound target without passing a
      // compiler call site. Bind the guarded callable, including other realms.
      return apply(fn, wrap(receiver), args);
    }
    const slots = callbackSlots.get(meta.native);
    if (slots?.some(slot => typeof args[slot] === "function")) {
      args = args.slice();
      for (const slot of slots) if (typeof args[slot] === "function") args[slot] = wrap(args[slot]);
    }
    const protocol = protocolMethods.get(meta.native);
    if (protocol && args[0] !== null && (typeof args[0] === "object" || typeof args[0] === "function")) {
      // Well-known symbols are shared by every realm.
      if (describe(protocolTarget(args[0][Symbol[protocol]])).forbidden) throw new Error("Expression cannot call Function constructors or eval, or functions they create");
    }
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
    reset(enableBudget = true) { remaining = limit; bounded = enableBudget; },
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
