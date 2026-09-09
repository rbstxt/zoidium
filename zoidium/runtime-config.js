(function (global) {
  "use strict";

  var defaults = {
    version: "1.0.0",
    overlayStyles: [
      "./zoidium/ui-overrides.css?v=29",
      "./plugins/plugin-manager.css?v=17",
      "./zoidium-welcome-tour.css?v=13",
      "./zoidium/runtime-fonts.css?v=4"
    ],
    preInitScripts: [
      "./zoidium/debug-log.js?v=4",
      "./plugins/core-patches/window-stylesheet-guard.js?v=1",
      "./plugins/core-patches/project-media-fps.js",
      "./plugins/core-patches/audio-track-visibility.js?v=3",
      "./plugins/core-patches/default-project-settings.js?v=1",
      "./plugins/core-patches/particle-defaults.js?v=2",
      "./plugins/core-patches/temporal-render.js?v=5",
      "./plugins/core-patches/video-frame-export.js",
      "./plugins/core-patches/render-aspect-ratio.js",
      "./plugins/core-patches/export-fps.js?v=2",
      "./plugins/core-patches/image-export-options.js?v=1",
      "./plugins/core-patches/precise-time-left.js?v=1",
      "./plugins/core-patches/about-attribution.js",
      "./plugins/core-patches/text-shape-winding.js",
      "./plugins/core-patches/object3d-registry.js",
      "./plugins/core-patches/disable-recovery.js",
      "./plugins/core-patches/remove-ad-panel.js",
      "./plugins/core-patches/remove-videoeditor-legacy-message.js?v=1",
      "./plugins/core-patches/restore-videoeditor-controls.js?v=1",
      "./plugins/core-patches/remove-community-media.js",
      "./zoidium/direct-download.js",
      "./plugins/core-patches/project-files.js?v=3"
    ],
    postInitScripts: [
      "./zoidium/ui-kit.js?v=3",
      "./zoidium/project-restore.js?v=10",
      "./zoidium/settings.js?v=27",
      "./plugins/plugin-manager.js?v=39",
      "./zoidium-welcome-tour.js?v=9"
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
