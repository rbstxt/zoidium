"use strict";
const { createModel, defaults } = require("./model.js");
const { createLayerClass, TYPE } = require("./layer.js");
const { titles } = require("./properties.js");
const { createMapping } = require("./viewport-mapping.js");
const { find } = require("./editor-tree-data.js");
const { getMasks } = require("./mask-model.js");
const { planAdd } = require("./contents-ops.js");
const { createEditorPathRegistry } = require("./path-hosts.js");
const { isPerspectiveView, PERSPECTIVE_EDIT_MESSAGE } = require("./path-projection.js");
const DEFAULT_CLIP_LENGTH = 180;
function gradientFacade(property, frame) {
  return new Proxy(property, { get(target, key) {
    if (key === "definition") return { ...target.definition, zoidiumControl: undefined };
    // The classic picker mutates its working array before calling set().
    // A snapshot prevents that mutation from leaking into the preceding
    // held key when editStart creates a new key at the local frame.
    if (key === "get") return () => JSON.parse(JSON.stringify(target.get(frame())));
    if (key === "set") return value => target.set(value, frame());
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function install(context) {
  const PZ = window.PZ, THREE = window.THREE, apis = context.apis;
  const textService = require("./text-service.js").createService(context);
  const { Content } = createModel(PZ, textService), Layer = createLayerClass(PZ, THREE, Content);
  const own = cleanup => context.lifecycle.onDispose(cleanup);
  own(require("./path-channel-labels.js").install(PZ));
  const plugin = { id: "shape-plus", name: "Shape+", version: context.plugin?.version || "1", author: "Zoidium" };
  own(apis.layers.registerType({ id: "shape-plus/shape-layer", type: TYPE, name: "Shape+", plugin, factory: () => new Layer() }));
  own(apis.layers.registerPicker({ type: TYPE, name: "Shape+", desc: "Ordered vector paths, groups, fills and strokes." }));
  const data = { type: TYPE, schemaVersion: 1, renderVersion: 1, properties: { name: "Shape+" }, effects: [], contents: defaults() };
  own(apis.media.registerPreset({ id: "shape-plus/shape-layer", name: "Shape+", icon: "shape", json: {
    assets: [], baseType: "track", data: [{ type: 0, clips: [{ type: 0, start: 0, length: DEFAULT_CLIP_LENGTH, offset: 0, link: null, properties: { name: "Shape+" }, object: data }] }],
  } }));
  PZ.ui.objectTypes.set(Content, Object.keys(titles).map(kind => ({ type: kind, name: titles[kind], desc: "Add " + titles[kind].toLowerCase() + " to the contents." })));
  own(() => PZ.ui.objectTypes.delete(Content));
  // CM3's picker reads/writes without a frame. Supply local UI time while
  // preserving the real property identity, address, observables and history.
  own(apis.propertyControls.register("shape-plus/gradient", { type: PZ.property.type.GRADIENT, create(property) {
    const frame = () => window.CM.playback.currentFrame - property.frameOffset;
    const facade = gradientFacade(property, frame);
    return PZ.ui.controls.generateGradientInput(facade);
  } }));
  // The group is a real native dynamic.group. Its aggregate row controls all
  // channels; the ordinary child rows expose numeric editing in Objects.
  own(apis.propertyControls.register("shape-plus/path", { type: PZ.property.type.NUMBER, create(property) {
    const element = document.createElement("div"); element.className = "editbox";
    element.pz_update = () => { element.textContent = property.objects.length / 6 + " vertices"; };
    element.pz_update(); return element;
  } }));
  require("./text-controls.js").install(context);
  // Controls must exist before an enabled panel regenerates saved Path rows.
  // Reverse disposal then removes the overlay/panels before their controls.
  // Layer masks on native Scene/Adjustment layers (mask-model.js,
  // mask-raster.js, mask-host.js, mask-render.js). No masks means no wrapper
  // work, so unmasked projects render exactly as before.
  require("./mask-render.js").installMaskRender({ PZ, THREE, Content, onDispose: own });
  require("./mask-persist.js").installMaskPersistence(PZ, own);
  require("./native-ui.js").install(PZ, Layer, Content, own);
  const { maskOverlay, transfer } = installPathEditing(context, Layer, Content);
  require("./mask-panels.js").installMaskPanels(context, Content, mode => maskOverlay.setMode(mode), transfer);
  require("./mask-api.js").installMaskApi({ PZ, THREE, Content, onDispose: own });
  require("./convert-native.js").install(context, Layer);
  require("./workflow.js").install(context, Layer, Content, transfer);
}
function timelineTracks(editor, PZ, document) {
  for (const element of document.querySelectorAll(".editorpanel")) {
    const panel = element.pz_panel;
    if (PZ.ui.timeline && panel instanceof PZ.ui.timeline &&
        panel.editor === editor && panel.sequence === editor.sequence) return panel.tracks;
  }
  return null;
}

function selectTimelineClips(tracks, clips) {
  if (!tracks) return false;
  const requested = new Set(clips);
  const rows = [...tracks.container.querySelectorAll(".clip")].filter(row => requested.has(row.pz_object));
  if (rows.length !== requested.size) return false;
  tracks.deselectClips();
  for (const row of rows) row.classList.add("selected");
  tracks.selectClips();
  return true;
}

function createShapeClip(editor, tracks, point, nextId) {
  const { sequence, history } = editor;
  if (!tracks || history.operation !== null) return null;
  const contents = [];
  const { item } = planAdd(contents, "path", { nextId, point, paints: ["stroke", "fill"], strokeWidth: 2 });
  const index = sequence.videoTracks.length, start = Math.max(0, Math.round(editor.playback.currentFrame));
  const previous = Array.from(tracks.selection);
  const data = { type: 0, start, length: DEFAULT_CLIP_LENGTH, offset: 0, link: null,
    properties: { name: "Shape+" }, object: { type: TYPE, schemaVersion: 1, renderVersion: 1,
      properties: { name: "Shape+" }, effects: [], contents } };
  const clip = () => sequence.videoTracks[index]?.clips[0];
  function undoSelection() {
    selectTimelineClips(tracks, previous);
    history.pushCommand(redoSelection);
  }
  function redoSelection() {
    selectTimelineClips(tracks, [clip()]);
    history.pushCommand(undoSelection);
  }
  history.startOperation();
  try {
    // These native commands record the track and clip inverses in the
    // same operation. The clip starts with its first path already loaded.
    tracks.createTrack({ type: 0, newTrackIdx: index, data: null });
    tracks.createClip({ type: 0, newTrackIdx: index, newIdx: 0, start, length: DEFAULT_CLIP_LENGTH, data });
    redoSelection();
    history.finishOperation();
    return { clip: clip(), pathId: item.id };
  } catch (error) {
    if (history.operation !== null) history.discardOperation();
    throw error;
  }
}

function installPathEditing(context, Layer, Content) {
  const editor = window.CM, viewport = editor.mainViewport, PZ = window.PZ;
  const own = cleanup => context.lifecycle.onDispose(cleanup);
  own(require("./path-channel-labels.js").install(PZ));
  const paths = createEditorPathRegistry(editor, viewport);
  own(() => paths.dispose());
  const shapeEditor = require("./editor.js");
  const shapeOverlay = shapeEditor.install(context, Layer, Content, paths);
  // Layer masks on native Scene/Adjustment layers (mask-model.js,
  // mask-raster.js, mask-host.js, mask-render.js, mask-persist.js,
  // mask-overlay.js, mask-panels.js).
  const maskEditor = require("./mask-overlay.js");
  const maskOverlay = maskEditor.install(context, Content, paths);
  const sessions = new WeakMap();
  function sessionFor(layer) {
    if (maskEditor.maskableLayer(PZ, layer)) return maskOverlay.sessionFor(layer).s;
    if (!(layer instanceof Layer)) return null;
    if (shapeOverlay.state?.layer === layer) return shapeOverlay.state;
    let state = sessions.get(layer);
    if (!state?.valid()) {
      const { createEditorModel } = require("./editor-model.js");
      state = createEditorModel({ PZ, editor, project: editor.project, layer, Content,
        message: message => context.ui.notify({ title: "Shape+", message }) });
      sessions.set(layer, state);
    }
    return state;
  }
  const nativeUi = require("./native-ui.js");
  const transfer = require("./path-transfer.js").editorTransfer({
    PZ, editor, viewport, sessionFor, nextId: () => "sp-" + window.crypto.randomUUID(),
    notify: message => context.ui.notify({ title: "Path transfer", message }),
    openMenu: options => context.ui.openMenu(options),
  });
  nativeUi.installPathConversion(PZ, Content, transfer, options => context.ui.openMenu(options), own);
  nativeUi.installPathControls(PZ, sessionFor, own);
  const refreshTimeline = nativeUi.installPathTimeline(PZ, editor, sessionFor, layer => {
    if (!layer) return null;
    if (shapeOverlay.state?.layer === layer) return shapeOverlay.state.canvas;
    if (maskOverlay.state?.pathHost.owns(layer)) return maskOverlay.state.canvas;
    return null;
  }, message => context.ui.notify({ title: "Path timeline", message }), own);
  function selectedLayer() {
    const selected = viewport.objects?.length === 1 ? viewport.objects[0] : null;
    return selected?.object || selected;
  }
  const notifyPerspective = () => context.ui.notify({ title: "Path editing", message: PERSPECTIVE_EDIT_MESSAGE });
  paths.setMounter((kind, layer, pathId) => {
    if (isPerspectiveView(viewport) && selectedLayer() === layer) { notifyPerspective(); return false; }
    if (!viewport.enabled || !editor.project || !editor.sequence || globalThis.ZoidiumTrackSwitches?.isLocked(layer)) return false;
    if (kind === "shape") {
      if (!(layer instanceof Layer) || find(layer.contents, pathId)?.item.kind !== "path") return false;
    } else if (!maskEditor.maskableLayer(PZ, layer) || !getMasks(layer).some(mask => mask.id === pathId)) {
      return false;
    }
    const clip = layer.parent && layer.parentObject;
    if (!(clip instanceof PZ.clip) || clip.object !== layer ||
        clip.tryGetParentOfType(PZ.sequence) !== editor.sequence || clip.length <= 0) return false;
    try {
      if (editor.project.addressLookup(layer.getAddress()) !== layer) return false;
    } catch (_error) {
      return false;
    }
    if (selectedLayer() !== layer && !selectTimelineClips(timelineTracks(editor, PZ, document), [clip])) return false;
    if (editor.playback.currentFrame < clip.start || editor.playback.currentFrame >= clip.start + clip.length) {
      editor.playback.speed = 0;
      editor.playback.currentFrame = clip.start;
    }
    if (isPerspectiveView(viewport)) { notifyPerspective(); return false; }
    if (kind === "mask") {
      shapeOverlay.update();
      maskOverlay.setMode("select");
      return !!maskOverlay.state?.pathHost.owns(layer);
    }
    maskOverlay.update();
    shapeOverlay.setTool("select");
    return shapeOverlay.state?.layer === layer;
  });
  const publicPaths = Object.freeze({ activate: paths.activate });
  // Clicking a mask name in Properties starts editing that mask at once.
  const maskPanels = require("./mask-panels.js");
  maskPanels.setPanelActivator((session, layer, maskId, focusPen, refresh, additive = false) => {
    maskOverlay.sessionFor(layer);
    if (!paths.selectMask(layer, maskId, additive)) {
      session.s.selectItem(maskId);
      if (!isPerspectiveView(viewport) && typeof focusPen === "function") focusPen("select");
    }
    if (typeof refresh === "function") refresh();
  });
  own(() => maskPanels.setPanelActivator(null));
  PZ.zoidium ??= {};
  if (PZ.zoidium.define) PZ.zoidium.define("pathEditor", publicPaths, "shape-plus");
  else PZ.zoidium.pathEditor = publicPaths;
  own(() => {
    if (PZ.zoidium.pathEditor === publicPaths) delete PZ.zoidium.pathEditor;
  });

  function routeTool(tool, explain = true) {
    if (isPerspectiveView(viewport)) {
      if (explain) notifyPerspective();
      return;
    }
    const mask = maskEditor.maskClip(editor, viewport, PZ)?.layer;
    if (mask) {
      shapeOverlay.update();
      const host = paths.hostForLayer(mask);
      if (tool === "pen" || maskOverlay.state || (host && host === paths.controller.activeHost)) maskOverlay.setMode(tool);
    } else {
      maskOverlay.update();
      shapeOverlay.setTool(tool);
    }
  }
  function suspendPen() {
    if (paths.controller.tool === "pen") paths.controller.setTool("select");
  }
  const transformControl = document.querySelector('button[title="layer transform controls (t)"]');
  transformControl?.addEventListener("click", suspendPen);
  own(() => transformControl?.removeEventListener("click", suspendPen));

  paths.shortcuts = require("./editor-actions.js").installPathShortcuts({
    paths, viewport, document, window,
    session: () => {
      const shape = shapeEditor.editableClip(editor, viewport, Layer, PZ)?.object;
      if (shape && shapeOverlay.state?.layer === shape) return shapeOverlay.state;
      const mask = maskEditor.maskClip(editor, viewport, PZ)?.layer;
      if (mask && maskOverlay.state?.pathHost.owns(mask)) return maskOverlay.state;
      return null;
    },
    routeTool, suspendPen,
  });
  own(() => paths.shortcuts.dispose());

  // Timeline selection is an observable list in the native viewport.
  // Rebind it when the viewport switches to another selection list.
  function selectionChanged() {
    if (paths.controller.tool === "pen") routeTool("pen", false);
    else { shapeOverlay.update(); maskOverlay.update(); }
    refreshTimeline?.();
  }
  let selectionEvents;
  function bindSelection() {
    selectionEvents?.unwatch(selectionChanged);
    selectionEvents = viewport.objects?.onListChanged;
    selectionEvents?.watch(selectionChanged);
    selectionChanged();
  }
  viewport.onObjectsChanged?.watch(bindSelection);
  bindSelection();
  own(() => {
    viewport.onObjectsChanged?.unwatch(bindSelection);
    selectionEvents?.unwatch(selectionChanged);
  });

  function canvasPress(event) {
    if (event.target !== viewport.canvas || event.button !== 0 || event.isPrimary === false ||
        !editor.project || !editor.sequence || !viewport.enabled || paths.controller.tool !== "pen") return;
    if (isPerspectiveView(viewport)) { notifyPerspective(); return; }
    const layer = selectedLayer();
    // A compatible selection with an unavailable projection stays on its
    // host. It must not silently add a layer to a different coordinate space.
    if (layer instanceof Layer || maskEditor.maskableLayer(PZ, layer)) return;
    const mapping = createMapping(viewport.canvas.getBoundingClientRect(), editor.sequence.properties.resolution.get(), {
      position: [0, 0, 0], scale: [1, 1, 1], rotation: 0,
    });
    if (!mapping) return;
    const point = mapping.client([event.clientX, event.clientY]);
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      editor.playback.speed = 0;
      const created = createShapeClip(editor, timelineTracks(editor, PZ, document), point,
        () => "sp-" + window.crypto.randomUUID());
      if (!created) return;
      shapeOverlay.setTool("pen");
      const state = shapeOverlay.state, host = state?.sharedPathHost;
      if (state?.layer !== created.clip.object || !host?.hasPath(created.pathId)) return;
      paths.controller.activate(host, created.pathId);
      paths.controller.setSelection(host, created.pathId, host.listVertexIds(created.pathId));
      paths.controller.startDrawing({ points: [point] });
      shapeOverlay.canvas.focus({ preventScroll: true });
    } catch (error) {
      context.ui.notify({ title: "Shape+", message: error.message });
    }
  }
  viewport.el.addEventListener("pointerdown", canvasPress, true);
  own(() => viewport.el.removeEventListener("pointerdown", canvasPress, true));
  return { paths, shapeOverlay, maskOverlay, sessionFor, transfer };
}

module.exports = { install, gradientFacade, installPathEditing };
