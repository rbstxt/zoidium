"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DRAG_STATE_KEY,
  BOUNDARY_TOLERANCE_PX,
  BOUNDARY_TOLERANCE_RATIO,
  BOUNDARY_TOLERANCE_MAX_RATIO,
  boundaryTolerance,
  findBoundary,
  rowRects,
  planBoundaryInsert,
} = require("../plugins/core/timeline-track-insert");

const {
  Element,
  setup,
  pointer,
  placeProxy,
  nativeRowIndex,
  scrollWindow,
  videoTrack,
  audioTrack,
  serialize,
  load,
} = require("./helpers/timeline-track-fixture.cjs");

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
  assert.equal(findBoundary(rows, 80, true).index, 1, "edge between V1 and V2");
  assert.equal(findBoundary(rows, 40, true).index, 2, "edge between V2 and V3");
  assert.equal(findBoundary(rows, 80 - 8, true).index, 1, "8 px above the edge is inside the 12 px band");
  assert.equal(findBoundary(rows, 60, true), null, "row centre is not a boundary");
  assert.equal(findBoundary(rows, 100, true), null, "20 px past the band away from an edge");
});

test("a boundary hit picks the index of the lower array row for audio", () => {
  const rows = [
    { top: 200, height: 40 },
    { top: 240, height: 40 },
    { top: 280, height: 40 },
  ];
  assert.equal(findBoundary(rows, 240, false).index, 1);
  assert.equal(findBoundary(rows, 280, false).index, 2);
  assert.equal(findBoundary(rows, 220, false), null, "A1 centre");
});

test("the band is 6 px, 30% of the row, capped at 45%", () => {
  const almost = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, message || actual + " != " + expected);
  assert.equal(BOUNDARY_TOLERANCE_PX, 6);
  assert.equal(BOUNDARY_TOLERANCE_RATIO, 0.3);
  assert.equal(BOUNDARY_TOLERANCE_MAX_RATIO, 0.45);
  assert.equal(boundaryTolerance(40), 12);
  almost(boundaryTolerance(24), 7.2);
  assert.equal(boundaryTolerance(16), 6);
  almost(boundaryTolerance(10), 4.5, "the 45% cap wins on very short rows");
  almost(boundaryTolerance(4), 1.8);
  assert.equal(boundaryTolerance(0), 0);
  assert.equal(boundaryTolerance(undefined), 0);
});

test("the middle of a 16, 24 and 40 px row is never a boundary", () => {
  for (const height of [16, 24, 40]) {
    const rows = [{ top: height, height }, { top: 0, height }];
    const band = boundaryTolerance(height);
    assert.equal(findBoundary(rows, height / 2, true), null, "middle of a " + height + " px row");
    assert.equal(findBoundary(rows, height - band, true).index, 1, "band edge of a " + height + " px row");
    assert.equal(findBoundary(rows, height - band - 0.5, true), null, "just outside the band");
  }
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
  assert.deepEqual(rowRects(container).map(row => ({ top: row.top, height: row.height })),
    [{ top: 20, height: 40 }]);
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
// Outer edges
// ---------------------------------------------------------------------------

test("the outer bottom edge of the video container inserts at index 0", () => {
  const { tracks, drag, history } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 1), "COLOR", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 124);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 0);
  assert.equal(state.candidate.index, 0);
  assert.equal(state.candidate.outer, true);
  assert.equal(state.candidate.native, false);
  assert.equal(state.line.style.display, "");
  assert.ok(Math.abs(Number.parseFloat(state.line.style.top) - 119) <= 1);

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(tracks.createdTracks[0].type, 0);
  assert.equal(tracks.createdTracks[0].newTrackIdx, 0);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4);
  assert.equal(videoTrack(tracks, 0).clips[0], clip, "the clip lands on the new bottom row");
  assert.equal(videoTrack(tracks, 0).clips[0].start, 10);
  assert.equal(history.undoStack.length, 1);
});

test("the outer top edge of the audio container inserts at index 0", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(audioTrack(tracks, 1), "MUSIC", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 196);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 1);
  assert.equal(state.candidate.index, 0);
  assert.equal(state.candidate.outer, true);
  assert.equal(state.candidate.native, false);

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(tracks.createdTracks[0].type, 1);
  assert.equal(tracks.createdTracks[0].newTrackIdx, 0);
  assert.equal(audioTrack(tracks, 0).clips[0], clip);
  assert.equal(audioTrack(tracks, 0).clips[0].start, 10);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3, "an audio edge never adds video");
});

test("a drag past the last video row keeps the native new-row path", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 2), "COLOR", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, -10);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 0);
  assert.equal(state.candidate.index, 3, "a new row above the last row");
  assert.equal(state.candidate.native, true, "the native insertTrackProxies path owns it");
  assert.equal(state.line.style.display, "", "the insertion line still shows");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "the module does not insert a second row");
  assert.equal(tracks.trackProxyCalls.length, 1, "the native insert path still runs");
  assert.equal(tracks.moveCalls.length, 1);
});

test("a drag past the last audio row keeps the native new-row path", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(audioTrack(tracks, 1), "MUSIC", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 284);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate.type, 1);
  assert.equal(state.candidate.index, 2);
  assert.equal(state.candidate.native, true);

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });
  assert.equal(tracks.createdTracks.length, 0);
});

test("a far outer edge drop never plans a second row", () => {
  const { tracks, drag } = setup();
  const neighbour = tracks.addClip(videoTrack(tracks, 2), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  // The pointer is past the top row, and the proxy sits on that row where it
  // overlaps the neighbour. A no-overwrite plan would insert a second row next
  // to the one insertTrackProxies already creates.
  placeProxy(tracks, proxy, 2, 10);
  pointer(dragContext, -10);
  assert.equal(dragContext[DRAG_STATE_KEY].candidate.native, true);

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "the native path owns the new row");
  assert.equal(tracks.trackProxyCalls.length, 1, "the native insert path still runs");
  assert.equal(tracks.moveCalls.length, 1, "the move reaches the host directly");
  assert.equal(neighbour.start, 0);
  assert.equal(neighbour.length, 100);
});

test("holding Shift still inserts a track on a boundary", () => {
  const { tracks, drag } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 78, { shiftKey: true });
  assert.equal(dragContext[DRAG_STATE_KEY].candidate.index, 1, "the boundary line still shows");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: true });

  assert.equal(tracks.createdTracks.length, 1, "Shift keeps the boundary insert");
  assert.equal(tracks.createdTracks[0].newTrackIdx, 1);
  assert.equal(videoTrack(tracks, 1).clips[0], clip);
});

// ---------------------------------------------------------------------------
// Coordinate space
// ---------------------------------------------------------------------------

test("a scrolled, offset, zoomed pointer picks the native row", () => {
  const { tracks, drag, videoContainer } = setup({ scrollTop: 40, scrollLeft: 12, offset: 120, zoom: 2 });
  const clip = tracks.addClip(videoTrack(tracks, 1), "COLOR", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });

  // Row 1 spans content 40..80 and client 120..160.
  pointer(dragContext, 140);
  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(nativeRowIndex(videoContainer, 0, dragContext.currentPt.y), 1);
  assert.equal(state.candidate, null, "the row middle is not a boundary");

  pointer(dragContext, 120);
  assert.equal(nativeRowIndex(videoContainer, 0, dragContext.currentPt.y), 2);
  assert.equal(state.candidate.index, 2, "the boundary above native row 2");
  assert.equal(state.candidate.type, 0);
});

test("a window scroll during the drag keeps the native boundary", () => {
  const { tracks, drag, videoContainer } = setup();
  const clip = tracks.addClip(videoTrack(tracks, 1), "COLOR", 10, 30);
  const dragContext = drag([tracks.makeProxy(clip)]);

  dragContext.clipDragStart({ type: "mousedown" });
  pointer(dragContext, 40);
  assert.equal(dragContext[DRAG_STATE_KEY].candidate.index, 2);

  // The window scrolls by 20 without a new drag start: the client rects move,
  // the drag origin does not. Native uses the drag-relative y, so the same
  // page position still selects the same boundary.
  scrollWindow(tracks, 20);
  pointer(dragContext, 40);
  assert.equal(nativeRowIndex(videoContainer, 0, dragContext.currentPt.y), 2);
  assert.equal(dragContext[DRAG_STATE_KEY].candidate.index, 2);
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
