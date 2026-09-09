(function installDefaultProjectSettingsPatch(global) {
  "use strict";

  var PZ = global.PZ;
  var frameRate = 60;

  function applyDefaultFrameRate(editor) {
    var defaultProject = editor && editor.defaultProject;
    var sequence = defaultProject && defaultProject.sequence;
    var properties = sequence && sequence.properties;

    if (properties && typeof properties === "object") {
      properties.rate = frameRate;
    }
  }

  if (!PZ || !PZ.ui || !PZ.ui.editor || !PZ.ui.editor.prototype) return;

  var editorPrototype = PZ.ui.editor.prototype;
  if (!editorPrototype.__zoidiumDefaultProjectSettingsPatch) {
    var originalNew = editorPrototype.new;
    if (typeof originalNew !== "function") return;

    editorPrototype.new = function createDefaultProject() {
      applyDefaultFrameRate(this);
      return originalNew.apply(this, arguments);
    };
    editorPrototype.__zoidiumDefaultProjectSettingsPatch = true;
  }

  // CM3 assigns its default project before initTool() is called. Updating it
  // here also covers callers which read the template directly.
  applyDefaultFrameRate(global.CM);

  if (
    PZ.sequence &&
    PZ.sequence.propertyDefinitions &&
    PZ.sequence.propertyDefinitions.rate
  ) {
    PZ.sequence.propertyDefinitions.rate.value = frameRate;
  }
})(window);
