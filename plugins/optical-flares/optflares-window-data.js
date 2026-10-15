"use strict";

// OpenZoid Optical Flares - options window.
//
// One floating window (context.ui.openWindow, see docs/plugin-ui.md) with a
// Browser (Flare, Elements and Presets tabs), the element stack, the selected
// element, Source, Global, Advanced and Custom Layers sections. The editor
// viewport behind it is the live preview.
//
// Every edit is written through the flare's own properties with CM3's property
// operations, and element add/remove/move uses CM3's object list commands, so
// undo and redo come from the host history. Dragging previews through
// property.set() only; the undo record is written once, on commit.
//
// The stack rows and browser tiles draw per-type thumbnails with the same
// seeded 2D routines the donor editor used (no wall clock, no Math.random),
// corrected so each type draws its own shape. Scoped widget CSS holds the
// row and tile layout; the host supplies standard window chrome.

// Optical Flares options-window data: field tables, widget CSS, favorites
// and preview-background storage, and small value helpers. Factory state
// (window serials, favorite memory) lives in the closure.

module.exports = function createWindowData() {
    var SOURCE_FIELDS = [
        { path: "positioning.sourceType", label: "Source", kind: "select" },
        { path: "positioning.lightIndex", label: "Light index", kind: "number" },
        { path: "positioning.foreground.occlude", label: "Occlude", kind: "check" },
        {
            path: "positioning.foreground.fade",
            label: "Fade amount",
            kind: "number",
            hint: "Stored with the project. Occlusion is per pixel, so Fade does not change the render.",
        },
        { path: "positioning.margin", label: "Edge margin", kind: "number" },
        { path: "positioning.distanceFalloff", label: "Distance falloff", kind: "number" },
        { path: "positioning.referenceDistance", label: "Reference distance", kind: "number" },
    ];

    var GLOBAL_FIELDS = [
        { path: "flareSetup.centerPosition", label: "Center", kind: "xy" },
        { path: "flareSetup.brightness", label: "Brightness", kind: "number" },
        { path: "flareSetup.scale", label: "Scale", kind: "number" },
        { path: "flareSetup.scaleOffset", label: "Scale offset", kind: "check" },
        { path: "flareSetup.color", label: "Color", kind: "color" },
        { path: "flareSetup.colorMode", label: "Color mode", kind: "select" },
        { path: "flareSetup.rotationOffset", label: "Rotation offset", kind: "number" },
        { path: "flareSetup.animationEvolution", label: "Evolution", kind: "number" },
        { path: "positioning.flicker.amount", label: "Flicker", kind: "number" },
        { path: "positioning.flicker.speed", label: "Flicker speed", kind: "number" },
        { path: "flareSetup.gpu", label: "High quality", kind: "check" },
    ];

    var ADVANCED_FIELDS = [
        { path: "global.scale", label: "Element scale", kind: "number" },
        { path: "global.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "global.blendMode", label: "Blend mode", kind: "select" },
        { path: "global.color", label: "Color", kind: "color" },
        { path: "global.globalSeed", label: "Seed", kind: "number" },
        { path: "global.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "motionBlur.renderMode", label: "Render mode", kind: "select" },
    ];

    var ELEMENT_FIELDS = [
        { path: "element.enabled", label: "Enabled", kind: "check" },
        { path: "element.solo", label: "Solo", kind: "check" },
        { path: "globalParams.color", label: "Color", kind: "color" },
        { path: "globalParams.scale", label: "Size", kind: "number" },
        { path: "element.opacity", label: "Brightness", kind: "number" },
        { path: "element.distance", label: "Position", kind: "number" },
        { path: "element.rotation", label: "Rotation", kind: "number" },
        { path: "globalParams.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "globalParams.blendMode", label: "Blend mode", kind: "select" },
        { path: "globalParams.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "element.animate", label: "Animate", kind: "check" },
        { path: "globalParams.globalSeed", label: "Seed", kind: "number" },
    ];

    var SHAPE_FIELDS = [
        { path: "lensTexture.textureImage", label: "Texture", kind: "select" },
        { path: "lensTexture.illuminationRadius", label: "Illumination", kind: "number" },
        { path: "lensTexture.falloff", label: "Falloff", kind: "number" },
        { path: "matteBox.shape", label: "Matte shape", kind: "select" },
        { path: "matteBox.startRange", label: "Matte start", kind: "number" },
        { path: "matteBox.fadeAmount", label: "Matte fade", kind: "number" },
    ];

    // Layout for the stack rows and browser tiles. Everything visual comes
    // from the theme tokens; the canvases keep a black base so additive
    // glow drawings read the same under any theme.
    var WIDGET_CSS = [
        ".of-stack{display:flex;flex-direction:column;gap:4px;}",
        ".of-row{display:flex;gap:6px;align-items:center;padding:4px;border:1px solid var(--zui-border-soft);border-radius:3px;cursor:pointer;}",
        ".of-row:hover{background:var(--zui-hover);}",
        ".of-row.active{border-color:var(--zui-accent);}",
        ".of-row.disabled .of-row-name,.of-row.disabled .of-thumb{opacity:.45;}",
        ".of-row.dragover{border-top-color:var(--zui-accent);}",
        ".of-thumb{width:72px;height:44px;background:#000;border:1px solid var(--zui-border);border-radius:3px;flex:0 0 auto;}",
        ".of-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}",
        ".of-row-top{display:flex;align-items:center;gap:4px;}",
        ".of-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zui-text-strong);}",
        ".of-row-actions{display:flex;gap:3px;flex:0 0 auto;}",
        ".of-mini{width:auto;background:transparent;border:1px solid var(--zui-border-soft);color:var(--zui-text-muted);border-radius:3px;padding:1px 6px;cursor:pointer;}",
        ".of-mini:hover{color:var(--zui-text-bright);border-color:var(--zui-accent);}",
        ".of-mini.on{background:var(--zui-accent);color:var(--zui-text-bright);border-color:var(--zui-accent);}",
        ".of-mini.x{color:var(--zui-danger);}",
        ".of-row-fields{display:flex;gap:4px;}",
        ".of-row-fields .zoidium-field{flex:1 1 0;min-width:0;grid-template-columns:minmax(0,auto) minmax(0,1fr);padding:2px 2px 2px 4px;min-height:26px;column-gap:4px;border-bottom:0;}",
        ".of-row-fields .zoidium-number{width:100%;}",
        ".of-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}",
        ".of-tile{background:var(--zui-bg-sunken);border:1px solid var(--zui-border-soft);border-radius:3px;cursor:pointer;padding:0 0 4px;text-align:left;color:var(--zui-text);}",
        ".of-tile:hover{border-color:var(--zui-accent);}",
        ".of-tile canvas{width:100%;height:56px;display:block;background:#000;border-radius:3px 3px 0 0;}",
        ".of-tile-row{display:flex;align-items:center;gap:4px;padding:3px 6px 0;}",
        ".of-tile-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".of-sub{display:flex;gap:6px;align-items:center;margin-bottom:6px;}",
        ".of-hint{color:var(--zui-text-muted);padding:6px 2px;}",
        ".of-section-label{text-align:center;color:var(--zui-text-muted);padding:8px 0 2px;grid-column:1/-1;}",
        ".of-thumb.of-checker,.of-tile canvas.of-checker{background-image:linear-gradient(45deg,var(--zui-border) 25%,transparent 25%,transparent 75%,var(--zui-border) 75%),linear-gradient(45deg,var(--zui-border) 25%,var(--zui-bg-sunken) 25%,var(--zui-bg-sunken) 75%,var(--zui-border) 75%);background-size:12px 12px;background-position:0 0,6px 6px;}",
    ].map(function (rule) {
        return rule.replace(/^[^{]+/, function (selectors) {
            return selectors.split(",").map(function (selector) { return ".of-window " + selector; }).join(",");
        });
    }).join("\n");

    var TITLE = "Optical Flares";
    var windowSerial = 0;
    var windowIds = new WeakMap();
    var FAV_KEY = "zoidium.optical-flares.presetFavs.v1";
    var BG_KEY = "zoidium.optical-flares.previewBg.v1";
    var favMemory = {};
    var bgMemory = "black";

    function loadFavs() {
        try {
            if (typeof localStorage !== "undefined") {
                var raw = localStorage.getItem(FAV_KEY);
                if (raw) return JSON.parse(raw) || {};
            }
        } catch (error) { /* UI state only; fall back to memory */ }
        return favMemory;
    }

    function saveFavs(favs) {
        favMemory = favs || {};
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(FAV_KEY, JSON.stringify(favMemory));
        } catch (error) { /* UI state only */ }
    }

    function loadPreviewBg() {
        try {
            if (typeof localStorage !== "undefined") {
                var raw = localStorage.getItem(BG_KEY);
                if (raw === "checker" || raw === "black") return raw;
            }
        } catch (error) { /* UI state only */ }
        return bgMemory;
    }

    function savePreviewBg(value) {
        bgMemory = value;
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(BG_KEY, value);
        } catch (error) { /* UI state only */ }
    }

    /* ---------------- deterministic thumbnails ---------------- */

    // Seeded hash in [0, 1): the same type always draws the same thumbnail.

    function resolve(base, path) {
        var node = base;
        var parts = path.split(".");
        for (var i = 0; i < parts.length && node; i++) node = node[parts[i]];
        return node || null;
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function toHex(rgb) {
        return "#" + [0, 1, 2].map(function (i) {
            var v = Math.round(Math.max(0, Math.min(1, Number(rgb && rgb[i]) || 0)) * 255);
            return (v < 16 ? "0" : "") + v.toString(16);
        }).join("");
    }

    function fromHex(hex) {
        var n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    function optionItems(definition) {
        return String(definition && definition.items || "").split(";").map(function (label, index) {
            return { value: String(index), label: label };
        });
    }

    function stop(event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    }

    // Group of observer subscriptions that can be dropped together. Callbacks
    // never re-subscribe from inside the observable they are attached to.
    function Scope() {
        this.disposers = [];
    }
    Scope.prototype.watch = function (observable, fn) {
        if (!observable || typeof observable.watch !== "function") return;
        observable.watch(fn);
        this.disposers.push(function () { observable.unwatch(fn); });
    };
    Scope.prototype.dispose = function () {
        var list = this.disposers.splice(0, this.disposers.length);
        for (var i = 0; i < list.length; i++) list[i]();
    };


    return {
        SOURCE_FIELDS: SOURCE_FIELDS,
        GLOBAL_FIELDS: GLOBAL_FIELDS,
        ADVANCED_FIELDS: ADVANCED_FIELDS,
        ELEMENT_FIELDS: ELEMENT_FIELDS,
        SHAPE_FIELDS: SHAPE_FIELDS,
        WIDGET_CSS: WIDGET_CSS,
        TITLE: TITLE,
        windowSerial: windowSerial,
        windowIds: windowIds,
        FAV_KEY: FAV_KEY,
        BG_KEY: BG_KEY,
        loadFavs: loadFavs,
        saveFavs: saveFavs,
        loadPreviewBg: loadPreviewBg,
        savePreviewBg: savePreviewBg,
        resolve: resolve,
        copy: copy,
        toHex: toHex,
        fromHex: fromHex,
        optionItems: optionItems,
        stop: stop,
        Scope: Scope,
    };
};
