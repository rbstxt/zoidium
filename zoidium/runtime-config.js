(function (global) {
  "use strict";

  var defaults = {
    overlayStyles: [
      "./zoidium/ui-overrides.css",
      "./plugins/plugin-manager.css?v=9",
      "./zoidium-welcome-tour.css?v=11",
      "./zoidium/runtime-fonts.css"
    ],
    preInitScripts: [
      "./plugins/core-patches/project-media-fps.js",
      "./plugins/core-patches/video-frame-export.js",
      "./plugins/core-patches/render-aspect-ratio.js",
      "./plugins/core-patches/about-attribution.js",
      "./plugins/core-patches/text-shape-winding.js",
      "./plugins/core-patches/object3d-registry.js",
      "./plugins/core-patches/disable-recovery.js",
      "./plugins/core-patches/remove-ad-panel.js",
      "./plugins/core-patches/remove-community-media.js",
      "./zoidium/direct-download.js"
    ],
    postInitScripts: [
      "./plugins/plugin-manager.js?v=26",
      "./zoidium-welcome-tour.js?v=7"
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
