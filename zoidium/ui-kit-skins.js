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

  var skins = new Map();

  function skinSelector(id) {
    return '.zoidium-window[data-zui-skin="' + String(id).replace(/["\\]/g, "\\$&") + '"]';
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

  // Scopes a stylesheet to `scope`. Comments are dropped; @keyframes,
  // @font-face and other non-grouping at-rules are copied unchanged.
  function scopeCss(css, scope) {
    var source = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
    var out = "";
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
      var block = source.slice(open + 1, cursor - 1);
      if (/^@(media|supports|container)\b/i.test(prelude)) {
        out += prelude + "{" + scopeCss(block, scope) + "}\n";
      } else if (prelude.charAt(0) === "@") {
        out += prelude + "{" + block + "}\n";
      } else if (prelude) {
        out += splitSelectors(prelude).map(function (selector) {
          return scopeSelector(selector, scope);
        }).join(",") + "{" + block + "}\n";
      }
      index = cursor;
    }
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
    style.textContent = scopeCss(css, skinSelector(id));
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
