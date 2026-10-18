"use strict";
// Keep the editor's open(x, y, entries) adapter; all rendering, focus and
// dismissal belong to the shared UI kit, including menus in popup documents.
function createMenu(document, owner, kit = document.defaultView.ZoidiumUI) {
  let handle = null;
  return {
    open(x, y, items, options = {}) {
      handle?.close(false);
      handle = kit.openMenu({ document, owner, x, y, items, ...options });
    },
    close(focus = true) { handle?.close(focus); handle = null; },
    get element() { return handle?.isOpen() ? handle.element : null; },
  };
}
module.exports = { createMenu };
