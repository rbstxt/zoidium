"use strict";
// Masks section in the layer Properties (the clip Edit panel).
//
// The panel mounts one P1.3 expandable row per mask (mask-row-view.js) and
// wires every control to the real mask model and history. Each mutation is
// one undo step through the shared mask session (mask-host.js + editor-model
// gestures), so undo/redo, the pen overlay and saving stay in sync.
//
// Stored fields are unchanged: mode, feather, opacity, invert, vertexIds,
// vertexModes and properties.path keep their existing encoding. The row also
// edits display fields (name, outlineColor, locked, expansion) that default on
// read, so old projects render exactly as before until the user edits; the
// panel never writes during render, so showing the row leaves saved data
// byte-identical.
//
// Lock policy: a locked mask blocks geometry, keyframe, property and delete
// writes; unlocking, selection/activation and reordering remain available.
// Reordering a locked mask is allowed because order is a collection property,
// not an edit to the locked mask itself. Duplicate mints fresh mask and
// vertex IDs from the single session generator, so mask and vertex IDs share
// one collision namespace (see mask-metadata.js).
//
// Activation hook: clicking the mask name calls an injectable activator with
// (session, layer, maskId, focusPen, refresh). P1.7a plugs the real
// activate(hostKind, layer, pathId) entry here; until then the default keeps
// the existing Edit-toggle behaviour (select the mask, focus point editing).
const { createMaskSession, maskSessionFor } = require("./mask-host.js");
const { MODES } = require("./mask-model.js");
const { renderMaskRow } = require("./mask-row-view.js");
const metadata = require("./mask-metadata.js");
const animation = require("./path-animation.js");

const EXPANSION_MIN = -128;
const EXPANSION_MAX = 128;
const FEATHER_MIN = 0;
const FEATHER_MAX = 500;

function isMaskable(PZ, object) {
  return !!object && (object instanceof PZ.layer.scene || object instanceof PZ.layer.adjustment);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function transact(session, fn) {
  session.s.mutate(() => {
    const data = session.host.readLive?.() || clone(session.host.contents());
    fn(data);
    session.host.write(data);
  });
}

function isLockedJson(mask) {
  if (!mask || typeof mask !== "object") return false;
  if (mask.locked === true || mask.locked === 1) return true;
  const properties = mask.properties;
  if (properties && typeof properties === "object" &&
      (properties.locked === true || properties.locked === 1)) return true;
  return false;
}

function findJson(session, id) {
  const data = session.host.contents();
  return data.find(mask => mask && mask.id === id) || null;
}

// One undo step is enforced by routing every write through s.mutate (directly
// or via s.keyframe / s.treeAction, which mutate internally). A locked mask
// rejects geometry, keyframe, property and delete actions visibly and records
// no history; selection, unlock, duplicate and reorder always pass.
function blockIfLocked(session, id, action) {
  const item = findJson(session, id);
  if (item && isLockedJson(item) &&
      action !== "select" && action !== "unlock" &&
      action !== "reorder" && action !== "duplicate" && action !== "navigate") {
    session.s.message("Layer mask is locked");
    return true;
  }
  return false;
}

function defaultActivate(session, layer, maskId, focusPen, refresh) {
  session.s.selectItem(maskId);
  if (typeof focusPen === "function") focusPen("select");
  if (typeof refresh === "function") refresh();
}

// Injectable activation entry. The lead plugs P1.7a's real
// activate(hostKind, layer, pathId) here; until then the default above keeps
// the existing Edit-toggle behaviour so the row works standalone.
let panelActivator = null;
function setPanelActivator(fn) {
  panelActivator = typeof fn === "function" ? fn : null;
}
function getPanelActivator() {
  return panelActivator || null;
}

function activateMask(session, layer, maskId, focusPen, refresh, override) {
  const fn = typeof override === "function" ? override
    : panelActivator || defaultActivate;
  fn(session, layer, maskId, focusPen, refresh);
}

function keyframeStateFor(mask, frame) {
  try {
    return { hollow: "off", outlined: "armed", filled: "keyed" }[animation.diamond(mask, frame)];
  } catch (_error) { return "off"; }
}

function jumpToKeyframe(session, layer, maskId, direction, refresh) {
  const state = session.s;
  if (state.seekPathKey) state.seekPathKey(maskId, direction);
  else {
    // Standalone row hosts can supply serialized paths and native clip time.
    try {
      const item = findJson(session, maskId), playback = state.editor.playback;
      const clip = layer?.tryGetParentOfType?.(state.PZ.clip);
      const find = direction < 0 ? animation.previous : animation.next;
      const frame = find(item, playback.currentFrame, clip || undefined);
      if (frame === null) state.message("No further path keyframe");
      else { playback.currentFrame = frame; state.selectItem(maskId); }
    } catch (error) { state.message(error.message); }
  }
  refresh?.();
}

function isValidColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

// Expanded/collapsed UI state only; never persisted. Defaults to expanded.
const collapsedIds = new Set();

function rowCallbacks(session, layer, focusPen, refresh, hooks) {
  const activateOverride = hooks && typeof hooks.onActivate === "function" ? hooks.onActivate : null;
  return {
    onActivate(id) {
      activateMask(session, layer, id, focusPen, refresh, activateOverride);
    },
    onToggleExpand(id) {
      if (collapsedIds.has(id)) collapsedIds.delete(id);
      else collapsedIds.add(id);
      if (typeof refresh === "function") refresh();
    },
    onToggleEdit(id) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      try {
        session.s.selectItem(id);
        if (typeof focusPen === "function") focusPen("select");
      } catch (error) {
        session.s.message(error.message);
      }
      if (typeof refresh === "function") refresh();
    },
    onRename(id, name) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const next = metadata.rename(data, id, name);
        data.splice(0, data.length, ...next);
      });
      if (typeof refresh === "function") refresh();
    },
    onModeChange(id, mode) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      if (!MODES.includes(mode)) {
        session.s.message("Layer mask mode must be one of " + MODES.join(", "));
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.mode = mode;
      });
      if (typeof refresh === "function") refresh();
    },
    onToggleInvert(id) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.invert = item.invert ? 0 : 1;
      });
      if (typeof refresh === "function") refresh();
    },
    onToggleEnabled(id) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) {
          if (!item.properties || typeof item.properties !== "object") item.properties = {};
          const enabled = (item.properties.enabled ?? 1) !== 0 && item.enabled !== 0 && item.enabled !== false;
          item.properties.enabled = enabled ? 0 : 1;
        }
      });
      if (typeof refresh === "function") refresh();
    },
    onKeyframeToggle(id) {
      if (blockIfLocked(session, id, "keyframe")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      try {
        if (session.s.togglePathKey) session.s.togglePathKey(id);
        else { session.s.selectItem(id); session.s.keyframe(); }
      } catch (error) {
        session.s.message(error.message);
      }
      if (typeof refresh === "function") refresh();
    },
    onAnimationToggle: session.s.setPathAnimation && (id => {
      session.s.setPathAnimation(id);
      refresh?.();
    }),
    onKeyframePrev(id) {
      jumpToKeyframe(session, layer, id, -1, refresh);
    },
    onKeyframeNext(id) {
      jumpToKeyframe(session, layer, id, 1, refresh);
    },
    onFeatherChange(id, px) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      if (typeof px !== "number" || !Number.isFinite(px) || px < FEATHER_MIN || px > FEATHER_MAX) {
        session.s.message("Layer mask feather must be between " + FEATHER_MIN + " and " + FEATHER_MAX + " px");
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.feather = px;
      });
      if (typeof refresh === "function") refresh();
    },
    onOpacityChange(id, value) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        session.s.message("Layer mask opacity must be between 0 and 1");
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.opacity = value;
      });
      if (typeof refresh === "function") refresh();
    },
    onExpansionChange(id, px) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      if (typeof px !== "number" || !Number.isFinite(px) || px < EXPANSION_MIN || px > EXPANSION_MAX) {
        session.s.message("Layer mask expansion must be between " + EXPANSION_MIN + " and " + EXPANSION_MAX + " px");
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.expansion = px;
      });
      if (typeof refresh === "function") refresh();
    },
    onOutlineColorChange(id, color) {
      if (blockIfLocked(session, id, "edit")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      if (!isValidColor(color)) {
        session.s.message("Layer mask outlineColor must be a #rrggbb hex string");
        if (typeof refresh === "function") refresh();
        return;
      }
      transact(session, data => {
        const item = data.find(mask => mask && mask.id === id);
        if (item) item.outlineColor = color;
      });
      if (typeof refresh === "function") refresh();
    },
    onToggleLock(id) {
      transact(session, data => {
        const next = metadata.setLocked(data, id, !isLockedJson(data.find(mask => mask && mask.id === id)));
        data.splice(0, data.length, ...next);
      });
      if (typeof refresh === "function") refresh();
    },
    onDuplicate(id) {
      session.s.mutate(() => {
        const current = clone(session.host.contents());
        const { masks, id: copyId } = metadata.duplicate(current, id, session.s.nextId);
        session.host.write(masks);
        try {
          session.s.selectItem(copyId);
        } catch (_error) { /* Selection is best-effort. */ }
      });
      if (typeof refresh === "function") refresh();
    },
    onDelete(id) {
      if (blockIfLocked(session, id, "delete")) {
        if (typeof refresh === "function") refresh();
        return;
      }
      try {
        session.s.selectItem(id);
        session.s.treeAction("delete");
      } catch (error) {
        session.s.message(error.message);
      }
      if (typeof refresh === "function") refresh();
    },
    onMove(id, direction) {
      const data = session.host.readLive?.() || clone(session.host.contents());
      const index = data.findIndex(mask => mask && mask.id === id);
      if (index < 0) {
        session.s.message("Unknown layer mask id");
        if (typeof refresh === "function") refresh();
        return;
      }
      const next = metadata.move(data, id, index + (direction < 0 ? -1 : 1));
      session.s.mutate(() => {
        session.host.write(next);
      });
      if (typeof refresh === "function") refresh();
    },
  };
}

function renderMasksSection(document, container, session, layer, focusPen, refresh, hooks) {
  while (container.firstChild) container.firstChild.remove();
  const head = document.createElement("div");
  head.textContent = "Masks";
  head.style.cssText = "font-weight:600;padding:2px 0;cursor:default";
  container.appendChild(head);
  const callbacks = rowCallbacks(session, layer, focusPen, refresh, hooks);
  const masks = session.host.readLive?.() || clone(session.host.contents());
  let frame = 0;
  try {
    frame = session.s.localFrame();
  } catch (_error) { /* Detached session reads keyframes at frame 0. */ }
  masks.forEach((mask, index) => {
    const state = {
      active: session.s.activeId === mask.id,
      editing: session.s.activeId === mask.id,
      expanded: !collapsedIds.has(mask.id),
      keyframeState: keyframeStateFor(mask, frame),
      canMoveUp: index > 0,
      canMoveDown: index < masks.length - 1,
    };
    container.appendChild(renderMaskRow(document, mask, state, callbacks));
  });
  const add = document.createElement("button");
  add.className = "actionbutton";
  add.textContent = "+ Add mask";
  add.style.cssText = "margin:2px 0 2px 8px;font-size:11px;cursor:pointer";
  add.addEventListener("click", event => {
    event.stopPropagation();
    try {
      let size = [640, 360];
      try {
        const res = layer.properties?.resolution?.get?.();
        if (Array.isArray(res) && res[0] > 0 && res[1] > 0) size = res;
      } catch (_error) { /* Defaults above. */ }
      const item = session.s.addItem("path", [size[0] / 2, size[1] / 2]);
      if (item) session.s.selectItem(item.id);
      if (typeof focusPen === "function") focusPen("pen");
    } catch (error) {
      session.s.message(error.message);
    }
    if (typeof refresh === "function") refresh();
  });
  container.appendChild(add);
}

// Refresh the Properties rows only when controller activation changes the
// active mask. Vertex selection changes must not replace focused controls.
function watchPathSelection(session, refresh) {
  const state = session.s, previous = state.onPathSelection;
  let activeId = state.activeId;
  function changed() {
    previous?.();
    if (activeId === state.activeId) return;
    activeId = state.activeId;
    refresh();
  }
  state.onPathSelection = changed;
  return () => { if (state.onPathSelection === changed) state.onPathSelection = previous; };
}

function installMaskPanels(context, Content, focusPen) {
  const PZ = window.PZ, editor = window.CM;
  if (!PZ?.ui?.edit?.prototype) throw Error("Layer masks require the native property panels");
  const prototype = PZ.ui.edit.prototype;
  const original = prototype.generateListItem;
  const originalUnload = prototype.unloadListItem;
  function sessionFor(layer) {
    return maskSessionFor(layer, () => createMaskSession({ PZ, editor, project: editor.project, nativeLayer: layer, Content,
      notify: text => context.ui.notify({ title: "Masks", message: text }) }));
  }
  // Live sections re-render their contents on project changes without
  // disturbing the surrounding native panel.
  const live = new Set(), watched = new Map();
  function refreshLive() {
    for (const entry of live) {
      if (!entry.container.isConnected) { entry.dispose(); continue; }
      try {
        renderMasksSection(entry.container.ownerDocument, entry.container, entry.session, entry.layer, focusPen, entry.refresh, entry.hooks);
      } catch (_error) { /* Panel torn down mid-edit. */ }
    }
  }
  function track(container, session, layer, hooks) {
    const entry = { container, session, layer, hooks, refresh: () => {} };
    entry.refresh = () => refreshLive();
    for (const existing of live) if (existing.container === container) existing.dispose(false);
    let watcher = watched.get(session);
    if (!watcher) {
      watcher = { count: 0, dispose: watchPathSelection(session, refreshLive) };
      watched.set(session, watcher);
    }
    watcher.count++;
    entry.dispose = (remove = true) => {
      if (!live.delete(entry)) return;
      if (--watcher.count === 0) { watcher.dispose(); watched.delete(session); }
      if (remove) container.remove();
    };
    live.add(entry);
    return entry.dispose;
  }
  const cleanups = new WeakMap();
  function maskListItem(container, object) {
    const row = original.apply(this, arguments);
    try {
      if (isMaskable(PZ, object)) {
        cleanups.get(row)?.();
        const session = sessionFor(object);
        let section = row.querySelector(":scope > .zoidium-masks");
        if (!section) {
          section = row.ownerDocument.createElement("div");
          section.className = "zoidium-masks";
          section.style.cssText = "padding:2px 0 4px 14px";
          row.appendChild(section);
        }
        renderMasksSection(row.ownerDocument, section, session, object, focusPen, () => refreshLive());
        cleanups.set(row, track(section, session, object));
      }
    } catch (_error) { /* Never break native rows. */ }
    return row;
  }
  function maskUnloadListItem(row) {
    try { cleanups.get(row)?.(); cleanups.delete(row); } catch (_error) { /* ignore */ }
    return originalUnload.apply(this, arguments);
  }
  prototype.generateListItem = maskListItem;
  prototype.unloadListItem = maskUnloadListItem;
  const rewatch = () => {
    try { editor.project?.ui?.onChanged?.watch?.(refreshLive); } catch (_error) { /* ignore */ }
  };
  rewatch();
  const projectChanged = () => rewatch();
  editor.onProjectChanged.watch(projectChanged);
  context.lifecycle.onDispose(() => {
    if (prototype.generateListItem === maskListItem) prototype.generateListItem = original;
  });
  context.lifecycle.onDispose(() => {
    if (prototype.unloadListItem === maskUnloadListItem) prototype.unloadListItem = originalUnload;
  });
  context.lifecycle.onDispose(() => {
    for (const entry of [...live]) entry.dispose();
    try { editor.project?.ui?.onChanged?.unwatch?.(refreshLive); } catch (_error) { /* ignore */ }
    try { editor.onProjectChanged.unwatch(projectChanged); } catch (_error) { /* ignore */ }
  });
  return { sessionFor };
}

module.exports = { installMaskPanels, renderMasksSection, isMaskable, setPanelActivator, getPanelActivator, rowCallbacks, keyframeStateFor, watchPathSelection };
