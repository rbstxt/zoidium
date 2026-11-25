"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DRAG_STATE_KEY,
  BOUNDARY_TOLERANCE_PX,
  BOUNDARY_TOLERANCE_RATIO,
  boundaryTolerance,
  findBoundary,
  rowRects,
  planBoundaryInsert,
  installTimelineTrackInsert,
} = require("../plugins/core/timeline-track-insert");

// ---------------------------------------------------------------------------
// Fixture: an element tree with the pieces the native timeline drag reads, and
// a tracks object whose createTrack / deleteTrack / moveClip / moveClipProxies
// follow the native splice + history-command shape closely enough to observe
// the operation the insert joins.
// ---------------------------------------------------------------------------

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
      proxy.start = start === undefined ? clip.start : start;
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
        this.isLocked?.(proxy.pz_clip?.parentElement?.pz_object);
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
        const oldIdx = sourceTrack.clips.indexOf(proxy.pz_clip.pz_object);
        let newIdx = 0;
        while (newIdx < destTrack.clips.length && destTrack.clips[newIdx].start <= proxy.start) newIdx += 1;
        this.moveClip({
          type, oldTrackIdx: sourceIndex, oldIdx, newTrackIdx: destIndex, newIdx,
          start: proxy.start, length: proxy.pz_clip.pz_object.length,
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

// ---------------------------------------------------------------------------
// Boundary selection
// ---------------------------------------------------------------------------

test("a boundary hit picks the index of the upper array row for video", () => {
  // Video rows stack upward: index 0 is the bottom row.
  const rows = [
    { top: 80, height: 40 },
    { top: 40, height: 40 },
    { top: 0, height: 40 },
  ];
  assert.equal(findBoundary(rows, 80).index, 1, "edge between V1 and V2");
  assert.equal(findBoundary(rows, 40).index, 2, "edge between V2 and V3");
  assert.equal(findBoundary(rows, 80 - 3).index, 1, "3 px above the edge");
  assert.equal(findBoundary(rows, 60), null, "row centre is not a boundary");
  assert.equal(findBoundary(rows, 100), null, "4 px past the tolerance away from an edge");
});

test("a boundary hit picks the index of the lower array row for audio", () => {
  const rows = [
    { top: 200, height: 40 },
    { top: 240, height: 40 },
    { top: 280, height: 40 },
  ];
  assert.equal(findBoundary(rows, 240).index, 1);
  assert.equal(findBoundary(rows, 280).index, 2);
  assert.equal(findBoundary(rows, 220), null, "A1 centre");
});

test("the tolerance is 4 px or a quarter of the row, whichever is smaller", () => {
  assert.equal(boundaryTolerance(40), BOUNDARY_TOLERANCE_PX);
  assert.equal(boundaryTolerance(12), 3);
  assert.equal(boundaryTolerance(12), 12 * BOUNDARY_TOLERANCE_RATIO);
  assert.equal(boundaryTolerance(4), 1);
  assert.equal(boundaryTolerance(0), 0);
  assert.equal(boundaryTolerance(undefined), 0);
  const shortRows = [{ top: 0, height: 12 }, { top: 12, height: 12 }];
  assert.equal(findBoundary(shortRows, 15).index, 1);
  assert.equal(findBoundary(shortRows, 16), null, "4 px is outside a 3 px tolerance");
});

test("rowRects ignores elements without a track object", () => {
  const container = new Element("div");
  const first = new Element("div");
  first.pz_object = { type: 0 };
  first.rectTop = 20;
  first.rectHeight = 40;
  const proxyRow = new Element("div");
  proxyRow.rectTop = 60;
  proxyRow.rectHeight = 40;
  container.appendChild(first);
  container.appendChild(proxyRow);
  assert.deepEqual(rowRects(container), [{ top: 20, height: 40 }]);
});

// ---------------------------------------------------------------------------
// Drag integration
// ---------------------------------------------------------------------------

test("a clip dragged onto a video boundary shows an insertion line and hides proxies", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 0);
  assert.equal(state.candidate.index, 1);
  assert.equal(state.line.style.display, "");
  assert.equal(state.line.parentElement, tracks.el);
  assert.equal(proxy.style.display, "none", "the destination-row proxy is hidden");
  assert.ok(Math.abs(Number.parseFloat(state.line.style.top) - 80) <= 1);

  pointer(dragContext, 60);
  assert.equal(state.candidate, null, "leaving the boundary clears the candidate");
  assert.equal(state.line.style.display, "none");
  assert.equal(proxy.style.display, "", "the ordinary destination feedback returns");
});

test("a clip dragged onto an audio boundary selects the audio row pair", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(audioTrack(tracks, 0), "MUSIC", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 242);
  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 1);
  assert.equal(state.candidate.index, 1);
});

test("a boundary line is not offered when the drag carries no clip of that kind", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 242);
  assert.equal(dragContext[DRAG_STATE_KEY].candidate, null);
  assert.equal(dragContext[DRAG_STATE_KEY].line, null);
});

test("a boundary drop creates one unlocked track, moves the clip and joins one undo step", () => {
  const { tracks, drag, history } = setup();
  const source = videoTrack(tracks, 0);
  const clip = tracks.addClip(source, "COLOR", 10, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(tracks.createdTracks[0].type, 0);
  assert.equal(tracks.createdTracks[0].newTrackIdx, 1);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4);
  assert.equal(videoTrack(tracks, 0).clips.length, 0, "nothing stays behind on the source row");
  assert.deepEqual(videoTrack(tracks, 1).clips.map(item => item.name), ["COLOR"]);
  assert.equal(videoTrack(tracks, 1).clips[0].start, 10, "the dragged time is kept");
  assert.equal(tracks.timeline.sequence.audioTracks.length, 2, "a video boundary never adds audio");
  assert.equal(history.undoStack.length, 1, "one undo step covers the track and the move");
  assert.equal(tracks.blockedMoves, 0);
  assert.equal(tracks.createdTracks[0].data, null);
});

test("undo removes the inserted track and puts the clip back; redo repeats it", () => {
  const { tracks, drag, history } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(videoTrack(tracks, 1).clips[0], clip);
  assert.equal(history.undo(), true);

  assert.equal(tracks.timeline.sequence.videoTracks.length, 3, "undo removes the track");
  assert.equal(videoTrack(tracks, 0).clips[0], clip, "undo returns the clip to V1");
  assert.equal(videoTrack(tracks, 0).clips[0].start, 10);

  assert.equal(history.redo(), true);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4, "redo recreates the track");
  assert.equal(videoTrack(tracks, 1).clips[0], clip, "redo returns the clip to the new row");
  assert.equal(videoTrack(tracks, 0).clips.length, 0);
});

test("a row-centre drop keeps the native overwrite path untouched", () => {
  const { tracks, drag, history } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 60);
  videoTrack(tracks, 1).element.appendChild(proxy);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "row drops never insert a track");
  assert.equal(tracks.moveCalls.length, 1);
  assert.equal(tracks.moveCalls[0].createOnly, false);
  assert.equal(history.undoStack.length, 1);
});

test("Escape cancels the boundary insert and changes nothing", () => {
  const { tracks, drag, history } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "keydown", key: "Escape", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(tracks.moveClipCalls.length, 0);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3);
  assert.equal(videoTrack(tracks, 0).clips[0], clip);
  assert.equal(history.undoStack.length, 0, "cancel records no history");
  assert.equal(tracks.rootContainsLine(), false, "the insertion line is removed");
  assert.equal(proxy.removed, true, "the proxy is cleaned up");
});

test("dropping back at the start leaves the project unchanged", () => {
  const { tracks, drag, history } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(tracks.moveClipCalls.length, 0);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3);
  assert.equal(history.undoStack.length, 0);
});

test("a locked source track still rejects the boundary insert", () => {
  const isLocked = track => track?.zoidiumLocked === true;
  const { tracks, drag } = setup({ isLocked });
  const source = videoTrack(tracks, 0);
  source.zoidiumLocked = true;
  const clip = tracks.addClip(source, "COLOR", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "no track is inserted for a locked source");
  assert.equal(tracks.blockedMoves, 1, "the native lock guard still rejects the move");
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3);
  assert.equal(source.clips[0], clip);
});

test("a boundary next to a locked track inserts an unlocked track", () => {
  const isLocked = track => track?.zoidiumLocked === true;
  const { tracks, drag } = setup({ isLocked });
  videoTrack(tracks, 1).zoidiumLocked = true;
  const clip = tracks.addClip(videoTrack(tracks, 2), "THYRO", 0, 30);
  const proxy = tracks.makeProxy(clip);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(videoTrack(tracks, 1).zoidiumLocked, undefined, "the new track is unlocked");
  assert.equal(videoTrack(tracks, 2).zoidiumLocked, true, "the locked track is only shifted");
  assert.equal(tracks.blockedMoves, 0);
});

test("linked video and audio clips keep their link when only video is inserted", () => {
  const { tracks, drag } = setup();
  const link = { key: 7, clips: [] };
  const video = tracks.addClip(videoTrack(tracks, 0), "VIDEO", 0, 30);
  const audio = tracks.addClip(audioTrack(tracks, 0), "AUDIO", 0, 30);
  video.link = link;
  audio.link = link;
  link.clips.push(video, audio);
  tracks.timeline.sequence.clipLinks.links[link.key] = link;
  video.track = videoTrack(tracks, 0);
  audio.track = audioTrack(tracks, 0);
  const videoProxy = tracks.makeProxy(video);
  const audioProxy = tracks.makeProxy(audio);
  const dragContext = drag([videoProxy, audioProxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(videoTrack(tracks, 1).clips[0], video, "the video clip moves onto the new row");
  assert.equal(audioTrack(tracks, 0).clips[0], audio, "the audio partner stays on its own track");
  assert.equal(video.link, link);
  assert.equal(audio.link, link);
  assert.deepEqual(link.clips, [video, audio]);
});

test("a multi-track drag inserts one track per source track and keeps the order", () => {
  const { tracks, drag, history } = setup();
  const lower = tracks.addClip(videoTrack(tracks, 0), "LOWER", 0, 30);
  const upper = tracks.addClip(videoTrack(tracks, 2), "UPPER", 100, 30);
  const dragContext = drag([tracks.makeProxy(lower), tracks.makeProxy(upper)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 2);
  assert.deepEqual(tracks.createdTracks.map(command => command.newTrackIdx), [1, 2]);
  assert.equal(videoTrack(tracks, 1).clips[0], lower, "the lower source keeps the lower new row");
  assert.equal(videoTrack(tracks, 2).clips[0], upper, "the upper source keeps the upper new row");
  assert.equal(history.undoStack.length, 1);
});

test("an audio boundary inserts only audio tracks", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(audioTrack(tracks, 0), "MUSIC", 0, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 242);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(tracks.createdTracks[0].type, 1);
  assert.equal(audioTrack(tracks, 1).clips[0], clip);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3, "an audio boundary never adds video");
});

test("alt-drag copy keeps today's duplicate behaviour instead of inserting a track", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 0, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78, { altKey: true });
  dragContext.clipDragEnd({ type: "mouseup", altKey: true, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(tracks.moveCalls.length, 1);
  assert.equal(tracks.moveCalls[0].createOnly, true);
});

test("planBoundaryInsert refuses a locked source and groups several source rows", () => {
  const container = new Element("div");
  const sourceA = new Element("div");
  sourceA.pz_object = { type: 0, clips: [] };
  const sourceB = new Element("div");
  sourceB.pz_object = { type: 0, clips: [] };
  container.appendChild(sourceA);
  container.appendChild(sourceB);

  const clipA = { element: new Element("div") };
  clipA.element.pz_clip = null;
  clipA.element.pz_object = { name: "A" };
  sourceA.appendChild(clipA.element);

  const proxyA = new Element("div");
  proxyA.pz_clip = clipA.element;
  proxyA.pz_type = 0;
  const proxyB = new Element("div");
  proxyB.pz_clip = new Element("div");
  proxyB.pz_clip.pz_object = { name: "B" };
  proxyB.pz_type = 0;
  sourceB.appendChild(proxyB.pz_clip);

  const first = {
    videoContainer: container, audioContainer: null,
    createTrack() {}, moveClipProxies() {},
  };
  const plan = planBoundaryInsert(first, [proxyB, proxyA], 0, 1, undefined);
  assert.deepEqual(plan.entries.map(entry => entry.sourceIndex), [0, 1]);
  assert.deepEqual(plan.entries.map(entry => entry.newIndex), [1, 2]);
  assert.deepEqual(plan.entries[0].proxies, [proxyA], "clips follow their source row, not the proxy order");

  const locked = planBoundaryInsert(first, [proxyA], 0, 1, () => true);
  assert.equal(locked, null);
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("a project saved after an insert reloads the same track order and links", () => {
  const { tracks, drag } = setup();
  const link = { key: 3, clips: [] };
  const video = tracks.addClip(videoTrack(tracks, 0), "VIDEO", 5, 30);
  const audio = tracks.addClip(audioTrack(tracks, 0), "AUDIO", 5, 30);
  video.link = link;
  audio.link = link;
  link.clips.push(video, audio);
  tracks.timeline.sequence.clipLinks.links[link.key] = link;
  video.track = videoTrack(tracks, 0);
  audio.track = audioTrack(tracks, 0);
  const dragContext = drag([tracks.makeProxy(video), tracks.makeProxy(audio)]);
  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  const project = serialize(tracks.timeline.sequence);
  assert.deepEqual(project.videoTracks.map(track => track.clips.length), [0, 1, 0, 0]);
  assert.deepEqual(project.videoTracks[1].clips.map(clip => clip.name), ["VIDEO"]);
  assert.deepEqual(project.clipLinks.links["3"].clips, [
    [0, 1, 1, 0, 0],
    [0, 2, 0, 0, 0],
  ], "link addresses are recomputed after the insert");

  const reloaded = load(project);
  assert.deepEqual(reloaded.videoTracks.map(track => track.clips.map(clip => clip.name)),
    [[], ["VIDEO"], [], []]);
  assert.deepEqual(reloaded.audioTracks.map(track => track.clips.map(clip => clip.name)),
    [["AUDIO"], []]);
  const restored = reloaded.clipLinks.links["3"];
  assert.equal(restored.clips[0].name, "VIDEO");
  assert.equal(restored.clips[1].name, "AUDIO");
  assert.equal(restored.clips[0].link, restored);
  assert.equal(restored.clips[1].link, restored);
});

test("a project without an insert serializes exactly as before", () => {
  const { tracks } = setup();
  const video = tracks.addClip(videoTrack(tracks, 0), "COLOR", 0, 30);
  video.track = videoTrack(tracks, 0);
  const before = serialize(tracks.timeline.sequence);
  const reloaded = load(before);
  assert.deepEqual(serialize(reloaded), before);
});
