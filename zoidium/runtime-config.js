(function (global) {
  "use strict";

  var defaults = {
    version: "1.0.0",
    // Single cache-busting counter for every first-party style and script
    // below. Bump this once when any of those files changes; the runtime
    // loader appends it automatically, so per-file ?v= queries are never
    // hand-edited here. Plugin asset URLs are versioned separately by
    // tools/build-plugin-bundles.js from each manifest's own version.
    assetVersion: 193,
    // Plugin registry consumed by plugins/plugin-manager.js. It is preloaded
    // below, so its URL lives here as the single source.
    registryUrl: "./plugins/registry.json?v=150",
    // Source Code Pro is imported through fonts.css as its own sheet (listed
    // before runtime-fonts.css) so the font files are not discovered only
    // after an @import chain has finished downloading.
    overlayStyles: [
      "./fonts/fonts.css?v=5",
      "./zoidium/ui-overrides.css",
      "./zoidium/ui-window.css",
      "./zoidium/ui-node-editor.css",
      "./zoidium/theme-editor.css",
      "./zoidium/gradient-editor.css",
      "./plugins/plugin-manager.css",
      "./zoidium-welcome-tour.css",
      "./zoidium/runtime-fonts.css"
    ],
    preInitScripts: [
      "./zoidium/debug-journal.js",
      "./zoidium/debug-crash.js",
      "./zoidium/debug-log.js",
      "./plugins/core/window-stylesheet-guard.js",
      "./plugins/core/project-media-fps.js",
      "./plugins/core/audio-track-visibility.js",
      "./plugins/core/default-project-settings.js",
      "./plugins/core/preview-context-menu.js",
      "./plugins/core/particle-defaults.js",
      "./plugins/core/empty-keyframes.js",
      "./plugins/core/temporal-math.js",
      "./plugins/core/temporal-layers.js",
      "./plugins/core/temporal-capture.js",
      "./plugins/core/temporal-sampler.js",
      "./plugins/core/temporal-export.js",
      "./plugins/core/temporal-render.js",
      "./plugins/core/video-frame-export.js",
      "./plugins/core/render-aspect-ratio.js",
      "./plugins/core/project-archive.js",
      "./plugins/core/export-bitrate.js",
      "./plugins/core/io-serialization.js",
      "./plugins/core/export-fps.js",
      "./plugins/core/image-export-options.js",
      "./plugins/core/precise-time-left.js",
      "./plugins/core/about-attribution.js",
      "./plugins/core/text-shape-winding.js",
      "./plugins/core/object3d-registry.js",
      "./plugins/core/shadow-quality.js",
      "./plugins/core/named-property-lists.js",
      "./plugins/core/shader-pipeline.js",
      "./plugins/core/disable-recovery.js",
      "./plugins/core/remove-ad-panel.js",
      "./plugins/core/centered-layout.js",
      "./plugins/core/layer-unload-dispose.js",
      "./plugins/core/display-labels.js",
      "./plugins/core/remove-videoeditor-legacy-message.js",
      "./plugins/core/restore-videoeditor-controls.js",
      "./plugins/core/videoeditor-timeline-defaults.js",
      "./plugins/core/remove-community-media.js",
      "./plugins/core/composite-video-materials.js",
      "./plugins/core/playback-seek-sync.js",
      "./plugins/core/export-audio-trace.js",
      "./zoidium/direct-download.js",
      "./plugins/core/project-files.js",
      "./plugins/core/panel-fullscreen-shortcut.js",
      "./plugins/core/output-frame-store.js",
      "./plugins/core/output-frame-cache.js",
      // Keeps the editor's main preview reachable as editor.mainViewport. It
      // must be installed before initTool() builds the viewport.
      "./plugins/core/main-viewport.js",
      "./plugins/core/asset-registry-walk.js",
      "./plugins/core/asset-registry-status.js",
      "./plugins/core/asset-registry-reveal.js",
      "./plugins/core/asset-registry-fetch.js",
      "./plugins/core/asset-registry-decode.js",
      "./plugins/core/asset-registry-consumers.js",
      "./plugins/core/asset-registry-actions.js",
      "./plugins/core/asset-retention.js",
      "./plugins/core/asset-registry-edits.js",
      "./plugins/core/asset-replacement-consumers.js",
      "./plugins/core/asset-registry-replace.js",
      "./plugins/core/asset-registry-organize.js",
      "./plugins/core/asset-registry-zip.js",
      "./plugins/core/asset-registry-collect.js",
      "./plugins/core/asset-registry.js"
    ],
    postInitScripts: [
      // ui-panels.js queues its installer for ui-kit.js, so it loads first.
      // The node editor and the UI kit are split along their seams; the
      // assemblers (ui-node-editor.js, ui-kit.js) load last.
      "./zoidium/ui-panels.js",
      "./zoidium/ui-node-editor-graph.js",
      "./zoidium/ui-node-editor-view.js",
      "./zoidium/ui-node-editor-fields.js",
      "./zoidium/ui-node-editor-menu.js",
      "./zoidium/ui-node-editor.js",
      "./zoidium/ui-kit-panels.js",
      "./zoidium/ui-kit-skins.js",
      "./zoidium/ui-kit-windows.js",
      "./zoidium/ui-kit-controls.js",
      "./zoidium/ui-kit-menus.js",
      "./zoidium/ui-kit.js",
      "./zoidium/project-restore-store.js",
      "./zoidium/project-restore-snapshots.js",
      "./zoidium/project-restore-toasts.js",
      "./zoidium/project-restore.js",
      "./zoidium/shared/random.js",
      "./zoidium/shared/props.js",
      "./zoidium/shared/color.js",
      "./zoidium/shared/gl.js",
      "./zoidium/shared/json.js",
      "./zoidium/shared/windows.js",
      "./zoidium/theme-model.js",
      "./zoidium/theme-state.js",
      "./zoidium/theme-clips.js",
      "./zoidium/theme-editor.js",
      "./zoidium/gradient-model.js",
      "./zoidium/gradient-color-panel.js",
      "./zoidium/gradient-editor.js",
      "./zoidium/gradient-native.js",
      "./zoidium/settings.js",
      "./zoidium/plugin-apis.js",
      "./zoidium/project-compatibility.js",
      "./zoidium/plugin-manager-state.js",
      "./zoidium/plugin-manager-persistence.js",
      "./zoidium/plugin-manager-assets.js",
      "./zoidium/plugin-manager-picker.js",
      "./zoidium/plugin-manager-factories.js",
      "./zoidium/plugin-manager-lifecycle.js",
      "./zoidium/plugin-manager-scanners.js",
      "./zoidium/plugin-manager-fallbacks.js",
      "./zoidium/plugin-manager-projects.js",
      "./zoidium/plugin-manager-panel.js",
      "./zoidium/community-safe-json.js",
      "./zoidium/community-package.js",
      "./zoidium/community-protocol.js",
      "./zoidium/community-bootstrap.js",
      "./zoidium/community-ui.js",
      "./zoidium/community-effect-host.js",
      "./zoidium/community-preview.js",
      "./zoidium/community-effects.js",
      "./zoidium/community-store-indexeddb.js",
      "./zoidium/community-plugin-store.js",
      "./zoidium/community-plugin-panel.js",
      "./plugins/plugin-manager.js",
      "./zoidium-welcome-tour.js"
    ],
    policy: {
      ads: "block",
      account: "offline",
      community: "offline"
    }
  };

  // Load the staged trusted Worker data before any package can be selected.
  // No community package controls this URL or initiates this script load.
  try {
    if (global.localStorage?.getItem("zoidium.community-preview") === "1") {
      defaults.postInitScripts.splice(defaults.postInitScripts.indexOf("./zoidium/community-effects.js"), 0,
        "./zoidium/community-runtime-source.js");
    }
  } catch (_error) { /* Preview stays unavailable when storage is blocked. */ }

  var overrides = global.ZOIDIUM_RUNTIME_OVERRIDES || {};
  var config = Object.assign({}, defaults, overrides, {
    policy: Object.assign({}, defaults.policy, overrides.policy || {}),
    overlayStyles: Array.isArray(overrides.overlayStyles)
      ? overrides.overlayStyles.slice()
      : defaults.overlayStyles.slice(),
    preInitScripts: Array.isArray(overrides.preInitScripts)
      ? overrides.preInitScripts.slice()
      : defaults.preInitScripts.slice(),
    postInitScripts: Array.isArray(overrides.postInitScripts)
      ? overrides.postInitScripts.slice()
      : defaults.postInitScripts.slice()
  });

  global.ZOIDIUM_RUNTIME = Object.freeze(config);

  // This file runs before the CM3 core and UI bundles, so these hints start
  // the extension downloads while those large files are still arriving. The
  // runtime loader later inserts the same URLs (identical ?v= query, same
  // CORS mode) and they resolve from the preload cache. Hints never execute
  // anything, so the CM3 script order is unchanged.
  function preloadRuntimeAssets(runtime) {
    var doc = global.document;
    if (!doc || !doc.head || typeof doc.createElement !== "function") return;

    function versioned(value) {
      var href = new URL(value, doc.baseURI).href;
      if (runtime.assetVersion == null || /[?#]/.test(value)) return href;
      return href + "?v=" + encodeURIComponent(String(runtime.assetVersion));
    }

    function hint(href, as, crossOrigin) {
      var link = doc.createElement("link");
      link.rel = "preload";
      link.as = as;
      if (crossOrigin) link.crossOrigin = crossOrigin;
      link.href = href;
      doc.head.appendChild(link);
    }

    // Hint only the editor entry the loader will select (same rule as
    // runtime-loader.js: the stored layout when valid, a "-centered" variant's
    // base editor, else the default).
    var profiles = global.ZOIDIUM_RUNTIME_PROFILES || {};
    var layouts = profiles.layouts || {};
    var stored = null;
    try {
      var settings = JSON.parse(global.localStorage.getItem("zoidium.editor-settings") || "null");
      stored = settings && typeof settings.layout === "string" ? settings.layout : null;
    } catch (_error) {
      // Storage may be blocked; the default layout is still hinted.
      stored = null;
    }
    var base = typeof stored === "string" ? stored.replace(/-centered\d*$/, "") : stored;
    var selected = layouts[stored] ? stored : layouts[base] ? base : profiles.defaultLayout || "clipmaker";
    if (layouts[selected] && typeof layouts[selected].entryScript === "string") {
      hint(versioned(layouts[selected].entryScript), "script");
    }
    runtime.overlayStyles.forEach(function (url) { hint(versioned(url), "style"); });
    runtime.preInitScripts.concat(runtime.postInitScripts).forEach(function (url) {
      hint(versioned(url), "script");
    });
    // fonts.css references the WOFF2 without a query, so the hint must not add one.
    hint(new URL("./fonts/source-code-pro-regular.woff2", doc.baseURI).href, "font", "anonymous");
    hint(versioned(runtime.registryUrl), "fetch", "anonymous");
  }

  try {
    preloadRuntimeAssets(config);
  } catch (_error) {
    // Hints are an optimization; the loader still starts every file on demand.
  }
})(window);
