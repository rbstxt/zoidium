"use strict";

var GP_STYLE_ID = "zoidium-graph-plus-css";
var gpThemeRoots = new WeakMap();
// Native CM3 popups flatten stylesheet paths and do not inherit root tokens.
// Keep their graph colors and UI font in step with the main editor on redraw.
function gpSyncTheme(doc) {
  try {
    if (typeof document === "undefined" || doc === document || !doc.documentElement) return;
    var theme = document.defaultView.getComputedStyle(document.documentElement);
    var saved = gpThemeRoots.get(doc);
    if (!saved) { saved = {}; gpThemeRoots.set(doc, saved); }
    function copy(key) {
      if (!(key in saved)) saved[key] = { value: doc.documentElement.style.getPropertyValue(key), priority: doc.documentElement.style.getPropertyPriority(key) };
      var value = theme.getPropertyValue(key).trim();
      if (doc.documentElement.style.getPropertyValue(key) !== value) doc.documentElement.style.setProperty(key, value);
    }
    var tokens = ["font", "accent", "accent-rgb", "accent-strong", "value", "value-strong",
      "bg", "bg-title", "bg-title-focused", "bg-input", "bg-sunken", "border", "border-soft",
      "hover", "text", "text-strong", "text-bright", "text-muted", "text-faint", "danger", "shadow",
      "menu-active", "menu-font-size", "menu-title-font-size", "menu-padding", "menu-item-padding", "menu-title-padding"];
    tokens.forEach(function (name) {
      var key = "--zui-" + name;
      copy(key);
    });
    ["--zoidium-font-family", "--zoidium-code-font-family", "--zoidium-theme-focus", "--zoidium-theme-link"].forEach(function (key) {
      copy(key);
    });
  } catch (_themeError) { /* A closing popup needs no theme update. */ }
}
function gpInjectStyle(doc) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !doc.head) return;
    if (doc.getElementById && doc.getElementById(GP_STYLE_ID)) return;
    if (typeof document !== "undefined" && doc !== document && document.querySelectorAll) {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function (source) {
        if (!/\/(?:ui-window|ui-overrides|runtime-fonts|fonts)\.css(?:[?#]|$)/.test(source.href)) return;
        var link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href = source.href;
        link.dataset.graphPlusTheme = "true";
        doc.head.appendChild(link);
      });
      gpSyncTheme(doc);
    }
    var element = doc.createElement("style");
    element.id = GP_STYLE_ID;
    element.textContent = gpCssText();
    doc.head.appendChild(element);
  } catch (_styleError) {
    // Styling must never break the editor.
  }
}
function gpRemoveStyle(doc) {
  try {
    var existing = doc && doc.getElementById ? doc.getElementById(GP_STYLE_ID) : null;
    if (existing && typeof existing.remove === "function") existing.remove();
    if (doc && doc.querySelectorAll) doc.querySelectorAll('[data-graph-plus-theme]').forEach(function (link) { link.remove(); });
    var saved = doc && gpThemeRoots.get(doc);
    if (saved && doc.documentElement) {
      Object.keys(saved).forEach(function (key) {
        if (saved[key].value) doc.documentElement.style.setProperty(key, saved[key].value, saved[key].priority);
        else doc.documentElement.style.removeProperty(key);
      });
      gpThemeRoots.delete(doc);
    }
  } catch (_removeError) {
    // A closed popup needs no cleanup.
  }
}
function gpCssText() {
return [
    ".g2-editor,.g2-editor *{font-family:var(--zui-font) !important}",
    ".g2-wrap{display:flex;flex-direction:column;width:100%;height:100%;background:var(--zui-bg-sunken);color:var(--zui-text-bright) !important;font-family:var(--zui-font);overflow:hidden;user-select:none;-webkit-user-select:none;position:relative}",
    ".g2-wrap svg,.g2-wrap canvas{-webkit-user-drag:none;user-drag:none}",
    ".g2-canvas{touch-action:none}",
    ".g2-wrap :focus-visible{outline:1px solid var(--zui-accent);outline-offset:-1px}",
    ".g2-canvas svg{touch-action:none}",
    ".g2-toolbar,.g2-status,.g2-ruler{display:flex !important;visibility:visible !important;opacity:1 !important}",
    /* ==== toolbar: CM3 title-row chrome, same tile layout ==== */
    /* Narrow popup windows (Ctrl+G is 600x400 with a 197px picker column)
       must never squeeze the canvas to zero: the toolbar wraps but is
       capped so the canvas always keeps room; narrow screens get smaller
       tiles so more actions stay visible without scrolling. */
    ".g2-toolbar{flex:0 1 auto;flex-shrink:1;display:flex;align-items:flex-start;gap:6px;padding:15px 26px 10px;background:var(--zui-bg-title);border-bottom:1px solid var(--zui-border);font-size:var(--zui-font-size-compact);flex-wrap:wrap;overflow-y:auto;overflow-x:hidden;min-height:104px;max-height:46%;z-index:5;position:relative;scrollbar-width:thin}",
    ".g2-wrap.g2-narrow .g2-toolbar{gap:4px;padding:10px 12px 8px;min-height:0}",
    ".g2-wrap.g2-narrow .g2-tile .g2-box{width:44px;height:38px}",
    ".g2-wrap.g2-narrow .g2-tile .g2-tlabel{font-size:var(--zui-font-size-compact);max-width:60px}",
    ".g2-wrap.g2-narrow .g2-group{gap:8px}",
    ".g2-wrap.g2-narrow .g2-sep{width:12px}",
    ".g2-wrap.g2-narrow .g2-tile.g2-small .g2-box{width:32px;height:28px}",
    ".g2-wrap.g2-narrow .g2-custom .g2-sbox{width:40px;height:26px}",
    ".g2-wrap.g2-narrow .g2-custom .g2-clabel{font-size:var(--zui-font-size-compact)}",
    ".g2-group{display:flex;align-items:flex-start;gap:13px;background:transparent;border:0;border-radius:0;padding:0;flex-shrink:0}",
    ".g2-sep{width:40px;align-self:stretch;background:transparent;flex-shrink:0}",
    ".g2-spacer{flex:1 1 auto}",
    ".g2-wrap .g2-toolbar button.g2-tile{display:flex;flex-direction:column;align-items:center;gap:8px;background:transparent !important;border:0 !important;padding:0 !important;cursor:pointer;width:auto;height:auto;flex-shrink:0}",
    ".g2-tile .g2-box{width:68px;height:54px;background:var(--zui-bg-input);border:1px solid var(--zui-border);border-radius:2px;display:flex;align-items:center;justify-content:center;box-sizing:border-box}",
    ".g2-tile:hover .g2-box{background:var(--zui-hover)}",
    ".g2-tile:active .g2-box{background:var(--zui-bg-sunken)}",
    ".g2-tile.on .g2-box{outline:2px solid var(--zui-accent);outline-offset:0}",
    ".g2-tile .g2-tlabel{font-size:var(--zui-font-size-compact);line-height:1.2;color:var(--zui-text-bright) !important;text-align:center;max-width:90px;white-space:normal}",
    /* custom easings: thumbnail + label to the RIGHT */
    ".g2-wrap .g2-toolbar button.g2-custom{display:flex;align-items:center;gap:14px;background:transparent !important;border:0 !important;padding:0 !important;cursor:pointer;flex-shrink:0;min-height:54px}",
    ".g2-custom .g2-sbox{width:50px;height:30px;background:var(--zui-bg-input);border:1px solid var(--zui-border);border-radius:2px;display:flex;align-items:center;justify-content:center}",
    ".g2-custom:hover .g2-sbox{background:var(--zui-hover)}",
    ".g2-custom .g2-clabel{font-size:var(--zui-font-size-compact);color:var(--zui-text-bright) !important;white-space:nowrap}",
    /* others: right-aligned small tiles */
    ".g2-tile.g2-small .g2-box{width:38px;height:32px}",
    ".g2-tile.g2-small{gap:3px}",
    ".g2-tile.g2-small .g2-tlabel{font-size:var(--zui-font-size-compact);max-width:56px}",
    ".g2-tile.g2-acc .g2-box{background:rgb(var(--zui-accent-rgb) / 0.55)}",
    ".g2-ico{display:inline-flex;flex:0 0 auto}",
    ".g2-ico svg{display:block}",
    /* custom easings popup */
    ".g2-popup{position:absolute;z-index:30;min-width:200px;max-height:330px;overflow-y:auto;background:var(--zui-bg);border:1px solid var(--zui-border);border-radius:3px;padding:4px 0}",
    ".g2-popup-head{padding:5px 10px;font-size:var(--zui-font-size-compact);color:var(--zui-text-muted) !important;border-bottom:1px solid var(--zui-border-soft)}",
    ".g2-popup-item{padding:5px 10px;font-size:var(--zui-font-size-compact);color:var(--zui-text-bright) !important;cursor:pointer;white-space:nowrap}",
    ".g2-popup-item:hover{background:var(--zui-accent)}",
    ".g2-wrap .g2-toolbar select{display:none}",
    ".g2-ruler{flex:0 0 auto;flex-shrink:0;height:30px;background:var(--zui-bg);border-bottom:1px solid var(--zui-border);cursor:ew-resize;position:relative;overflow:hidden}",
    ".g2-ruler canvas{position:absolute;inset:0;width:100%;height:100%;display:block}",
    ".g2-body{flex:1;position:relative;min-height:0;overflow:hidden;background:var(--zui-bg-sunken)}",
    ".g2-main{display:flex;flex:1;min-height:0;min-width:0}",
    ".g2-tracks{flex:0 0 188px;width:188px;min-height:0;background:var(--zui-bg);border-right:1px solid var(--zui-border);overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}",
    ".g2-tracks-head{flex:0 0 auto;padding:5px 8px;background:var(--zui-bg-title);border-bottom:1px solid var(--zui-border);font-size:var(--zui-font-size-compact);color:var(--zui-text-bright) !important}",
    ".g2-track-row{display:flex;align-items:center;gap:7px;padding:5px 8px;border-bottom:1px solid var(--zui-border-soft);white-space:nowrap;cursor:pointer;flex:0 0 auto}",
    ".g2-track-row:hover{background:var(--zui-hover)}",
    ".g2-track-row.selected{background:var(--zui-accent)}",
    ".g2-swatch{width:12px;height:4px;flex:0 0 12px;border-radius:1px}",
    ".g2-track-name{flex:1;overflow:hidden;text-overflow:ellipsis;color:var(--zui-text-bright) !important;font-size:var(--zui-font-size-compact)}",
    ".g2-track-val{color:var(--zui-value) !important;font-size:var(--zui-font-size-compact);font-variant-numeric:tabular-nums;background:var(--zui-bg-input);border-radius:3px;padding:1px 5px}",
    ".g2-wrap .g2-eye{cursor:pointer;border:1px solid var(--zui-border);background:var(--zui-hover);color:var(--zui-text-bright) !important;font-size:var(--zui-font-size-compact);padding:1px 6px;border-radius:3px;line-height:1.4}",
    ".g2-wrap .g2-eye.off{opacity:.35}",
    ".g2-right{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}",
    ".g2-canvas{flex:1;position:relative;min-height:48px;min-width:48px;overflow:hidden;background:var(--zui-bg-sunken)}",
    ".g2-canvas svg{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}",
    ".g2-cv{stroke-linecap:round;stroke-linejoin:round}",
    ".g2-kf{cursor:move;}",
    ".g2-kf:hover{stroke:var(--zui-accent-strong)}",
    ".g2-hdl{cursor:move}",
    ".g2-legend{display:none}",
    ".g2-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}",
    ".g2-empty-card{pointer-events:auto;text-align:center;background:var(--zui-bg);border:1px solid var(--zui-border-soft);border-radius:3px;padding:20px 26px;max-width:360px}",
    ".g2-empty-card h3{margin:0 0 6px;font-size:var(--zui-font-size-small);color:var(--zui-text-bright) !important}",
    ".g2-empty-card p{margin:0;font-size:var(--zui-font-size-compact);line-height:1.6;color:var(--zui-text) !important}",
    ".g2-empty-card .zoidium-note{padding:0;border-bottom:0;font-size:var(--zui-font-size-compact);line-height:1.6}",
    ".g2-empty-card b{color:var(--zui-value);font-weight:400}",
    ".g2-tip{position:absolute;pointer-events:none;background:var(--zui-bg-input);border:1px solid var(--zui-border-soft);border-radius:3px;padding:6px 9px;font-size:var(--zui-font-size-compact);line-height:1.5;display:none;z-index:5;color:var(--zui-text) !important}",
    ".g2-status{flex:0 0 auto;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--zui-bg-title);border-top:1px solid var(--zui-border);font-size:var(--zui-font-size-compact);color:var(--zui-text) !important;flex-wrap:nowrap;overflow:hidden;white-space:nowrap}",
    ".g2-pill{background:var(--zui-hover);border:1px solid var(--zui-border-soft);border-radius:3px;padding:2px 10px;color:var(--zui-text-muted) !important;font-variant-numeric:tabular-nums;flex:0 0 auto;max-width:100%}",
    ".g2-status .g2-pill:last-child{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".g2-pill b{color:var(--zui-text-bright);font-weight:400}",
    ".g2-pill.live{border-color:var(--zui-accent);color:var(--zui-value)}",
    ".g2-curve-label{font-weight:700;paint-order:stroke;stroke:var(--zui-bg-sunken);stroke-width:3px}",
    ".g2-property-selected{outline:1px solid var(--zui-accent);outline-offset:-1px;background:rgb(var(--zui-accent-rgb) / 0.12)}",
      ".g2-hover{filter:brightness(1.5);stroke:var(--zui-text-bright)!important;cursor:move}",
    ".g2-group[data-label]{position:relative;padding:18px 8px 3px;border-right:1px solid var(--zui-border);gap:6px;flex-wrap:wrap;max-width:100%;box-sizing:border-box}",
    ".g2-group[data-label]:before{content:attr(data-label);position:absolute;left:8px;top:0;font-size:10px;color:var(--zui-text-muted)}",
    ".g2-wrap .g2-toolbar{padding:6px;gap:3px;min-height:0;max-height:46%}",
    ".g2-wrap .g2-tile .g2-box{width:32px!important;height:28px!important}",
    ".g2-wrap .g2-tile{gap:3px!important;max-width:65px}",
    ".g2-wrap .g2-tile .g2-tlabel{max-width:65px;font-size:10px}",
    ".g2-wrap .g2-custom{max-width:100px;gap:3px!important;min-height:28px!important}",
    ".g2-wrap .g2-custom .g2-sbox{width:32px;height:28px}",
    ".g2-wrap .g2-toolbar button:disabled{opacity:.35;cursor:default}",
    ".g2-gestures{position:absolute;right:6px;bottom:32px;max-width:calc(100% - 28px);max-height:calc(100% - 60px);overflow:auto;padding:10px;background:var(--zui-bg);border:1px solid var(--zui-border);z-index:20;font-size:11px;box-shadow:0 4px 16px var(--zui-shadow)}",
    ".g2-gestures td,.g2-gestures th{padding:5px;text-align:left;white-space:normal}",
    ".g2-wrap .g2-eye{min-width:26px;min-height:26px;padding:2px}",
    ".g2-track-row{min-height:28px;box-sizing:border-box}",
    ".g2-track-name{min-width:0}",
    ".g2-wrap .g2-status{flex-wrap:wrap;max-height:48px;gap:4px}",
].join("\n");
}

module.exports = { gpSyncTheme, gpInjectStyle, gpRemoveStyle, gpCssText };
