"use strict";

// A fake timeline for the track-insert tests: an element tree with the pieces
// the native drag reads, and a tracks object whose createTrack / deleteTrack /
// moveClip / moveClipProxies follow the native splice + history-command shape
// closely enough to observe the operation an insert joins.

const assert = require("node:assert/strict");

const { installTimelineTrackInsert } = require("../../plugins/core/timeline-track-insert");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.style = {};
    this.children = [];
    this.pz_object = null;
    this.className = "";
    this._parent = null;
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  get parentElement() { return this._parent; }
  get ownerDocument() { return this.document; }
  appendChild(child) {
    if (child._parent) child._parent.removeChild(child);
    child._parent = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    if (child._parent) child._parent.removeChild(child);
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child._parent = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child._parent = null;
  }
  remove() {
    if (this._parent) this._parent.removeChild(this);
    this.removed = true;
  }
  getBoundingClientRect() {
    return {
      top: this.rectTop ?? 0,
      height: this.rectHeight ?? this.height ?? 40,
      left: this.rectLeft ?? 0,
      width: this.rectWidth ?? 800,
    };
  }
}

function createHistory() {
  const undoStack = [];
  const redoStack = [];
  let operation = null;
  const run = (commands, target) => {
    operation = [];
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      commands[index].fn(commands[index].arg);
    }
    if (operation.length) target.push(operation);
    operation = null;
  };
  return {
    undoStack,
    redoStack,
    get operation() { return operation; },
    startOperation() { operation = []; },
    pushCommand(fn, arg) { operation.push({ fn, arg }); },
    finishOperation(redo) {
      if (operation.length) {
        if (redo === true) redoStack.push(operation);
        else {
          undoStack.push(operation);
          if (redo === undefined) redoStack.length = 0;
        }
      }
      operation = null;
    },
    undo() {
      if (!undoStack.length || operation !== null) return false;
      run(undoStack.pop(), redoStack);
      return true;
    },
    redo() {
      if (!redoStack.length || operation !== null) return false;
      run(redoStack.pop(), undoStack);
      return true;
    },
  };
}

const VIDEO_TOP = 0;
const AUDIO_TOP = 200;
const ROW_HEIGHT = 40;

function proxyFrameStart(proxy) {
  const left = parseFloat(proxy.style && proxy.style.left);
  return Number.isFinite(left) ? left : proxy.start;
}

function setup(options = {}) {
  const videoCount = options.videoCount ?? 3;
  const audioCount = options.audioCount ?? 2;
  const document = { createElement: tag => new Element(tag) };
  const history = createHistory();

  const videoContainer = new Element("div");
  videoContainer.rectTop = VIDEO_TOP;
  videoContainer.rectHeight = videoCount * ROW_HEIGHT;
  videoContainer.rectLeft = 200;
  videoContainer.rectWidth = 600;
  const audioContainer = new Element("div");
  audioContainer.rectTop = AUDIO_TOP;
  audioContainer.rectHeight = audioCount * ROW_HEIGHT;
  audioContainer.rectLeft = 200;
  audioContainer.rectWidth = 600;
  const root = new Element("div");
  root.rectTop = 0;
  root.rectHeight = 480;

  const sequence = {
    videoTracks: [],
    audioTracks: [],
    clipLinks: { links: {}, seed: 1 },
  };

  class Tracks {
    tracksFor(type) {
      return type === 0 ? this.timeline.sequence.videoTracks : this.timeline.sequence.audioTracks;
    }
    containerFor(type) {
      return type === 0 ? this.videoContainer : this.audioContainer;
    }
    layout() {
      this.timeline.sequence.videoTracks.forEach((track, index) => {
        track.element.rectTop = VIDEO_TOP + (this.timeline.sequence.videoTracks.length - 1 - index) * ROW_HEIGHT;
        track.element.rectHeight = ROW_HEIGHT;
      });
      this.timeline.sequence.audioTracks.forEach((track, index) => {
        track.element.rectTop = AUDIO_TOP + index * ROW_HEIGHT;
        track.element.rectHeight = ROW_HEIGHT;
      });
    }
    addTrack(type) {
      const track = { type, clips: [], element: new Element("div") };
      track.element.pz_object = track;
      this.containerFor(type).appendChild(track.element);
      this.tracksFor(type).push(track);
      return track;
    }
    addClip(track, name, start, length) {
      const clip = { name, start, length, link: null, track };
      const element = new Element("div");
      element.pz_object = clip;
      element.document = document;
      clip.element = element;
      track.clips.push(clip);
      track.element.appendChild(element);
      return clip;
    }
    makeProxy(clip, start) {
      const proxy = new Element("div");
      proxy.pz_clip = clip.element;
      proxy.pz_object = clip;
      proxy.pz_type = clip.track.type;
      proxy.pz_start = clip.start;
      proxy.pz_length = clip.length;
      proxy.start = start === undefined ? clip.start : start;
      proxy.style.left = String(proxy.start);
      proxy.style.width = String(clip.length);
      clip.track.element.appendChild(proxy);
      return proxy;
    }
    // --- native-shaped host methods ---------------------------------------
    clipDragStart(event) {
      this.started = event;
    }
    clipDrag(event) {
      this.currentPt = { x: event.pageX - this.origin.x, y: event.pageY - this.origin.y };
    }
    clipDragUpdate() {
      this.moved = true;
      for (const proxy of this.clip_proxies) proxy.style.display = "";
    }
    clipDragEnd(event) {
      this.ctx.endEvents.push(event);
      this.ctx.timeline.editor.history.startOperation();
      this.ctx.insertTrackProxies(this.track_proxies);
      if (this.moved) this.ctx.moveClipProxies(this.clip_proxies, this.createOnly || event.altKey, this.deltaFrames > 0);
      this.ctx.timeline.editor.history.finishOperation();
      for (const proxy of this.clip_proxies) proxy.remove();
      this.ctx.verticalZoom();
      this.ctx.timeline.updateZoom();
    }
    insertTrackProxies(proxies) {
      this.trackProxyCalls.push(proxies);
    }
    verticalZoom() { this.zoomed += 1; }
    moveClip(command) {
      const list = this.tracksFor(command.type);
      const from = list[command.oldTrackIdx];
      const to = list[command.newTrackIdx];
      let clip;
      if (command.oldTrackIdx !== command.newTrackIdx || command.oldIdx !== command.newIdx) {
        clip = from.clips.splice(command.oldIdx, 1)[0];
        to.clips.splice(command.newIdx, 0, clip);
        to.element.insertBefore(clip.element, to.element.children[command.newIdx] || null);
      }
      clip = to.clips[command.newIdx];
      const previous = { start: clip.start, length: clip.length };
      if (command.start !== undefined) clip.start = command.start;
      if (command.length !== undefined) clip.length = command.length;
      this.moveClipCalls.push(command);
      this.timeline.editor.history.pushCommand(this.moveClip.bind(this), {
        type: command.type,
        oldTrackIdx: command.newTrackIdx, oldIdx: command.newIdx,
        newTrackIdx: command.oldTrackIdx, newIdx: command.oldIdx,
        start: previous.start, length: previous.length,
      });
    }
    createTrack(command) {
      const track = { type: command.type, clips: [], element: new Element("div") };
      track.element.pz_object = track;
      this.tracksFor(command.type).splice(command.newTrackIdx, 0, track);
      this.containerFor(command.type).children.splice(command.newTrackIdx, 0, track.element);
      track.element._parent = this.containerFor(command.type);
      this.layout();
      this.createdTracks.push(command);
      this.timeline.editor.history.pushCommand(this.deleteTrack.bind(this), {
        type: command.type, oldTrackIdx: command.newTrackIdx,
      });
    }
    deleteTrack(command) {
      const [track] = this.tracksFor(command.type).splice(command.oldTrackIdx, 1);
      this.containerFor(command.type).removeChild(track.element);
      this.layout();
      this.deletedTracks.push(command);
      this.timeline.editor.history.pushCommand(this.createTrack.bind(this), {
        type: command.type, newTrackIdx: command.oldTrackIdx, data: { type: command.type, clips: [] },
      });
    }
    moveClipProxies(proxies, createOnly, movedRight) {
      this.moveCalls.push({ proxies: Array.from(proxies), createOnly, movedRight });
      if (createOnly) return;
      const blocked = proxy => this.isLocked?.(proxy.pz_clip?.pz_object) ||
        this.isLocked?.(proxy.pz_clip?.parentElement?.pz_object) ||
        this.isLocked?.(proxy.parentElement?.pz_object);
      if (Array.from(proxies).some(blocked)) {
        this.blockedMoves += 1;
        return;
      }
      const ordered = Array.from(proxies);
      if (movedRight) ordered.reverse();
      for (const proxy of ordered) {
        const type = proxy.pz_type;
        const container = this.containerFor(type);
        const sourceIndex = container.children.indexOf(proxy.pz_clip.parentElement);
        const destIndex = container.children.indexOf(proxy.parentElement);
        const sourceTrack = this.tracksFor(type)[sourceIndex];
        const destTrack = this.tracksFor(type)[destIndex];
        const start = proxyFrameStart(proxy);
        const draggedClip = proxy.pz_clip.pz_object;
        const oldIdx = sourceTrack.clips.indexOf(draggedClip);
        let newIdx = 0;
        for (const clip of destTrack.clips) {
          if (clip === draggedClip) continue;
          if (clip.start >= start) break;
          newIdx += 1;
        }
        this.moveClip({
          type, oldTrackIdx: sourceIndex, oldIdx, newTrackIdx: destIndex, newIdx,
          start, length: proxy.pz_object.length,
        });
      }
      if (movedRight) ordered.reverse();
    }
  }

  const tracks = new Tracks();
  tracks.videoContainer = videoContainer;
  tracks.audioContainer = audioContainer;
  tracks.el = root;
  tracks.container = root;
  tracks.timeline = {
    editor: { history },
    sequence,
    updateZoom() { tracks.zoomUpdates += 1; },
    frameToPx: frames => frames,
    pxToFrame: px => Math.round(px),
  };
  tracks.createdTracks = [];
  tracks.deletedTracks = [];
  tracks.moveClipCalls = [];
  tracks.moveCalls = [];
  tracks.trackProxyCalls = [];
  tracks.endEvents = [];
  tracks.blockedMoves = 0;
  tracks.zoomed = 0;
  tracks.zoomUpdates = 0;
  tracks.isLocked = options.isLocked;
  tracks.rootContainsLine = () =>
    tracks.el.children.some(child => child.className === "timeline-track-insert-line");

  for (let index = 0; index < videoCount; index += 1) tracks.addTrack(0);
  for (let index = 0; index < audioCount; index += 1) tracks.addTrack(1);
  tracks.layout();

  const installed = installTimelineTrackInsert(
    { ui: { timeline: { tracks: Tracks } } },
    { document, isLocked: options.isLocked },
  );

  function drag(proxies) {
    const dragContext = Object.create(Tracks.prototype);
    Object.assign(dragContext, {
      ctx: tracks,
      origin: { x: 0, y: 0 },
      currentPt: { x: 0, y: 0 },
      clip_proxies: proxies,
      track_proxies: [],
      moved: false,
    });
    return dragContext;
  }

  return { tracks, sequence, history, document, root, videoContainer, audioContainer, drag, installed };
}

function pointer(dragContext, y, extra = {}) {
  dragContext.clipDrag({ pageX: 100, pageY: y, ...extra });
  dragContext.clipDragUpdate();
}

// Places a proxy on a destination row at the dropped frame, as the native
// clipDragUpdate does after it maps the pointer to a row.
function placeProxy(tracks, proxy, destIndex, start) {
  const container = proxy.pz_type === 0 ? tracks.videoContainer : tracks.audioContainer;
  const row = container.children[destIndex];
  assert.ok(row, "the destination row exists");
  proxy.remove();
  row.appendChild(proxy);
  proxy.style.left = String(start);
  proxy.style.width = String(proxy.pz_object.length);
  return proxy;
}

function videoTrack(tracks, index) {
  return tracks.timeline.sequence.videoTracks[index];
}

function audioTrack(tracks, index) {
  return tracks.timeline.sequence.audioTracks[index];
}

function addressOf(sequence, clip) {
  const lists = [[1, sequence.videoTracks], [2, sequence.audioTracks]];
  for (const [listIndex, list] of lists) {
    for (let trackIndex = 0; trackIndex < list.length; trackIndex += 1) {
      const clipIndex = list[trackIndex].clips.indexOf(clip);
      if (clipIndex >= 0) return [0, listIndex, trackIndex, 0, clipIndex];
    }
  }
  return null;
}

function serialize(sequence) {
  const links = {};
  for (const key of Object.keys(sequence.clipLinks.links)) {
    links[key] = { clips: sequence.clipLinks.links[key].clips.map(clip => addressOf(sequence, clip)) };
  }
  const track = item => ({
    type: item.type,
    clips: item.clips.map(clip => ({
      name: clip.name,
      start: clip.start,
      length: clip.length,
      link: clip.link ? clip.link.key : null,
    })),
  });
  return {
    videoTracks: sequence.videoTracks.map(track),
    audioTracks: sequence.audioTracks.map(track),
    clipLinks: { seed: sequence.clipLinks.seed, links },
  };
}

function load(project) {
  const sequence = {
    videoTracks: [],
    audioTracks: [],
    clipLinks: { links: {}, seed: project.clipLinks.seed },
  };
  const lists = [[0, project.videoTracks], [1, project.audioTracks]];
  for (const [type, savedTracks] of lists) {
    for (const savedTrack of savedTracks) {
      const track = { type, clips: [] };
      for (const savedClip of savedTrack.clips) {
        const clip = { name: savedClip.name, start: savedClip.start, length: savedClip.length, link: null };
        track.clips.push(clip);
      }
      sequence[type === 0 ? "videoTracks" : "audioTracks"].push(track);
    }
  }
  const lookup = address => sequence[address[1] === 1 ? "videoTracks" : "audioTracks"][address[2]].clips[address[4]];
  for (const key of Object.keys(project.clipLinks.links)) {
    const link = { key, clips: project.clipLinks.links[key].clips.map(lookup) };
    sequence.clipLinks.links[key] = link;
    for (const clip of link.clips) clip.link = link;
  }
  return sequence;
}

module.exports = {
  Element,
  createHistory,
  VIDEO_TOP,
  AUDIO_TOP,
  ROW_HEIGHT,
  setup,
  pointer,
  placeProxy,
  videoTrack,
  audioTrack,
  serialize,
  load,
};
