(function removeVideoEditorLegacyMessage(global) {
  "use strict";

  var editor = global.VE;
  if (
    global.ZOIDIUM_LAYOUT !== "videoeditor" ||
    !editor ||
    typeof editor.setUpEditor !== "function" ||
    editor.__zoidiumLegacyMessageRemoved
  ) {
    return;
  }

  var originalSetUpEditor = editor.setUpEditor;
  editor.setUpEditor = function setUpEditorWithoutLegacyMessage(account) {
    var layoutAccount = Object.assign({}, account || {}, {
      hasSubscription: true,
    });
    return originalSetUpEditor.call(this, layoutAccount);
  };
  editor.__zoidiumLegacyMessageRemoved = true;
})(window);
