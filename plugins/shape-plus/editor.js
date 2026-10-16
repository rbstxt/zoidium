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
function editableClip(editor, viewport, Layer) {
  const clips = viewport.objects;
  if (!viewport.enabled || viewport.renderMode || clips?.length !== 1) return null;
  const clip = clips[0], layer = clip.object, frame = editor.playback.currentFrame;
  if (!(layer instanceof Layer) || layer.parentObject !== clip || layer.effects.length ||
      frame < clip.start || frame >= clip.start + clip.length) return null;
  // A composite/perspective parent, a remapped composition or image effects
  // require a different inverse projection. Do not place guessed handles.
  if (clip.tryGetParentOfType(window.PZ.sequence) !== editor.sequence) return null;
  const p = layer.properties, local = frame - clip.start + (clip.offset || 0);
  if (!inverse(matrix({ position: p.position.get(local), scale: p.scale.get(local), rotation: p.rotation.get(local) }))) return null;
  return clip;
}
function mountOverlay(context, layer, Content, viewport, panels, tool, onSelection) {
  const canvas = document.createElement("canvas"), editor = window.CM, PZ = window.PZ;
  canvas.className = "shape-plus-overlay";
  canvas.setAttribute("aria-label", "Shape+ path controls");
  canvas.tabIndex = 0;
  canvas.style.cssText = "position:absolute;touch-action:none;z-index:1;outline:none";
  viewport.el.append(canvas);
  const s = {
    context, layer, Content, viewport, editor, PZ, document, window,
    project: editor.project, canvas, tool, overlay: true, snap: true,
    selection: new Set(), treeSelection: new Set(), activeId: null,
    penFinished: false, dirty: true,
  };
  s.nextId = () => "sp-" + window.crypto.randomUUID();
  s.make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  s.message = text => context.ui.notify({ title: "Shape+", message: text });
  createEditorModel(s);
  function syncSelection() {
    const selected = [...s.treeSelection].map(s.find).filter(Boolean);
    const top = panels.top;
    for (const row of top.list.querySelectorAll("li"))
      if (row.pz_object instanceof Content) row.classList.toggle("selected", selected.includes(row.pz_object));
    if (selected.length !== top.selection.length || selected.some((item, i) => top.selection[i] !== item))
      top.selection.splice(0, top.selection.length, ...selected);
    onSelection();
  }
  s.refresh = () => { s.dirty = true; syncSelection(); };
  s.selectItem = (id, extend = false) => {
    s.pointer?.cancel(); s.finishNudge?.(true);
    if (!extend) s.treeSelection.clear();
    s.treeSelection.add(id); s.activeId = id;
    s.selection.clear(); s.penFinished = false; s.refresh();
  };
  s.insertionMatrix = () => {
    const entry = find(layer.contents, s.activeId);
    if (!entry) return identity;
    const chain = [...entry.ancestors, ...(entry.item.kind === "group" ? [entry.item] : [])];
    return chain.reduce((m, item) => multiply(m, matrix(item.evaluate(s.localFrame()).properties)), identity);
  };
  s.canvasApi = createCanvas(s, canvas);
  s.pointer = createPointer(s, canvas);
  const actions = installActions(s, canvas);
  let lastContext = "", disposed = false;
  function cancel() { s.pointer.cancel(); s.finishNudge(true); s.gesture.finish(true); }
  function update() {
    if (disposed) return;
    s.canvasApi.resize();
    const current = JSON.stringify([s.localFrame(), s.canvasApi.activeMatrix(),
      viewport.canvas.getBoundingClientRect().toJSON(), layer.getAddress()]);
    if (lastContext && current !== lastContext) cancel();
    lastContext = current;
    actions.check();
    s.canvasApi.draw();
  }
  return {
    canvas, state: s, update, cancel,
    tool(next) { cancel(); s.tool = next; s.penFinished = false; canvas.focus(); },
    select(items) {
      const ids = items.filter(item => item instanceof Content).map(item => item.id);
      if (ids[0] === s.activeId && ids.length === s.treeSelection.size && ids.every(id => s.treeSelection.has(id))) return;
      cancel(); s.activeId = ids[0] || null; s.treeSelection = new Set(ids); s.selection.clear(); s.penFinished = false;
    },
    dispose() {
      if (disposed) return;
      cancel(); actions.dispose(); s.pointer.dispose(); s.canvasApi.dispose();
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
    ["select", "v", "edit2", "Shape+ path controls (v)"],
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
    view?.cancel();
    const result = select.apply(this, arguments);
    view?.select(this.selection);
    return result;
  }
  panels.top.selectItems = selected;
  const changed = () => { view?.dispose(); view = null; };
  editor.onProjectChanged.watch(changed);
  function restoreWidget() {
    if (hiddenWidget !== null) { viewport.widget2d.el.style.visibility = hiddenWidget; hiddenWidget = null; }
  }
  let request;
  function tick(schedule = true) {
    if (disposed) return;
    const clip = editableClip(editor, viewport, Layer);
    const layer = clip?.object;
    const item = panels.top.selection.length === 1 ? panels.top.selection[0] : null;
    const entry = item instanceof Content && layer ? find(layer.contents, item.id) : null;
    const visible = enabled && layer && (tool === "pen" || entry &&
      ["path", "rectangle", "ellipse", "polystar", "gradientFill", "gradientStroke", "repeater"].includes(item.kind));
    if (view && (!visible || view.state.layer !== layer || !view.state.valid())) { view.dispose(); view = null; }
    if (visible && !view) {
      view = mountOverlay(context, layer, Content, viewport, panels, tool, () => {});
      view.select(panels.top.selection);
    }
    if (view) {
      if (hiddenWidget === null) hiddenWidget = viewport.widget2d.el.style.visibility;
      viewport.widget2d.el.style.visibility = "hidden";
      view.update();
    } else restoreWidget();
    for (const { name, button, image } of buttons) {
      button.disabled = !clip;
      button.setAttribute("aria-pressed", String(!!clip && enabled && name === tool));
      image.style.fill = name === "pen" ? "none" : enabled && name === tool && clip ? "#8a2828" : "#acacac";
      image.style.color = enabled && name === tool && clip ? "#8a2828" : "#acacac";
    }
    if (schedule) request = window.requestAnimationFrame(() => tick());
  }
  tick();
  context.lifecycle.onDispose(() => {
    disposed = true; window.cancelAnimationFrame(request); changed(); restoreWidget();
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
