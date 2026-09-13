(function installDefaultProjectSettingsPatch(global) {
  "use strict";

  var PZ = global.PZ;
  var SETTINGS_STORAGE_KEY = "zoidium.editor-settings";
  var DEFAULT_FRAME_RATE = 30;
  var MIN_FRAME_RATE = 1;
  var MAX_FRAME_RATE = 240;
  var frameRate = DEFAULT_FRAME_RATE;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readConfiguredFrameRate() {
    try {
      var raw = global.localStorage.getItem(SETTINGS_STORAGE_KEY);
      var settings = raw ? JSON.parse(raw) : null;
      var storedValue = settings && settings.defaultFrameRate;
      if (storedValue === undefined || storedValue === null || storedValue === "") {
        return DEFAULT_FRAME_RATE;
      }
      var configured = Number(storedValue);
      if (!Number.isFinite(configured)) return DEFAULT_FRAME_RATE;
      return clamp(configured, MIN_FRAME_RATE, MAX_FRAME_RATE);
    } catch (_error) {
      return DEFAULT_FRAME_RATE;
    }
  }

  function applyDefaultFrameRate(editor) {
    var defaultProject = editor && editor.defaultProject;
    var sequence = defaultProject && defaultProject.sequence;
    var properties = sequence && sequence.properties;

    if (properties && typeof properties === "object") {
      properties.rate = frameRate;
    }
  }

  function applySequenceDefinition() {
    if (
      PZ.sequence &&
      PZ.sequence.propertyDefinitions &&
      PZ.sequence.propertyDefinitions.rate
    ) {
      PZ.sequence.propertyDefinitions.rate.value = frameRate;
    }
  }

  function applyDefaultProjectSettings() {
    // CM3 assigns its default project before initTool() is called. Updating it
    // here also covers callers which read the template directly.
    applyDefaultFrameRate(global.CM);
    applySequenceDefinition();
  }

  if (!PZ || !PZ.ui || !PZ.ui.editor || !PZ.ui.editor.prototype) return;

  var editorPrototype = PZ.ui.editor.prototype;
  if (!editorPrototype.__zoidiumDefaultProjectSettingsPatch) {
    var originalNew = editorPrototype.new;
    if (typeof originalNew !== "function") return;

    editorPrototype.new = function createDefaultProject() {
      frameRate = readConfiguredFrameRate();
      applyDefaultFrameRate(this);
      return originalNew.apply(this, arguments);
    };
    editorPrototype.__zoidiumDefaultProjectSettingsPatch = true;
  }

  global.ZoidiumDefaultProjectSettings = {
    setFrameRate: function (value) {
      var configured = Number(value);
      frameRate = Number.isFinite(configured)
        ? clamp(configured, MIN_FRAME_RATE, MAX_FRAME_RATE)
        : DEFAULT_FRAME_RATE;
      applyDefaultProjectSettings();
    },
    getFrameRate: function () {
      return frameRate;
    },
  };

  frameRate = readConfiguredFrameRate();
  applyDefaultProjectSettings();
})(window);
