"use strict";
// Which Position properties get a motion path, and in which space.
const projection = require("./projection.js");

function positionGroup(PZ, owner, size) {
  const group = owner?.properties?.position;
  if (!(group instanceof PZ.property.dynamic.group) || group.expression) return null;
  const axes = Array.from(group.objects);
  if (axes.length < size || !axes.slice(0, size).every(axis => axis instanceof PZ.property.dynamic.keyframes)) return null;
  const channels = axes.slice(0, size);
  // A path needs at least one keyed (not expression-driven) axis.
  if (!channels.some(axis => axis.animated && !axis.expression)) return null;
  return { group, axes: channels };
}
function expressionDriven(owner) {
  if (!owner) return false;
  if (owner.expression) return true;
  return Array.from(owner.objects || []).some(expressionDriven);
}
function dynamicGeometry(PZ, owner) {
  for (let node = owner, depth = 0; node && depth < 64; node = node.parentObject, depth++) {
    const p = node.properties || {};
    if ([p.position, p.rotation, p.scale].some(expressionDriven)) return true;
    if (!(node.parentObject instanceof PZ.object3d)) break;
  }
  return false;
}
function clipState(editor, PZ, clip) {
  if (!(clip instanceof PZ.clip.video) || clip.tryGetParentOfType(PZ.sequence) !== editor.sequence) return null;
  const frame = editor.playback.currentFrame;
  // Same span guard as Shape+'s editableClip: the clip must be on screen.
  if (!(frame >= clip.start && frame < clip.start + clip.length)) return null;
  return { frame, local: frame - clip.start + (clip.offset || 0) };
}
function rect(element) {
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}
function layerPath(context, clip, state) {
  const { PZ, editor, viewport } = context, layer = clip.object;
  const position = positionGroup(PZ, layer, 2);
  const canvasRect = rect(viewport.canvas);
  if (!position || !canvasRect) return null;
  const mapping = projection.sequenceMapping(canvasRect, editor.sequence.properties.resolution.get());
  if (!mapping) return null;
  return {
    id: clip, kind: "2d", owner: layer, clip, ...position, local: state.local, length: clip.length, startFrame: clip.offset || 0, endFrame: (clip.offset || 0) + clip.length,
    dynamicGeometry: expressionDriven(position.group),
    space: projection.planarSpace(mapping),
    projectionKey: JSON.stringify([canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height, mapping.ratio]),
  };
}
function sceneClip(PZ, object) {
  const layer = object.tryGetParentOfType?.(PZ.layer.scene);
  const clip = layer?.parentObject;
  return layer && clip instanceof PZ.clip ? { layer, clip } : null;
}
function findCameraObject(PZ, objects, camera, depth = 0) {
  for (const object of objects || []) {
    if (object.threeObj === camera) return object;
    if (depth < 32 && object.objects) {
      const found = findCameraObject(PZ, object.objects, camera, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
// The camera that draws the viewport: CM3's editing camera when the edit
// view shows this scene, otherwise the scene's own camera composited by the
// layer transform.
function cameraFor(context, layer, clip, local) {
  const { PZ, THREE, editor, viewport } = context;
  const canvasRect = rect(viewport.canvas);
  if (!canvasRect) return null;
  if (viewport.renderMode) {
    if (viewport.layer !== layer) return null;
    const camera = viewport.camera;
    camera.updateMatrixWorld();
    return { view: new THREE.Matrix4().getInverse(camera.matrixWorld), projection: camera.projectionMatrix, ndc: projection.canvasNdc(canvasRect),
      key: JSON.stringify([camera.matrixWorld.elements, camera.projectionMatrix.elements,
        canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height]) };
  }
  const camera = layer.pass?.camera;
  if (!camera) return null;
  const object = findCameraObject(PZ, layer.objects, camera);
  let world;
  if (object) {
    // A cached preview frame skips the live update, so evaluate the camera
    // at the playhead the same way the scene draw does.
    try { object.update(local); } catch (_error) { /* Keep the last drawn camera. */ }
    camera.updateMatrix();
    world = projection.ancestorMatrix(THREE, PZ, object, local).multiply(camera.matrix);
  } else {
    camera.updateMatrixWorld();
    world = camera.matrixWorld.clone();
  }
  const mapping = projection.sequenceMapping(canvasRect, editor.sequence.properties.resolution.get());
  const p = layer.properties;
  const position = p.position.get(local), scale = p.scale.get(local), rotation = p.rotation.get(local), resolution = p.resolution.get();
  const transform = projection.layerTransform(position, scale, rotation);
  const ndc = mapping && projection.layerNdc(mapping, resolution, transform);
  if (!ndc) return null;
  return { view: new THREE.Matrix4().getInverse(world), projection: camera.projectionMatrix, ndc,
    key: JSON.stringify([world.elements, camera.projectionMatrix.elements, position, scale, rotation, resolution,
      canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height, mapping.ratio]) };
}
function objectPaths(context) {
  const { PZ, THREE, editor, viewport } = context;
  const selection = Array.from(viewport.options?.helper3dObjects || []);
  const paths = [], cameras = new Map();
  for (const object of selection) {
    if (!(object instanceof PZ.object3d)) continue;
    const position = positionGroup(PZ, object, 3);
    const scene = position && sceneClip(PZ, object);
    const state = scene && clipState(editor, PZ, scene.clip);
    if (!state) continue;
    if (!cameras.has(scene.layer)) cameras.set(scene.layer, cameraFor(context, scene.layer, scene.clip, state.local));
    const camera = cameras.get(scene.layer);
    if (!camera) continue;
    const parent = projection.ancestorMatrix(THREE, PZ, object, state.local);
    if (Math.abs(parent.determinant()) < 1e-12) continue;
    paths.push({
      id: object, kind: "3d", owner: object, clip: scene.clip, ...position, local: state.local, length: scene.clip.length, startFrame: scene.clip.offset || 0, endFrame: (scene.clip.offset || 0) + scene.clip.length,
      dynamicGeometry: dynamicGeometry(PZ, object),
      projectionKey: camera.key,
      space: projection.cameraSpace(THREE, { parent, ...camera }),
      spaceAt: frame => projection.cameraSpace(THREE, { parent: projection.ancestorMatrix(THREE, PZ, object, frame), ...camera }),
    });
  }
  return paths;
}
function shapePlusActive(viewport) {
  return !!viewport.el.querySelector(":scope > .shape-plus-overlay");
}
// Visible paths for the current editor state. Hidden while exporting, while
// the viewport is paused, and (for layers) in the editing-camera view.
function collect(context) {
  const { PZ, editor, viewport } = context;
  if (editor.enabled === false || !viewport.enabled || viewport.__zoidiumPlayerPlusPaused || !editor.sequence) return [];
  const paths = [];
  const clips = viewport.objects;
  if (!viewport.renderMode && clips?.length === 1 && (viewport.widget2d?.edit || shapePlusActive(viewport))) {
    const clip = clips[0], state = clipState(editor, PZ, clip);
    const path = state && clip.object instanceof PZ.layer ? layerPath(context, clip, state) : null;
    if (path) paths.push(path);
  }
  paths.push(...objectPaths(context));
  return paths;
}
module.exports = { collect, positionGroup, findCameraObject };
