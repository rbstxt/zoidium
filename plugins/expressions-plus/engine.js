"use strict";
const { compile, createSharedMutationCache, sandboxFunction } = require("./compiler.js");
const { createCallGuard } = require("./call-guard.js");
const { createAPI, createLegacyAPI, copy, ancestor } = require("./api.js");

function installEngine(options) {
  const { PZ, document: doc, patch } = options;
  const compiled = new WeakMap(), active = new Set(), errors = new WeakMap();
  const nativeParse = PZ.expression.prototype.parse;
  const reported = new Set();
  const sourceKinds = new Map();
  let methodStamp = "";
  const guard = createCallGuard(options.stepLimit);
  // Preview-cache eligibility per expression source text. Compiling on demand
  // (with a bounded cache) keeps expressions that never evaluated from
  // slipping through the key builder. A source that no longer compiles fails
  // closed: it cannot be proven stateless.
  const isSharedMutation = createSharedMutationCache(() => Object.keys(PZ.expression.methods));
  function report(expression, property, error) {
    const message = error ? "Expression error: " + String(error.message || error) : null;
    expression.error = message;
    if (property) { if (message) errors.set(property, message); else errors.delete(property); }
    if (message && !reported.has(expression.source + message)) {
      reported.add(expression.source + message);
      // Bound the diagnostic cache for long editing sessions.
      if (reported.size > 256) reported.delete(reported.values().next().value);
      console.warn("[Zoidium] " + message);
    }
  }
  patch(PZ.expression.prototype, "parse", () => function parseExtended(source) {
    try {
      const result = compile(source, Object.keys(PZ.expression.methods));
      const fn = sandboxFunction(doc, result.code);
      compiled.set(this, { ...result, fn }); this.error = null;
      const expression = this;
      // Trapcode's existing adapter invokes .fn with seven legacy arguments
      // instead of chaining evaluate(). Keep that entry point compatible, then
      // use the same guarded evaluator as every native property read.
      return function legacyEntry(frame, time, methods, custom, _parent, property, value) {
        if (property?.get) return evaluate(expression, frame, property.parentObject, property);
        if (!active.size) guard.reset(result.extended);
        const context = createAPI({ PZ, owner: null, property: null, frame, time, base: value, read, baseAt, sequence: options.sequence?.() || options.project?.sequence,
          methods: methods || PZ.expression.methods, wiggleMethods: options.wiggleMethods, controls: options.controls, world: options.world, extended: result.extended, needs: result.needs });
        const previous = guard.swapOverrides(context.overrides), pure = fn.zoidiumPure;
        try { return fn(frame, time, context.methods, custom, pure.Math, { ...guard, api: context.api, pure }); }
        finally { guard.swapOverrides(previous); }
      };
    } catch (error) { report(this, null, error); compiled.set(this, { failed: true }); return this.noop; }
  });
  // A number property reads this result as its value, or as no change at all.
  // Report the cause without changing the value the property receives.
  function unusableResult(expression, property, value) {
    if (property?.definition?.type !== PZ.property.type.NUMBER || Number.isFinite(Number(value))) return null;
    return new Error(/\brandom\s*\(\s*\)/.test(expression.source) && !/\bseedRandom\s*\(/.test(expression.source)
      ? "random() needs a seed. Use random(frame), or call seedRandom(1) first."
      : "The result is not a finite number.");
  }
  // Obtain the native value through the original getter, with the expression
  // slot temporarily clear. This keeps native interpolation and plugin fixes.
  const baseGetters = new Map();
  const protos = [PZ.property.dynamic.prototype, PZ.property.dynamic.group.prototype, PZ.property.dynamic.keyframes.prototype];
  for (const proto of protos) baseGetters.set(proto, proto.get);
  const isClip = node => node instanceof PZ.clip;
  const protoCache = new WeakMap();
  function baseAt(p, frame) {
    if (!p) return undefined;
    // A property whose default is an expression, such as CM3's Glitch Time,
    // has no keyframes. Its native getter would read a missing keyframe.
    if (p.keyframes && p.keyframes.length === 0 && protos[2].isPrototypeOf(p)) return undefined;
    const expression = p.expression;
    try {
      // The host stores an observable backing slot. Avoid firing UI events
      // while reading a base value during rendering.
      p._expression = null;
      // The prototype chain of a property never changes; cache the lookup.
      let proto = protoCache.get(p);
      if (proto === undefined) {
        proto = false;
        for (const candidate of protos) if (candidate.isPrototypeOf(p)) proto = candidate;
        protoCache.set(p, proto);
      }
      return copy(proto ? baseGetters.get(proto).call(p, frame) : p.get(frame));
    } finally { p._expression = expression; }
  }
  function read(p, frame) {
    if (active.has(p)) throw new Error("Expression property cycle detected");
    const result = copy(p.get(frame));
    if (active.size && errors.get(p)?.includes("cycle detected")) throw new Error("Expression property cycle detected");
    return result;
  }
  function evaluate(expression, frame, owner, property) {
    let result = compiled.get(expression);
    if (result === undefined) {
      expression.fn = expression.parse(expression.source);
      result = compiled.get(expression);
    }
    // The native base value is only a fallback (failed compiles, cycles and
    // unusable results) plus the `value` observable and the wiggle context.
    // Read it eagerly only when the program can observe it, so the hot path
    // skips the native getter entirely.
    if (!result || result.failed) return baseAt(property, frame);
    if (active.has(property)) { report(expression, property, new Error("Expression property cycle detected")); return baseAt(property, frame); }
    const outer = active.size === 0;
    let previousOverrides;
    if (outer) guard.reset(result.extended);
    active.add(property);
    const clip = ancestor(owner, isClip);
    const isTime = clip && property === clip.properties.time;
    const legacy = result.needs.full === false;
    const methods = PZ.expression.methods;
    // The full API exposes the base through `value` and its derivatives, so
    // it always needs it. Legacy reads it only for time properties and for
    // the wiggle receiver; anything else stays unread. Like the old eager
    // read, this stays outside the guarded section so a throwing native
    // getter propagates exactly as before.
    // Time expressions use their native value as context, without reading
    // themselves again. Other properties read the evaluated clip time.
    const needBase = !legacy || isTime || (methods.wiggle && (!result.needs.methods || result.needs.methods.includes("wiggle")));
    const base = needBase ? baseAt(property, frame) : undefined;
    try {
      const time = clip ? isTime ? base : read(clip.properties.time, frame) : 0;
      // Legacy programs only observe methods, the frame, the base and the
      // property, so they skip the full context object (and its allocation).
      const context = legacy
        ? createLegacyAPI(methods, result.needs, frame, base, property, options.wiggleMethods)
        : createAPI({ PZ, owner, property, frame, time, base, read, baseAt,
          methods, wiggleMethods: options.wiggleMethods,
          controls: options.controls, world: options.world, extended: result.extended, needs: result.needs });
      const pure = result.fn.zoidiumPure;
      // Legacy helpers never carry an API handle and the guard functions are
      // stable per engine, so one helpers object serves every evaluation of
      // the same compiled expression. Full programs build their own context.
      const helpers = legacy
        ? result.helpers || (result.helpers = { ...guard, api: undefined, pure })
        : { ...guard, api: context.api, pure };
      previousOverrides = guard.swapOverrides(context.overrides);
      const custom = expression.getCustomProperties(frame, owner);
      const value = result.fn(frame, time, context.methods, custom, pure.Math, helpers);
      report(expression, property, unusableResult(expression, property, value));
      return value;
    } catch (error) { report(expression, property, error); return base !== undefined ? base : baseAt(property, frame); }
    finally { if (previousOverrides) guard.swapOverrides(previousOverrides); active.delete(property); }
  }
  patch(PZ.expression.prototype, "evaluate", () => function evaluateExtended(frame, owner, property) {
    return evaluate(this, frame, owner, property);
  });
  // Observe assignment, including native load and history replay, instead of
  // adding a dispatch function to every dynamic property read. Only the
  // onExpressionChanged observable of each dynamic property is wrapped, so
  // every other observable in CM3 keeps calling the native update untouched.
  const intercepted = new WeakMap(), hookedUpdates = new WeakMap();
  let enabled = true;
  function hookEvents(property) {
    const observable = property.onExpressionChanged;
    if (!observable || hookedUpdates.has(observable)) return;
    const nativeUpdate = observable.update;
    hookedUpdates.set(observable, nativeUpdate);
    observable.update = function () {
      if (enabled) prepare(property);
      return nativeUpdate.apply(this, arguments);
    };
  }
  function prepare(property) {
    if (!(property instanceof PZ.property.dynamic)) return;
    hookEvents(property);
    const previous = intercepted.get(property);
    if (!property.expression) {
      if (previous) {
        if (property.get === previous.get) {
          if (previous.descriptor) Object.defineProperty(property, "get", previous.descriptor);
          else delete property.get;
        }
        intercepted.delete(property);
      }
      return;
    }
    if (previous) return;
    const descriptor = Object.getOwnPropertyDescriptor(property, "get");
    const original = property.get;
    const get = function (frame) {
      return enabled && this.expression
        ? evaluate(this.expression, frame, this.parentObject, this)
        : original.apply(this, arguments);
    };
    Object.defineProperty(property, "get", { configurable: true, writable: true, value: get });
    intercepted.set(property, { get, descriptor });
  }
  patch(PZ.observable, "defineObservableProp", original => function (object, name) {
    const result = original.apply(this, arguments);
    if (name === "expression" && object instanceof PZ.property.dynamic) prepare(object);
    return result;
  });
  options.project?.forEachItemOfType?.(PZ.property.dynamic, prepare);
  return { baseAt, read, prepare, error: p => errors.get(p) || p?.expression?.error || null,
    isExtended: expression => !!compiled.get(expression)?.extended,
    isSharedMutation, compile, guard,
    requiresSource(source) {
      const methods = Object.keys(PZ.expression.methods), stamp = methods.join("\0");
      if (stamp !== methodStamp) { sourceKinds.clear(); methodStamp = stamp; }
      if (sourceKinds.has(source)) return sourceKinds.get(source);
      let needed;
      try { needed = compile(source, methods).extended; } catch (_error) { return undefined; }
      if (sourceKinds.size >= 512) sourceKinds.delete(sourceKinds.keys().next().value);
      sourceKinds.set(source, needed);return needed;
    },
    restore(project) {
      enabled = false;
      project?.forEachItemOfType?.(PZ.property.dynamic, property => {
        const previous = intercepted.get(property);
        if (previous && property.get === previous.get) {
          if (previous.descriptor) Object.defineProperty(property, "get", previous.descriptor);
          else delete property.get;
        }
        intercepted.delete(property);
        const observable = property.onExpressionChanged, nativeUpdate = observable && hookedUpdates.get(observable);
        if (nativeUpdate && observable.update !== nativeUpdate) observable.update = nativeUpdate;
        if (observable) hookedUpdates.delete(observable);
        const expression = property.expression;
        if (expression) expression.fn = nativeParse.call(expression, expression.source);
      });
    } };
}
module.exports = { installEngine };
