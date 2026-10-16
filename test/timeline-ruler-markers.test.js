"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.style = { pointerEvents: "", cursor: "", backgroundColor: "", display: "" };
    this.attributes = new Map(); this.listeners = new Map();
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set title(value) { this.setAttribute("title", value); }
  get title() { return this.getAttribute("title") || ""; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  getElementsByClassName(name) {
    return this.children.flatMap(child => [...(child.classList.contains(name) ? [child] : []), ...child.getElementsByClassName(name)]);
  }
}
function setup(withRow = true) {
  const cleanups = [], observers = [], events = [], panels = [];
  const document = { querySelectorAll: () => panels };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  class Keyframes {
    constructor(timeline) {
      this.timeline = timeline;
      this.container = new Element(document);
      this.keyframe_drag = {
        startfn_bound: event => {
          events.push({ type: "native-start", event });
          this.deselectAll(); this.selectKeyframe(event.currentTarget);
          this.keyframe_drag.dragging = true;
          events.push("native-focus");
        },
        endfn_bound: event => { events.push({ type: "native-end", event }); this.keyframe_drag.dragging = false; },
      };
    }
    createKeyframeTrack(container, property) {
      const track = container.appendChild(new Element(document));
      track.pz_object = property; track.pz_label = new Element(document);
      for (const marker of property.keyframes) {
        const key = track.appendChild(new Element(document));
        key.pz_object = marker; key.classList.add("kfobject");
      }
      events.push("create-native-track");
      return track;
    }
    unloadKeyframeTrack(track) { events.push("unload-native-track"); track.remove(); }
    selectKeyframe(element) { element.classList.add("selected"); }
    deselectKeyframe(element) { element.classList.remove("selected"); }
    deselectAll() { for (const element of this.container.getElementsByClassName("kfobject")) this.deselectKeyframe(element); }
    objectsChanged() { for (const track of this.container.children.slice()) this.unloadKeyframeTrack(track); }
    keydown() { events.push("native-keydown"); }
    keyframeDragEnd() { events.push("native-drag-end"); }
  }
  class Timeline {
    constructor() {
      this.sequence = { properties: { markers: { keyframes: [{ frame: 0, value: "1" }, { frame: 30, value: "2" }] } } };
      this.el = new Element(document); this.el.pz_panel = this; panels.push(this.el);
      this.create(); this.keyframes = new Keyframes(this);
      if (withRow) this.keyframes.createKeyframeTrack(this.keyframes.container, this.sequence.properties.markers);
      this.redrawMarkers();
    }
    create() { this.timerule = new Element(document); this.markers = []; }
    redrawMarkers() {
      for (const marker of this.markers) marker.remove();
      this.markers = this.sequence.properties.markers.keyframes.map(marker => {
        const label = new Element(document); label.pz_marker = marker;
        label.style.pointerEvents = "none";
        this.timerule.appendChild(label); return label;
      });
    }
    frameToPx(frame) { return frame * 4; }
    setFrame(pixel) { this.frame = pixel / 4; }
  }
  Timeline.keyframes = Keyframes;
  const timeline = new Timeline();
  const originals = { create: Timeline.prototype.create, redraw: Timeline.prototype.redrawMarkers, select: Keyframes.prototype.selectKeyframe };
  const realm = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/timeline-ruler-markers.js"), "utf8"), realm);
  realm.module.exports.activate({ PZ: { ui: { timeline: Timeline } }, document, window: { MutationObserver: Observer },
    lifecycle: { onDispose: callback => cleanups.push(callback) } });
  const down = (label, options = {}) => {
    const event = { target: label, pageX: 128, pageY: 690, button: 0, shiftKey: false, altKey: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
    timeline.timerule.listeners.get("mousedown")(event);
    return event;
  };
  return { timeline, Timeline, Keyframes, observers, events, down, originals, dispose: () => cleanups.forEach(callback => callback()) };
}

test("ruler press selects the actual native marker, seeks its exact frame, and delegates the gesture", () => {
  const { timeline, down, events } = setup();
  const label = timeline.markers[1];
  const event = down(label, { shiftKey: true, altKey: true, ctrlKey: true, metaKey: true });
  assert.equal(timeline.frame, 30);
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  const forwarded = events.find(event => event.type === "native-start").event;
  assert.equal(forwarded.currentTarget.pz_object, label.pz_marker);
  assert.equal(forwarded.pageX, 128); assert.equal(forwarded.pageY, 690);
  for (const key of ["shiftKey", "altKey", "ctrlKey", "metaKey"]) assert.equal(forwarded[key], true);
  assert.equal(label.getAttribute("aria-pressed"), "true");
  assert.equal(label.style.pointerEvents, "auto");
  assert.equal(events.includes("native-focus"), true, "native keyframe focus keeps Delete on the property operations");
  timeline.keyframes.deselectAll();
  assert.equal(label.getAttribute("aria-pressed"), "false");
});

test("a hidden native row supports ruler operations while other properties own the visible rows", () => {
  const { timeline, down, events, dispose } = setup(false);
  down(timeline.markers[1]);
  assert.equal(events.filter(event => event === "create-native-track").length, 1);
  const track = timeline.keyframes.container.children[0];
  assert.equal(track.style.height, "0px"); assert.equal(track.pz_label.style.height, "0px");
  assert.equal(track.style.visibility, "hidden"); assert.notEqual(track.style.display, "none");
  // Native movement can recreate the keyframe and reveal its track.
  track.style.height = "20px"; track.pz_label.style.height = "20px";
  timeline.keyframes.keyframeDragEnd.call({ ctx: timeline.keyframes });
  assert.equal(track.style.height, "0px"); assert.equal(track.pz_label.style.height, "0px");
  assert.equal(track.style.visibility, "hidden"); assert.notEqual(track.style.display, "none");
  dispose();
  assert.equal(track.parentElement, null);
  assert.equal(events.filter(event => event === "unload-native-track").length, 1);
  assert.equal(events.some(event => event.type === "native-end"), true, "finish active history before unloading its row");
});

test("bound redraws and future timelines get interactive labels without observing per-frame label text", () => {
  const { timeline, Timeline, observers, originals } = setup();
  originals.redraw.call(timeline);
  const label = timeline.markers[1];
  assert.equal(label.style.pointerEvents, "none");
  observers[0].callback();
  assert.equal(label.style.pointerEvents, "auto");
  assert.equal(observers[0].options.childList, true);
  assert.equal(observers[0].options.subtree, undefined);
  const next = new Timeline();
  assert.equal(next.markers[0].style.pointerEvents, "auto");
});

test("right presses and stale labels keep native ruler handling", () => {
  const { timeline, down, events } = setup();
  assert.equal(down(timeline.markers[0], { button: 2 }).stopped, undefined);
  timeline.sequence.properties.markers.keyframes = [];
  assert.equal(down(timeline.markers[0]).stopped, undefined);
  assert.equal(events.some(event => event.type === "native-start"), false);
});

test("dispose restores labels, observers and owned prototypes while preserving a later patch", () => {
  const { timeline, Timeline, Keyframes, observers, originals, dispose } = setup();
  const label = timeline.markers[0];
  const foreign = () => {};
  Keyframes.prototype.selectKeyframe = foreign;
  dispose();
  assert.equal(label.style.pointerEvents, "none");
  assert.equal(label.style.cursor, ""); assert.equal(label.style.backgroundColor, "");
  assert.equal(label.getAttribute("title"), null); assert.equal(label.getAttribute("aria-pressed"), null);
  assert.equal(timeline.timerule.listeners.size, 0);
  assert.equal(observers[0].disconnected, true);
  assert.equal(Timeline.prototype.create, originals.create);
  assert.equal(Timeline.prototype.redrawMarkers, originals.redraw);
  assert.equal(Keyframes.prototype.selectKeyframe, foreign);
});
