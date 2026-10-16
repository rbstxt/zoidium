"use strict";
const { selectionPart } = require("./editor-selection.js");
const { createEditorModel } = require("./editor-model.js");
const { createCanvas } = require("./editor-canvas.js");
const { createPointer } = require("./editor-pointer.js");
const { createTree } = require("./editor-tree.js");
const { installActions } = require("./editor-actions.js");
const { matrix, identity } = require("./compiler.js");
const { multiply } = require("./editor-geometry.js");
const { icon: ownedIcon } = require("./editor-icons.js");
const treeData = require("./editor-tree-data.js");
function mountEditor(context, layer, Content, body, host, initial) {
  const document = body.ownerDocument,
    window = document.defaultView,
    editor = window.CM,
    PZ = window.PZ;
  const s = {
    context,
    layer,
    Content,
    editor,
    PZ,
    document,
    window,
    project: editor.project,
    host,
    tool: "select",
    space: false,
    grid: false,
    snap: true,
    spacing: 50,
    selection: new Set(),
    treeSelection: new Set(),
    collapsed: new Set(),
    activeId: initial?.id || null,
    dirty: true,
    penFinished: false,
  };
  s.nextId = () => "sp-" + window.crypto.randomUUID();
  s.make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  s.icon = (name) => {
    const el = ownedIcon(document, name) || PZ.ui.generateIcon(name);
    el.classList.add("sp-icon");
    el.setAttribute("aria-hidden", "true");
    return el;
  };
  s.button = (label, icon, action, className = "") => {
    const button = s.make("button", "pz-inputbox sp-button " + className);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    if (icon) button.append(s.icon(icon));
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      action(e);
    });
    return button;
  };
  createEditorModel(s);
  const root = s.make("div", "shape-editor");
  body.classList.add("sp-window-body");
  body.append(root);
  const toolbar = s.make("div", "sp-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Shape tools");
  const tools = {};
  for (const [tool, label, icon] of [
    ["select", "Select (V)", "select"],
    ["pen", "Pen (P)", "pen"],
    ["hand", "Hand (H)", "hand"],
  ]) {
    tools[tool] = s.button(label, icon, () => {
      s.pointer.cancel();
      s.finishNudge();
      s.tool = tool;
      s.penFinished = false;
      s.refresh();
      s.canvas.focus();
    });
    toolbar.append(tools[tool]);
  }
  const separator = () => toolbar.append(s.make("span", "sp-separator"));
  separator();
  for (const [kind, label] of [
    ["rectangle", "Rectangle"],
    ["ellipse", "Ellipse"],
    ["polystar", "Star"],
  ]) {
    const button = s.button(
      "Add " + label,
      kind,
      () => {
        s.mutate(() => s.addItem(kind));
        s.canvas.focus();
      },
      "sp-primitive",
    );
    button.append(s.make("span", "", label));
    toolbar.append(button);
  }
  separator();
  toolbar.append(
    s.button("Fit (0 / Shift+1)", "search", () => s.canvasApi.fit()),
  );
  const grid = s.button("Toggle grid", "templates", () => {
      s.grid = !s.grid;
      s.refresh();
    }),
    snap = s.button("Toggle snapping", "link", () => {
      s.snap = !s.snap;
      s.refresh();
    });
  toolbar.append(grid, snap);
  const spacer = s.make("span", "sp-spacer"),
    frame = s.make("span", "sp-frame");
  const key = s.button(
    "Toggle Path keyframe",
    "stopwatch",
    () => {
      s.keyframe();
      s.canvas.focus();
    },
    "sp-path-key",
  );
  key.append(s.make("span", "", "Path"));
  toolbar.append(spacer, frame, key);
  root.append(toolbar);
  const workspace = s.make("div", "sp-workspace"),
    sidebar = s.make("div", "sp-sidebar"),
    heading = s.make("div", "sp-heading");
  heading.append(s.make("span", "", "Contents"));
  const add = s.button("Add content", "add", () => {
    const r = add.getBoundingClientRect();
    s.addMenu(r.left, r.bottom);
  });
  const more = s.button("Contents actions", "ellipsis", () => {
    const r = more.getBoundingClientRect();
    s.openItemMenu(r.left, r.bottom);
  });
  heading.append(add, more);
  sidebar.append(heading);
  const treeContainer = s.make("div", "sp-tree-container");
  sidebar.append(treeContainer);
  const propertiesHeading = s.make(
      "div",
      "sp-heading sp-properties-heading",
      "Properties",
    ),
    propertiesContainer = s.make("div", "sp-properties");
  sidebar.append(propertiesHeading, propertiesContainer);
  const center = s.make("div", "sp-center"),
    canvas = s.make("canvas", "sp-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Shape editing canvas");
  canvas.setAttribute("role", "application");
  s.canvas = canvas;
  center.append(canvas);
  workspace.append(sidebar, center);
  root.append(workspace);
  const status = s.make("div", "sp-status"),
    spacingLabel = s.make("label", "sp-spacing", "Grid "),
    spacing = s.make("input", "pz-inputbox");
  spacing.type = "number";
  spacing.min = "1";
  spacing.max = "10000";
  spacing.step = "1";
  spacing.value = "50";
  spacing.setAttribute("aria-label", "Grid spacing");
  spacingLabel.append(spacing, document.createTextNode(" px"));
  spacing.addEventListener("change", () => {
    const value = Number(spacing.value);
    s.spacing = Number.isFinite(value)
      ? Math.max(1, Math.min(10000, value))
      : 50;
    spacing.value = String(s.spacing);
    s.dirty = true;
  });
  s.zoomLabel = s.make("span", "sp-zoom");
  const hint = s.make(
    "span",
    "sp-hint",
    "Select anchors or drag a marquee. Space-drag to pan.",
  );
  hint.setAttribute("role", "status");
  const mode = s.make("select", "pz-inputbox sp-mode");
  mode.setAttribute("aria-label", "Point mode");
  for (const value of ["corner", "smooth", "symmetric", "independent"]) {
    const option = s.make(
      "option",
      "",
      value[0].toUpperCase() + value.slice(1),
    );
    option.value = value;
    mode.append(option);
  }
  mode.addEventListener("change", () => {
    s.setMode(mode.value);
    s.canvas.focus();
  });
  status.append(spacingLabel, s.zoomLabel, hint, mode);
  root.append(status);
  let messageUntil = 0;
  s.message = (text) => {
    hint.textContent = text;
    messageUntil = Date.now() + 5000;
  };
  s.selectItem = (id, extend = false) => {
    s.pointer?.cancel();
    s.finishNudge?.();
    s.penFinished = false;
    if (extend && s.treeSelection.has(id)) s.treeSelection.delete(id);
    else {
      if (!extend) s.treeSelection.clear();
      s.treeSelection.add(id);
    }
    s.activeId = id;
    s.selection.clear();
    s.refresh?.(true);
  };
  s.insertionMatrix = () => {
    const entry = treeData.find(layer.contents, s.activeId);
    if (!entry) return identity;
    const chain = [
      ...entry.ancestors,
      ...(entry.item.kind === "group" ? [entry.item] : []),
    ];
    return chain.reduce(
      (m, item) =>
        multiply(m, matrix(item.evaluate(s.localFrame()).properties)),
      identity,
    );
  };
  s.canvasApi = createCanvas(s, canvas);
  s.pointer = createPointer(s, canvas);
  const actions = installActions(s, root),
    tree = createTree(s, treeContainer);
  const properties = context.ui.properties({
    target: () => s.active()?.properties || null,
    keys: (name) => name !== "name",
    labelWidth: 0.62,
  });
  propertiesContainer.append(properties.element);
  let previousTarget = null,
    disposed = false,
    lastFrame = null,
    lastSnapshot = "",
    lastTime = 0;
  s.refresh = (force = false) => {
    if (disposed) return;
    if (!s.find(s.activeId)) {
      // Retain the desired ID while an undo temporarily removes the item.
      // Redo can then restore focus to the same item without serializing UI state.
      s.selection.clear();
    }
    for (const id of [...s.treeSelection])
      if (!s.find(id)) s.treeSelection.delete(id);
    const item = s.active();
    if (item && !s.treeSelection.size) s.treeSelection.add(item.id);
    if (item?.kind === "path")
      for (const id of [...s.selection])
        if (!item.vertexIds.includes(selectionPart(id).id))
          s.selection.delete(id);
    if (previousTarget !== item) {
      previousTarget = item;
      properties.setTarget(item?.properties || null);
    }
    tree.render();
    for (const [tool, button] of Object.entries(tools))
      button.setAttribute("aria-pressed", String(s.tool === tool));
    grid.setAttribute("aria-pressed", String(s.grid));
    snap.setAttribute("aria-pressed", String(s.snap));
    frame.textContent = "Frame " + s.localFrame();
    frame.title = "Local layer frame, including clip offset";
    const path = item?.kind === "path" ? item.properties.path : null;
    key.disabled = !path;
    key.setAttribute("aria-pressed", String(!!path?.animated));
    key.title = !path?.animated
      ? "Enable Path animation"
      : path.hasKeyframe(s.localFrame())
        ? path.objects[0].keyframes.length > 1
          ? "Remove Path keyframe at this frame"
          : "Disable Path animation; keep its single key"
        : "Add Path keyframe at this frame";
    key.classList.toggle(
      "keyed",
      !!path?.animated && path.hasKeyframe(s.localFrame()),
    );
    mode.hidden = item?.kind !== "path" || !s.selection.size;
    const first = s.selection.size
        ? selectionPart([...s.selection][0]).id
        : null,
      pointMode = item?.vertexModes?.[first] || "corner";
    mode.value = pointMode;
    propertiesHeading.textContent = item
      ? item.properties.name.get()
      : "Properties";
    canvas.dataset.tool = s.tool;
    if (Date.now() > messageUntil)
      hint.textContent =
        s.tool === "pen"
          ? "Click to add. Drag for handles. Alt breaks handles. Enter finishes."
          : item?.kind === "path"
            ? s.selection.size +
              " selected · Shift adds · Double-click changes mode"
            : "Select anchors or drag a marquee. Space-drag to pan.";
    if (force) s.dirty = true;
    s.dirty = true;
  };
  if (initial) s.treeSelection.add(initial.id);
  s.refresh(true);
  function tick(time) {
    if (disposed) return;
    if (!s.valid()) {
      s.pointer.cancel();
      host.close();
      return;
    }
    if (time - lastTime >= 32 || s.pointer.active) {
      lastTime = time;
      const currentFrame = s.localFrame();
      if (
        s.pointer.active?.frame !== undefined &&
        (s.pointer.active.frame !== currentFrame ||
          s.pointer.active.target !== s.activeId ||
          !s.active() ||
          s.pointer.active.matrix !==
            JSON.stringify(s.canvasApi.activeMatrix()))
      )
        s.pointer.cancel();
      actions.check();
      const snapshot = JSON.stringify(layer.contents);
      if (lastFrame !== currentFrame || snapshot !== lastSnapshot) {
        lastFrame = currentFrame;
        lastSnapshot = snapshot;
        s.refresh();
      }
      if (s.dirty) {
        s.canvasApi.draw();
        s.dirty = false;
      }
    }
    request = window.requestAnimationFrame(tick);
  }
  let request = window.requestAnimationFrame(tick);
  const changed = () => {
    s.dirty = true;
  };
  s.project.ui.onChanged.watch(changed);
  const focus = () => canvas.focus({ preventScroll: true });
  window.requestAnimationFrame(focus);
  return {
    select: s.selectItem,
    dispose() {
      if (disposed) return;
      s.pointer.cancel();
      actions.dispose();
      s.gesture.finish(true);
      disposed = true;
      window.cancelAnimationFrame(request);
      s.project.ui.onChanged.unwatch(changed);
      s.pointer.dispose();
      s.canvasApi.dispose();
      tree.dispose();
      properties.dispose();
      root.remove();
    },
  };
}
function install(context, Layer, Content) {
  const PZ = window.PZ,
    editor = window.CM,
    windows = new Map();
  const style = document.createElement("style");
  style.textContent = context.getAsset(
    "text",
    "./plugins/shape-plus/editor.css",
  );
  document.head.append(style);
  function owner(target) {
    if (target instanceof Layer) return target;
    try {
      return target instanceof Content ? target.getParentOfType(Layer) : null;
    } catch (_error) {
      return null;
    }
  }
  function open(target) {
    const layer = owner(target);
    if (!layer) return;
    const existing = windows.get(layer);
    if (existing) {
      if (target instanceof Content) existing.view.select(target.id);
      existing.host.reveal();
      return;
    }
    let view;
    const host = context.ui.openWindow({
      id: "shape-editor:" + layer.getAddress().join("-"),
      title: "Shape Editor",
      subtitle: layer.properties.name.get(),
      persistKey: "shape-editor",
      placement: "right",
      width: 960,
      height: 620,
      minWidth: 620,
      minHeight: 360,
      resizable: true,
      maximizable: true,
      isValid: () => {
        try {
          return (
            layer.parentProject === editor.project &&
            editor.project.addressLookup(layer.getAddress()) === layer
          );
        } catch (_error) {
          return false;
        }
      },
      mount(body, win) {
        view = mountEditor(
          context,
          layer,
          Content,
          body,
          win,
          target instanceof Content ? target : null,
        );
        return () => view.dispose();
      },
    });
    windows.set(layer, { host, view });
    host.onClose(() => windows.delete(layer));
  }
  context.ui.registerEditor({
    title: "Shape Editor",
    icon: "edit2",
    match: (target) => !!owner(target),
    open,
  });
  // Follow native selections inside an already open layer window. Other layer
  // windows stay pinned to their own targets rather than competing for focus.
  const proto = PZ.ui.edit.prototype,
    original = proto.selectItems;
  function selected() {
    const result = original.apply(this, arguments);
    for (const item of this.selection || [])
      if (item instanceof Content) {
        const layer = owner(item);
        windows.get(layer)?.view.select(item.id);
      }
    return result;
  }
  proto.selectItems = selected;
  const closeAll = () => {
    for (const { host } of [...windows.values()]) host.close();
  };
  const doubleClick = event => {
    if (event.defaultPrevented || event.target.closest("input,textarea,select,.handle")) return;
    const element = event.target.closest(".clip");
    const clip = element?.pz_object;
    if (!(clip instanceof PZ.clip) || !(clip.object instanceof Layer)) return;
    open(clip.object);
  };
  document.addEventListener("dblclick", doubleClick);
  editor.onProjectChanged.watch(closeAll);
  context.lifecycle.onDispose(() => {
    closeAll();
    document.removeEventListener("dblclick", doubleClick);
    editor.onProjectChanged.unwatch(closeAll);
    if (proto.selectItems === selected) proto.selectItems = original;
    style.remove();
  });
}
module.exports = { install, mountEditor };
