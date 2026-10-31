"use strict";
const { createEditorModel } = require("./editor-model.js");
const { createCanvas } = require("./editor-canvas.js");
const { createPointer } = require("./editor-pointer.js");
const { installActions } = require("./editor-actions.js");
const { matrix, identity } = require("./compiler.js");
const { multiply, inverse } = require("./editor-geometry.js");
const { find } = require("./editor-tree-data.js");
const { findObjectsPanel } = require("./native-ui.js");
const { icon } = require("./editor-icons.js");
function editableClip(editor, viewport, Layer, PZ) {
  const clips = viewport.objects;
  if (!viewport.enabled || viewport.renderMode || clips?.length !== 1) return null;
  const clip = clips[0], layer = clip.object, frame = editor.playback.currentFrame;
  if (!(layer instanceof Layer) || !clip.parent || !layer.parent || layer.parentObject !== clip ||
      frame < clip.start || frame >= clip.start + clip.length) return null;
  // Handles edit pre-effect layer space, including with spatial image effects.
  // Composite/perspective parents require a different inverse projection.
  if (clip.tryGetParentOfType(PZ.sequence) !== editor.sequence) return null;
  const p = layer.properties, local = frame - clip.start + (clip.offset || 0);
  if (!inverse(matrix({ position: p.position.get(local), scale: p.scale.get(local), rotation: p.rotation.get(local) }))) return null;
  return clip;
}
function mountOverlay(context, layer, Content, viewport, panels, tool) {
  const canvas = document.createElement("canvas"), editor = window.CM, PZ = window.PZ;
  canvas.className = "shape-plus-overlay";
  canvas.setAttribute("aria-label", "Shape+ selection");
  canvas.tabIndex = 0;
  canvas.style.cssText = "position:absolute;touch-action:none;z-index:1;outline:none";
  viewport.el.append(canvas);
  const s = {
    context, layer, Content, viewport, editor, PZ, document, window,
    project: editor.project, canvas, tool, snap: true,
    selection: new Set(), treeSelection: new Set(), activeId: null,
    penFinished: false, dirty: true, hover: null,
  };
  s.nextId = () => "sp-" + window.crypto.randomUUID();
  s.make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  s.message = text => context.ui.notify({ title: "Shape+", message: text });
  s.rename = id => {
    const row = Array.from(panels.top.list.querySelectorAll("li")).find(row => row.pz_object?.id === id);
    if (row) panels.top.renameClick({ currentTarget: row, preventDefault() {} });
  };
  createEditorModel(s);
  function syncSelection() {
    const selected = [...s.treeSelection].map(s.find).filter(Boolean);
    const top = panels.top;
    for (const row of top.list.querySelectorAll("li"))
      if (row.pz_object instanceof Content) row.classList.toggle("selected", selected.includes(row.pz_object));
    if (selected.length !== top.selection.length || selected.some((item, i) => top.selection[i] !== item))
      top.selection.splice(0, top.selection.length, ...selected);
  }
  s.refresh = () => { s.dirty = true; syncSelection(); };
  s.selectItem = (id, extend = false) => {
    s.finishTextEdit?.();
    s.pointer?.commit(); s.finishNudge?.();
    if (!extend) s.treeSelection.clear();
    s.treeSelection.add(id); s.activeId = id;
    s.selection.clear(); s.penFinished = false; s.refresh();
  };
  s.clearSelection = () => {
    s.finishTextEdit?.();
    s.pointer?.commit(); s.finishNudge?.();
    s.treeSelection.clear(); s.activeId = null;
    s.selection.clear(); s.penFinished = false; s.refresh();
  };
  // A new Pen path goes into the selected group, otherwise into a new
  // untransformed group (see contents-ops.js planAdd with groupsOnly).
  s.insertionMatrix = () => {
    const entry = find(layer.contents, s.activeId);
    if (!entry || entry.item.kind !== "group") return identity;
    return [...entry.ancestors, entry.item].reduce((m, item) => multiply(m, matrix(item.evaluate(s.localFrame()).properties)), identity);
  };
  s.canvasApi = createCanvas(s, canvas);
  s.pointer = createPointer(s, canvas);
  const actions = installActions(s, canvas);
  const textEditor = require("./text-inline.js").install(s);
  let disposed = false;
  // Tool switches, native selection and teardown end an edit in progress but
  // keep it: what the preview shows is what history records. Only undo
  // (editor-actions.js) or an error roll a gesture back; in-place text
  // editing commits on Escape instead (see text-inline.js).
  function settle() { textEditor.finish(); s.pointer.commit(); s.finishNudge(); s.gesture.finish(); }
  const changed = () => { if (!disposed && s.valid()) s.refresh(); };
  s.project.ui.onChanged.watch(changed);
  function update() {
    if (disposed) return;
    s.canvasApi.resize();
    // Gestures capture their frame and inverse transforms when they start,
    // so layout or projection changes mid-drag cannot corrupt them. A frame
    // change (playback) or a removed target ends the drag where it is.
    const gesture = s.pointer.active;
    if (gesture && (gesture.frame !== s.localFrame() || (gesture.target != null && !s.find(gesture.target)))) settle();
    actions.check(); textEditor.check();
    s.canvasApi.draw();
  }
  return {
    canvas, state: s, update, settle,
    tool(next) { settle(); s.tool = next; s.penFinished = false; canvas.focus(); },
    select(items) {
      const ids = items.filter(item => item instanceof Content).map(item => item.id);
      if (ids[0] === s.activeId && ids.length === s.treeSelection.size && ids.every(id => s.treeSelection.has(id))) return;
      settle(); s.activeId = ids[0] || null; s.treeSelection = new Set(ids); s.selection.clear(); s.penFinished = false;
    },
    dispose() {
      if (disposed) return;
      settle(); actions.dispose(); s.pointer.dispose(); s.canvasApi.dispose();
      s.project.ui.onChanged.unwatch(changed);
      disposed = true; canvas.remove();
    },
  };
}
function install(context, Layer, Content) {
  const editor = window.CM, PZ = window.PZ, viewport = editor.mainViewport;
  const panels = findObjectsPanel(PZ, editor, document);
  const transform = document.querySelector('button[title="layer transform controls (t)"]');
  const toolbar = transform?.closest(".toolbarpanel")?.pz_panel;
  if (!viewport || !panels || !toolbar) throw Error("Shape+ requires the native Objects panel and viewport toolbar");
  let view = null, tool = "select", enabled = true, disposed = false, hiddenWidget = null;
  const commands = [], buttons = [];
  function setTool(next) {
    if (next === "select") enabled = !enabled || tool !== "select";
    else enabled = true;
    tool = next;
    view?.tool(next);
    tick(false);
  }
  for (const [name, key, nativeIcon, title] of [
    ["select", "v", "edit2", "Shape+ selection (v)"],
    ["pen", "p", null, "Shape+ pen (p)"],
  ]) {
    const command = { title, key, fn: () => setTool(name) };
    const button = document.createElement("button");
    button.title = title; button.setAttribute("aria-label", title); button.cmd = command;
    const image = nativeIcon ? PZ.ui.generateIcon(nativeIcon) : icon(document, "pen");
    image.style.cssText = "width:25px;height:25px;pointer-events:none";
    button.append(image); button.onclick = toolbar.click.bind(toolbar);
    transform.after(button); commands.push(command); buttons.push({ name, button, image });
  }
  // Native toolbar owns shortcut dispatch, ignore-typing rules and modifiers.
  // V and P are unused in CM3's native toolbar. Keep its C/T commands intact.
  toolbar.buttons.push(...commands);
  const select = panels.top.selectItems;
  function selected() {
    if (!view) return select.apply(this, arguments);
    // Finishing an edit can rebuild the native rows. Retain the clicked IDs
    // first, then select their live replacements instead of stale instances.
    const requested = Array.from(this.list.getElementsByClassName("selected"), row => row.pz_object);
    view?.settle();
    this.deselectItems();
    for (const row of this.list.querySelectorAll("li"))
      if (requested.some(item => item instanceof Content ? row.pz_object instanceof Content && row.pz_object.id === item.id : row.pz_object === item))
        row.classList.add("selected");
    const result = select.apply(this, arguments);
    view?.select(this.selection);
    return result;
  }
  panels.top.selectItems = selected;
  const changed = () => { view?.dispose(); view = null; };
  editor.onProjectChanged.watch(changed);
  function restoreWidget() {
    if (hiddenWidget !== null) {
      const previous = hiddenWidget; hiddenWidget = null;
      viewport.widget2d.el.style.visibility = previous.visibility;
      viewport.widget2d.edit = previous.edit;
    }
  }
  let request;
  function tick(schedule = true) {
    if (disposed) return;
    const clip = editableClip(editor, viewport, Layer, PZ);
    const layer = clip?.object;
    // The overlay is the Shape+ selection tool: it stays active for any
    // directly edited Shape+ clip so shapes can be clicked and dragged even
    // before anything is selected in Objects. T hands control to CM3.
    const visible = enabled && !!layer;
    if (view && (!visible || view.state.layer !== layer || !view.state.valid())) { view.dispose(); view = null; }
    if (visible && !view) {
      view = mountOverlay(context, layer, Content, viewport, panels, tool);
      view.state.setTool = setTool;
      view.select(panels.top.selection);
    }
    if (view) {
      if (hiddenWidget === null) {
        hiddenWidget = { visibility: viewport.widget2d.el.style.visibility, edit: viewport.widget2d.edit };
        viewport.widget2d.edit = false;
      }
      viewport.widget2d.el.style.visibility = "hidden";
      view.update();
    } else restoreWidget();
    for (const { name, button, image } of buttons) {
      button.disabled = !clip;
      button.setAttribute("aria-pressed", String(!!clip && enabled && name === tool));
      image.style.fill = name === "pen" ? "none" : enabled && name === tool && clip ? "var(--zui-toggle-on)" : "var(--zui-toggle-off)";
      image.style.color = enabled && name === tool && clip ? "var(--zui-toggle-on)" : "var(--zui-toggle-off)";
    }
    if (schedule) request = window.requestAnimationFrame(() => tick());
  }
  const transformChanged = () => {
    if (view && viewport.widget2d.edit) {
      if (hiddenWidget) hiddenWidget.edit = viewport.widget2d.edit;
      enabled = false; tick(false);
    }
  };
  viewport.widget2d.onEditChanged.watch(transformChanged);
  tick();
  context.lifecycle.onDispose(() => {
    disposed = true; window.cancelAnimationFrame(request);
    viewport.widget2d.onEditChanged.unwatch(transformChanged);
    changed(); restoreWidget();
    editor.onProjectChanged.unwatch(changed);
    if (panels.top.selectItems === selected) panels.top.selectItems = select;
    for (const command of commands) {
      const index = toolbar.buttons.indexOf(command);
      if (index >= 0) toolbar.buttons.splice(index, 1);
    }
    for (const { button } of buttons) button.remove();
  });
}
module.exports = { install, mountOverlay, editableClip };
