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
        // A throwing host getter only skips that key; the scan continues.
        return;
      }
      if (value && typeof value === "object") queue.push(value);
    });
  }
  return null;
}

function clearSelection(tracks) {
  tracks.deselectClips();
  // Native deselectClips only removes CSS classes. The shared observable
  // list also drives Edit, Objects, Effects, and the viewport.
  tracks.selection.splice(0, tracks.selection.length);
}

function refreshTimeline(editor) {
  const tracks = findTimelineTracks(editor);
  if (tracks) {
    try {
      clearSelection(tracks);
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

function replacementData(seq, json) {
  // CM3 appends keys, even defaults for omitted properties. Supply preserved
  // keys for partial/older JSON before clearing lists the loader will refill.
  const data = clone(json), keyLists = [];
  function replacement(node, incoming) {
    if (node.keyframes) {
      keyLists.push(node.keyframes);
      return Array.isArray(incoming?.keyframes) ? incoming : {
        ...clone(node), ...incoming, keyframes: clone(node.keyframes),
      };
    }
    if (node.objects) {
      const result = { ...incoming };
      result.objects = Array.from(node.objects, (property, index) => replacement(property,
        Array.isArray(incoming?.keyframes) ? {
          ...incoming.objects?.[index], animated: incoming.animated,
          keyframes: incoming.keyframes.map(key => ({ ...key, value: key.value[index] })),
        } : incoming?.objects?.[index]));
      // Legacy grouped keys are now represented by the normalized axis lists.
      delete result.keyframes;
      return result;
    }
    if (typeof node[Symbol.iterator] === "function") {
      const result = Array.isArray(node) ? [] : { ...incoming };
      for (const key of Object.keys(node)) result[key] = replacement(node[key], incoming?.[key]);
      return result;
    }
    return incoming;
  }
  data.properties = replacement(seq.properties, data.properties);
  for (const keys of keyLists) keys.splice(0, keys.length);
  return data;
}

function applySequence(editor, json) {
  const seq = editor.project.sequence;
  const data = replacementData(seq, json);
  // Release outgoing resources while their project ancestry is attached.
  for (const track of [...seq.videoTracks, ...seq.audioTracks]) {
    for (const clip of track.clips) {
      try { clip.unload(); }
      catch (error) { console.error("[Precomp+] outgoing clip unload failed:", error); }
    }
  }
  seq.videoTracks.splice(0, seq.videoTracks.length);
  seq.audioTracks.splice(0, seq.audioTracks.length);
  seq.load(data);
  // The host loader keeps only clips; reapply the stored track switches so
  // muted and 3D tracks stay muted and 3D when a composition opens.
  (data.videoTracks || []).forEach(function (trackJSON, i) {
    if (seq.videoTracks[i]) applyTrackSwitches(seq.videoTracks[i], trackJSON);
  });
  (data.audioTracks || []).forEach(function (trackJSON, i) {
    if (seq.audioTracks[i]) applyTrackSwitches(seq.audioTracks[i], trackJSON);
  });
  refreshTimeline(editor);
}

// The sequence and property lists stay attached to the native UI. Park the
// actual tracks and keys, so history closures keep their original objects.
function visitKeyProperties(node, visit, path = []) {
  if (!node || typeof node !== "object") return;
  if (node.keyframes) visit(node, path);
  else if (node.objects) node.objects.forEach((child, index) => visitKeyProperties(child, visit, path.concat("objects", index)));
  else if (typeof node[Symbol.iterator] === "function") {
    for (const key of Object.keys(node)) visitKeyProperties(node[key], visit, path.concat(key));
  }
}

function captureSequence(seq) {
  const keys = [];
  visitKeyProperties(seq.properties, (property, path) => keys.push({ property, path, keys: Array.from(property.keyframes) }));
  return { json: clone(seq), videoTracks: Array.from(seq.videoTracks),
    audioTracks: Array.from(seq.audioTracks), clipLinks: seq.clipLinks, keys };
}

function detachTracks(seq) {
  for (const list of [seq.videoTracks, seq.audioTracks]) {
    const tracks = list.splice(0, list.length);
    // Keep asset ownership available while this authored timeline is parked.
    for (const track of tracks) track.parent = list;
  }
}

function restoreSequence(editor, state) {
  require("./comps-resources.js").resume(state);
  const seq = editor.project.sequence;
  detachTracks(seq);
  const data = replacementData(seq, state.json);
  seq.properties.load(data.properties);
  for (const entry of state.keys) {
    entry.property.keyframes.splice(0, entry.property.keyframes.length, ...entry.keys);
  }
  seq.videoTracks.push(...state.videoTracks);
  seq.audioTracks.push(...state.audioTracks);
  seq.clipLinks = state.clipLinks;
  seq.length = state.json.length;
  PZ.schedule.analyzeSequence(seq);
  refreshTimeline(editor);
}

// Timing commands change stored timelines as JSON. Apply those changes to
// parked objects in place before they can be reopened by a history switch.
function updateSequenceTiming(state, json) {
  function update(node, data) {
    if (!node || data === undefined || data === null) return;
    if (node.keyframes && data.keyframes) {
      data.keyframes.forEach((key, index) => node.keyframes[index].load(key));
    } else if (typeof data !== "object") {
      if (typeof node.set === "function") node.set(data);
    } else {
      for (const key of Object.keys(data)) {
        if (["start", "length", "offset"].includes(key) && typeof data[key] === "number") node[key] = data[key];
        else if (key !== "type") update(node[key], data[key]);
      }
    }
  }
  for (const type of ["videoTracks", "audioTracks"]) update(state[type], json[type] || []);
  for (const entry of state.keys) {
    let data = json.properties;
    for (const key of entry.path) data = data?.[key];
    if (data?.keyframes) data.keyframes.forEach((key, index) => entry.keys[index].load(key));
  }
  state.json = clone(json);
}

// Explicit history reset for destructive sequence replacement. Composition
// navigation preserves live objects and records a switch instead.
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

// The Tracks patch in comps.js remembers the live timeline as CM3 draws it.
function rememberTimelineTracks(tracks) {
  cachedTracks = tracks;
}

module.exports = {
  findTimelineTracks: findTimelineTracks,
  refreshTimeline: refreshTimeline,
  clearSelection: clearSelection,
  applySequence: applySequence,
  captureSequence,
  detachTracks,
  restoreSequence,
  updateSequenceTiming,
  clearHistory: clearHistory,
  runOperation: runOperation,
  cmdInsertComp: cmdInsertComp,
  cmdRemoveComp: cmdRemoveComp,
  cmdRenameComp: cmdRenameComp,
  clearTimelineCache: clearTimelineCache,
  rememberTimelineTracks: rememberTimelineTracks,
};

