// Precomp+ timeline integration (split from comps.js).
// Timeline lookup, sequence application, history helpers and undo commands.
// Loaded through the shared bundle module loader with PZ in scope.
const model = require("./comps-model.js");
const clone = model.clone;
const cloneCompRef = model.cloneCompRef;
const compName = model.compName;
const findComp = model.findComp;
const snapshotMedia = model.snapshotMedia;
const insertMedia = model.insertMedia;
const applyTrackSwitches = model.applyTrackSwitches;
const SKIP_KEYS = new Set([
  "project", "sequence", "history", "recovery", "playback", "defaultProject",
  "window", "windows", "document", "el", "container", "parent", "parentObject",
]);

let cachedTracks = null;

function findTimelineTracks(editor) {
  const Tracks = PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;
  if (typeof Tracks !== "function" || !editor) return null;
  if (cachedTracks && cachedTracks.timeline && cachedTracks.timeline.editor === editor) return cachedTracks;
  // CM3 keeps the timeline under the main window's split panels, rather
  // than directly on the editor. Start there before scanning other objects.
  const queue = Array.from(editor.windows || []).map(function (win) { return win.panel; });
  queue.push(editor);
  const seen = new Set();
  let budget = 5000;
  while (queue.length && budget > 0) {
    budget -= 1;
    const node = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node) || node.nodeType) continue;
    if (node === globalThis) continue;
    seen.add(node);
    if (node instanceof Tracks) {
      cachedTracks = node;
      return node;
    }
    Object.keys(node).forEach(function (key) {
      if (SKIP_KEYS.has(key)) return;
      let value = null;
      try {
        value = node[key];
      } catch (error) {
        return;
      }
      if (value && typeof value === "object") queue.push(value);
    });
  }
  return null;
}

function refreshTimeline(editor) {
  const tracks = findTimelineTracks(editor);
  if (tracks) {
    try {
      tracks.deselectClips();
      tracks.redraw();
      tracks.zoom();
    } catch (error) {
      console.error("[Precomp+] timeline refresh failed:", error);
    }
  }
  try {
    editor.project.ui.onChanged.update();
  } catch (error) {
    console.error("[Precomp+] viewport refresh failed:", error);
  }
}

function applySequence(editor, json) {
  const seq = editor.project.sequence;
  seq.videoTracks.splice(0, seq.videoTracks.length);
  seq.audioTracks.splice(0, seq.audioTracks.length);
  seq.load(clone(json));
  // The host loader keeps only clips; reapply the stored track switches so
  // muted and 3D tracks stay muted and 3D when a composition opens.
  const data = json || {};
  (data.videoTracks || []).forEach(function (trackJSON, i) {
    if (seq.videoTracks[i]) applyTrackSwitches(seq.videoTracks[i], trackJSON);
  });
  (data.audioTracks || []).forEach(function (trackJSON, i) {
    if (seq.audioTracks[i]) applyTrackSwitches(seq.audioTracks[i], trackJSON);
  });
  refreshTimeline(editor);
}

// Undo entries refer to clip objects that are replaced by a switch, so the
// stacks are cleared whenever the live sequence changes meaning.
function clearHistory(editor) {
  const history = editor.history;
  if (!history) return;
  if (history.undoStack) history.undoStack.clear();
  if (history.redoStack) history.redoStack.clear();
  history.operation = null;
}

function runOperation(editor, work) {
  const history = editor.history;
  history.startOperation();
  try {
    return work();
  } finally {
    history.finishOperation();
  }
}

// History commands. Each takes its parameters as data and pushes its inverse.
function cmdInsertComp(p) {
  insertMedia(p.project, p.snapshot, p.index);
  p.editor.history.pushCommand(cmdRemoveComp, { editor: p.editor, project: p.project, id: p.snapshot.comp.id });
}

function cmdRemoveComp(p) {
  const media = findComp(p.project, p.id);
  if (!media) return;
  const index = p.project.media.indexOf(media);
  const snapshot = snapshotMedia(p.project, media);
  media.unload();
  p.project.media.splice(index, 1);
  p.editor.history.pushCommand(cmdInsertComp, { editor: p.editor, project: p.project, snapshot: snapshot, index: index });
}

function cmdRenameComp(p) {
  const media = findComp(p.project, p.id);
  if (!media) return;
  const previous = compName(media);
  media.properties.name.set(p.name);
  p.editor.history.pushCommand(cmdRenameComp, { editor: p.editor, project: p.project, id: p.id, name: previous });
}

function clearTimelineCache() {
  cachedTracks = null;
}

module.exports = {
  findTimelineTracks: findTimelineTracks,
  refreshTimeline: refreshTimeline,
  applySequence: applySequence,
  clearHistory: clearHistory,
  runOperation: runOperation,
  cmdInsertComp: cmdInsertComp,
  cmdRemoveComp: cmdRemoveComp,
  cmdRenameComp: cmdRenameComp,
  clearTimelineCache: clearTimelineCache,
};

