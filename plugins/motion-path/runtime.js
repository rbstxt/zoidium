"use strict";
// Installs the viewport overlay, the toolbar toggle and the redraw loop.
const targets = require("./targets.js");
const overlay = require("./overlay.js");
const { createInvalidation } = require("./invalidation.js");
const { createInteraction } = require("./interaction.js");

const STORAGE_KEY = "zoidium.motion-path.visible";
const TITLE = "motion paths (o)";
// "o" is unused by CM3's toolbars, timeline and graph shortcuts and by the
// other Zoidium viewport tools (Shape+ uses v and p; CM3 uses c and t).
const SHORTCUT = "o";

function readVisible(storage) {
  try { return storage.getItem(STORAGE_KEY) !== "false"; } catch (_error) { return true; }
}
function writeVisible(storage, value) {
  try { storage.setItem(STORAGE_KEY, value ? "true" : "false"); } catch (_error) { /* Private mode keeps the session value. */ }
}
function icon(document) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<path d="M4 18 C 8 4, 15 20, 20 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="0.1 2.6" stroke-linecap="round"/>' +
    '<rect x="2" y="16" width="4" height="4" fill="currentColor"/>' +
    '<rect x="18" y="4" width="4" height="4" fill="currentColor"/>' +
    '<rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1.4"/>';
  return svg;
}
function install(context) {
  const window = globalThis.window, document = window.document;
  const PZ = window.PZ, THREE = window.THREE, editor = window.CM, viewport = editor?.mainViewport;
  const transform = document.querySelector('button[title="layer transform controls (t)"]');
  const toolbar = transform?.closest(".toolbarpanel")?.pz_panel;
  if (!viewport?.el || !toolbar) throw Error("Motion paths require the native viewport and its toolbar");
  const canvas = document.createElement("canvas");
  canvas.className = "motion-path-overlay";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2;touch-action:none";
  let interaction, invalidation, command, button, request = 0, disposed = false;
  // Own cleanup before installing DOM or listeners so partial activation can
  // be unwound by the plugin manager too.
  context.lifecycle.onDispose(() => {
    disposed = true;
    window.cancelAnimationFrame(request);
    interaction?.dispose();
    invalidation?.dispose();
    canvas.remove();
    const index = toolbar.buttons.indexOf(command);
    if (index >= 0) toolbar.buttons.splice(index, 1);
    button?.remove();
  });
  viewport.el.append(canvas);
  const ctx = canvas.getContext("2d");
  const s = {
    PZ, THREE, editor, viewport, canvas, window, document,
    easings: PZ.tween.easingList.map(entry => entry.fn || null),
    selection: new Map(), models: [], dirty: true,
    requestDraw() {
      s.dirty = true;
      if (!disposed && !request) request = window.requestAnimationFrame(frame);
    },
  };
  interaction = createInteraction(s);
  invalidation = createInvalidation(s);
  invalidation.sync([]);
  let visible = readVisible(window.localStorage), drawn = false;

  command = { title: TITLE, key: SHORTCUT, fn: () => setVisible(!visible) };
  button = document.createElement("button");
  button.title = TITLE;
  button.setAttribute("aria-label", TITLE);
  button.cmd = command;
  const image = icon(document);
  image.style.cssText = "width:25px;height:25px;pointer-events:none";
  button.append(image);
  button.onclick = toolbar.click.bind(toolbar);
  (document.querySelector('button[title="Shape+ selection (v)"]') || transform).after(button);
  toolbar.buttons.push(command);
  function paintButton() {
    button.setAttribute("aria-pressed", String(visible));
    image.style.color = visible ? "var(--zui-toggle-on)" : "var(--zui-toggle-off)";
  }
  function setVisible(next) {
    visible = !!next;
    writeVisible(window.localStorage, visible);
    if (!visible) interaction.commit();
    paintButton();
    s.requestDraw();
  }
  paintButton();

  function clear() {
    if (!drawn) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawn = false;
  }
  let previousFrame, viewKey;
  function frame() {
    request = 0;
    if (disposed) return;
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const currentFrame = editor.playback.currentFrame;
    const sourceRect = viewport.canvas.getBoundingClientRect();
    const camera = viewport.camera;
    // Editing-camera controls, zoom/pan, layout, quality, and host mode flags
    // can change without property signals. Comparing this small state never
    // evaluates an animated Position channel or an ancestor transform.
    const key = JSON.stringify([rect.left, rect.top, rect.width, rect.height, dpr,
      sourceRect.left, sourceRect.top, sourceRect.width, sourceRect.height,
      viewport.renderMode, viewport.enabled, editor.enabled, viewport.__zoidiumPlayerPlusPaused,
      camera?.matrixWorld?.elements, camera?.projectionMatrix?.elements]);
    if (key !== viewKey) s.dirty = true;
    const moved = previousFrame !== currentFrame;
    let models = s.models;
    if (s.dirty || moved) {
      const rebuild = s.dirty;
      // Clear before evaluation so a signal emitted during collection is not lost.
      s.dirty = false;
      try {
        const paths = visible && canvas.isConnected ? targets.collect(s) : [];
        invalidation.sync(paths);
        const cached = new Map(models.map(model => [model.path.id, model]));
        models = paths.map(path => {
          const model = cached.get(path.id), previous = model?.path;
          if (!rebuild && previous && previous.projectionKey === path.projectionKey &&
              previous.startFrame === path.startFrame && previous.endFrame === path.endFrame &&
              !path.dynamicGeometry && previous.axes?.every((axis, index) => axis === path.axes[index])) {
            // Sampled positions, frame ticks, keys and handle projections stay
            // fixed when only the playhead moves, including in a static 3D view.
            model.path = path;
            overlay.updateCurrent(model);
            return model;
          }
          return overlay.build(path, s.easings, s.selection.get(path.id));
        }).filter(Boolean);
      } catch (error) {
        if (!s.warned) { s.warned = true; console.warn("[Zoidium] motion-path: the path could not be evaluated", error); }
        models = [];
      }
    } else {
      if (models.length) request = window.requestAnimationFrame(frame);
      return;
    }
    previousFrame = currentFrame;
    viewKey = key;
    for (const id of s.selection.keys()) if (!models.some(m => m.path.id === id)) s.selection.delete(id);
    s.models = models;
    interaction.check(models);
    if (!models.length) {
      clear();
      if (!interaction.active) canvas.style.pointerEvents = "none";
      return;
    }
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlay.draw(ctx, models, rect);
    drawn = true;
    if (!request) request = window.requestAnimationFrame(frame);
  }
  s.requestDraw();

}
module.exports = { install, STORAGE_KEY, SHORTCUT };
