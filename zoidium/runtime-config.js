(function (global) {
  "use strict";

  var defaults = {
    version: "1.0.0",
    // Single cache-busting counter for every first-party style and script
    // below. Bump this once when any of those files changes; the runtime
    // loader appends it automatically, so per-file ?v= queries are never
    // hand-edited here. Plugin asset URLs are versioned separately by
    // tools/build-plugin-bundles.js from each manifest's own version.
    assetVersion: 39,
    overlayStyles: [
      "./zoidium/ui-overrides.css",
      "./plugins/plugin-manager.css",
      "./zoidium-welcome-tour.css",
      "./zoidium/runtime-fonts.css"
    ],
    preInitScripts: [
      "./zoidium/debug-log.js",
      "./plugins/core-patches/window-stylesheet-guard.js",
      "./plugins/core-patches/project-media-fps.js",
      "./plugins/core-patches/audio-track-visibility.js",
      "./plugins/core-patches/default-project-settings.js",
      "./plugins/core-patches/particle-defaults.js",
      "./plugins/core-patches/temporal-render.js",
      "./plugins/core-patches/video-frame-export.js",
      "./plugins/core-patches/render-aspect-ratio.js",
      "./plugins/core-patches/export-fps.js",
      "./plugins/core-patches/image-export-options.js",
      "./plugins/core-patches/precise-time-left.js",
      "./plugins/core-patches/about-attribution.js",
      "./plugins/core-patches/text-shape-winding.js",
      "./plugins/core-patches/object3d-registry.js",
      "./plugins/core-patches/disable-recovery.js",
      "./plugins/core-patches/remove-ad-panel.js",
      "./plugins/core-patches/remove-videoeditor-legacy-message.js",
      "./plugins/core-patches/restore-videoeditor-controls.js",
      "./plugins/core-patches/remove-community-media.js",
      "./zoidium/direct-download.js",
      "./plugins/core-patches/project-files.js"
    ],
    postInitScripts: [
      "./zoidium/ui-kit.js",
      "./zoidium/project-restore.js",
      "./zoidium/settings.js",
      "./plugins/plugin-manager.js",
      "./zoidium-welcome-tour.js"
    ],
    policy: {
      ads: "block",
      account: "offline",
      community: "offline"
    }
  };

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
})(window);
