"use strict";

// Minimal CM3 object model for the Precomp+ tests. It mirrors only the host
// behaviour the engine depends on: the parent chain, ObjectList parenting,
// track time lookup, asset reference counts and history stacks. The real
// host sources are not loaded.

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const enginePath = path.join(projectRoot, "plugins/precomp-plus/comps.js");

function createPZ() {
  const PZ = {};

  class Observable {
    constructor() { this.watchers = []; }
    watch(fn, immediate) { this.watchers.push(fn); if (immediate) fn(); }
    unwatch(fn) { const i = this.watchers.indexOf(fn); if (i >= 0) this.watchers.splice(i, 1); }
    update(...args) { this.watchers.slice().forEach((fn) => fn(...args)); }
  }

  class Obj {
    constructor() { this.parent = null; }
    get parentObject() { return this.parent instanceof Obj ? this.parent : this.parent.parentObject; }
    getParentOfType(T) {
      const p = this.parentObject;
      return p instanceof T ? p : p.getParentOfType(T);
    }
    get parentProject() { return this.getParentOfType(PZ.project); }
  }

  class ObjectList extends Array {
    static get [Symbol.species]() { return Array; }
    constructor(parent) {
      super();
      Object.defineProperty(this, "parent", { value: parent || null, writable: true });
    }
    get parentObject() { return this.parent; }
    splice(start, count, ...items) {
      const removed = super.splice(start, count, ...items);
      removed.forEach((item) => { if (item && this.parent !== null) item.parent = null; });
      items.forEach((item) => { if (item && this.parent !== null) item.parent = this; });
      return removed;
    }
    push(...items) { this.splice(this.length, 0, ...items); return this.length; }
  }

  const prop = (value) => ({ v: value, get() { return this.v; }, set(next) { this.v = next; } });

  class Layer extends Obj {
    constructor() {
      super();
      this.type = 0;
      this.properties = { position: { get: () => [0, 0] }, rotation: { get: () => 0 }, scale: { get: () => [1, 1] }, opacity: { get: () => 1 } };
      this.effects = new ObjectList(this);
      this.composite = { group: {}, quad: { material: { uniforms: { opacity: { value: 1 } } } } };
      this.updates = [];
      this.prepares = [];
    }
    load(e) { this.loaded = e; }
    update(e) { this.updates.push(e); }
    async prepare(e) { this.prepares.push(e); }
    unload() { this.unloaded = (this.unloaded || 0) + 1; }
    toJSON() { return { type: this.type, properties: {}, effects: [] }; }
  }

  class Composite extends Layer {
    constructor() {
      super();
      this.type = 2;
      this.objects = new ObjectList(this);
    }
    load(e) {
      super.load(e);
      if (e && Array.isArray(e.objects)) {
        e.objects.forEach((child) => {
          const layer = createLayer(child.type);
          this.objects.push(layer);
          layer.load(child);
        });
      }
    }
    toJSON() {
      const json = super.toJSON();
      json.objects = this.objects;
      return json;
    }
    update(e) {
      super.update(e);
      this.objects.forEach((child) => child.update(e));
    }
    async prepare(e, t) {
      for (const child of this.objects) await child.prepare(e, t);
      await super.prepare(e, t);
    }
    unload() {
      this.objects.forEach((child) => child.unload());
      super.unload();
    }
  }

  function createLayer(type) {
    const layer = type === 2 ? new Composite() : new Layer();
    layer.type = type;
    return layer;
  }

  class Clip extends Obj {
    constructor(objType) {
      super();
      this.start = 0;
      this.length = 0;
      this.link = null;
      this.media = null;
      this.properties = { name: prop(""), time: { get: (frame) => frame } };
      this.object = createLayer(objType);
      this.object.parent = this;
    }
    get endFrame() { return this.start + this.length; }
    load(e) {
      this.start = e.start;
      this.length = e.length;
      this.link = e.link || null;
      this.properties.name.v = (e.properties && e.properties.name) || "";
      if (e.hasMedia) this.media = { asset: { key: "footage" } };
      this.object.loading = this.object.load(e.object);
    }
    toJSON() {
      return {
        start: this.start,
        length: this.length,
        properties: { name: this.properties.name.v },
        link: this.link,
        hasMedia: !!this.media,
        object: this.object,
      };
    }
    unload() { this.object.unload(); }
    update(e) { this.object.update(e - this.start); }
    async prepare(e, t) { await this.object.prepare(e - this.start, t); }
  }

  class Track extends Obj {
    constructor() {
      super();
      this.enabled = true;
      this.layer = null;
      this.clips = new ObjectList(this);
    }
    getCurrentClip(e) {
      for (let t = 0; t < this.clips.length && e >= this.clips[t].start; t++) {
        if (e < this.clips[t].endFrame) return this.clips[t];
      }
      return null;
    }
    load(json) {
      if (!json) return;
      json.clips.forEach((clipJSON) => {
        const clip = new Clip(clipJSON.object.type);
        this.clips.push(clip);
        clip.load(clipJSON);
      });
    }
    update(e) {
      const clip = this.enabled ? this.getCurrentClip(e) : null;
      this.layer = clip ? clip.object : null;
    }
    toJSON() { return { type: this.type, clips: this.clips }; }
  }

  class VideoTrack extends Track {
    constructor() { super(); this.type = 0; this.clips = new ObjectList(this); }
  }

  class AudioTrack extends Track {
    constructor() { super(); this.type = 1; this.clips = new ObjectList(this); }
  }

  class Sequence extends Obj {
    constructor() {
      super();
      this.length = 0;
      this.properties = { toJSON: () => ({ resolution: [1920, 1080], rate: 30 }), load() {} };
      this.videoTracks = new ObjectList(this);
      this.audioTracks = new ObjectList(this);
      this.clipLinks = null;
      this.videoSchedules = [];
      this.audioSchedules = [];
      this.ui = { onClipCreated: new Observable(), onClipDeleted: new Observable() };
    }
    load(e) {
      if (e) {
        this.length = e.length;
        (e.videoTracks || []).forEach((json) => { const t = new VideoTrack(); this.videoTracks.push(t); t.load(json); });
        (e.audioTracks || []).forEach((json) => { const t = new AudioTrack(); this.audioTracks.push(t); t.load(json); });
        this.clipLinks = null;
      }
      PZ.schedule.analyzeSequence(this);
    }
    toJSON() {
      return {
        properties: this.properties,
        length: this.length,
        videoTracks: this.videoTracks,
        audioTracks: this.audioTracks,
        clipLinks: this.clipLinks,
      };
    }
  }

  class Media extends Obj {
    constructor() {
      super();
      this.properties = { name: prop("Media") };
      this.icon = "fragment";
      this.creationId = null;
      this.data = null;
      this.baseType = null;
      this.assets = [];
      this.preset = false;
      this.loaded = false;
      this.loading = null;
    }
    async load(e) {
      e = await e;
      this.properties.name.v = e.properties.name;
      this.icon = e.icon || this.icon;
      this.data = e.data;
      this.baseType = e.baseType;
      this.preset = !!e.preset;
      (e.assets || []).forEach((key) => { this.assets.push(this.parentProject.assets.load(key, true)); });
      this.loaded = true;
    }
    unload() {
      this.assets.forEach((asset) => this.parentProject.assets.unload(asset, true));
    }
    toJSON() {
      return {
        properties: { name: this.properties.name.v, icon: this.icon },
        title: this.properties.name.v,
        icon: this.icon,
        creationId: this.creationId,
        data: this.data,
        baseType: this.baseType,
        assets: this.assets.map((asset) => asset.key),
      };
    }
  }

  class AssetList {
    constructor() { this.list = {}; }
    add(key) { this.list[key] = { key: key, references: 0, mediaReferences: 0 }; return this.list[key]; }
    load(key, forMedia) {
      const asset = this.list[key];
      if (!asset) return null;
      if (forMedia) asset.mediaReferences += 1; else asset.references += 1;
      return asset;
    }
    unload(asset, forMedia) {
      if (forMedia) asset.mediaReferences -= 1; else asset.references -= 1;
      if (asset.references <= 0 && asset.mediaReferences <= 0) delete this.list[asset.key];
    }
    toJSON() { return this.list; }
  }

  class Project extends Obj {
    constructor() {
      super();
      this.assets = new AssetList();
      this.sequence = new Sequence();
      this.sequence.parent = this;
      this.media = new ObjectList(this);
      this.ui = { onChanged: new Observable(), dirty: false };
    }
    toJSON() {
      return { assets: this.assets, media: this.media.filter((m) => !m.preset), sequence: this.sequence };
    }
  }

  class FixedStack {
    constructor() { this.stack = []; }
    get length() { return this.stack.length; }
    push(item) { this.stack.push(item); }
    pop() { return this.stack.pop(); }
    clear() { this.stack = []; }
  }

  class History {
    constructor(editor) {
      this.editor = editor;
      this.undoStack = new FixedStack();
      this.redoStack = new FixedStack();
      this.operation = null;
    }
    startOperation() { this.operation = []; }
    pushCommand(fn, params) { this.operation.push({ fn: fn, params: params }); }
    finishOperation(isUndo) {
      if (this.operation && this.operation.length) {
        (isUndo === true ? this.redoStack : this.undoStack).push(this.operation);
        this.editor.project.ui.onChanged.update();
      }
      this.operation = null;
    }
    undo() {
      if (!this.undoStack.length || this.operation !== null) return;
      const entry = this.undoStack.pop();
      this.startOperation();
      for (let i = entry.length - 1; i >= 0; i--) entry[i].fn(entry[i].params);
      this.finishOperation(true);
    }
  }

  // Timeline tracks UI: selection is read from the clip elements, and edits go
  // through history like CM3's own clip commands.
  class TracksUI {
    constructor(timeline, editor) {
      this.timeline = timeline;
      this.editor = editor;
      this.selectedClips = [];
      this.selection = [];
      this.container = {
        getElementsByClassName: () => {
          const out = [];
          editor.project.sequence.videoTracks.forEach((track) => track.clips.forEach((clip) => {
            out.push({ pz_object: clip });
          }));
          return out;
        },
      };
    }
    selectClips() { this.selection = this.selectedClips.slice(); }
    deselectClips() {}
    redraw() {}
    zoom() {}
    locate(clip) {
      const seq = this.editor.project.sequence;
      for (let t = 0; t < seq.videoTracks.length; t++) {
        const idx = seq.videoTracks[t].clips.indexOf(clip);
        if (idx >= 0) return { trackIdx: t, idx: idx };
      }
      return null;
    }
    removeAt(p) {
      const track = this.editor.project.sequence.videoTracks[p.trackIdx];
      const clip = track.clips[p.idx];
      const data = JSON.parse(JSON.stringify(clip));
      clip.unload();
      track.clips.splice(p.idx, 1);
      this.editor.history.pushCommand((q) => this.insertFrom(q), { trackIdx: p.trackIdx, idx: p.idx, data: data });
    }
    insertFrom(p) {
      const track = this.editor.project.sequence.videoTracks[p.trackIdx];
      const clip = new Clip(p.data.object.type);
      track.clips.splice(p.idx, 0, clip);
      clip.load(p.data);
      this.editor.history.pushCommand((q) => this.removeAt(q), { trackIdx: p.trackIdx, idx: p.idx });
    }
    deleteClips(elements) {
      elements.forEach((el) => {
        const where = this.locate(el.pz_object);
        if (where) this.removeAt(where);
      });
    }
    createClip(e) {
      this.insertFrom({
        trackIdx: e.newTrackIdx,
        idx: e.newIdx,
        data: Object.assign(JSON.parse(JSON.stringify(e.data)), { start: e.start, length: e.length, link: null }),
      });
    }
  }

  class Timeline {
    constructor(editor) {
      this.editor = editor;
      this.tracks = new TracksUI(this, editor);
    }
  }

  class Editor {
    constructor(project) {
      this.project = project;
      this.history = new History(this);
      this.onProjectChanged = new Observable();
      this.playback = { currentFrame: 0 };
      this.timeline = new Timeline(this);
    }
  }

  Object.assign(PZ, {
    Observable, Obj, ObjectList, Layer, Clip, Track, Sequence, Media, Project, Editor,
    layer: Object.assign(Layer, { composite: Composite, create: createLayer }),
    clip: { create: (kind, objType) => new Clip(objType) },
    track: Object.assign(Track, { video: VideoTrack, audio: AudioTrack }),
    media: Media,
    project: Project,
    schedule: {
      type: { VIDEO: 0, AUDIO: 1, NONE: 2 },
      combineTracks(tracks) {
        const out = [];
        tracks.forEach((track) => track.clips.forEach((clip) => out.push(clip)));
        return out.sort((a, b) => a.start - b.start);
      },
      updateSchedules(seq, schedules, items, type) {
        if (type === 0) seq.lastVideoItems = items.slice();
        else seq.lastAudioItems = items.slice();
      },
      analyzeSequence(seq) {
        PZ.schedule.updateSchedules(seq, seq.videoSchedules, PZ.schedule.combineTracks(seq.videoTracks), 0);
        PZ.schedule.updateSchedules(seq, seq.audioSchedules, PZ.schedule.combineTracks(seq.audioTracks), 1);
      },
    },
    ui: { timeline: { tracks: TracksUI } },
  });
  return PZ;
}

// Loads the engine exactly as the plugin runtime does: a function body over PZ.
function loadEngine(PZ) {
  const source = fs.readFileSync(enginePath, "utf8");
  new Function("PZ", source)(PZ);
  return PZ.precomp;
}

// A project with one video track and a fresh editor. Engine hooks are
// installed; the returned `uninstall` restores the host methods.
function createEnvironment() {
  const PZ = createPZ();
  const engine = loadEngine(PZ);
  const project = new PZ.project();
  project.sequence.videoTracks.push(new PZ.track.video());
  const editor = new PZ.Editor(project);
  const uninstall = engine.install();
  return { PZ, engine, project, editor, tracks: editor.timeline.tracks, uninstall };
}

// Appends a video clip to track `trackIdx` of the live sequence.
function addClip(env, trackIdx, options) {
  const seq = env.project.sequence;
  while (seq.videoTracks.length <= trackIdx) seq.videoTracks.push(new env.PZ.track.video());
  const clip = new env.PZ.Clip(options.compId ? 2 : 0);
  clip.start = options.start;
  clip.length = options.length;
  clip.properties.name.v = options.name || "";
  clip.media = options.hasMedia ? { asset: { key: "footage" } } : null;
  if (options.compId) {
    // Loading the composite is what turns it into a composition layer.
    clip.object.load({ type: 2, compId: options.compId, offset: options.offset || 0, properties: {}, effects: [], objects: [] });
  }
  seq.videoTracks[trackIdx].clips.push(clip);
  return clip;
}

// Adds a composition media entry with the given tracks, without the engine.
function addCompMedia(env, id, name, data) {
  const media = new env.PZ.media();
  media.properties.name.v = name;
  media.data = data;
  media.comp = { id: id, clipLinks: null };
  media.loaded = true;
  env.project.media.push(media);
  return media;
}

// Serialize then rebuild a project through the same host paths as open().
async function reloadProject(env, json) {
  const project = new env.PZ.project();
  Object.keys(json.assets || {}).forEach((key) => project.assets.add(key));
  for (const mediaJSON of json.media) {
    const media = new env.PZ.media();
    project.media.push(media);
    media.loading = media.load(JSON.parse(JSON.stringify(mediaJSON)));
    await media.loading;
  }
  project.sequence.load(JSON.parse(JSON.stringify(json.sequence)));
  return project;
}

module.exports = { createPZ, loadEngine, createEnvironment, addClip, addCompMedia, reloadProject, enginePath, projectRoot };
