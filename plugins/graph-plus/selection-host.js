"use strict";

const { controllers, Selection, curvesFor, sameSet } = require("./selection.js");

module.exports = function installSelection({ PZ, editor, document: doc, open, styleDocument, unstyleDocument }) {
  const storage = (() => { try { return doc?.defaultView?.localStorage; } catch (_error) { return null; } })();
  const selection = new Selection(PZ, storage);
  controllers.set(editor, selection);
  const cleanups = [], labels = new WeakMap(), keySelections = new WeakMap(), decorated = new Map(), documents = new Map();
  let disposed = false, menu = null, pending = null, queued = false, lastRow = null;
  function patch(target, key, after) {
    if (typeof target?.[key] !== "function") return;
    const original = target[key], descriptor = Object.getOwnPropertyDescriptor(target, key);
    function replacement(...args) {
      const result = original.apply(this, args);
      if (!disposed) after.call(this, result, ...args);
      return result;
    }
    target[key] = replacement;
    cleanups.push(() => {
      if (target[key] !== replacement) return;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
  }
  // Coalesce native recursive key selection and list changes into one update.
  // This is event-driven and never runs from a playback/frame update.
  function schedule(fn) {
    pending = fn;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const action = pending;
      pending = null;
      if (!disposed) { action?.(); paint(); }
    });
  }
  function decorate(row) {
    if (!row || decorated.has(row)) return;
    decorated.set(row, { tabindex: row.getAttribute("tabindex"), title: row.getAttribute("title") });
    row.tabIndex = 0;
    row.title = "Show in Graph Editor (Alt+Shift+G)";
  }
  function restoreRow(row, original) {
    row.classList.remove("g2-property-selected", "g2-property-label");
    labels.delete(row);
    for (const key of ["tabindex", "title"]) {
      if (original[key] === null) row.removeAttribute(key); else row.setAttribute(key, original[key]);
    }
  }
  function propertyRow(row) {
    return row && curvesFor(PZ, row.pz_object).length > 0;
  }
  function editPanel(row) { return row?.closest?.(".editorpanel")?.pz_panel; }
  function rowAt(target) {
    if (!target?.closest || target.closest(".g2-editor")) return null;
    const label = target.closest(".g2-property-label");
    if (label && labels.has(label)) return label;
    const row = target.closest("li, .kftrack");
    if (!propertyRow(row)) return null;
    if (row.classList.contains("kftrack")) return row;
    const panel = editPanel(row);
    return panel instanceof PZ.ui.edit && panel.editor === editor && panel.options.showPropertyControls ? row : null;
  }
  function targetProperty(row) { return labels.get(row) || row.pz_object; }
  function paint() {
    for (const row of decorated.keys()) {
      if (!row.isConnected) { decorated.delete(row); continue; }
      row.classList.toggle("g2-property-selected", selection.properties.includes(targetProperty(row)));
    }
  }
  function pick(row, additive) {
    lastRow = row;
    decorate(row);
    selection.select([targetProperty(row)], additive);
    paint();
  }
  function show(row) {
    lastRow = row;
    const panel = open();
    if (panel) { selection.show(targetProperty(row), panel); paint(); }
  }
  function closeMenu() { const open = menu; menu = null; open?.close(false); }
  function context(event) {
    const row = rowAt(event.target);
    if (!row) return;
    event.preventDefault(); event.stopPropagation();
    // macOS reports Control-click as a context-menu gesture. Keep the
    // documented additive selection working there as well as on Windows.
    if (event.ctrlKey) { closeMenu(); pick(row, true); return; }
    closeMenu();
    // The shared kit menu keeps every Zoidium context menu identical,
    // including detached CM3 property windows (owner document aware).
    const kit = (doc?.defaultView || globalThis).ZoidiumUI;
    if (typeof kit?.openMenu !== "function") return;
    const handle = kit.openMenu({
      document: row.ownerDocument || doc,
      owner: row,
      x: event.clientX,
      y: event.clientY,
      focusReturn: row,
      items: [{ label: "Show in Graph Editor", shortcut: "Alt+Shift+G", action: () => show(row) }],
      onClose: () => { if (menu === handle) menu = null; },
    });
    menu = handle;
  }
  function keydown(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
        !(event.code === "KeyG" || event.key?.toLowerCase() === "g")) return;
    let row = rowAt(event.target);
    // CM3 moves focus from a clicked label to the containing Edit panel.
    // Its selected property remains the shortcut target in that panel.
    if (!row && lastRow?.isConnected && selection.properties.includes(targetProperty(lastRow))) {
      const owner = editPanel(event.target);
      if (owner && owner === editPanel(lastRow)) row = lastRow;
    }
    if (!row) return;
    event.preventDefault(); event.stopPropagation();
    show(row);
  }
  function pointer(event) {
    if (event.button !== 0) return;
    const row = rowAt(event.target);
    if (!row) {
      const clip = event.target.closest?.(".clip");
      if (clip?.pz_object) {
        const timeline = editPanel(clip);
        if (timeline?.editor === editor) {
          const objects = event.ctrlKey || event.metaKey || event.shiftKey
            ? Array.from(new Set([...(timeline.tracks?.selection || []), clip.pz_object])) : [clip.pz_object];
          // Re-clicking an already selected layer emits no native list change,
          // but still leaves property/key selection and requests animated curves.
          lastRow = null;
          selection.objects(objects); paint();
        }
      }
      return;
    }
    // Capture before inputs stop propagation; following never changes focus.
    pick(row, event.ctrlKey || event.metaKey || event.shiftKey);
    if (!event.target.closest("button, input, textarea, select, [contenteditable]")) row.focus({ preventScroll: true });
  }
  function focus(event) {
    const row = rowAt(event.target);
    // Pointer gestures already handle add/replace. A tab into another row
    // selects it without losing a multi-selection when its field takes focus.
    if (row && !selection.properties.includes(targetProperty(row))) pick(row, false);
  }
  function timelineSelection(host) {
    schedule(() => {
      const keys = Array.from(host.container.querySelectorAll(".kfobject.selected"));
      if (sameSet(keys, keySelections.get(host) || [])) return;
      keySelections.set(host, keys);
      const properties = keys.map(key => key.parentElement.pz_object);
      if (properties.length) selection.select(Array.from(new Set(properties)), false, true);
      else selection.objects(host.objects);
    });
  }
  const timeline = PZ.ui.timeline?.keyframes?.prototype;
  patch(timeline, "createKeyframeTrack", function (track) {
    if (this.timeline.editor !== editor || !propertyRow(track)) return;
    labels.set(track.pz_label, track.pz_object);
    track.pz_label.classList.add("g2-property-label");
    decorate(track.pz_label); decorate(track);
  });
  for (const method of ["selectKeyframe", "deselectKeyframe", "deselectAll"]) {
    patch(timeline, method, function () { if (this.timeline.editor === editor) timelineSelection(this); });
  }
  patch(PZ.ui.timeline?.prototype, "selectionChanged", function () {
    if (this.editor === editor) schedule(() => selection.objects(this.tracks.selection));
  });
  patch(PZ.ui.edit?.prototype, "generateListItem", function (row) {
    if (this.editor === editor && this.options.showPropertyControls && propertyRow(row)) decorate(row);
  });
  patch(PZ.ui.edit?.prototype, "selectItems", function () {
    if (this.editor === editor && !this.el.closest(".g2-editor")) {
      // Native edit rows are draggable objects too. Their mouse-up selection
      // uses Shift alone and must not replace our Ctrl/Shift property set.
      if (Array.from(this.selection).some(property => curvesFor(PZ, property).length)) return;
      schedule(() => selection.objects(this.selection));
    }
  });
  function refreshRows(owner = doc, initial = true) {
    let objects = [], properties = [];
    for (const element of owner?.querySelectorAll?.(".editorpanel") || []) {
      const panel = element.pz_panel;
      if (panel instanceof PZ.ui.edit && panel.editor === editor && panel.options.showPropertyControls && !element.closest(".g2-editor")) {
        for (const row of panel.list.querySelectorAll("li")) if (propertyRow(row)) decorate(row);
        const selected = Array.from(panel.selection || []);
        const selectedProperties = selected.filter(property => curvesFor(PZ, property).length);
        if (selectedProperties.length) properties = selectedProperties;
        else if (selected.length) objects = selected;
      }
      const keys = panel?.keyframes;
      if (keys?.timeline?.editor === editor) {
        if (!objects.length) objects = Array.from(keys.timeline.tracks?.selection || []);
        for (const track of keys.container.querySelectorAll(".kftrack")) if (propertyRow(track)) {
          labels.set(track.pz_label, track.pz_object);
          track.pz_label.classList.add("g2-property-label");
          decorate(track.pz_label); decorate(track);
        }
      }
    }
    if (initial) {
      if (properties.length) selection.select(properties);
      else selection.objects(objects);
    }
  }
  refreshRows();
  function bindDocument(owner) {
    if (!owner?.addEventListener || documents.has(owner)) return;
    const listeners = [["pointerdown", pointer], ["contextmenu", context], ["keydown", keydown], ["focusin", focus]];
    for (const [type, fn] of listeners) owner.addEventListener(type, fn, true);
    const release = () => {
      for (const [type, fn] of listeners) owner.removeEventListener(type, fn, true);
      owner.defaultView?.removeEventListener?.("pagehide", release);
      documents.delete(owner);
      for (const [row, original] of decorated) if (row.ownerDocument === owner) {
        restoreRow(row, original); decorated.delete(row);
      }
      if (lastRow?.ownerDocument === owner) lastRow = null;
      if (owner !== doc) unstyleDocument?.(owner);
    };
    documents.set(owner, release);
    if (owner !== doc) {
      styleDocument?.(owner);
      owner.defaultView?.addEventListener?.("pagehide", release);
    }
  }
  bindDocument(doc);
  // Native duplicated Edit windows adopt rows into their own document.
  // Bind at mount time, including already-open popups, without a frame poll.
  for (const win of editor.windows || []) {
    const owner = win.panel?.el?.ownerDocument;
    if (owner && owner !== doc) { bindDocument(owner); refreshRows(owner, false); }
  }
  patch(PZ.ui.window?.prototype, "setPanel", function () {
    if (this.editor !== editor) return;
    const owner = this.panel?.el?.ownerDocument;
    bindDocument(owner);
    if (owner && owner !== doc) refreshRows(owner, false);
  });
  const reset = () => {
    closeMenu(); lastRow = null; selection.properties = []; selection.objectSelection = []; selection.curves = [];
    // A pin belongs to the current project; release stale property references.
    schedule(() => { for (const panel of selection.panels) selection.apply(panel); });
  };
  editor.onProjectChanged?.watch(reset);
  editor.onSequenceChanged?.watch(reset);
  cleanups.push(() => { editor.onProjectChanged?.unwatch(reset); editor.onSequenceChanged?.unwatch(reset); });
  return {
    selection,
    dispose() {
      disposed = true; pending = null; lastRow = null; closeMenu();
      for (const release of Array.from(documents.values())) release();
      for (const cleanup of cleanups.reverse()) cleanup();
      for (const [row, original] of decorated) {
        restoreRow(row, original);
      }
      decorated.clear(); selection.dispose();
      controllers.delete(editor);
    },
  };
};
