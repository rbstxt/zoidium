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

  // CM3 rebuilds a popup's stylesheets as "<page directory>/<file name>",
  // which drops every folder (./zoidium/..., ./plugins/..., ./fonts/...), so
  // only root-level sheets loaded and Zoidium panels opened in a popup were
  // unstyled. Replace those links with the resolved URLs of the main page's
  // sheets, and copy inline <style> elements (window skins, injected widget
  // styles) and the root theme variables so the popup matches the editor.
  function mirrorStylesheets(popupWindow, sourceDocument) {
    var popupDocument = popupWindow && popupWindow.document;
    var head = popupDocument && popupDocument.head;
    if (!head || !sourceDocument || !sourceDocument.head) return;
    var stale = head.querySelectorAll('link[rel="stylesheet"], style[data-zoidium-mirrored]');
    for (var index = 0; index < stale.length; index += 1) stale[index].remove();
    var sources = sourceDocument.head.querySelectorAll('link[rel="stylesheet"], style');
    for (var item = 0; item < sources.length; item += 1) {
      var source = sources[item];
      var copy;
      if (source.tagName === "LINK") {
        if (!source.href) continue;
        copy = popupDocument.createElement("link");
        copy.setAttribute("rel", "stylesheet");
        copy.setAttribute("href", source.href);
      } else {
        copy = popupDocument.createElement("style");
        copy.textContent = source.textContent;
      }
      copy.setAttribute("data-zoidium-mirrored", "");
      head.appendChild(copy);
    }
    var rootStyle = sourceDocument.documentElement && sourceDocument.documentElement.getAttribute("style");
    if (rootStyle && popupDocument.documentElement) popupDocument.documentElement.setAttribute("style", rootStyle);
    var theme = sourceDocument.documentElement && sourceDocument.documentElement.dataset;
    if (theme && popupDocument.documentElement) {
      if (theme.zoidiumTheme) popupDocument.documentElement.dataset.zoidiumTheme = theme.zoidiumTheme;
      if (theme.zoidiumFont) popupDocument.documentElement.dataset.zoidiumFont = theme.zoidiumFont;
    }
  }

  function GuardedWindow(editor, target) {
    var hidden = [];
    var secondary = isSecondaryWindowRequest(target);
    if (secondary) {
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
      if (secondary && this && this.secondary && this.window) {
        try {
          var sourceWindow = editor && editor.windows && editor.windows[0] && editor.windows[0].window;
          mirrorStylesheets(this.window, sourceWindow && sourceWindow.document);
        } catch (_error) { /* a closed or blocked popup keeps CM3's own links */ }
      }
    }
  }

  GuardedWindow.prototype = OriginalWindow.prototype;
  PZ.ui.window = GuardedWindow;
  PZ.zoidium.define("windowStylesheetGuard", true, "core/window-stylesheet-guard");
})(window);
