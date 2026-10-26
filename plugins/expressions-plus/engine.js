"use strict";
const { compile, sandboxFunction } = require("./compiler.js");
const { createCallGuard } = require("./call-guard.js");
const { createAPI, copy, ancestor } = require("./api.js");

function installEngine(options) {
  const { PZ, document: doc, patch } = options;
  const compiled = new WeakMap(), active = new Set(), errors = new WeakMap();
  const nativeParse = PZ.expression.prototype.parse;
  const reported = new Set();
  const sourceKinds = new Map();
  let methodStamp = "";
  const guard = createCallGuard(options.stepLimit);
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
        const context = createAPI({ PZ, owner: null, property: null, frame, time, base: value, read, baseAt,
          methods: methods || PZ.expression.methods, wiggleMethods: options.wiggleMethods, controls: options.controls, world: options.world, extended: result.extended, needs: result.needs });
        const previous = guard.swapOverrides(context.overrides), pure = fn.zoidiumPure;
        try { return fn(frame, time, context.methods, custom, pure.Math, { ...guard, api: context.api, pure }); }
        finally { guard.swapOverrides(previous); }
      };
    } catch (error) { report(this, null, error); compiled.set(this, { failed: true }); return this.noop; }
  });
  // Obtain the native value through the original getter, with the expression
  // slot temporarily clear. This keeps native interpolation and plugin fixes.
  const baseGetters = new Map();
  const protos = [PZ.property.dynamic.prototype, PZ.property.dynamic.group.prototype, PZ.property.dynamic.keyframes.prototype];
  for (const proto of protos) baseGetters.set(proto, proto.get);
  function baseAt(p, frame) {
    if (!p) return undefined;
    const expression = p.expression;
    try {
      // The host stores an observable backing slot. Avoid firing UI events
      // while reading a base value during rendering.
      p._expression = null;
      const proto = protos.findLast(proto => proto.isPrototypeOf(p));
      return copy(proto ? baseGetters.get(proto).call(p, frame) : p.get(frame));
    } finally { p._expression = expression; }
  }
  function read(p, frame) {
    if (active.has(p)) throw new Error("Expression property cycle detected");
    const result = p.get(frame);
    if (active.size && errors.get(p)?.includes("cycle detected")) throw new Error("Expression property cycle detected");
    return result;
  }
  function evaluate(expression, frame, owner, property) {
    if (!compiled.has(expression)) { expression.fn = expression.parse(expression.source); }
    const result = compiled.get(expression);
    const base = baseAt(property, frame);
    if (!result || result.failed) return base;
    if (active.has(property)) { report(expression, property, new Error("Expression property cycle detected")); return base; }
    const outer = active.size === 0;
    let previousOverrides;
    if (outer) guard.reset(result.extended);
    active.add(property);
    try {
      const clip = ancestor(owner, n => n instanceof PZ.clip);
      const time = clip ? read(clip.properties.time, frame) : 0;
      const context = createAPI({ PZ, owner, property, frame, time, base, read, baseAt,
        methods: PZ.expression.methods, wiggleMethods: options.wiggleMethods,
        controls: options.controls, world: options.world, extended: result.extended, needs: result.needs });
      const pure = result.fn.zoidiumPure;
      const helpers = { ...guard, api: context.api, pure };
      previousOverrides = guard.swapOverrides(context.overrides);
      const custom = expression.getCustomProperties(frame, owner);
      const value = result.fn(frame, time, context.methods, custom, pure.Math, helpers);
      report(expression, property, null);
      return value;
    } catch (error) { report(expression, property, error); return base; }
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
    compile, guard,
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
