(function (global) {
  "use strict";

  // Scoped window skins for the Zoidium UI kit: registerSkin scopes every
  // rule to the windows that opt in so a product-specific look cannot leak
  // into the editor. Loaded before zoidium/ui-kit.js, which publishes
  // registerSkin on the frozen ZoidiumUI surface (see postInitScripts in
  // zoidium/runtime-config.js).

  // ---------------------------------------------------------------------
  // Window skins
  //
  // A skin restyles the windows that opt into it (openWindow({ skin })) and
  // nothing else. Every rule is scoped to those windows: selectors are
  // prefixed with the window selector, `:scope` names the window itself and
  // @media/@supports blocks are scoped recursively. The host keeps owning
  // window behavior (dragging, resizing, focus, keyboard isolation, close and
  // lifecycle), so a skinned editor still behaves like every other window.
  // Skins should read the theme tokens (var(--zui-*), see ui-window.css) for
  // anything that ought to follow the editor theme.
  //
  // Skins are untrusted CSS: declarations that fetch remote resources are
  // dropped (only data: URLs survive) and @import is removed, so a skin can
  // neither phone home nor pull a hostile font. @keyframes names are global
  // in CSS, so each skin's keyframes are namespaced per skin id and
  // animation references are rewritten to match.

  var skins = new Map();

  function skinSelector(id) {
    return '.zoidium-window[data-zui-skin="' + String(id).replace(/["\\]/g, "\\$&") + '"]';
  }

  // A skin id embedded in CSS identifiers (keyframe names): anything outside
  // [a-zA-Z0-9_-] becomes "_".
  function skinToken(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, "_") || "skin";
  }

  function splitSelectors(text) {
    var parts = [];
    var depth = 0;
    var start = 0;
    for (var index = 0; index < text.length; index += 1) {
      var ch = text[index];
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(text.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function scopeSelector(selector, scope) {
    if (/:scope\b/.test(selector)) return selector.replace(/:scope\b/g, scope);
    if (/^(:root|html|body)\b/.test(selector)) return selector.replace(/^(:root|html|body)\b/, scope);
    return scope + " " + selector;
  }

  // Splits a declaration block at top-level semicolons, ignoring separators
  // inside parentheses, brackets, braces and quotes (so data: URLs with
  // embedded semicolons survive intact).
  function splitDeclarations(block) {
    var parts = [];
    var depth = 0;
    var quote = null;
    var start = 0;
    for (var index = 0; index < block.length; index += 1) {
      var ch = block[index];
      if (quote) {
        if (ch === quote) quote = null;
        else if (ch === "\\") index += 1;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth -= 1;
      } else if (ch === ";" && depth === 0) {
        parts.push(block.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(block.slice(start));
    return parts;
  }

  // True when a declaration value fetches anything but an embedded data: URL.
  function hasRemoteUrl(value) {
    var pattern = /url\(\s*("[^"]*"|'[^']*'|[^)"']*)\s*\)/gi;
    var match;
    while ((match = pattern.exec(value)) !== null) {
      var target = match[1].trim();
      if (target.charAt(0) === '"' || target.charAt(0) === "'") {
        target = target.slice(1, -1).trim();
      }
      if (!/^data:/i.test(target)) return true;
    }
    return false;
  }

  // Rewrites animation references to their per-skin keyframe names. Only the
  // animation and animation-name properties can name keyframes.
  function renameAnimations(declaration, names) {
    var colon = declaration.indexOf(":");
    if (colon < 0) return declaration;
    var property = declaration.slice(0, colon).trim().toLowerCase();
    if (property !== "animation" && property !== "animation-name") return declaration;
    var value = declaration.slice(colon + 1);
    Object.keys(names).forEach(function (name) {
      var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp("\\b" + escaped + "\\b", "g"), names[name]);
    });
    return declaration.slice(0, colon + 1) + value;
  }

  // Drops declarations that fetch remote resources and rewrites animation
  // references. Nested keyframe stops contain their semicolons inside braces,
  // so they arrive as one chunk and pass through (or drop as one block when
  // a stop fetches remotely: fail closed).
  function sanitizeBlock(block, names) {
    var kept = splitDeclarations(block).filter(function (chunk) {
      if (chunk.trim() === "") return false;
      if (chunk.indexOf(":") < 0) return true;
      return !hasRemoteUrl(chunk);
    }).map(function (chunk) {
      return renameAnimations(chunk, names);
    });
    var out = kept.join(";");
    if (!out) return out;
    var ending = block.match(/;(\s*)$/);
    return out + (ending ? ";" + ending[1] : "");
  }

  // Matches "@keyframes NAME" and "@-vendor-keyframes NAME".
  function keyframeNameOf(prelude) {
    var match = prelude.match(/^@(?:-[a-z]+-)?keyframes\s+([^\s{;,]+)/i);
    return match ? match[1] : null;
  }

  // Scopes a stylesheet to `scope`. Comments are dropped, @import is removed,
  // remote url() declarations are stripped, and @keyframes names are
  // namespaced per skin id (shared through `names` so @media-nested
  // references resolve too). Rules left empty by sanitizing are dropped.
  function scopeCss(css, scope, skinId, names) {
    var token = skinToken(skinId);
    var table = names || Object.create(null);
    var source = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
    // @import has no block: drop it before rule parsing so it cannot merge
    // into the next rule's prelude.
    source = source.replace(/@import[^;]*;/gi, "");
    var rules = [];
    var index = 0;
    while (index < source.length) {
      var open = source.indexOf("{", index);
      if (open < 0) break;
      var prelude = source.slice(index, open).trim();
      // Find the matching closing brace.
      var depth = 1;
      var cursor = open + 1;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      rules.push({ prelude: prelude, block: source.slice(open + 1, cursor - 1) });
      index = cursor;
    }
    rules.forEach(function (rule) {
      var name = keyframeNameOf(rule.prelude);
      if (name && !table[name]) table[name] = "zui-" + token + "-" + name;
    });
    var out = "";
    rules.forEach(function (rule) {
      var prelude = rule.prelude;
      var body = "";
      var name = keyframeNameOf(prelude);
      if (name) {
        body = sanitizeBlock(rule.block, table);
        if (!body) return;
        prelude = prelude.replace(name, table[name]);
      } else if (/^@(media|supports|container)\b/i.test(prelude)) {
        body = scopeCss(rule.block, scope, skinId, table);
        if (!body) return;
      } else if (prelude.charAt(0) === "@") {
        body = sanitizeBlock(rule.block, table);
        if (!body) return;
      } else if (prelude) {
        body = sanitizeBlock(rule.block, table);
        if (!body) return;
        prelude = splitSelectors(prelude).map(function (selector) {
          return scopeSelector(selector, scope);
        }).join(",");
      } else {
        return;
      }
      out += prelude + "{" + body + "}\n";
    });
    return out;
  }

  // Registers (or replaces) a skin and returns a function that removes it.
  function registerSkin(id, css) {
    if (typeof id !== "string" || !id.trim()) throw new Error("ZoidiumUI.registerSkin requires an id");
    if (!global.document || !global.document.head) return function () {};
    var previous = skins.get(id);
    if (previous) previous.remove();
    var style = global.document.createElement("style");
    style.dataset.zuiSkin = id;
    style.textContent = scopeCss(css, skinSelector(id), id);
    global.document.head.appendChild(style);
    skins.set(id, style);
    return function removeSkin() {
      if (skins.get(id) !== style) return;
      skins.delete(id);
      style.remove();
    };
  }

  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  builder.skins = {
    registerSkin: registerSkin,
  };
})(window);
