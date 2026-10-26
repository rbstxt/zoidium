"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const S = commonJS ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  const P = commonJS ? require("./community-package") : root.ZoidiumCommunityPackage;
  const VERSION = 1, INTERPRETER = "quickjs-emscripten-0.32.0-release-sync";
  const FIELDS = ["protocolVersion", "interpreterVersion", "packageId", "packageHash", "runnerGeneration", "instanceId", "instanceGeneration", "projectGeneration", "revision", "requestId", "frameKey"];
  const REQUESTS = ["initialize", "prepareEffect", "uiEvent", "dispose"];
  const REPLIES = ["ready", "prepared", "uiPatch", "disposed", "error"];
  function bounded(value, max = 4096) { if (typeof value !== "string" || !value.length || value.length > max) S.fail("invalid protocol token"); }
  function message(m, reply = false) {
    const bytes = S.data(m, { binary: false });
    if (bytes > 65536 || new TextEncoder().encode(JSON.stringify(m)).length > 65536) S.fail("control message size limit exceeded");
    S.keys(m, [...FIELDS, "operation", "payload"]);
    if (m.protocolVersion !== VERSION || m.interpreterVersion !== INTERPRETER) S.fail("incompatible runtime version");
    if (!P.ID.test(m.packageId) || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(m.packageHash)) S.fail("invalid package binding");
    for (const key of ["instanceId", "requestId", "frameKey"]) bounded(m[key]);
    for (const key of ["runnerGeneration", "instanceGeneration", "projectGeneration", "revision"]) {
      if (!Number.isSafeInteger(m[key]) || m[key] < 0) S.fail("invalid generation");
    }
    if (!(reply ? REPLIES : REQUESTS).includes(m.operation)) S.fail("unknown operation");
    return m;
  }
  function matches(reply, pending) {
    message(reply, true);
    for (const key of FIELDS) if (reply[key] !== pending[key]) S.fail("stale or foreign reply: " + key);
    const expected = { initialize: "ready", prepareEffect: "prepared", uiEvent: "uiPatch", dispose: "disposed" }[pending.operation];
    if (reply.operation !== "error" && reply.operation !== expected) S.fail("unexpected reply operation");
    return reply;
  }
  function result(value, effect, operation) {
    S.data(value);
    if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) S.fail("result size limit exceeded");
    if (operation === "uiEvent") { S.keys(value, ["state"]); P.state(value.state, effect.properties); return value; }
    S.keys(value, ["uniforms"], ["temporal", "textures"]);
    if (value.temporal !== undefined) {
      S.keys(value.temporal, ["offsets", "weights"]);
      P.list(value.temporal.offsets, 8); P.list(value.temporal.weights, 8);
      if (!value.temporal.offsets.length || value.temporal.weights.length !== value.temporal.offsets.length) S.fail("invalid temporal tap count");
      for (const offset of value.temporal.offsets) { P.finite(offset); if (Math.abs(offset) > 120) S.fail("temporal offset outside bounds"); }
      for (const weight of value.temporal.weights) { P.finite(weight); if (weight < 0 || weight > 1) S.fail("temporal weight outside bounds"); }
      const total = value.temporal.weights.reduce((sum, weight) => sum + weight, 0);
      if (Math.abs(total - 1) > 1e-9) S.fail("temporal weights must sum to one");
    }
    const allowed = effect.template === "gain-v1" ? ["gain"] : [];
    S.keys(value.uniforms, [], allowed);
    for (const number of Object.values(value.uniforms)) { P.finite(number); if (Math.abs(number) > 1000000) S.fail("uniform outside bounds"); }
    if (value.textures !== undefined) {
      P.list(value.textures, 4);
      const ids = new Set(); let total = 0;
      for (const t of value.textures) {
        S.keys(t, ["id", "width", "height", "pixels"]); P.token(t.id);
        if (ids.has(t.id)) S.fail("duplicate texture ID"); ids.add(t.id);
        for (const n of [t.width, t.height]) if (!Number.isInteger(n) || n < 1 || n > 256) S.fail("texture dimension limit exceeded");
        const size = t.width * t.height * 4;
        if ((total += size) > 1048576 || !Array.isArray(t.pixels) || t.pixels.length !== size) S.fail("texture byte size mismatch");
        for (const n of t.pixels) if (!Number.isInteger(n) || n < 0 || n > 255) S.fail("invalid RGBA8 value");
      }
    }
    return value;
  }
  function requestPayload(m, bundle) {
    if (m.operation === "initialize" || m.operation === "dispose") { S.keys(m.payload, []); return; }
    S.keys(m.payload, ["effectId", "input"]);
    const effect = bundle.manifest.effects.find(e => e.id === m.payload.effectId);
    if (!effect) S.fail("unknown effect");
    const i = m.payload.input;
    if (m.operation === "prepareEffect") {
      S.keys(i, ["properties", "frame", "time", "frameRate", "width", "height", "pixelAspect", "seed"]);
      P.state(i.properties, effect.properties);
      if (Object.keys(i.properties).length !== effect.properties.length) S.fail("missing evaluated property");
      for (const key of ["frame", "time", "frameRate", "width", "height", "pixelAspect", "seed"]) P.finite(i[key]);
      if (i.frameRate <= 0 || i.pixelAspect <= 0 || !Number.isInteger(i.width) || !Number.isInteger(i.height) || i.width < 1 || i.height < 1 || i.width > 16384 || i.height > 16384 || !Number.isSafeInteger(i.seed)) S.fail("invalid frame input");
    } else {
      S.keys(i, ["state"], ["action", "property", "value"]);
      if (Object.hasOwn(i, "action")) {
        if (Object.hasOwn(i, "property") || Object.hasOwn(i, "value") || !effect.actions.includes(i.action)) S.fail("unknown UI action");
      } else {
        if (!Object.hasOwn(i, "property") || !Object.hasOwn(i, "value")) S.fail("missing UI property event");
        P.state({ [i.property]: i.value }, effect.properties);
      }
      P.state(i.state, effect.properties);
    }
    return effect;
  }
  function binding(m, installed) {
    for (const key of ["packageId", "packageHash", "runnerGeneration"]) if (m[key] !== installed[key]) S.fail("foreign runner binding");
  }
  const api = { VERSION, INTERPRETER, FIELDS, message, matches, result, requestPayload, binding };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityProtocol = api;
})(globalThis);
