"use strict";

// Coverage for the Precomp+ engine: comps subsystem evaluates, the timeline
// clip menu gains its items, and entering a comp sticks across project
// notifications (the drill-in fix).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function fakeElement() {
  const styleObj = {};
  const el = {
    children: [],
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c, ref) {
      const at = el.children.indexOf(ref);
      if (at < 0) el.children.push(c);
      else el.children.splice(at, 0, c);
      return c;
    },
    remove() {},
    setAttribute(k, v) { el[k] = v; },
    querySelector: () => null,
  };
  Object.defineProperty(el, "style", {
    get: () => styleObj,
    set: () => {},
    configurable: true,
  });
  Object.defineProperty(el, "firstElementChild", { get: () => el.children[0] || null });
  return el;
}

function createHarness() {
  const watchers = { projectChanged: [] };
  const project = {
    sequence: { videoTracks: [], audioTracks: [], length: 180 },
    media: [],
    ui: {},
  };
  const CM = {
    project,
    playback: { currentFrame: 0 },
    history: { startOperation() {}, finishOperation() {}, pushCommand() {} },
    timelineSelection: [],
    onProjectChanged: { watch: (fn) => watchers.projectChanged.push(fn) },
    windows: [],
  };
  class StubPanel {}
  const tracksProto = {
    clipContextMenu(e) {
      this._clipMenu = fakeElement();
    },
  };
  const PZ = {
    ui: {
      panel: StubPanel,
      timeline: { tracks: { prototype: tracksProto } },
    },
    media: function () {},
    track: { video: function () {}, audio: function () {} },
    schedule: { analyzeSequence() {} },
  };
  const g = globalThis;
  const keep = {};
  for (const k of ["PZ", "CM", "document", "window", "alert", "confirm"]) keep[k] = g[k];
  g.PZ = PZ;
  g.CM = CM;
  g.document = {
    createElement: () => fakeElement(),
    body: { appendChild() {} },
    querySelector: () => null,
  };
  g.window = g;
  g.alert = () => {};
  g.confirm = () => true;
  return {
    PZ, CM, project, watchers,
    context: {
      PZ,
      editor: CM,
      window: g,
      getAsset: (kind, url) => {
        const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
        return fs.readFileSync(path.join(projectRoot, key), "utf8");
      },
    },
    restore() {
      for (const k of ["PZ", "CM", "document", "window", "alert", "confirm"]) {
        if (keep[k] === undefined) delete g[k];
        else g[k] = keep[k];
      }
    },
  };
}

function loadModule() {
  const full = path.join(projectRoot, "plugins/precomp-plus/precomp-runtime.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

test("comps engine installs and the clip menu gains its items", () => {
  const h = createHarness();
  try {
    const mod = loadModule();
    mod.activate(h.context);
    assert.ok(h.PZ.ui.comps, "comps namespace");
    assert.equal(typeof h.PZ.ui.comps.precomposeFromSelection, "function");
    assert.equal(typeof h.PZ.ui.comps.switchTo, "function");
    assert.equal(typeof h.PZ.ui.comps.newComp, "function");
    assert.equal(typeof h.CM.precomposeSelection, "function");
    assert.equal(typeof h.PZ.ui.compsPanel, "function");
    // Clip menu: owner records the wrapper; items append on open.
    const owner = { clipContextMenu(e) { this._clipMenu = fakeElement(); } };
    h.PZ.ui.timeline.tracks.prototype.clipContextMenu = owner.clipContextMenu;
    // Re-activate path is guarded; drive the installed wrapper directly.
    mod.deactivate();
    mod.activate(h.context);
    const menu = fakeElement();
    const menuOwner = { clipContextMenu(e) { this._clipMenu = menu; } };
    h.PZ.ui.timeline.tracks.prototype.clipContextMenu = menuOwner.clipContextMenu;
    mod.deactivate();
    mod.activate(h.context);
    const tracks = { _clipMenu: null, timeline: { editor: h.CM } };
    const fakeEvent = { currentTarget: { pz_object: null } };
    h.PZ.ui.timeline.tracks.prototype.clipContextMenu.call(tracks, fakeEvent);
    const labels = menu.children.map((c) => c.innerText);
    assert.ok(labels.includes("Pre-compose selected"), "pre-compose item: " + labels.join(","));
    assert.ok(labels.includes("Open source composition"), "open-source item");
    assert.ok(!labels.includes("Back to Main composition"), "no back-to-main on Main");
    mod.deactivate();
  } finally {
    h.restore();
  }
});

test("entering a comp sticks across project notifications", () => {
  const h = createHarness();
  try {
    const mod = loadModule();
    mod.activate(h.context);
    // Fake a comp media object in project media.
    const media = { properties: { name: { get: () => "DrillTest" } }, data: [{ type: 0, clips: [] }], compLength: 60 };
    h.project.media.push(media);
    // Minimal sequence shape for restoreIntoSequence.
    h.project.sequence.videoTracks = [];
    h.project.sequence.audioTracks = [];
    h.CM.project.ui = { dirty: false };
    const entered = h.PZ.ui.comps.switchTo(h.CM, media);
    assert.equal(entered, true);
    assert.equal(h.CM.activeComp, media);
    // The notification storm a switch can trigger must not pop back out.
    for (const fn of h.watchers.projectChanged) fn();
    assert.equal(h.CM.activeComp, media, "drill-in sticks");
    // A genuinely replaced project still resets.
    h.CM.project = { sequence: { videoTracks: [], audioTracks: [], length: 10 }, media: [], ui: {} };
    for (const fn of h.watchers.projectChanged) fn();
    assert.equal(h.CM.activeComp, null);
    assert.equal(h.CM.mainBackup, null);
    mod.deactivate();
  } finally {
    h.restore();
  }
});
