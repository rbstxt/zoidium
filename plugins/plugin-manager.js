// Plugin manager: startup. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { REGISTRY_URL, pluginStates } = manager;
  const settleRegistryReady = (...args) => manager.settleRegistryReady(...args);
  const shouldStartEnabled = (...args) => manager.shouldStartEnabled(...args);
  const fetchJson = (...args) => manager.fetchJson(...args);
  const installEffectPickerBadges = (...args) => manager.installEffectPickerBadges(...args);
  const configureBundledLightDefault = (...args) => manager.configureBundledLightDefault(...args);
  const installMissingNativeFactories = (...args) => manager.installMissingNativeFactories(...args);
  const trackPluginMaterial = (...args) => manager.trackPluginMaterial(...args);
  const untrackPluginMaterial = (...args) => manager.untrackPluginMaterial(...args);
  const trackPluginResource = (...args) => manager.trackPluginResource(...args);
  const untrackPluginResource = (...args) => manager.untrackPluginResource(...args);
  const installObject3DUsageTracker = (...args) => manager.installObject3DUsageTracker(...args);
  const loadPluginPackageForState = (...args) => manager.loadPluginPackageForState(...args);
  const rememberPluginError = (...args) => manager.rememberPluginError(...args);
  const getDebugPlugins = (...args) => manager.getDebugPlugins(...args);
  const getDebugProjectUsage = (...args) => manager.getDebugProjectUsage(...args);
  const installNumericFallbacks = (...args) => manager.installNumericFallbacks(...args);
  const installProjectPluginHooks = (...args) => manager.installProjectPluginHooks(...args);
  const installEditorPluginHooks = (...args) => manager.installEditorPluginHooks(...args);
  const enablePlugin = (...args) => manager.enablePlugin(...args);
  const createPanel = (...args) => manager.createPanel(...args);
  const createTab = (...args) => manager.createTab(...args);

  // BEGIN manager body 3477
  async function initialize() {
    if (typeof PZ === "undefined" || !PZ.effect || !PZ.ui?.objectTypes) {
      setTimeout(initialize, 50);
      return;
    }
    if (document.querySelector(".zoidium-plugin-tab")) {
      settleRegistryReady();
      return;
    }

    window.ZoidiumCommunityEffectHost?.installGuards();
    installProjectPluginHooks();
    installEditorPluginHooks();
    PZ.zoidium.define("requestPlugin", (...args) => manager.requestPlugin(...args), "plugin-manager");
    PZ.zoidium.define("getDebugPlugins", getDebugPlugins, "plugin-manager");
    PZ.zoidium.define("getDebugProjectUsage", getDebugProjectUsage, "plugin-manager");
    installObject3DUsageTracker();
    PZ.zoidium.define("trackPluginMaterial", trackPluginMaterial, "plugin-manager");
    PZ.zoidium.define("untrackPluginMaterial", untrackPluginMaterial, "plugin-manager");
    PZ.zoidium.define("trackPluginResource", trackPluginResource, "plugin-manager");
    PZ.zoidium.define("untrackPluginResource", untrackPluginResource, "plugin-manager");
    installMissingNativeFactories();
    installNumericFallbacks();
    configureBundledLightDefault();

    try {
      const registry = await fetchJson(REGISTRY_URL);
      if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
        throw new Error("Invalid plugin registry");
      }
      const panel = createPanel(registry);
      createTab(panel);
      installEffectPickerBadges();

      const startupStates = Array.from(pluginStates.values()).filter((state) =>
        shouldStartEnabled(state.plugin)
      );
      await Promise.all(
        startupStates.map(async (state) => {
          try {
            await loadPluginPackageForState(state);
          } catch (error) {
            rememberPluginError(state, "preload", error);
            console.error(`[Zoidium] failed to preload ${state.plugin.name}:`, error);
          }
        })
      );
      for (const state of startupStates) {
        if (shouldStartEnabled(state.plugin)) await enablePlugin(state, false);
      }
      try {
        window.ZoidiumCommunityEffectHost?.installGuards();
        if (window.localStorage?.getItem("zoidium.community-preview") === "1") {
          manager.mountCommunityPanel?.(panel, registry);
        }
      } catch (error) {
        console.error("[Zoidium] community management is unavailable:", error);
      }
    } catch (error) {
      console.error("[Zoidium] plugin manager failed to initialize:", error);
    } finally {
      settleRegistryReady();
    }
  }

  // END manager body
  Object.assign(manager, { initialize });

  initialize();
})();
