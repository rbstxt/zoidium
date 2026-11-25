"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const SOURCE = "plugins/core/timeline-ruler-drag.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...init,
    };
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
    return event;
  }
}

class FakeRuler extends FakeTarget {
  constructor(rect, clientWidth) {
    super();
    this.style = {};
    this.rect = { ...rect };
    this.clientWidth = clientWidth;
    this.captured = new Set();
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.captured.has(pointerId);
  }
}

// The patch must replace the native mouse/touch start and own the drag through
// pointer events. The fake ruler records listeners and implements pointer
// capture so the test can prove both sides.
function setup(options = {}) {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  doc.defaultView = win;

  function Timeline() {}

  Timeline.prototype.create = function () {
    const ruler = new FakeRuler(options.rect ?? { left: 200, width: 400 }, options.clientWidth ?? 400);
    ruler.ownerDocument = doc;
    this.timerule = ruler;
    this.scrollBar = { scrollLeft: options.scrollLeft ?? 0, clientWidth: 400 };
    this.scroll = options.scroll ?? 0;
    this.zoom = options.zoom ?? 1;
    this.frameRate = options.frameRate ?? 30;
    this.totalFrames = options.totalFrames ?? 1000;
    this.focusCalls = 0;
    this.el = { focus: () => { this.focusCalls += 1; } };
    this.px = [];
    this.frames = [];
    this.currentFrame = 0;
    this.setFrame = px => {
      this.px.push(px);
      options.keepInView?.(this, px);
      const frame = Math.round(px / 400 * this.frameRate / this.zoom);
      this.currentFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
      this.frames.push(this.currentFrame);
    };
    this.timerule_drag = { startfn_bound() {}, dragging: false };
    // The native constructor installs these; the patch must remove them.
    ruler.addEventListener("mousedown", this.timerule_drag.startfn_bound);
    ruler.addEventListener("touchstart", this.timerule_drag.startfn_bound);
  };

  vm.runInNewContext(fs.readFileSync(SOURCE, "utf8"), {
    window: Object.assign(win, {
      PZ: { ui: { timeline: Timeline } },
      requestAnimationFrame: () => null,
      cancelAnimationFrame: () => {},
    }),
  });

  const timeline = new Timeline();
  timeline.create();
  return { timeline, ruler: timeline.timerule, win, doc };
}

function press(ruler, clientX, pointerId = 1, extra = {}) {
  return ruler.dispatch("pointerdown", { pointerId, button: 0, buttons: 1, clientX, isPrimary: true, ...extra });
}

function move(ruler, clientX, pointerId = 1, buttons = 1) {
  return ruler.dispatch("pointermove", { pointerId, buttons, clientX });
}

test("a pointer drag replaces the native start and seeks from the current rectangle", () => {
  const { timeline, ruler } = setup();
  assert.equal(ruler.count("mousedown"), 0);
  assert.equal(ruler.count("touchstart"), 0);
  assert.equal(ruler.style.touchAction, "none");

  const down = press(ruler, 300, 7);
  assert.equal(down.defaultPrevented, true);
  assert.equal(ruler.hasPointerCapture(7), true);
  assert.equal(timeline.timerule_drag.dragging, true);
  assert.equal(timeline.focusCalls, 1);
  assert.equal(timeline.px.at(-1), 100);

  move(ruler, 350, 7);
  assert.equal(timeline.px.at(-1), 150);

  const up = ruler.dispatch("pointerup", { pointerId: 7 });
  assert.equal(up.defaultPrevented, true);
  assert.equal(timeline.timerule_drag.dragging, false);
  assert.equal(ruler.hasPointerCapture(7), false);
});

test("a touch pointer scrubs through the same pointer path", () => {
  const { timeline, ruler } = setup();
  press(ruler, 280, 2, { pointerType: "touch" });
  move(ruler, 320, 2);
  assert.equal(timeline.px.at(-1), 120);
  ruler.dispatch("pointerup", { pointerId: 2, pointerType: "touch" });
  assert.equal(timeline.timerule_drag.dragging, false);
});

test("a scaled ruler maps screen coordinates to timeline pixels", () => {
  const { timeline, ruler } = setup({ rect: { left: 400, width: 320 }, clientWidth: 400 });
  press(ruler, 570);
  assert.equal(timeline.px.at(-1), 212.5);
});

test("window blur ends the drag and later moves are ignored", () => {
  const { timeline, ruler, win, doc } = setup();
  press(ruler, 300);
  move(ruler, 320);
  assert.equal(timeline.px.at(-1), 120);

  win.dispatch("blur");
  assert.equal(timeline.timerule_drag.dragging, false);
  assert.equal(ruler.hasPointerCapture(1), false);
  assert.equal(win.count("blur"), 0);
  assert.equal(doc.count("keydown"), 0);

  const before = timeline.px.length;
  move(ruler, 390);
  assert.equal(timeline.px.length, before);
  assert.equal(timeline.px.at(-1), 120);
});

test("lostpointercapture ends the drag and later moves are ignored", () => {
  const { timeline, ruler } = setup();
  press(ruler, 300, 3);
  move(ruler, 340, 3);
  assert.equal(timeline.px.at(-1), 140);

  ruler.dispatch("lostpointercapture", { pointerId: 3 });
  assert.equal(timeline.timerule_drag.dragging, false);

  const before = timeline.px.length;
  move(ruler, 390, 3);
  assert.equal(timeline.px.length, before);
  assert.equal(timeline.px.at(-1), 140);
});

test("a move with no pressed buttons ends the drag", () => {
  const { timeline, ruler } = setup();
  press(ruler, 300);
  move(ruler, 340);
  assert.equal(timeline.px.at(-1), 140);

  move(ruler, 500, 1, 0);
  assert.equal(timeline.timerule_drag.dragging, false);
  assert.equal(timeline.px.at(-1), 140);
  assert.equal(ruler.hasPointerCapture(1), false);

  const before = timeline.px.length;
  move(ruler, 520);
  assert.equal(timeline.px.length, before);
});

test("Escape ends the drag but other keys keep it active", () => {
  const { timeline, ruler, doc } = setup();
  press(ruler, 300);
  doc.dispatch("keydown", { key: "a" });
  assert.equal(timeline.timerule_drag.dragging, true);
  doc.dispatch("keydown", { key: "Escape" });
  assert.equal(timeline.timerule_drag.dragging, false);
  assert.equal(ruler.hasPointerCapture(1), false);
});

test("a stale timeline.scroll does not offset the frame", () => {
  const { timeline, ruler } = setup({ scroll: 500, scrollLeft: 120 });
  press(ruler, 280);
  assert.equal(timeline.px.at(-1), 200);
  assert.equal(timeline.scroll, 500);

  move(ruler, 300);
  assert.equal(timeline.px.at(-1), 220);
  ruler.dispatch("pointerup", { pointerId: 1 });
  // The drag end copies the live scrollbar position into the native field.
  assert.equal(timeline.scroll, 120);
});

test("a changing rectangle, scale, scroll and zoom still map exactly", () => {
  const { timeline, ruler } = setup();
  press(ruler, 300);
  assert.equal(timeline.px.at(-1), 100);

  ruler.rect = { left: 280, width: 320 };
  timeline.zoom = 1.5;
  timeline.scrollBar.scrollLeft = 55;
  move(ruler, 460);
  assert.equal(timeline.px.at(-1), 280);
  assert.equal(timeline.currentFrame, 14);
});

test("keepInView scrolling feeds the next move without a stale offset", () => {
  const { timeline, ruler } = setup({
    keepInView: (panel, px) => { panel.scrollBar.scrollLeft = px - 20; },
  });
  press(ruler, 300);
  assert.equal(timeline.px.at(-1), 100);
  move(ruler, 310);
  // keepInView moved the scrollbar to 80; the same pointer now sits at 80 + 110.
  assert.equal(timeline.px.at(-1), 190);
});

test("destroy ends the drag and removes every listener", () => {
  const { timeline, ruler, win, doc } = setup();
  press(ruler, 300);
  assert.equal(ruler.count("pointermove"), 1);
  assert.equal(win.count("blur"), 1);
  assert.equal(doc.count("keydown"), 1);

  timeline.destroy();
  assert.equal(timeline.timerule_drag.dragging, false);
  assert.equal(ruler.hasPointerCapture(1), false);
  assert.equal(ruler.count("pointerdown"), 0);
  assert.equal(ruler.count("pointermove"), 0);
  assert.equal(ruler.count("pointerup"), 0);
  assert.equal(ruler.count("pointercancel"), 0);
  assert.equal(ruler.count("lostpointercapture"), 0);
  assert.equal(win.count("blur"), 0);
  assert.equal(doc.count("keydown"), 0);

  const before = timeline.px.length;
  press(ruler, 500);
  assert.equal(timeline.px.length, before);
});
