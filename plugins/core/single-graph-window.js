"use strict";

// Native graph popups are reused per editor. Graph Editor 2 installs an own
// createWindow method, so it takes precedence over this prototype patch,
// regardless of which plugin activates first.
module.exports = {
  activate(context) {
    const prototype = context.PZ?.ui?.editor?.prototype;
    if (!prototype || typeof prototype.createWindow !== "function") return;
    const entries = new Map();
    const patches = [];
    const disposedPanels = new WeakSet();

    function patch(target, key, replacement) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      patches.push(() => {
        if (target[key] !== replacement) return;
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
      });
      target[key] = replacement;
    }

    function disposePanel(panel) {
      if (!panel || disposedPanels.has(panel)) return;
      disposedPanels.add(panel);
      panel.enabled = false;
      for (const key of ["drag", "svg_drag", "column_drag", "item_drag"]) {
        const drag = panel[key];
        if (drag?.dragging && typeof drag.endfn_bound === "function") {
          drag.endfn_bound({ type: "mouseup", currentTarget: panel.el?.ownerDocument, preventDefault() {} });
        }
      }
      if ("objects" in panel) panel.objects = null;
      // Native edit lists defer unloading while disabled; native graphs have
      // no unload() implementation for their property SVG subscriptions.
      if (panel.list && typeof panel.unloadListItem === "function") panel.objectsChanged();
      if (panel.svg && typeof panel.unloadProperty === "function") {
        for (const child of Array.from(panel.svg.children)) {
          if (child.pz_object) { panel.unloadProperty(child); child.remove(); }
        }
      }
      for (const child of panel.panels || []) disposePanel(child);
      panel.unload?.();
      panel.el?.remove();
    }

    function release(editor, entry, close) {
      if (entries.get(editor) !== entry) return;
      entries.delete(editor);
      editor.onProjectChanged?.unwatch(entry.projectChanged);
      entry.popup.removeEventListener("unload", entry.closed);
      entry.popup.removeEventListener("pagehide", entry.closed);
      if (entry.handle.setPanel === entry.setPanel) {
        if (entry.panelDescriptor) Object.defineProperty(entry.handle, "setPanel", entry.panelDescriptor);
        else delete entry.handle.setPanel;
      }
      // Restore the method before calling it, so disposal cannot recurse.
      if (entry.popup.close === entry.close) {
        if (entry.closeDescriptor) Object.defineProperty(entry.popup, "close", entry.closeDescriptor);
        else delete entry.popup.close;
      }
      disposePanel(entry.handle.panel);
      // CM3's own unload listeners disable panel and remove the handle from
      // editor.windows. Keep both available until those listeners have run.
      if (close && !entry.popup.closed) entry.originalClose.call(entry.popup);
    }

    function restore(entry) {
      const popup = entry.popup;
      // Browsers may ignore moveTo/resizeTo for OS-minimized or maximized
      // windows. Focus remains the portable way to request OS restoration.
      try {
        const screen = popup.screen;
        if (screen?.availWidth > 0 && screen.availHeight > 0) {
          const width = Math.min(Math.max(300, popup.outerWidth || 600), screen.availWidth);
          const height = Math.min(Math.max(200, popup.outerHeight || 400), screen.availHeight);
          const left = screen.availLeft || 0, top = screen.availTop || 0;
          popup.resizeTo(width, height);
          popup.moveTo(Math.max(left, Math.min(popup.screenX, left + screen.availWidth - width)),
            Math.max(top, Math.min(popup.screenY, top + screen.availHeight - height)));
        }
      } catch (_error) { /* OS window geometry is optional. */ }
      popup.focus();
      entry.handle.resize?.();
    }

    const originalCreate = prototype.createWindow;
    const originalCloseAll = prototype.closeAllWindows;
    // Own cleanup before mutating the host, including partial activation.
    context.lifecycle.onDispose(() => {
      for (const [editor, entry] of Array.from(entries)) release(editor, entry, true);
      for (const restorePatch of patches.reverse()) restorePatch();
    });
    patch(prototype, "createWindow", function (options) {
      if (options?.title !== "Graph editor") return originalCreate.apply(this, arguments);
      const previous = entries.get(this);
      if (previous) {
        if (!previous.popup.closed && this.windows?.includes(previous.handle)) {
          restore(previous);
          return previous.handle;
        }
        release(this, previous, false);
      }
      const handle = originalCreate.apply(this, arguments);
      // A foreign floating-window replacement owns its own lifetime.
      if (!handle?.secondary || handle.host || !handle.window?.addEventListener) return handle;
      const editor = this, popup = handle.window;
      const entry = { handle, popup, originalClose: popup.close,
        panelDescriptor: Object.getOwnPropertyDescriptor(handle, "setPanel"),
        closeDescriptor: Object.getOwnPropertyDescriptor(popup, "close") };
      const originalSetPanel = handle.setPanel;
      entry.setPanel = function (panel) {
        // The native toolbar constructs another panel after every request.
        // Keep the live panel and its selection, and unload the unused one.
        if (this.panel === panel) return;
        if (this.panel && panel?.constructor === this.panel.constructor) { disposePanel(panel); return; }
        // A plugin can upgrade the panel class in an existing native window.
        // Its rebuild path owns disposal of the replaced panel.
        return originalSetPanel.apply(this, arguments);
      };
      entry.closed = () => release(editor, entry, false);
      entry.projectChanged = () => release(editor, entry, true);
      entry.close = function () {
        const result = entry.originalClose.apply(this, arguments);
        if (popup.closed) release(editor, entry, false);
        return result;
      };
      entries.set(editor, entry);
      handle.setPanel = entry.setPanel;
      popup.close = entry.close;
      popup.addEventListener("unload", entry.closed);
      popup.addEventListener("pagehide", entry.closed);
      editor.onProjectChanged?.watch(entry.projectChanged);
      return handle;
    });
    if (typeof originalCloseAll === "function") {
      patch(prototype, "closeAllWindows", function () {
        const entry = entries.get(this);
        if (entry) release(this, entry, true);
        return originalCloseAll.apply(this, arguments);
      });
    }
  },
};
