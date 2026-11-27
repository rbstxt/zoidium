"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DRAG_STATE_KEY } = require("../plugins/core/timeline-track-insert");

const {
  setup,
  pointer,
  placeProxy,
  videoTrack,
  audioTrack,
  serialize,
  load,
} = require("./helpers/timeline-track-fixture.cjs");

// ---------------------------------------------------------------------------
// Row drops never overwrite
// ---------------------------------------------------------------------------

test("a row drop that would overlap creates a row at destination + 1", () => {
  const { tracks, drag, history } = setup();
  const thyro = tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.candidate, null, "the row middle is not a boundary");
  assert.equal(state.line.style.display, "", "the new-row line shows for the overlap");
  assert.ok(Math.abs(Number.parseFloat(state.line.style.top) - 39) <= 1, "line at the destination top edge");
  assert.equal(proxy.style.display, "none");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 1);
  assert.equal(tracks.createdTracks[0].type, 0);
  assert.equal(tracks.createdTracks[0].newTrackIdx, 2, "directly above the destination row");
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4);
  assert.equal(videoTrack(tracks, 2).clips[0], color, "the clip lands on the new row");
  assert.equal(videoTrack(tracks, 2).clips[0].start, 10, "the dropped time is kept");
  assert.equal(videoTrack(tracks, 1).clips[0], thyro, "the other clip stays where it was");
  assert.equal(thyro.start, 0, "the other clip keeps its start");
  assert.equal(thyro.length, 100, "the other clip is not trimmed");
  assert.equal(thyro.name, "THYRO", "the other clip keeps its content");
  assert.equal(history.undoStack.length, 1, "one undo step");
  assert.equal(tracks.blockedMoves, 0);
});

test("a row drop with no overlap places the clip on that row", () => {
  const { tracks, drag } = setup();
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);

  assert.equal(dragContext[DRAG_STATE_KEY].candidate, null);
  assert.equal(tracks.rootContainsLine(), false, "no new row, no line");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(videoTrack(tracks, 1).clips[0], color);
  assert.equal(videoTrack(tracks, 1).clips[0].start, 10);
});

test("clips that only touch end to start are not an overlap", () => {
  const first = setup();
  const thyro = first.tracks.addClip(videoTrack(first.tracks, 1), "THYRO", 0, 100);
  const color = first.tracks.addClip(videoTrack(first.tracks, 0), "COLOR", 100, 30);
  const firstProxy = first.tracks.makeProxy(color);
  const firstDrag = first.drag([firstProxy]);
  firstDrag.clipDragStart({ type: "mousedown" });
  placeProxy(first.tracks, firstProxy, 1, 100);
  pointer(firstDrag, 60);
  firstDrag.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(first.tracks.createdTracks.length, 0, "touching after the end is not an overlap");
  assert.equal(videoTrack(first.tracks, 1).clips.includes(color), true);
  assert.equal(thyro.start, 0);
  assert.equal(thyro.length, 100);

  const second = setup();
  const neighbour = second.tracks.addClip(videoTrack(second.tracks, 1), "THYRO", 100, 50);
  const before = second.tracks.addClip(videoTrack(second.tracks, 0), "COLOR", 70, 30);
  const secondProxy = second.tracks.makeProxy(before);
  const secondDrag = second.drag([secondProxy]);
  secondDrag.clipDragStart({ type: "mousedown" });
  placeProxy(second.tracks, secondProxy, 1, 70);
  pointer(secondDrag, 60);
  secondDrag.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(second.tracks.createdTracks.length, 0, "touching before the start is not an overlap");
  assert.equal(neighbour.start, 100);
  assert.equal(neighbour.length, 50);
});

test("a multi-row drop inserts one row per overlapping destination row", () => {
  const { tracks, drag, history } = setup({ videoCount: 4 });
  const lowNeighbour = tracks.addClip(videoTrack(tracks, 2), "LOWNEIGHBOUR", 0, 100);
  const highNeighbour = tracks.addClip(videoTrack(tracks, 3), "HIGHNEIGHBOUR", 0, 100);
  const lower = tracks.addClip(videoTrack(tracks, 0), "LOWER", 10, 30);
  const upper = tracks.addClip(videoTrack(tracks, 1), "UPPER", 10, 30);
  const lowerProxy = tracks.makeProxy(lower);
  const upperProxy = tracks.makeProxy(upper);
  const dragContext = drag([lowerProxy, upperProxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, lowerProxy, 2, 10);
  placeProxy(tracks, upperProxy, 3, 10);
  pointer(dragContext, 20);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.deepEqual(tracks.createdTracks.map(command => command.newTrackIdx), [3, 5]);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 6);
  assert.equal(videoTrack(tracks, 3).clips[0], lower, "the lower source keeps the lower new row");
  assert.equal(videoTrack(tracks, 5).clips[0], upper, "the upper source keeps the upper new row");
  assert.equal(videoTrack(tracks, 2).clips[0], lowNeighbour, "the lower neighbour is untouched");
  assert.equal(videoTrack(tracks, 4).clips[0], highNeighbour, "the upper neighbour is only shifted");
  assert.equal(lowNeighbour.length, 100);
  assert.equal(highNeighbour.length, 100);
  assert.equal(history.undoStack.length, 1);

  assert.equal(history.undo(), true);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4, "undo removes both rows");
  assert.equal(videoTrack(tracks, 0).clips[0], lower);
  assert.equal(videoTrack(tracks, 1).clips[0], upper);
  assert.equal(videoTrack(tracks, 2).clips[0], lowNeighbour);
  assert.equal(videoTrack(tracks, 3).clips[0], highNeighbour);
});

test("a linked audio partner gets a new audio row only when it would overlap", () => {
  const build = () => {
    const context = setup();
    const link = { key: 7, clips: [] };
    const video = context.tracks.addClip(videoTrack(context.tracks, 0), "VIDEO", 0, 30);
    const audio = context.tracks.addClip(audioTrack(context.tracks, 0), "AUDIO", 0, 30);
    video.link = link;
    audio.link = link;
    link.clips.push(video, audio);
    context.tracks.timeline.sequence.clipLinks.links[link.key] = link;
    video.track = videoTrack(context.tracks, 0);
    audio.track = audioTrack(context.tracks, 0);
    context.tracks.addClip(videoTrack(context.tracks, 1), "THYRO", 0, 100);
    const videoProxy = context.tracks.makeProxy(video);
    const audioProxy = context.tracks.makeProxy(audio);
    const dragContext = context.drag([videoProxy, audioProxy]);
    return { ...context, link, video, audio, videoProxy, audioProxy, dragContext };
  };

  const empty = build();
  empty.dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(empty.tracks, empty.videoProxy, 1, 0);
  placeProxy(empty.tracks, empty.audioProxy, 1, 0);
  pointer(empty.dragContext, 60);
  empty.dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(empty.tracks.createdTracks.length, 1, "only the video row is inserted");
  assert.equal(empty.tracks.createdTracks[0].type, 0);
  assert.equal(audioTrack(empty.tracks, 1).clips[0], empty.audio, "the partner lands on its own audio row");
  assert.equal(empty.video.link, empty.link);
  assert.equal(empty.audio.link, empty.link);

  const overlapping = build();
  overlapping.tracks.addClip(audioTrack(overlapping.tracks, 1), "MUSIC", 0, 100);
  overlapping.dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(overlapping.tracks, overlapping.videoProxy, 1, 0);
  placeProxy(overlapping.tracks, overlapping.audioProxy, 1, 0);
  pointer(overlapping.dragContext, 60);
  overlapping.dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.deepEqual(overlapping.tracks.createdTracks.map(command => [command.type, command.newTrackIdx]),
    [[0, 2], [1, 2]], "each kind gets its own new row");
  assert.equal(audioTrack(overlapping.tracks, 2).clips[0], overlapping.audio);
  assert.equal(audioTrack(overlapping.tracks, 1).clips[0].name, "MUSIC");
  assert.equal(overlapping.video.link, overlapping.link);
  assert.equal(overlapping.audio.link, overlapping.link);
});

test("a locked destination row refuses the no-overwrite insert", () => {
  const isLocked = track => track?.zoidiumLocked === true;
  const { tracks, drag } = setup({ isLocked });
  videoTrack(tracks, 1).zoidiumLocked = true;
  const thyro = tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "a locked destination inserts nothing");
  assert.equal(tracks.blockedMoves, 1, "the native lock guard still refuses the move");
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3);
  assert.equal(videoTrack(tracks, 0).clips[0], color);
  assert.equal(thyro.start, 0);
  assert.equal(thyro.length, 100);
});

test("a locked source row still refuses the no-overwrite insert", () => {
  const isLocked = track => track?.zoidiumLocked === true;
  const { tracks, drag } = setup({ isLocked });
  videoTrack(tracks, 0).zoidiumLocked = true;
  const thyro = tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(tracks.blockedMoves, 1);
  assert.equal(videoTrack(tracks, 0).clips[0], color);
  assert.equal(thyro.length, 100);
});

test("holding Shift keeps the native overwrite on a row drop", () => {
  const { tracks, drag } = setup();
  tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60, { shiftKey: true });

  assert.equal(tracks.rootContainsLine(), false, "overwrite mode shows no insertion line");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: true });

  assert.equal(tracks.createdTracks.length, 0, "the overwrite drop inserts no row");
  assert.equal(tracks.moveCalls.length, 1);
  assert.equal(tracks.moveCalls[0].createOnly, false);
  assert.equal(videoTrack(tracks, 1).clips.includes(color), true, "the clip uses the native row drop");
});

test("a zoomed drop reads the frame range through pxToFrame", () => {
  // 0.5 zoom: frame 60 is 30 px. A px-only read of 30..45 would overlap the
  // neighbour 0..40; the frames 60..90 do not.
  const { tracks, drag } = setup({ zoom: 0.5 });
  tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 40);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 60, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 60);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0, "the frame ranges do not overlap");
  assert.equal(videoTrack(tracks, 1).clips.includes(color), true);
  assert.equal(color.start, 60);
});

test("the insertion line follows Shift without a mouse move", () => {
  const { tracks, drag, document } = setup();
  tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);

  const state = dragContext[DRAG_STATE_KEY];
  assert.equal(state.line.style.display, "", "the overlap line shows");
  assert.equal(document.listenerCount("keydown"), 1);

  document.dispatch("keydown", { type: "keydown", key: "Shift", shiftKey: true });
  assert.equal(state.shiftKey, true);
  assert.equal(state.line.style.display, "none", "Shift hides the line");

  document.dispatch("keyup", { type: "keyup", key: "Shift", shiftKey: false });
  assert.equal(state.shiftKey, false);
  assert.equal(state.line.style.display, "", "releasing Shift shows it again");

  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });
  assert.equal(document.listenerCount("keydown"), 0, "the listeners are removed on end");
  assert.equal(document.listenerCount("keyup"), 0);
});

test("Escape removes the drag key listeners", () => {
  const { tracks, drag, document } = setup();
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  assert.equal(document.listenerCount("keydown"), 1);
  dragContext.clipDragEnd({ type: "keydown", key: "Escape", altKey: false, shiftKey: false });
  assert.equal(document.listenerCount("keydown"), 0);
  assert.equal(document.listenerCount("keyup"), 0);
});

test("Escape cancels an overlapping row drop and changes nothing", () => {
  const { tracks, drag, history } = setup();
  const thyro = tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);

  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "keydown", key: "Escape", altKey: false, shiftKey: false });

  assert.equal(tracks.createdTracks.length, 0);
  assert.equal(tracks.moveClipCalls.length, 0);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3);
  assert.equal(videoTrack(tracks, 0).clips[0], color);
  assert.equal(thyro.start, 0);
  assert.equal(thyro.length, 100);
  assert.equal(history.undoStack.length, 0);
  assert.equal(tracks.rootContainsLine(), false);
  assert.equal(proxy.removed, true);
});

test("one undo reverts an overlapping row drop and redo repeats it", () => {
  const { tracks, drag, history } = setup();
  const thyro = tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const color = tracks.addClip(videoTrack(tracks, 0), "COLOR", 10, 30);
  const proxy = tracks.makeProxy(color);
  const dragContext = drag([proxy]);
  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, proxy, 1, 10);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  assert.equal(videoTrack(tracks, 2).clips[0], color);
  assert.equal(history.undo(), true);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 3, "undo removes the new row");
  assert.equal(videoTrack(tracks, 0).clips[0], color, "undo returns the clip to V1");
  assert.equal(videoTrack(tracks, 0).clips[0].start, 10);
  assert.equal(videoTrack(tracks, 1).clips[0], thyro);
  assert.equal(thyro.length, 100);

  assert.equal(history.redo(), true);
  assert.equal(tracks.timeline.sequence.videoTracks.length, 4, "redo recreates the row");
  assert.equal(videoTrack(tracks, 2).clips[0], color);
  assert.equal(videoTrack(tracks, 0).clips.length, 0);
});


test("a project saved after a no-overwrite drop reloads the same order and links", () => {
  const { tracks, drag } = setup();
  const link = { key: 9, clips: [] };
  const video = tracks.addClip(videoTrack(tracks, 0), "VIDEO", 10, 30);
  const audio = tracks.addClip(audioTrack(tracks, 0), "AUDIO", 10, 30);
  video.link = link;
  audio.link = link;
  link.clips.push(video, audio);
  tracks.timeline.sequence.clipLinks.links[link.key] = link;
  video.track = videoTrack(tracks, 0);
  audio.track = audioTrack(tracks, 0);
  tracks.addClip(videoTrack(tracks, 1), "THYRO", 0, 100);
  const videoProxy = tracks.makeProxy(video);
  const audioProxy = tracks.makeProxy(audio);
  const dragContext = drag([videoProxy, audioProxy]);
  dragContext.clipDragStart({ type: "mousedown" });
  placeProxy(tracks, videoProxy, 1, 10);
  placeProxy(tracks, audioProxy, 1, 10);
  pointer(dragContext, 60);
  dragContext.clipDragEnd({ type: "mouseup", altKey: false, shiftKey: false });

  const project = serialize(tracks.timeline.sequence);
  assert.deepEqual(project.videoTracks.map(track => track.clips.map(clip => clip.name)),
    [[], ["THYRO"], ["VIDEO"], []]);
  assert.deepEqual(project.audioTracks.map(track => track.clips.map(clip => clip.name)),
    [[], ["AUDIO"]]);
  assert.deepEqual(project.clipLinks.links["9"].clips, [
    [0, 1, 2, 0, 0],
    [0, 2, 1, 0, 0],
  ], "link addresses are recomputed after the new row");

  const reloaded = load(project);
  assert.deepEqual(reloaded.videoTracks.map(track => track.clips.map(clip => clip.name)),
    [[], ["THYRO"], ["VIDEO"], []]);
  assert.deepEqual(reloaded.audioTracks.map(track => track.clips.map(clip => clip.name)),
    [[], ["AUDIO"]]);
  assert.equal(reloaded.videoTracks[2].clips[0].start, 10);
  assert.equal(reloaded.videoTracks[1].clips[0].length, 100);
  const restored = reloaded.clipLinks.links["9"];
  assert.equal(restored.clips[0].name, "VIDEO");
  assert.equal(restored.clips[1].name, "AUDIO");
  assert.equal(restored.clips[0].link, restored);
  assert.equal(restored.clips[1].link, restored);
});
