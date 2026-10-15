// Plugin manager: persistence. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { STORAGE_PREFIX, debugUsageCounts } = manager;

  // BEGIN manager body 127
  function settleRegistryReady() {
    if (manager.registryReadySettled) return;
    manager.registryReadySettled = true;
    manager.resolveRegistryReady();
  }

  function updateDebugUsage(metadata, kind, itemId, itemName, delta) {
    if (!metadata?.id || !itemId) return;
    const key = `${metadata.id}\u0000${kind}\u0000${itemId}`;
    const count = Math.max(0, (debugUsageCounts.get(key) || 0) + delta);
    if (count > 0) debugUsageCounts.set(key, count);
    else debugUsageCounts.delete(key);
    if (delta <= 0 || (count & (count - 1)) !== 0) return;
    document.dispatchEvent(new CustomEvent("zoidium:plugin-usage-progress", {
      detail: {
        pluginId: metadata.id,
        pluginName: metadata.name || metadata.id,
        kind,
        itemId,
        itemName: itemName || itemId,
        count,
      },
    }));
  }

  function storageKey(pluginId) {
    return `${STORAGE_PREFIX}${pluginId}`;
  }

  function isPersistedEnabled(pluginId) {
    try {
      return localStorage.getItem(storageKey(pluginId)) === "true";
    } catch (_error) {
      manager.reportFailureOnce("read enabled state:" + pluginId, "read enabled state for " + pluginId, _error);
      return false;
    }
  }

  function isExplicitlyDisabled(pluginId) {
    try {
      return localStorage.getItem(storageKey(pluginId)) === "false";
    } catch (_error) {
      manager.reportFailureOnce("read disabled state:" + pluginId, "read disabled state for " + pluginId, _error);
      return false;
    }
  }

  // Plugins flagged "defaultEnabled" in the registry start enabled on first
  // run; an explicit persisted choice always wins over the default.
  function shouldStartEnabled(plugin) {
    // Hidden core plugins always run: they are not shown in the panel, never
    // persisted, and cannot be disabled.
    if (plugin.alwaysEnabled === true || plugin.visibility === "hidden") return true;
    if (isExplicitlyDisabled(plugin.id)) return false;
    if (isPersistedEnabled(plugin.id)) return true;
    return plugin.defaultEnabled === true;
  }

  function isSaveApprovalRemembered(pluginId) {
    try {
      return (
        localStorage.getItem(`zoidium.plugin.saveApproved.${pluginId}`) === "true"
      );
    } catch (_error) {
      manager.reportFailureOnce("read save approval:" + pluginId, "read save approval for " + pluginId, _error);
      return false;
    }
  }

  function rememberSaveApproval(pluginId) {
    try {
      localStorage.setItem(
        `zoidium.plugin.saveApproved.${pluginId}`,
        "true"
      );
    } catch (_error) {
      manager.reportFailureOnce("persist save approval:" + pluginId, "persist save approval for " + pluginId, _error);
      // Ask again on the next save if persistence is unavailable.
    }
  }

  function persistEnabled(pluginId, enabled) {
    try {
      localStorage.setItem(storageKey(pluginId), String(enabled));
    } catch (_error) {
      manager.reportFailureOnce("persist enabled state:" + pluginId, "persist enabled state for " + pluginId, _error);
      // Plugin state still applies for the current session.
    }
  }

  // END manager body
  Object.assign(manager, { settleRegistryReady, updateDebugUsage, storageKey, isPersistedEnabled, isExplicitlyDisabled, shouldStartEnabled, isSaveApprovalRemembered, rememberSaveApproval, persistEnabled });
})();
