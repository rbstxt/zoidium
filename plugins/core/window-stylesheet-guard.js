(function (global) {
  "use strict";

  var PZ = global.PZ;
  if (!PZ || !PZ.ui || typeof PZ.ui.window !== "function") return;

  PZ.zoidium = PZ.zoidium || {};
  if (PZ.zoidium.windowStylesheetGuard) return;

  var OriginalWindow = PZ.ui.window;

  function isSecondaryWindowRequest(target) {
    return !target || typeof target.nodeType !== "number";
  }

  function hideInvalidStylesheets(editor) {
    var sourceWindow = editor && editor.windows && editor.windows[0] && editor.windows[0].window;
    var sourceDocument = sourceWindow && sourceWindow.document;
    var head = sourceDocument && sourceDocument.head;
    if (!head || typeof head.querySelectorAll !== "function") return [];

    var links = head.querySelectorAll('link[rel="stylesheet"]');
    var hidden = [];
    for (var index = 0; index < links.length; index += 1) {
      var link = links[index];
      if (link.getAttribute("href") !== null || !link.parentNode) continue;

      var parent = link.parentNode;
      var nextSibling = link.nextSibling;
      parent.removeChild(link);
      hidden.push({ link: link, parent: parent, nextSibling: nextSibling });
    }
    return hidden;
  }

  function restoreStylesheets(hidden) {
    for (var index = 0; index < hidden.length; index += 1) {
      var entry = hidden[index];
      if (!entry.parent || entry.link.parentNode) continue;

      if (entry.nextSibling && entry.nextSibling.parentNode === entry.parent) {
        entry.parent.insertBefore(entry.link, entry.nextSibling);
      } else {
        entry.parent.appendChild(entry.link);
      }
    }
  }

  function GuardedWindow(editor, target) {
    var hidden = [];
    if (isSecondaryWindowRequest(target)) {
      try {
        hidden = hideInvalidStylesheets(editor);
      } catch (_error) {
        hidden = [];
      }
    }

    try {
      return OriginalWindow.apply(this, arguments);
    } finally {
      restoreStylesheets(hidden);
    }
  }

  GuardedWindow.prototype = OriginalWindow.prototype;
  PZ.ui.window = GuardedWindow;
  PZ.zoidium.define("windowStylesheetGuard", true, "core/window-stylesheet-guard");
})(window);
