"use strict";
// Masks section in the layer Properties (the clip Edit panel).
//
// The panel patches row generation: under every maskable Scene/Adjustment
// layer row it nests a Masks group listing the layer's masks with their
// combine parameters, feather/opacity/invert editors, a path keyframe toggle
// and add/delete/edit actions. Every edit goes through the shared mask
// session (mask-host.js), so history, undo and the pen overlay stay in sync.
const { createMaskSession, maskSessionFor } = require("./mask-host.js");
const { MODES } = require("./mask-model.js");

const MODE_LABEL = { add: "Add", subtract: "Subtract", intersect: "Intersect" };

function isMaskable(PZ, object) {
  return !!object && (object instanceof PZ.layer.scene || object instanceof PZ.layer.adjustment);
}

function transact(session, fn) {
  session.s.mutate(() => {
    const data = JSON.parse(JSON.stringify(session.host.contents()));
    fn(data);
    session.host.write(data);
  });
}

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function numberInput(document, value, min, max, step, onCommit) {
  const input = el(document, "input", "zoidium-mask-number");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.cssText = "width:52px;background:var(--zui-input-bg,#222);color:var(--zui-text,#ddd);border:1px solid var(--zui-border,#444);border-radius:3px;padding:1px 4px;font-size:11px";
  input.addEventListener("change", () => {
    const next = Number(input.value);
    if (!Number.isFinite(next)) { input.value = String(value); return; }
    try {
      onCommit(Math.min(max, Math.max(min, next)));
    } catch (_error) {
      input.value = String(value);
    }
  });
  return input;
}

function toggleButton(document, label, active, title, onClick) {
  const button = el(document, "button", "actionbutton", label);
  button.title = title;
  button.setAttribute("aria-pressed", String(!!active));
  button.style.cssText = "min-width:22px;height:18px;font-size:11px;padding:0 5px;cursor:pointer" + (active ? ";border-color:var(--zui-accent,#58a6ff);color:var(--zui-accent,#58a6ff)" : "");
  button.addEventListener("click", event => { event.stopPropagation(); onClick(); });
  return button;
}

function renderMasksSection(document, container, session, layer, focusPen, refresh) {
  while (container.firstChild) container.firstChild.remove();
  const head = el(document, "div", "", "Masks");
  head.style.cssText = "font-weight:600;padding:2px 0;cursor:default";
  container.append(head);
  const masks = JSON.parse(JSON.stringify(session.host.contents()));
  const frame = (() => { try { return session.s.localFrame(); } catch (_error) { return 0; } })();
  for (const mask of masks) {
    const row = el(document, "div", "");
    row.style.cssText = "padding:2px 0 2px 8px;border-top:1px solid var(--zui-border,#333)";
    const selected = session.s.activeId === mask.id;
    const name = el(document, "span", "", (mask.properties?.name || "Mask") + (selected ? " ●" : ""));
    name.style.cssText = "font-size:11px;margin-right:4px" + (selected ? ";color:var(--zui-accent,#58a6ff)" : "");
    row.append(name);
    row.append(toggleButton(document, MODE_LABEL[mask.mode] || mask.mode, mask.mode !== "add", "Combine mode (click to cycle)", () =>
      transact(session, data => {
        const item = data.find(m => m.id === mask.id);
        if (item) item.mode = MODES[(MODES.indexOf(item.mode) + 1 + MODES.length) % MODES.length];
      })));
    const enabled = (mask.properties?.enabled ?? 1) !== 0 && mask.enabled !== 0 && mask.enabled !== false;
    row.append(toggleButton(document, enabled ? "◉" : "○", enabled, "Enable/disable mask", () =>
      transact(session, data => {
        const item = data.find(m => m.id === mask.id);
        if (item && item.properties) item.properties.enabled = enabled ? 0 : 1;
      })));
    row.append(toggleButton(document, "Inv", !!mask.invert, "Invert mask", () =>
      transact(session, data => {
        const item = data.find(m => m.id === mask.id);
        if (item) item.invert = item.invert ? 0 : 1;
      })));
    const keyed = !!(mask.properties?.path && typeof mask.properties.path === "object" && mask.properties.path.animated);
    row.append(toggleButton(document, "◆", keyed, keyed ? "Remove path keyframes at this frame" : "Keyframe path at this frame", () => {
      try {
        session.s.selectItem(mask.id);
        session.s.keyframe();
      } catch (error) {
        session.s.message(error.message);
      }
      refresh();
    }));
    row.append(toggleButton(document, "Edit", selected, "Edit this path with the pen", () => {
      try {
        session.s.selectItem(mask.id);
        if (typeof focusPen === "function") focusPen();
      } catch (error) {
        session.s.message(error.message);
      }
      refresh();
    }));
    row.append(toggleButton(document, "×", false, "Delete mask", () => {
      try {
        session.s.selectItem(mask.id);
        session.s.treeAction("delete");
      } catch (error) {
        session.s.message(error.message);
      }
      refresh();
    }));
    container.append(row);
    const params = el(document, "div", "");
    params.style.cssText = "display:flex;gap:6px;align-items:center;padding:0 0 2px 8px;font-size:11px;color:var(--zui-text-muted,#999)";
    params.append(el(document, "span", "", "Feather"));
    params.append(numberInput(document, mask.feather || 0, 0, 500, 1, value =>
      transact(session, data => {
        const item = data.find(m => m.id === mask.id);
        if (item) item.feather = value;
      })));
    params.append(el(document, "span", "", "Opacity"));
    params.append(numberInput(document, Math.round((mask.opacity === undefined ? 1 : mask.opacity) * 100), 0, 100, 1, value =>
      transact(session, data => {
        const item = data.find(m => m.id === mask.id);
        if (item) item.opacity = value / 100;
      })));
    let vertices = "?";
    try {
      const item = session.s.find(mask.id);
      if (item) vertices = String(item.properties.path.get(frame).length / 6);
    } catch (_error) { /* Detached layer. */ }
    params.append(el(document, "span", "", vertices + " pts"));
    container.append(params);
  }
  const add = el(document, "button", "actionbutton", "+ Add mask");
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
      if (typeof focusPen === "function") focusPen();
    } catch (error) {
      session.s.message(error.message);
    }
    refresh();
  });
  container.append(add);
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
  const live = new Set();
  function refreshLive() {
    for (const entry of live) {
      if (!entry.container.isConnected) { live.delete(entry); continue; }
      try {
        renderMasksSection(entry.container.ownerDocument, entry.container, entry.session, entry.layer, focusPen, entry.refresh);
      } catch (_error) { /* Panel torn down mid-edit. */ }
    }
  }
  function track(container, session, layer) {
    const entry = { container, session, layer, refresh: () => {} };
    entry.refresh = () => refreshLive();
    for (const existing of live) if (existing.container === container) live.delete(existing);
    live.add(entry);
    return () => { live.delete(entry); container.remove(); };
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
          row.append(section);
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
    try { editor.project?.ui?.onChanged?.unwatch?.(refreshLive); } catch (_error) { /* ignore */ }
    try { editor.onProjectChanged.unwatch(projectChanged); } catch (_error) { /* ignore */ }
  });
  return { sessionFor };
}

module.exports = { installMaskPanels, renderMasksSection, isMaskable };
