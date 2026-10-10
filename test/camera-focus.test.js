"use strict";

// Camera+ focus tools: the focus expression method measures the distance
// between two project objects. The Depth of Field button opens a floating
// window that links, sets once, or unlinks the focus distance through history.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";
const CONTROL_ID = "camera-plus/focus-tools";

function setupScene() {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const scene = new ctx.PZ.layer.scene();
  const vanilla = scene.push(new ctx.PZ.object3d.camera());
  const cameraPlus = scene.push(ctx.registry.instantiate(TYPE));
  const sphere = new ctx.PZ.object3d();
  sphere.threeObj = new ctx.THREE.Object3D();
  sphere.properties.name.set("Sphere");
  scene.push(sphere);
  const box = new ctx.PZ.object3d();
  box.threeObj = new ctx.THREE.Object3D();
  box.properties.name.set("Box");
  scene.push(box);
  for (const object of [vanilla, cameraPlus, sphere, box]) {
    ctx.project.register(object.getAddress(), object);
  }
  cameraPlus.threeObj.position.set(0, 0, 80);
  sphere.threeObj.position.set(0, 0, 0);
  box.threeObj.position.set(30, 40, 0);
  // The expression method and the focus tools resolve the project through
  // the active editor (globalThis.CM in the browser).
  globalThis.CM = ctx.editor;
  return { ctx, runtime, scene, vanilla, cameraPlus, sphere, box };
}

function teardownGlobals() {
  delete globalThis.CM;
}

// The property control builds a button row; its first button opens the window.
function pressFocusButton(ctx) {
  const spec = ctx.apis.propertyControls.registered.get(CONTROL_ID);
  const row = ctx.zoidiumUI.rows.length;
  const control = spec.create(ctx.lastFocusProperty, {
    document: { createElement: () => ({ className: "", appendChild() {} }) },
  });
  assert.ok(control, "control element built");
  const built = ctx.zoidiumUI.rows[ctx.zoidiumUI.rows.length - 1];
  assert.equal(ctx.zoidiumUI.rows.length, row + 1);
  built.buttons.find(button => button.title === "Focus Tools...").onClick();
  return ctx.zoidiumUI.windows[ctx.zoidiumUI.windows.length - 1];
}

function mountWindow(ctx, win) {
  const body = { children: [], appendChild(child) { this.children.push(child); return child; } };
  win.options.mount(body);
  return ctx.zoidiumUI.lists[ctx.zoidiumUI.lists.length - 1];
}

test("the focus control is a TEXT property control that is removed on disable", () => {
  const { ctx, runtime } = setupScene();
  const spec = ctx.apis.propertyControls.registered.get(CONTROL_ID);
  assert.ok(spec, "control registered");
  assert.equal(spec.type, ctx.PZ.property.type.TEXT);
  runtime.deactivate();
  assert.equal(ctx.apis.propertyControls.registered.has(CONTROL_ID), false);
  teardownGlobals();
});

test("focusDistanceTo measures the world distance between two project objects", () => {
  const { ctx, runtime, cameraPlus, sphere } = setupScene();
  const method = ctx.PZ.expression.methods.focusDistanceTo;
  assert.equal(typeof method, "function");
  assert.equal(method(cameraPlus.getAddress(), sphere.getAddress()), 80);
  assert.equal(method([9, 9], sphere.getAddress()), 0, "unknown address yields zero");
  runtime.deactivate();
  assert.equal(ctx.PZ.expression.methods.focusDistanceTo, undefined, "method removed on disable");
  teardownGlobals();
});

test("the Depth of Field button opens one focus window and lists only other objects in the scene", () => {
  const { ctx, runtime, cameraPlus, scene } = setupScene();
  ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
  const win = pressFocusButton(ctx);
  assert.equal(win.options.id, "focus:1");
  assert.equal(win.options.footer.length, 3);
  const picker = mountWindow(ctx, win);
  const titles = picker.options.items.map((item) => item.title).sort();
  assert.deepEqual(titles, ["Box", "Sphere"], "Camera and Camera+ objects are not targets");
  assert.equal(picker.options.items.every((item) => item.detail === scene.properties.name.get()), true);

  pressFocusButton(ctx);
  assert.equal(ctx.zoidiumUI.windows[ctx.zoidiumUI.windows.length - 1].options.id, "focus:1", "same camera reuses its window id");
  runtime.deactivate();
  teardownGlobals();
});

test("Link writes a focusDistanceTo expression built from both addresses inside one history operation", () => {
  const { ctx, runtime, cameraPlus, sphere } = setupScene();
  ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
  const win = pressFocusButton(ctx);
  const picker = mountWindow(ctx, win);

  win.options.footer[0].onClick();
  assert.equal(ctx.editor.log.filter((entry) => entry[0] === "setExpression").length, 0, "no target, no link");

  const sphereItem = picker.options.items.find((item) => item.title === "Sphere");
  picker.options.onSelect(sphereItem.id);
  ctx.editor.log.length = 0;
  win.options.footer[0].onClick();

  const expected = "focusDistanceTo(" + JSON.stringify(cameraPlus.getAddress()) + ", " + JSON.stringify(sphere.getAddress()) + ")";
  assert.deepEqual(ctx.editor.log.map((entry) => entry[0]), ["start", "setExpression", "finish"]);
  assert.deepEqual(ctx.editor.log[1][1], cameraPlus.properties.depthOfField.focusDistance.getAddress());
  assert.equal(ctx.editor.log[1][2], expected);
  runtime.deactivate();
  teardownGlobals();
});

test("Set Once writes the current distance as a keyframe at the playhead", () => {
  const { ctx, runtime, cameraPlus, sphere } = setupScene();
  ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
  const win = pressFocusButton(ctx);
  const picker = mountWindow(ctx, win);
  picker.options.onSelect(picker.options.items.find((item) => item.title === "Sphere").id);
  ctx.editor.log.length = 0;
  win.options.footer[1].onClick();
  const value = ctx.editor.log.find((entry) => entry[0] === "setValue");
  assert.ok(value, "value written");
  assert.equal(value[2], ctx.editor.playback.currentFrame, "frame is the playhead");
  assert.equal(value[3], 80, "distance from camera to sphere");
  assert.equal(ctx.editor.log.some((entry) => entry[0] === "setExpression"), false, "no expression touched without one");
  void sphere;
  runtime.deactivate();
  teardownGlobals();
});

test("Unlink clears the expression and leaves the stored value alone", () => {
  const { ctx, runtime, cameraPlus } = setupScene();
  ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
  const win = pressFocusButton(ctx);
  ctx.editor.log.length = 0;
  win.options.footer[2].onClick();
  const cleared = ctx.editor.log.find((entry) => entry[0] === "setExpression");
  assert.ok(cleared);
  assert.equal(cleared[2], null);
  assert.equal(ctx.editor.log.some((entry) => entry[0] === "setValue"), false);
  runtime.deactivate();
  teardownGlobals();
});

test("the focus window closes when its camera leaves the scene", () => {
  const { ctx, runtime, cameraPlus, scene } = setupScene();
  ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
  const win = pressFocusButton(ctx);
  assert.equal(win.options.isValid(), true);
  scene.objects.splice(scene.objects.indexOf(cameraPlus), 1);
  cameraPlus.parent = null;
  assert.equal(win.options.isValid(), false);
  runtime.deactivate();
  teardownGlobals();
});


test("direct Link and Set pickers perform one action and close; Unlink needs no picker", () => {
  const { ctx, runtime, cameraPlus } = setupScene();
  try {
    ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
    pressFocusButton(ctx);
    const buttons = ctx.zoidiumUI.rows.at(-1).buttons;
    for (const title of ["Link", "Set"]) {
      buttons.find(button => button.title === title).onClick();
      const win = ctx.zoidiumUI.windows.at(-1);
      assert.equal(win.options.title, title + " focus distance to...");
      const picker = mountWindow(ctx, win);
      ctx.editor.log.length = 0;
      picker.options.onSelect(picker.options.items[0].id);
      assert.equal(win.closed, true);
      assert.equal(ctx.editor.log.filter(entry => entry[0] === "start").length, 1);
      assert.equal(ctx.editor.log.filter(entry => entry[0] === "finish").length, 1);
    }
    const count = ctx.zoidiumUI.windows.length;
    buttons.find(button => button.title === "Unlink").onClick();
    assert.equal(ctx.zoidiumUI.windows.length, count);
    assert.equal(ctx.editor.log.at(-2)[0], "setExpression");
  } finally { runtime.deactivate(); teardownGlobals(); }
});

test("Set creates a missing playhead key and enables animation in the same operation", () => {
  const { ctx, runtime, cameraPlus } = setupScene();
  const OriginalOps = ctx.PZ.ui.properties;
  ctx.PZ.ui.properties = class extends OriginalOps {
    createKeyframe(op) { this.editor.log.push(["createKeyframe", op]); }
    toggleAnimation(property, frame, expression, enabled) { this.editor.log.push(["animate", frame, enabled]); }
  };
  try {
    const property = cameraPlus.properties.depthOfField.focusDistance;
    property.getKeyframe = () => null;
    property.frameOffset = 12;
    property.expression = { source: "old expression" };
    property.animated = false;
    ctx.editor.playback.currentFrame = 42;
    ctx.lastFocusProperty = cameraPlus.properties.depthOfField.focusTools;
    const win = pressFocusButton(ctx);
    const picker = mountWindow(ctx, win);
    picker.options.onSelect(picker.options.items[0].id);
    ctx.editor.log.length = 0;
    win.options.footer[1].onClick();
    assert.deepEqual(ctx.editor.log.map(entry => entry[0]), ["start", "setExpression", "createKeyframe", "animate", "finish"]);
    assert.equal(ctx.editor.log[2][1].data.frame, 30);
    assert.equal(ctx.editor.log[2][1].data.value, 80);
  } finally { runtime.deactivate(); teardownGlobals(); }
});
