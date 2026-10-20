"use strict";
const { compile, sandboxFunction } = require("./compiler.js");
const { createCallGuard } = require("./call-guard.js");
const { createAPI, copy, ancestor } = require("./api.js");

function installEngine(options) {
  const { PZ, document: doc, patch } = options;
  const compiled = new WeakMap(), active = new Set(), errors = new WeakMap();
  const reported = new Set();
  const guard = createCallGuard();
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
      return fn;
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
    if (outer) guard.reset();
    active.add(property);
    try {
      const clip = ancestor(owner, n => n instanceof PZ.clip);
      const time = clip ? read(clip.properties.time, frame) : 0;
      const context = createAPI({ PZ, owner, property, frame, time, base, read, baseAt,
        methods: PZ.expression.methods, wiggleMethods: options.wiggleMethods,
        controls: options.controls, world: options.world });
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
  for (const proto of protos) patch(proto, "get", original => function getWithExpressions(frame) {
    if (this.expression) return evaluate(this.expression, frame, this.parentObject, this);
    return original.apply(this, arguments);
  });
  return { baseAt, read, error: p => errors.get(p) || p?.expression?.error || null,
    isExtended: expression => !!compiled.get(expression)?.extended,
    compile, guard };
}
module.exports = { installEngine };
