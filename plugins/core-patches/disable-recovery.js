(function () {
  "use strict";

  if (!PZ.ui?.recovery?.prototype) return;

  const recoveryPrototype = PZ.ui.recovery.prototype;

  // The stock editor serializes the project while media can still be loading.
  // Do not restore or create those partial localStorage snapshots.
  recoveryPrototype.load = function () {
    return null;
  };
  recoveryPrototype.projectChanged = function () {
    this.project = this.editor?.project || null;
  };
  recoveryPrototype.projectModified = function () {};
  recoveryPrototype.backUp = function () {};
  recoveryPrototype.cleanUp = function () {
    try {
      localStorage.removeItem("backup");
    } catch (_error) {
      // Storage may be unavailable; recovery is still disabled for this session.
    }
  };

  try {
    localStorage.removeItem("backup");
  } catch (_error) {
    // Storage may be unavailable; recovery is still disabled for this session.
  }
})();
