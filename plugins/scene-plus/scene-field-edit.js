"use strict";

const math = require("./scene-field-edit-math.js");

// Transient editor state. No property definitions or project records are added.
function installFieldEdit(PZ, THREE) {
  const controls = PZ.ui?.controls, originalInput = controls?.generateInput3;
  const editor = globalThis.CM, ui = globalThis.ZoidiumUI;
  const viewport = editor?.mainViewport;
  if (!originalInput || !viewport?.canvas || !ui?.controls) return { isEditing: () => false, dispose() {} };
  const document = viewport.canvas.ownerDocument, window = document.defaultView;
  const propertyOps = new PZ.ui.properties(editor);
  const views = new Set();
  const originalCursor = viewport.canvas.style.cursor;
  let owner = null, drag = null, disposed = false;
  let hiddenControls = null;

  function selection() {
    const objects = viewport.helper3d?.objects;
    return objects?.length === 1 ? objects[0] : null;
  }
  function isEditing(target) { return !disposed && !!target && owner === target && selection() === target && viewport.renderMode; }
  function refresh() {
    for (const reference of views) {
      const view = reference.deref();
      if (!view) { views.delete(reference); continue; }
      view.toggle.set(isEditing(view.owner));
      view.hint.hidden = !isEditing(view.owner);
    }
    if (owner) {
      if (!hiddenControls) hiddenControls = { controls: viewport.widget3d.controls, visible: viewport.widget3d.controls.visible };
      hiddenControls.controls.visible = false;
      viewport.canvas.style.cursor = "move";
    } else {
      if (hiddenControls) hiddenControls.controls.visible = hiddenControls.visible;
      hiddenControls = null;
      viewport.canvas.style.cursor = originalCursor;
    }
  }
  function setOwner(target) {
    finish(true);
    owner = target && selection() === target && viewport.renderMode ? target : null;
    refresh();
  }
  function patchedInput(property) {
    const element = originalInput.apply(this, arguments);
    const target = property.parentObject;
    if (property !== target?.properties?.fieldPosition || !target?.threeObj?.__zoidiumEffectorOwner) return element;
    const toggle = ui.controls.checkbox({ label: "Edit field in viewport", value: isEditing(target),
      onChange: enabled => setOwner(enabled ? target : null) });
    toggle.element.style.cssText = "grid-template-columns:minmax(0,1fr) auto;padding:3px 0;width:190px;max-width:100%";
    toggle.element.querySelector(".zoidium-field-label").style.whiteSpace = "normal";
    const hint = document.createElement("div");
    hint.textContent = "Drag to move. Shift-drag to rotate. Alt-drag to resize. Escape to cancel.";
    hint.style.cssText = "color:var(--zui-text-muted);font-size:var(--zui-font-size-small);white-space:normal;width:190px;max-width:100%;overflow-wrap:break-word";
    hint.hidden = !isEditing(target);
    element.append(toggle.element, hint);
    const view = { owner: target, toggle, hint };
    // The DOM owns this view; weak references do not retain deleted objects.
    toggle.element.__zoidiumFieldView = view;
    views.add(new WeakRef(view));
    return element;
  }
  controls.generateInput3 = patchedInput;

  function consume(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function start(event) {
    if (event.button !== 0 || event.target !== viewport.canvas || !isEditing(owner) || editor.history.operation !== null) return;
    const mode = event.altKey ? "scale" : event.shiftKey ? "rotation" : "position";
    const property = owner.properties[{ position: "fieldPosition", rotation: "fieldRotation", scale: "fieldScale" }[mode]];
    const axes = property.objects || [property];
    if (property.expression || axes.some(axis => axis.definition.readOnly || axis.expression)) return;
    const frame = editor.playback.currentFrame - property.frameOffset;
    const camera = viewport.camera; // renderMode renders this camera, not the project camera.
    camera.updateMatrixWorld(true);
    owner.threeObj.updateMatrixWorld(true);
    const world = Array.from(owner.threeObj.matrixWorld.elements);
    if (!math.localDelta([0, 0, 0], [0, 0, 0], world)) return;
    const position = owner.properties.fieldPosition.get(frame).slice();
    const center = math.transformPoint(world, position);
    const cameraWorld = Array.from(camera.matrixWorld.elements);
    const normal = [cameraWorld[8], cameraWorld[9], cameraWorld[10]];
    const projectionInverse = Array.from(new THREE.Matrix4().getInverse(camera.projectionMatrix).elements);
    const rect = viewport.canvas.getBoundingClientRect();
    const screen = [event.clientX, event.clientY];
    const point = math.viewPlanePoint(screen, rect, cameraWorld, projectionInverse, center, normal);
    if (!point) return;
    const projected = new THREE.Vector3(...center).project(camera);
    const screenCenter = [rect.left + (projected.x + 1) * rect.width / 2, rect.top + (1 - projected.y) * rect.height / 2];
    const initialValue = property.get(frame).slice();
    editor.history.startOperation();
    // Vector groups have independent animated axes, just like CM3's typed row.
    for (const axis of axes) propertyOps.startEdit(axis, frame);
    drag = { target: owner, mode, property, frame, initialValue, world, cameraWorld, projectionInverse, center,
      normal, rect, screen, point, screenCenter, changed: false };
    consume(event);
  }
  function move(event) {
    if (!drag) return;
    const d = drag, screen = [event.clientX, event.clientY];
    let value;
    if (d.mode === "position") {
      const point = math.viewPlanePoint(screen, d.rect, d.cameraWorld, d.projectionInverse, d.center, d.normal);
      const delta = point && math.localDelta(d.point, point, d.world);
      if (!delta) return;
      value = d.initialValue.map((v, i) => v + delta[i]);
    } else if (d.mode === "rotation") {
      const axis = math.localViewAxis(d.normal, d.world);
      value = math.rotateField(d.initialValue, axis, math.screenAngle(d.screen, screen, d.screenCenter));
    } else value = math.resizeField(d.initialValue, screen.map((v, i) => v - d.screen[i]));
    d.changed = value.some((v, i) => Math.abs(v - d.initialValue[i]) > 1e-9);
    d.property.set(value, d.frame);
    consume(event);
  }
  function finish(cancel = false) {
    if (!drag) return;
    const d = drag; drag = null;
    propertyOps.setValue({ property: d.property.getAddress(), frame: d.frame, oldValue: d.initialValue });
    if (cancel || !d.changed) editor.history.discardOperation();
    else editor.history.finishOperation();
  }
  function end(event) {
    if (!drag || event.button !== 0) return;
    move(event); finish(); consume(event);
  }
  function key(event) {
    if (event.key !== "Escape" || !owner) return;
    if (drag) finish(true); else setOwner(null);
    consume(event);
  }
  function changed() { if (owner && (!isEditing(owner) || owner.parentProject !== editor.project)) setOwner(null); }
  function blur() { finish(true); }
  // Capture before native camera and object controls. With the toggle off,
  // every event follows CM3's untouched path.
  viewport.canvas.addEventListener("mousedown", start, true);
  document.addEventListener("mousemove", move, true);
  document.addEventListener("mouseup", end, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("blur", blur);
  const observables = [viewport.helper3d.objects?.onListChanged, viewport.onEditChanged, editor.onProjectChanged];
  for (const observable of observables) observable?.watch(changed);

  return { isEditing, dispose() {
    if (disposed) return;
    setOwner(null); disposed = true;
    viewport.canvas.removeEventListener("mousedown", start, true);
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("mouseup", end, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", blur);
    for (const observable of observables) observable?.unwatch(changed);
    if (controls.generateInput3 === patchedInput) controls.generateInput3 = originalInput;
    for (const reference of views) {
      const view = reference.deref();
      view?.toggle.element.remove(); view?.hint.remove();
    }
    views.clear();
  } };
}

module.exports = { installFieldEdit };
