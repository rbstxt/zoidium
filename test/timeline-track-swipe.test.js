"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  const calls = { audio: 0, refreshLock: 0 };
  const listeners = {};
  const windowListeners = {};
  let hit;
  const listen = handlers => ({
    addEventListener(name, listener) { handlers[name] = listener; },
    removeEventListener(name) { delete handlers[name]; },
  });
  const doc = {
    ...listen(listeners),
    defaultView: listen(windowListeners),
    elementFromPoint: () => hit,
    createElement: tag => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
  };
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.ownerDocument = doc;
      this.style = {};
      this.children = [];
      this.attributes = {};
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name) };
    }
    get firstElementChild() { return this.children[0]; }
    get lastElementChild() { return this.children.at(-1); }
    appendChild(child) { this.insertBefore(child, null); }
    insertBefore(child, before) {
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      child.parentElement = this;
    }
    focus() { doc.activeElement = this; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parentElement?.closest(selector); }
  }

  function Tracks() {}
  Tracks.prototype.createTrackLabel = function () {
    const label = new Element("div");
    const eye = new Element("button");
    eye.appendChild(new Element("svg"));
    label.appendChild(new Element("span"));
    label.appendChild(eye);
    label.appendChild(new Element("button"));
    return label;
  };
  const undo = [], redo = [];
  const history = {
    operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn, arg) { this.operation.push(() => fn(arg)); },
    finishOperation() { if (this.operation.length) undo.push(this.operation); this.operation = null; },
    replay(from, to) {
      const commands = from.pop();
      this.operation = [];
      commands.slice().reverse().forEach(fn => fn());
      to.push(this.operation);
      this.operation = null;
    },
  };
  const tracks = [0, 1, 2, 3].map(i => ({ enabled: true, type: i === 3 ? 1 : 0, getAddress: () => i }));
  const editor = { history, project: { addressLookup: i => tracks[i], ui: { onChanged: { update() {} } } } };
  const panel = new Tracks();
  panel.timeline = { editor };
  const context = {
    PZ: { ui: { timeline: { tracks: Tracks } }, schedule: { zoidiumAnalyzeWithoutSeeking() { calls.audio++; } } },
    ZoidiumTrackSwitches: { refreshLock() { calls.refreshLock++; } },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync("plugins/core/timeline-track-swipe.js", "utf8"), context);
  const labels = tracks.map(track => panel.createTrackLabel(track, track.type));
  const base = { button: 0, pointerId: 1, stopPropagation() {}, preventDefault() {} };
  return {
    doc, tracks, editor, undo, redo, labels, calls,
    begin(button, extra) { button.onpointerdown({ ...base, currentTarget: button, ...extra }); },
    click(button, detail = 0) { button.onclick({ ...base, detail }); },
    move(target, pointerId = 1) { hit = target; listeners.pointermove({ pointerId }); },
    end(type = "pointerup") { listeners[type]({ type, pointerId: 1 }); },
    blur() { windowListeners.blur({ type: "blur" }); },
  };
}

test("video and audio rows place labeled solo and lock buttons between visibility and delete", () => {
  const { labels } = setup();
  for (const label of labels) {
    assert.deepEqual(label.children.map(node => node.tag), ["span", "button", "button", "button", "button"]);
    assert.deepEqual(label.children.slice(1, 4).map(node => node.attributes["aria-label"]), ["Disable track", "Solo track", "Lock track"]);
    assert.deepEqual(label.children.slice(1, 4).map(node => node.attributes["aria-pressed"]), ["true", "false", "false"]);
    assert.equal(label.style.gridTemplateColumns, "1fr auto auto auto auto");
    for (const button of label.children.slice(2, 4)) assert.equal(button.type, "button");
  }
});

for (const [column, field] of [[1, "enabled"], [2, "zoidiumSolo"], [3, "zoidiumLocked"]]) {
  test("a swipe changes three tracks in one history step for " + field, () => {
    const { labels, begin, move, end, click, tracks, undo, redo, editor, doc } = setup();
    const initial = column === 1 ? true : undefined;
    const desired = column !== 1;
    const buttons = labels.map(label => label.children[column]);
    begin(buttons[0], { pointerType: "touch" });
    assert.equal(doc.activeElement, buttons[0]);
    move(labels[1].children[column === 2 ? 3 : 2]);
    move(buttons[1].firstElementChild, 2);
    assert.equal(tracks[1][field], initial);
    move(buttons[1].firstElementChild);
    move(buttons[2]);
    move(buttons[0]);
    end();
    click(buttons[0], 1);
    assert.deepEqual(tracks.map(track => track[field]), [desired, desired, desired, initial]);
    assert.equal(undo.length, 1);
    editor.history.replay(undo, redo);
    assert.deepEqual(tracks.slice(0, 3).map(track => track[field]), Array(3).fill(!desired));
    editor.history.replay(redo, undo);
    assert.deepEqual(tracks.slice(0, 3).map(track => track[field]), Array(3).fill(desired));
  });
}

test("keyboard activation makes one edit and undo refreshes the switch state", () => {
  const { labels, click, editor, tracks, undo, redo, calls } = setup();
  const lock = labels[0].children[3];
  click(lock);
  assert.equal(tracks[0].zoidiumLocked, true);
  assert.equal(lock.attributes["aria-pressed"], "true");
  assert.equal(lock.title, "Unlock track");
  assert.equal(calls.refreshLock, 1);
  editor.history.replay(undo, redo);
  assert.equal(tracks[0].zoidiumLocked, false);
  assert.equal(lock.attributes["aria-pressed"], "false");
  click(labels[3].children[1]);
  assert.equal(tracks[3].enabled, false);
  assert.equal(calls.audio, 1);
});

test("pointer cancellation and window blur finish one undoable edit", () => {
  const { labels, begin, end, blur, undo, editor } = setup();
  begin(labels[0].children[2]);
  end("pointercancel");
  begin(labels[1].children[2]);
  blur();
  assert.equal(editor.history.operation, null);
  assert.equal(undo.length, 2);
});
