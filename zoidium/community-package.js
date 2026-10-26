"use strict";

(function (root) {
  const S = typeof module === "object" && module.exports ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  const LIMITS = Object.freeze({ packageBytes: 16 * 1024 * 1024, assets: 4096, installed: 128, storageBytes: 128 * 1024 * 1024 });
  const ID = /^community-[a-f0-9]{32}$/;
  function text(value, max = 4096) { if (typeof value !== "string" || !value.length || value.length > max) S.fail("invalid text"); }
  function token(value) { if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) S.fail("invalid local identifier"); }
  function finite(value) { if (typeof value !== "number" || !Number.isFinite(value)) S.fail("expected finite number"); }
  function list(value, max) { if (!Array.isArray(value) || value.length > max) S.fail("array limit exceeded"); }
  function unique(items) { const set = new Set(); for (const id of items) { if (set.has(id)) S.fail("ID collision: " + id); set.add(id); } }
  function properties(definitions) {
    list(definitions, 64); unique(definitions.map(p => p.key));
    for (const p of definitions) {
      S.keys(p, ["key", "label", "type", "default"], ["min", "max", "options"]); token(p.key); text(p.label);
      if (p.type === "number") {
        if ("options" in p) S.fail("unexpected property options");
        finite(p.default); finite(p.min); finite(p.max);
        if (p.min > p.max || p.default < p.min || p.default > p.max) S.fail("invalid property bounds");
      } else if (p.type === "boolean") {
        if (typeof p.default !== "boolean" || "min" in p || "max" in p || "options" in p) S.fail("invalid boolean property");
      } else if (p.type === "color") {
        if ("min" in p || "max" in p || "options" in p || typeof p.default !== "string" || !/^#[a-fA-F0-9]{6}$/.test(p.default)) S.fail("invalid color property");
      } else if (p.type === "option") {
        if ("min" in p || "max" in p) S.fail("invalid option property");
        list(p.options, 64); unique(p.options.map(o => o.value));
        if (!p.options.length) S.fail("empty property options");
        for (const o of p.options) { S.keys(o, ["value", "label"]); token(o.value); text(o.label); }
        if (!p.options.some(o => o.value === p.default)) S.fail("invalid option default");
      } else S.fail("unsupported property type");
    }
  }
  function state(values, definitions) {
    S.keys(values, [], definitions.map(p => p.key));
    for (const [key, value] of Object.entries(values)) {
      const p = definitions.find(item => item.key === key);
      if (p.type === "number") { finite(value); if (value < p.min || value > p.max) S.fail("property value outside bounds"); }
      else if (p.type === "boolean") { if (typeof value !== "boolean") S.fail("expected boolean value"); }
      else if (p.type === "color") { if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value)) S.fail("invalid color value"); }
      else if (p.type === "option" && !p.options.some(o => o.value === value)) S.fail("unknown option value");
    }
  }
  function ui(nodes, definitions, actions) {
    let count = 0;
    function walk(items, depth) {
      list(items, 128);
      if (depth > 8) S.fail("UI depth limit exceeded");
      for (const n of items) {
        if (++count > 128) S.fail("UI node limit exceeded");
        S.keys(n, ["kind", "label"], ["children", "property", "action"]); text(n.label);
        if (n.kind === "section") { S.keys(n, ["kind", "label", "children"]); walk(n.children, depth + 1); }
        else if (n.kind === "control") { S.keys(n, ["kind", "label", "property"]); if (!definitions.some(p => p.key === n.property)) S.fail("unknown property"); }
        else if (n.kind === "button") { S.keys(n, ["kind", "label", "action"]); if (!actions.includes(n.action)) S.fail("unknown action"); }
        else if (n.kind !== "label" || Object.keys(n).length !== 2) S.fail("unsupported UI node");
      }
    }
    walk(nodes, 1);
  }
  function manifest(m, occupied = []) {
    S.data(m);
    S.keys(m, ["schemaVersion", "apiVersion", "id", "name", "author", "version", "profile", "sourceFormat", "entry", "assets", "effects"]);
    if (m.schemaVersion !== 1 || m.apiVersion !== 1 || m.profile !== "isolated-effects" || m.sourceFormat !== "guest-script-v1") S.fail("unsupported package version or source format");
    if (!ID.test(m.id)) S.fail("invalid community ID");
    text(m.name); text(m.author); text(m.version, 64); S.path(m.entry);
    list(m.assets, LIMITS.assets); unique(m.assets);
    m.assets.forEach(S.path);
    if (!m.assets.includes(m.entry)) S.fail("entry must be a declared asset");
    list(m.effects, 64);
    if (!m.effects.length) S.fail("package needs an effect");
    unique([m.id, ...m.effects.map(e => e.id)]);
    const claimed = new Set(occupied);
    for (const id of [m.id, ...m.effects.map(e => e.id)]) if (claimed.has(id)) S.fail("ID collision: " + id);
    for (const e of m.effects) {
      S.keys(e, ["id", "name", "dataSchema", "template", "properties", "actions", "ui"]);
      if (!e.id.startsWith(m.id + "-fx-")) S.fail("effect ID ownership violation");
      token(e.id.slice(m.id.length + 4)); text(e.name);
      if (e.dataSchema !== 1 || !["identity-v1", "gain-v1"].includes(e.template)) S.fail("unsupported effect template or schema");
      properties(e.properties); list(e.actions, 64); unique(e.actions); e.actions.forEach(token); ui(e.ui, e.properties, e.actions);
    }
    return m;
  }
  function bundle(b, occupied = []) {
    S.data(b); S.keys(b, ["schemaVersion", "manifest", "assets"]);
    if (b.schemaVersion !== 1) S.fail("unsupported bundle version");
    manifest(b.manifest, occupied); S.keys(b.assets, b.manifest.assets);
    for (const value of Object.values(b.assets)) { if (typeof value !== "string") S.fail("only text assets are supported"); }
    if (new TextEncoder().encode(JSON.stringify(b)).length > LIMITS.packageBytes) S.fail("package size limit exceeded");
    return b;
  }
  function parse(bytes, occupied = []) {
    const value = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return bundle(S.parse(value, LIMITS.packageBytes), occupied);
  }
  const api = { LIMITS, ID, manifest, bundle, parse, properties, state, ui, finite, token, list };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumCommunityPackage = api;
})(globalThis);
