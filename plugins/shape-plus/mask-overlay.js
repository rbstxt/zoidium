"use strict";
// Pen overlay for layer masks on native Scene and Adjustment layers.
//
// The overlay reuses the Shape+ editor stack (model, canvas, pointer,
// transform, actions) through the path-host adapter: the session state looks
// like a one-path Shape+ contents tree while the JSON stays a mask
// collection on the native layer. Only one overlay mounts at a time, for the
// single selected maskable clip.
const { createCanvas } = require("./editor-canvas.js");
const { createPointer } = require("./editor-pointer.js");
const { installActions } = require("./editor-actions.js");
const { matrix } = require("./compiler.js");
const { inverse } = require("./editor-geometry.js");
const { icon } = require("./editor-icons.js");
const { createMaskSession, maskSessionFor } = require("./mask-host.js");

function maskableLayer(PZ, layer) {
  return !!layer && (layer instanceof PZ.layer.scene || layer instanceof PZ.layer.adjustment);
}

// Clip entries from viewport picking and timeline selection share one shape:
// { object, parent, start, length, offset }. Raw clips work too.
//
// Unlike the Shape+ overlay, this must NOT gate on viewport.renderMode:
// selecting a Scene clip always switches the native viewport into camera
// render mode (edit && scene), while a Shape+ selection clears the viewport
// scene and leaves render mode off. The mask pen is a 2D overlay over the
// edited frame either way, like the native 2D transform widget.
function maskClip(editor, viewport, PZ) {
  const clips = viewport.objects;
  if (!viewport.enabled || clips?.length !== 1) return null;
  const entry = clips[0];
  const layer = entry?.object instanceof PZ.layer ? entry.object : entry instanceof PZ.layer ? entry : null;
  if (!maskableLayer(PZ, layer)) return null;
  const start = entry?.start ?? 0, length = entry?.length ?? Infinity, offset = entry?.offset ?? 0;
  const frame = editor.playback.currentFrame;
  if (frame < start || frame >= start + length) return null;
  const sequence = editor.sequence;
  try {
    if (entry?.tryGetParentOfType && entry.tryGetParentOfType(PZ.sequence) !== sequence &&
        layer.tryGetParentOfType(PZ.sequence) !== sequence) return null;
  } catch (_error) {
    return null;
  }
  // Handles edit pre-effect layer space. Composite/perspective parents
  // require a different inverse projection.
  const local = frame - start + offset;
  const p = layer.properties;
  if (!inverse(matrix({ position: p.position.get(local), scale: p.scale.get(local), rotation: p.rotation.get(local) }))) return null;
  return { layer, frame: local };
}

function mountMaskOverlay(session, viewport, context, tool) {
  const { s } = session;
  const { PZ, editor } = s;
  const canvas = document.createElement("canvas");
  canvas.className = "shape-plus-overlay";
  canvas.setAttribute("aria-label", "Layer mask selection");
  canvas.tabIndex = 0;
  canvas.style.cssText = "position:absolute;touch-action:none;z-index:1;outline:none";
  viewport.el.append(canvas);
  s.viewport = viewport;
  s.document = document;
  s.window = window;
  s.context = context;
  s.canvas = canvas;
  s.tool = tool;
  s.canvasApi = createCanvas(s, canvas);
  s.pointer = createPointer(s, canvas);
  const actions = installActions(s, canvas, { shapes: false });
  s.setTool = next => {
    if (s.tool !== next) { s.pointer?.commit?.(); s.finishNudge?.(); }
    s.tool = next;
    s.refresh();
  };
  s.select = items => {
    const ids = items.filter(item => item instanceof s.Content).map(item => item.id);
    s.pointer?.commit?.();
    s.finishNudge?.();
    s.activeId = ids[0] || null;
    s.treeSelection = new Set(ids);
    s.selection.clear();
    s.penFinished = false;
    s.refresh();
  };
  let disposed = false, lastFrame;
  function update() {
    if (disposed) return;
    s.canvasApi.resize();
    const frame = s.localFrame();
    if (lastFrame !== undefined && lastFrame !== frame) s.pathInput?.notifyFrameChanged();
    lastFrame = frame;
    s.reconcilePaths?.();
    const gesture = s.pointer.active;
    if (gesture && (gesture.frame !== frame || (gesture.target != null && !s.find(gesture.target)))) {
      s.pointer.commit();
      s.finishNudge?.();
      s.gesture.finish();
    }
    actions.check();
    s.canvasApi.draw();
  }
  return {
    canvas, state: s, update,
    tool(next) { s.setTool(next); },
    dispose() {
      if (disposed) return;
      disposed = true;
      s.pointer?.commit?.();
      s.finishNudge?.();
      actions.dispose();
      s.pointer.dispose();
      s.canvasApi.dispose();
      canvas.remove();
      s.canvasApi = null;
      s.pointer = null;
      s.viewport = null;
      s.canvas = null;
    },
  };
}

function install(context, Content, paths) {
  const editor = window.CM, PZ = window.PZ, viewport = editor.mainViewport;
  const transform = document.querySelector('button[title="layer transform controls (t)"]');
  const toolbar = transform?.closest(".toolbarpanel")?.pz_panel;
  if (!viewport || !toolbar) throw Error("Layer masks require the native viewport toolbar");
  function sessionFor(layer) {
    const session = maskSessionFor(layer, () => createMaskSession({ PZ, editor, project: editor.project, nativeLayer: layer, Content,
      notify: text => context.ui.notify({ title: "Masks", message: text }) }));
    paths?.register("mask", layer, session.s);
    return session;
  }
  // The overlay owns viewport pointer input only while mask editing is on:
  // "off" leaves drags to the native viewport (editing-camera orbit, the 2D
  // transform widget); "pen" draws; "select" reshapes. M stays native.
  const MODES = ["off", "pen", "select"];
  let view = null, mode = "off", modeLayer = null, disposed = false;
  function setMode(next) {
    if (!MODES.includes(next)) throw Error(`Unknown mask mode ${next}`);
    if (next !== "off") modeLayer = maskClip(editor, viewport, PZ)?.layer || null;
    mode = next;
    if (mode !== "off" && paths && paths.controller.tool !== mode) paths.controller.setTool(mode);
    if (mode === "off") { view?.dispose(); view = null; }
    else if (view?.state.pathHost.owns(modeLayer)) view.tool(mode);
    tick(false);
  }
  const command = { title: "Mask pen (q)", key: "q", fn: () => setMode("pen") };
  const button = document.createElement("button");
  button.title = "Mask pen (q)";
  button.setAttribute("aria-label", "Mask pen (q)");
  button.cmd = command;
  const image = icon(document, "pen");
  image.style.cssText = "width:25px;height:25px;pointer-events:none";
  button.append(image);
  if (paths) {
    button.setAttribute("data-zoidium-path-control", "");
    command.fn = () => paths.shortcuts?.tool("q", { currentTarget: button });
    button.onclick = event => paths.shortcuts?.tool("q", event);
  } else button.onclick = toolbar.click.bind(toolbar);
  transform.after(button);
  if (!paths) toolbar.buttons.push(command);
  const changed = () => { view?.dispose(); view = null; mode = "off"; modeLayer = null; restoreWidget(); };
  editor.onProjectChanged.watch(changed);
  // Hide the native 2D widget while the overlay is mounted and give back
  // both its visibility and its edit state afterwards.
  let hiddenWidget = null;
  function hideWidget() {
    if (hiddenWidget !== null) return;
    hiddenWidget = { visibility: viewport.widget2d.el.style.visibility, edit: viewport.widget2d.edit };
    viewport.widget2d.edit = false;
    viewport.widget2d.el.style.visibility = "hidden";
  }
  function restoreWidget() {
    if (hiddenWidget === null) return;
    const previous = hiddenWidget;
    hiddenWidget = null;
    viewport.widget2d.el.style.visibility = previous.visibility;
    if (viewport.widget2d.edit !== previous.edit) viewport.widget2d.edit = previous.edit;
  }
  // Turning on the native transform controls ends mask editing.
  const transformChanged = () => {
    if (!view || !viewport.widget2d.edit) return;
    if (hiddenWidget) hiddenWidget.edit = true;
    setMode("off");
  };
  viewport.widget2d.onEditChanged.watch(transformChanged);
  let request;
  function tick(schedule = true) {
    if (disposed) return;
    const found = maskClip(editor, viewport, PZ);
    const layer = found?.layer || null;
    // Follow Pen when a compatible layer becomes editable.
    if (layer !== modeLayer) {
      modeLayer = layer;
      mode = layer && paths?.controller.tool === "pen" ? "pen" : "off";
    }
    const active = !!found && mode !== "off";
    if (view && (!active || !view.state.pathHost.owns(layer) || !view.state.valid())) { view.dispose(); view = null; }
    if (active && !view) {
      const session = sessionFor(layer);
      view = mountMaskOverlay(session, viewport, context, mode);
    }
    if (view) {
      hideWidget();
      view.update();
    } else restoreWidget();
    button.disabled = !found;
    const on = !!found && mode !== "off";
    button.title = on ? `Mask ${mode === "pen" ? "pen" : "point editing"} (q)` : "Mask pen (q)";
    button.setAttribute("aria-pressed", String(on));
    image.style.fill = on ? "var(--zui-toggle-on)" : "var(--zui-toggle-off)";
    image.style.color = on ? "var(--zui-toggle-on)" : "var(--zui-toggle-off)";
    if (schedule) request = window.requestAnimationFrame(() => tick());
  }
  tick();
  context.lifecycle.onDispose(() => {
    disposed = true;
    window.cancelAnimationFrame(request);
    editor.onProjectChanged.unwatch(changed);
    viewport.widget2d.onEditChanged.unwatch(transformChanged);
    view?.dispose();
    view = null;
    restoreWidget();
    const index = toolbar.buttons.indexOf(command);
    if (index >= 0) toolbar.buttons.splice(index, 1);
    button.remove();
  });
  return { sessionFor, setMode, update: () => tick(false), get state() { return view?.state; } };
}

module.exports = { install, mountMaskOverlay, maskClip, maskableLayer };
