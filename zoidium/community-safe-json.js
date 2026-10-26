"use strict";

// Shared by the standalone packer, browser broker, and isolated Worker.
(function (root) {
  const POISON = new Set(["__proto__", "prototype", "constructor"]);
  function fail(message) { throw new Error("Community data: " + message); }
  function parse(text, maxBytes = 16 * 1024 * 1024, maxDepth = 64) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > maxBytes) fail("size limit exceeded");
    let pos = 0;
    const space = () => { while (/\s/.test(text[pos] || "") && pos < text.length) pos++; };
    function string() {
      const start = pos++;
      while (pos < text.length) {
        const c = text[pos++];
        if (c === "\\") pos++;
        else if (c === '"') return JSON.parse(text.slice(start, pos));
      }
      fail("unterminated string");
    }
    function value(depth) {
      if (depth > maxDepth) fail("nesting limit exceeded");
      space();
      if (text[pos] === '"') return string();
      const c = text[pos];
      if (c === "{" || c === "[") {
        pos++; space();
        const object = c === "{", out = object ? Object.create(null) : [], keys = new Set();
        const end = object ? "}" : "]";
        if (text[pos] === end) { pos++; return out; }
        for (;;) {
          space();
          if (object) {
            if (text[pos] !== '"') fail("expected object key");
            const key = string();
            if (POISON.has(key) || keys.has(key)) fail("duplicate or poisoned key: " + key);
            keys.add(key); space();
            if (text[pos++] !== ":") fail("expected colon");
            out[key] = value(depth + 1);
          } else out.push(value(depth + 1));
          space();
          if (text[pos] === end) { pos++; return out; }
          if (text[pos++] !== ",") fail("expected comma");
        }
      }
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(pos));
      if (!match) fail("invalid JSON value");
      pos += match[0].length;
      const out = JSON.parse(match[0]);
      if (typeof out === "number" && !Number.isFinite(out)) fail("non-finite number");
      return out;
    }
    const out = value(0); space();
    if (pos !== text.length) fail("trailing JSON data");
    return out;
  }
  function data(value, { maxDepth = 64, maxNodes = 200000, binary = false } = {}) {
    let nodes = 0, bytes = 0;
    const seen = new Set();
    function walk(v, depth) {
      if (++nodes > maxNodes || depth > maxDepth) fail("data complexity limit exceeded");
      if (v === null || typeof v === "boolean") return;
      if (typeof v === "number" && Number.isFinite(v)) return;
      if (typeof v === "string") { bytes += new TextEncoder().encode(v).length; return; }
      if (binary && v instanceof ArrayBuffer) { bytes += v.byteLength; return; }
      if (typeof v !== "object" || seen.has(v)) fail("unsupported or cyclic data");
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) fail("platform objects and handles are forbidden");
      seen.add(v);
      for (const key of Reflect.ownKeys(v)) {
        if (Array.isArray(v) && key === "length") continue;
        if (typeof key !== "string" || POISON.has(key)) fail("poisoned data key");
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !("value" in d)) fail("accessors are forbidden");
        bytes += key.length; walk(d.value, depth + 1);
      }
      seen.delete(v);
    }
    walk(value, 0);
    return bytes;
  }
  function keys(object, required, optional = []) {
    if (!object || Array.isArray(object) || typeof object !== "object") fail("expected record");
    for (const key of Object.keys(object)) if (!required.includes(key) && !optional.includes(key)) fail("unknown field: " + key);
    for (const key of required) if (!Object.hasOwn(object, key)) fail("missing field: " + key);
  }
  function path(value) {
    if (typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*$/.test(value) ||
        value.split("/").some(part => part === "." || part === "..") || value.includes("..")) fail("noncanonical asset path");
    return value;
  }
  const api = { parse, data, keys, path, fail };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumCommunityJSON = api;
})(globalThis);
