// Precomp+ engine. Evaluated once per session with the CM3 global PZ and
// published as PZ.precomp.
//
// Model
// - A composition is a project media entry with a stable `comp.id`. Its
//   `data` is CM3 track JSON (video tracks type 0, audio tracks type 1).
// - A composition clip is a composite layer (CM3 type 2) that carries
//   `compId` and `offset`. Its children are the composition's active clips.
// - Main and one open composition share the project's single live sequence.
//   Opening a composition loads its tracks into that sequence and keeps Main
//   as a JSON snapshot. project.toJSON reports Main and the open composition
//   correctly, so saving never depends on which one is on screen.
//
// Rendering
// - Comp time = clip-local time + offset. The active children are computed
//   from that time alone. track.update also sets them before the compositor
//   checks whether a composite has anything to draw.
// - Video inside a composition is scheduled through the same CM3 schedule as
//   Main, using proxies whose timeline position is mapped to Main time.
//
// User-facing results are returned as { ok, message } and shown by the UI.

if (PZ.precomp && PZ.precomp.version === 2) return;

const VERSION = 2;
const COMP_TYPE = 2;
const MAX_NAME_LENGTH = 60;
const MAIN_ID = "main";
const MAX_DEPTH = 16;
const SKIP_KEYS = new Set([
  "project", "sequence", "history", "recovery", "playback", "defaultProject",
  "window", "windows", "document", "el", "container", "parent", "parentObject",
]);

const sessions = new WeakMap();
const listeners = new Set();
let cachedTracks = null;
let renderDepth = 0;
let idCounter = 0;

function clone(value) {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
}

function result(ok, message, extra) {
  return Object.assign({ ok: ok, message: message || "" }, extra || {});
}

function fail(message) {
  return result(false, message);
}

function notifyListeners() {
  listeners.forEach(function (fn) {
    try {
      fn();
    } catch (error) {
      console.error("[Precomp+] listener failed:", error);
    }
  });
}

function sessionOf(project) {
  let session = sessions.get(project);
  if (!session) {
    session = { activeId: null, mainJSON: null };
    sessions.set(project, session);
  }
  return session;
}

// ---------------------------------------------------------------------------
// Compositions in the project

function isCompMedia(media) {
  return !!(media && media.comp && typeof media.comp.id === "string");
}

function compMedia(project) {
  return Array.from(project.media).filter(isCompMedia);
}

function findComp(project, id) {
  return compMedia(project).find(function (media) { return media.comp.id === id; }) || null;
}

function compName(media) {
  try {
    return String(media.properties.name.get());
  } catch (error) {
    return "";
  }
}

function lengthOf(tracks) {
  let end = 0;
  tracks.forEach(function (track) {
    (track.clips || []).forEach(function (clip) {
      end = Math.max(end, (clip.start || 0) + (clip.length || 0));
    });
  });
  return Math.max(1, end);
}

function liveTracks(seq) {
  return clone(seq.videoTracks).concat(clone(seq.audioTracks));
}

// The track data a composition or Main currently holds, including the open
// one (which lives in the sequence).
function compTracks(project, session, media) {
  if (session.activeId === media.comp.id) return liveTracks(project.sequence);
  return Array.isArray(media.data) ? media.data : [];
}

function mainTracks(project, session) {
  if (session.activeId === null) return liveTracks(project.sequence);
  const json = session.mainJSON || {};
  return (json.videoTracks || []).concat(json.audioTracks || []);
}

function mainLength(project, session) {
  if (session.activeId === null) return project.sequence.length;
  return (session.mainJSON && session.mainJSON.length) || 1;
}

function commitActive(project, session) {
  const media = session.activeId === null ? null : findComp(project, session.activeId);
  if (!media) return;
  media.data = liveTracks(project.sequence);
  media.comp = { id: media.comp.id, clipLinks: clone(project.sequence.clipLinks) };
}

function sequenceFor(project, media) {
  const data = Array.isArray(media.data) ? media.data : [];
  return {
    properties: clone(project.sequence.properties),
    length: lengthOf(data),
    videoTracks: data.filter(function (track) { return track.type !== 1; }),
    audioTracks: data.filter(function (track) { return track.type === 1; }),
    clipLinks: media.comp.clipLinks || null,
  };
}

function newCompId(project) {
  let id;
  do {
    idCounter += 1;
    id = "comp-" + Date.now().toString(36) + "-" + idCounter.toString(36);
  } while (findComp(project, id));
  return id;
}

function nameProblem(project, name, exceptId) {
  if (!name) return "Enter a name for the composition.";
  if (name.length > MAX_NAME_LENGTH) return "Names can be " + MAX_NAME_LENGTH + " characters or fewer.";
  const key = name.toLowerCase();
  if (key === "main") return "Main is reserved for the main timeline.";
  const taken = compMedia(project).some(function (media) {
    return media.comp.id !== exceptId && compName(media).trim().toLowerCase() === key;
  });
  return taken ? 'A composition named "' + name + '" already exists.' : null;
}

function uniqueName(project, base) {
  let name = base.slice(0, MAX_NAME_LENGTH);
  for (let n = 2; nameProblem(project, name, null); n++) {
    name = base.slice(0, MAX_NAME_LENGTH - 8) + " " + n;
  }
  return name;
}

// Collects composition ids referenced by composite layers in a JSON tree.
function collectCompRefs(node, out) {
  const refs = out || [];
  if (!node || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    node.forEach(function (item) { collectCompRefs(item, refs); });
    return refs;
  }
  if (node.type === COMP_TYPE && typeof node.compId === "string") refs.push(node.compId);
  Object.keys(node).forEach(function (key) { collectCompRefs(node[key], refs); });
  return refs;
}

// Usage of one composition, grouped by where the referencing clips live.
function usageOf(project, session, id) {
  const usage = [];
  const mainCount = collectCompRefs(mainTracks(project, session)).filter(function (ref) { return ref === id; }).length;
  if (mainCount) usage.push({ name: "Main", count: mainCount });
  compMedia(project).forEach(function (media) {
    const count = collectCompRefs(compTracks(project, session, media)).filter(function (ref) { return ref === id; }).length;
    if (count) usage.push({ name: compName(media), count: count });
  });
  return usage;
}

function describeUsage(usage) {
  return usage.map(function (item) {
    return item.count + (item.count === 1 ? " clip" : " clips") + " in " + item.name;
  }).join(" and ");
}

// True when a composition reachable from `roots` contains `targetId`.
function reaches(project, session, roots, targetId) {
  const queue = collectCompRefs(roots);
  const seen = new Set();
  while (queue.length) {
    const id = queue.pop();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const media = findComp(project, id);
    if (media) collectCompRefs(compTracks(project, session, media), queue);
  }
  return false;
}

// Asset keys (the assetList keys) referenced by strings anywhere in `node`.
function collectAssetKeys(project, node) {
  const list = (project.assets && project.assets.list) || {};
  const found = new Set();
  (function walk(value) {
    if (typeof value === "string") {
      if (Object.prototype.hasOwnProperty.call(list, value)) found.add(value);
      return;
    }
    if (value && typeof value === "object") Object.keys(value).forEach(function (key) { walk(value[key]); });
  })(node);
  return Array.from(found);
}

function snapshotMedia(project, media) {
  const list = (project.assets && project.assets.list) || {};
  const keys = [];
  (media.assets || []).forEach(function (asset) {
    const key = Object.keys(list).find(function (candidate) { return list[candidate] === asset; });
    if (key !== undefined) keys.push(key);
  });
  return {
    name: compName(media),
    data: clone(media.data) || [],
    assets: keys,
    comp: { id: media.comp.id, clipLinks: clone(media.comp.clipLinks) },
  };
}

// Creates a composition media entry synchronously. Asset references are taken
// immediately, so clips removed in the same operation cannot drop their assets.
function insertMedia(project, snapshot, index) {
  const media = new PZ.media();
  media.properties.name.set(snapshot.name);
  media.icon = "layers";
  media.creationId = null;
  media.baseType = "track";
  media.preset = false;
  media.data = clone(snapshot.data) || [];
  media.comp = { id: snapshot.comp.id, clipLinks: clone(snapshot.comp.clipLinks) };
  media.assets = [];
  (snapshot.assets || []).forEach(function (key) {
    const asset = project.assets.load(key, true);
    if (asset) media.assets.push(asset);
  });
  media.loaded = true;
  project.media.splice(index, 0, media);
  return media;
}

// ---------------------------------------------------------------------------
// Timeline and history helpers

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

// ---------------------------------------------------------------------------
// Public operations (return { ok, message })

function openComp(editor, id) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return fail("Open a project first.");
  const session = sessionOf(project);
  const wantsMain = id === null || id === undefined || id === MAIN_ID;
  const target = wantsMain ? null : findComp(project, id);
  if (!wantsMain && !target) return fail("That composition no longer exists.");

  if (!target) {
    if (session.activeId === null) return result(true);
    if (!session.mainJSON) return fail("Main could not be restored. Reopen the project.");
    commitActive(project, session);
    applySequence(editor, session.mainJSON);
    session.activeId = null;
    session.mainJSON = null;
  } else {
    if (session.activeId === target.comp.id) return result(true);
    if (session.activeId === null) {
      session.mainJSON = clone(project.sequence);
    } else {
      commitActive(project, session);
    }
    applySequence(editor, sequenceFor(project, target));
    session.activeId = target.comp.id;
  }
  clearHistory(editor);
  notifyListeners();
  return result(true);
}

function precompose(editor, rawName) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return fail("Open a project first.");
  const seq = project.sequence;
  const session = sessionOf(project);
  const tracks = findTimelineTracks(editor);
  if (!tracks) return fail("The timeline is not ready yet.");

  const name = String(rawName == null ? "" : rawName).trim();
  const problem = nameProblem(project, name, null);
  if (problem) return fail(problem);

  tracks.selectClips();
  const selected = new Set(Array.from(tracks.selection || []));
  const picked = [];
  seq.videoTracks.forEach(function (track, trackIdx) {
    track.clips.forEach(function (clip) {
      if (selected.has(clip)) picked.push({ clip: clip, trackIdx: trackIdx });
    });
  });
  if (!picked.length) return fail("Select one or more video clips on the timeline first.");

  const minStart = Math.min.apply(null, picked.map(function (p) { return p.clip.start; }));
  const maxEnd = Math.max.apply(null, picked.map(function (p) { return p.clip.start + p.clip.length; }));
  const trackIdx = freeTrackFor(seq, picked, minStart, maxEnd);
  if (trackIdx < 0) {
    return fail("The selected clips overlap other clips on their tracks. Move those clips first.");
  }

  const moved = picked.map(function (p) { return clone(p.clip); });
  if (session.activeId !== null && reaches(project, session, moved, session.activeId)) {
    return fail("A composition cannot contain itself.");
  }

  const byTrack = new Map();
  picked.forEach(function (p) {
    if (!byTrack.has(p.trackIdx)) byTrack.set(p.trackIdx, []);
    byTrack.get(p.trackIdx).push(p);
  });
  const data = Array.from(byTrack.keys()).sort(function (a, b) { return a - b; }).map(function (idx) {
    const clips = byTrack.get(idx).slice().sort(function (a, b) { return a.clip.start - b.clip.start; });
    return {
      type: 0,
      clips: clips.map(function (p) {
        const json = clone(p.clip);
        json.start -= minStart;
        json.link = null;
        return json;
      }),
    };
  });

  const elements = timelineElementsFor(tracks, picked.map(function (p) { return p.clip; }));
  if (elements.length !== picked.length) {
    return fail("The timeline is still updating. Try Pre-compose again.");
  }

  const id = newCompId(project);
  const snapshot = {
    name: name,
    data: data,
    assets: collectAssetKeys(project, data),
    comp: { id: id, clipLinks: null },
  };
  runOperation(editor, function () {
    cmdInsertComp({ editor: editor, project: project, snapshot: snapshot, index: project.media.length });
    tracks.deleteClips(elements);
    const newIdx = seq.videoTracks[trackIdx].clips.filter(function (clip) {
      return clip.start < minStart;
    }).length;
    tracks.createClip({
      type: 0,
      newTrackIdx: trackIdx,
      newIdx: newIdx,
      start: minStart,
      length: maxEnd - minStart,
      data: {
        properties: { name: name },
        object: { type: COMP_TYPE, compId: id, offset: 0, properties: { name: name }, effects: [], objects: [] },
      },
    });
  });
  notifyListeners();
  return result(true, "", {
    id: id,
    name: name,
    moved: picked.length,
    audioKept: Math.max(0, selected.size - picked.length),
  });
}

function freeTrackFor(seq, picked, minStart, maxEnd) {
  const selectedClips = new Set(picked.map(function (p) { return p.clip; }));
  const candidates = Array.from(new Set(picked.map(function (p) { return p.trackIdx; }))).sort(function (a, b) { return a - b; });
  for (let i = 0; i < candidates.length; i++) {
    const track = seq.videoTracks[candidates[i]];
    const blocked = track.clips.some(function (clip) {
      return !selectedClips.has(clip) && clip.start < maxEnd && clip.start + clip.length > minStart;
    });
    if (!blocked) return candidates[i];
  }
  return -1;
}

function timelineElementsFor(tracks, clips) {
  const wanted = new Set(clips);
  const container = tracks.container;
  if (!container || !container.getElementsByClassName) return [];
  return Array.from(container.getElementsByClassName("clip")).filter(function (el) {
    return el.pz_object && wanted.has(el.pz_object);
  });
}

function renameComp(editor, id, rawName) {
  const project = editor.project;
  const media = findComp(project, id);
  if (!media) return fail("That composition no longer exists.");
  const name = String(rawName == null ? "" : rawName).trim();
  if (name === compName(media)) return result(true);
  const problem = nameProblem(project, name, id);
  if (problem) return fail(problem);
  runOperation(editor, function () {
    cmdRenameComp({ editor: editor, project: project, id: id, name: name });
  });
  notifyListeners();
  return result(true);
}

function duplicateComp(editor, id) {
  const project = editor.project;
  const session = sessionOf(project);
  const media = findComp(project, id);
  if (!media) return fail("That composition no longer exists.");
  if (session.activeId === id) commitActive(project, session);
  const snapshot = snapshotMedia(project, media);
  snapshot.comp.id = newCompId(project);
  snapshot.name = uniqueName(project, compName(media) + " copy");
  const index = project.media.indexOf(media) + 1;
  runOperation(editor, function () {
    cmdInsertComp({ editor: editor, project: project, snapshot: snapshot, index: index });
  });
  notifyListeners();
  return result(true, "", { id: snapshot.comp.id });
}

function removeComp(editor, id) {
  const project = editor.project;
  const session = sessionOf(project);
  const media = findComp(project, id);
  if (!media) return fail("That composition no longer exists.");
  const usage = usageOf(project, session, id);
  if (usage.length) {
    return fail(compName(media) + " is used by " + describeUsage(usage) + ". Remove those clips before deleting it.");
  }
  if (session.activeId === id) {
    const left = openComp(editor, null);
    if (!left.ok) return left;
  }
  runOperation(editor, function () {
    cmdRemoveComp({ editor: editor, project: project, id: id });
  });
  notifyListeners();
  return result(true);
}

// One row per Main and composition, for the Compositions window.
function entries(editor) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return [];
  const session = sessionOf(project);
  const rows = [{
    id: MAIN_ID,
    name: "Main",
    isMain: true,
    editing: session.activeId === null,
    length: mainLength(project, session),
    uses: 0,
  }];
  compMedia(project).forEach(function (media) {
    const id = media.comp.id;
    const uses = usageOf(project, session, id).reduce(function (sum, item) { return sum + item.count; }, 0);
    rows.push({
      id: id,
      name: compName(media),
      isMain: false,
      editing: session.activeId === id,
      length: lengthOf(compTracks(project, session, media)),
      uses: uses,
    });
  });
  return rows;
}

function nextCompName(project) {
  for (let n = 1; ; n++) {
    const candidate = "Comp " + n;
    if (!nameProblem(project, candidate, null)) return candidate;
  }
}

// Counts of selected video and other clips, for the Pre-compose dialog.
function selectionSummary(editor) {
  const tracks = findTimelineTracks(editor);
  if (!tracks) return { video: 0, other: 0, ready: false };
  tracks.selectClips();
  const selected = Array.from(tracks.selection || []);
  const seq = editor.project.sequence;
  let video = 0;
  seq.videoTracks.forEach(function (track) {
    track.clips.forEach(function (clip) {
      if (selected.indexOf(clip) >= 0) video += 1;
    });
  });
  return { video: video, other: selected.length - video, ready: true };
}

// ---------------------------------------------------------------------------
// Nested rendering

const EMPTY = [];

const CompLayer = Object.create(PZ.layer.composite.prototype);

function adoptCompLayer(layer, json) {
  Object.setPrototypeOf(layer, CompLayer);
  layer.compId = json.compId;
  layer.offset = Number.isFinite(json.offset) ? json.offset : 0;
  layer.nested = null;
  layer.activeClips = [];
  layer.compTime = 0;
}

function projectOf(layer) {
  try {
    return layer.parentProject || null;
  } catch (error) {
    return null;
  }
}

function reanalyze(project) {
  try {
    PZ.schedule.analyzeSequence(project.sequence);
  } catch (error) {
    console.error("[Precomp+] could not refresh schedules:", error);
  }
}

Object.assign(CompLayer, {
  // Builds the composition's video tracks once per layer. Audio is stored in
  // the composition but not rendered in this version.
  nestedTracks() {
    if (this.nested) return this.nested;
    const project = projectOf(this);
    if (!project) return EMPTY;
    const media = findComp(project, this.compId);
    if (!media) return EMPTY;
    if (!media.loaded) {
      if (media.loading && typeof media.loading.then === "function") {
        media.loading.then(function () { reanalyze(project); });
      }
      return EMPTY;
    }
    const tracks = [];
    (clone(media.data) || []).forEach(function (json) {
      if (json.type === 1) return;
      const track = new PZ.track.video();
      track.parent = this;
      track.load(json);
      tracks.push(track);
    }, this);
    this.nested = tracks;
    return tracks;
  },

  // Sets the children that are active at comp time `ct`. Pure function of
  // (composition data, ct). Children are stacked so the top track is drawn
  // last, matching Main.
  setCompTime(ct) {
    const tracks = this.nestedTracks();
    const clips = this.activeClips;
    clips.length = 0;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const clip = tracks[i].getCurrentClip(ct);
      if (clip && clip.object) clips.push(clip);
    }
    const objects = this.objects;
    objects.length = 0;
    for (let i = 0; i < clips.length; i++) objects[i] = clips[i].object;
    this.compTime = ct;
  },

  update(e) {
    PZ.layer.prototype.update.call(this, e);
    if (renderDepth >= MAX_DEPTH) return;
    renderDepth += 1;
    try {
      const ct = e + this.offset;
      this.setCompTime(ct);
      this.activeClips.slice().forEach(function (clip) {
        clip.object.update(ct - clip.start);
      });
    } finally {
      renderDepth -= 1;
    }
  },

  async prepare(e, t) {
    const project = projectOf(this);
    const media = project ? findComp(project, this.compId) : null;
    if (media && media.loading) await media.loading;
    if (renderDepth < MAX_DEPTH) {
      renderDepth += 1;
      try {
        const ct = e + this.offset;
        this.setCompTime(ct);
        const clips = this.activeClips.slice();
        for (const clip of clips) await clip.object.prepare(ct - clip.start, t);
      } finally {
        renderDepth -= 1;
      }
    }
    await PZ.layer.prototype.prepare.call(this, e, t);
  },

  unload() {
    (this.nested || []).forEach(function (track) {
      Array.from(track.clips).forEach(function (clip) { clip.unload(); });
    });
    this.nested = null;
    this.activeClips.length = 0;
    this.objects.length = 0;
    PZ.layer.prototype.unload.call(this);
  },

  toJSON() {
    const json = PZ.layer.composite.prototype.toJSON.call(this);
    json.objects = [];
    json.compId = this.compId;
    json.offset = this.offset;
    return json;
  },
});

// Proxy schedule item for a video clip inside a composition. Its window is in
// Main time; `origin` is the Main time at which the clip's local time is zero.
function makeProxy(clip, origin, start, length) {
  const shift = start - origin;
  return {
    start: start,
    length: length,
    origin: origin,
    media: clip.media,
    object: clip.object,
    properties: {
      time: {
        get: function (frame) {
          return clip.properties && clip.properties.time ? clip.properties.time.get(frame + shift) : 0;
        },
      },
    },
    update: function (frame) {
      clip.object.update(frame - origin);
    },
    prepare: async function (frame, t) {
      await clip.object.prepare(frame - origin, t);
    },
  };
}

// Walks composition children, mapping each clip's local origin into Main time.
// `origin` is the Main time of the layer clip's local zero; `winStart/winEnd`
// bound the Main-time window that children may occupy.
function collectNested(layerClip, origin, winStart, winEnd, out, path) {
  const layer = layerClip.object;
  if (!layer || typeof layer.nestedTracks !== "function") return;
  if (path.has(layer.compId) || path.size >= MAX_DEPTH) return;
  path.add(layer.compId);
  layer.nestedTracks().forEach(function (track) {
    track.clips.forEach(function (clip) {
      const clipOrigin = origin + clip.start - layer.offset;
      const start = Math.max(winStart, clipOrigin);
      const end = Math.min(winEnd, clipOrigin + clip.length);
      if (end <= start) return;
      if (clip.media) out.push(makeProxy(clip, clipOrigin, start, end - start));
      if (clip.object && typeof clip.object.nestedTracks === "function") {
        collectNested(clip, clipOrigin, start, end, out, path);
      }
    });
  });
  path.delete(layer.compId);
}

function analyzeVideo(seq) {
  const sched = PZ.schedule;
  const clips = sched.combineTracks(seq.videoTracks);
  const extra = [];
  clips.forEach(function (clip) {
    if (clip.object && typeof clip.object.nestedTracks === "function") {
      collectNested(clip, clip.start, clip.start, clip.start + clip.length, extra, new Set());
    }
  });
  const all = extra.length ? clips.concat(extra).sort(function (a, b) { return a.start - b.start; }) : clips;
  sched.updateSchedules(seq, seq.videoSchedules, all, sched.type.VIDEO);
  sched.updateSchedules(seq, seq.audioSchedules, sched.combineTracks(seq.audioTracks), sched.type.AUDIO);
}

// ---------------------------------------------------------------------------
// Host hooks. Each wrapper calls the original and keeps its return value.

function activeProjectJSON(project, json) {
  const session = sessions.get(project);
  if (!session || session.activeId === null || !session.mainJSON) return json;
  if (!json || typeof json !== "object") return json;
  try {
    const media = Array.isArray(json.media) ? json.media.map(function (item) {
      if (!isCompMedia(item) || item.comp.id !== session.activeId) return item;
      const entry = item.toJSON();
      entry.data = liveTracks(project.sequence);
      entry.comp = { id: item.comp.id, clipLinks: clone(project.sequence.clipLinks) };
      return entry;
    }) : json.media;
    return Object.assign({}, json, { sequence: clone(session.mainJSON), media: media });
  } catch (error) {
    console.error("[Precomp+] could not serialize the open composition:", error);
    return Object.assign({}, json, { sequence: clone(session.mainJSON) });
  }
}

function patch(target, key, makeWrapper) {
  if (!target || typeof target[key] !== "function") {
    throw new Error("Precomp+ needs " + key + " from the CM3 runtime.");
  }
  const original = target[key];
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  const handler = makeWrapper(original);
  let active = true;
  const wrapper = function () {
    return (active ? handler : original).apply(this, arguments);
  };
  target[key] = wrapper;
  return function restore() {
    active = false;
    if (target[key] !== wrapper) return;
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  };
}

function install() {
  const restores = [];
  try {
    restores.push(patch(PZ.layer.composite.prototype, "load", function (original) {
      return function (e) {
        const out = original.apply(this, arguments);
        if (e && typeof e === "object" && typeof e.compId === "string") adoptCompLayer(this, e);
        return out;
      };
    }));
    restores.push(patch(PZ.track.prototype, "update", function (original) {
      return function (e) {
        const out = original.apply(this, arguments);
        const layer = this.layer;
        if (layer && typeof layer.setCompTime === "function" && this.enabled !== false) {
          const clip = this.getCurrentClip(e);
          if (clip && clip.object === layer) layer.setCompTime(e - clip.start + layer.offset);
        }
        return out;
      };
    }));
    restores.push(patch(PZ.schedule, "analyzeSequence", function (original) {
      return function (seq) {
        try {
          analyzeVideo(seq);
        } catch (error) {
          console.error("[Precomp+] nested scheduling failed; using CM3 scheduling:", error);
          original.call(this, seq);
        }
      };
    }));
    restores.push(patch(PZ.media.prototype, "toJSON", function (original) {
      return function () {
        const json = original.apply(this, arguments);
        if (this.comp && json && typeof json === "object") {
          json.comp = { id: this.comp.id, clipLinks: clone(this.comp.clipLinks) };
        }
        return json;
      };
    }));
    restores.push(patch(PZ.media.prototype, "load", function (original) {
      return function (e) {
        if (e && typeof e === "object" && e.comp && typeof e.comp.id === "string") {
          this.comp = { id: e.comp.id, clipLinks: clone(e.comp.clipLinks) };
        }
        return original.apply(this, arguments);
      };
    }));
    restores.push(patch(PZ.project.prototype, "toJSON", function (original) {
      return function () {
        const json = activeProjectJSON(this, original.apply(this, arguments));
        if (json && typeof json === "object" && compMedia(this).length) {
          const plugins = Array.isArray(json.plugins) ? json.plugins.slice() : [];
          if (!plugins.some(function (plugin) { return plugin.id === "precomp-plus"; })) {
            plugins.push({ id: "precomp-plus", name: "Precomp+", features: ["compositions"] });
          }
          return Object.assign({}, json, { plugins: plugins });
        }
        return json;
      };
    }));
    const Tracks = PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;
    if (Tracks && Tracks.prototype) {
      ["selectClips", "redraw"].forEach(function (key) {
        restores.push(patch(Tracks.prototype, key, function (original) {
          return function () {
            if (this.timeline && this.timeline.editor) cachedTracks = this;
            return original.apply(this, arguments);
          };
        }));
      });
    }
    const MediaPanel = PZ.ui && PZ.ui.media;
    if (MediaPanel && typeof MediaPanel.prototype.deleteMedia === "function") {
      restores.push(patch(MediaPanel.prototype, "deleteMedia", function (original) {
        return function (params) {
          const project = this.editor.project;
          const media = project.media[params.address[1]];
          if (isCompMedia(media)) {
            const session = sessionOf(project);
            const usage = usageOf(project, session, media.comp.id);
            if (usage.length) {
              globalThis.alert(compName(media) + " is used by " + describeUsage(usage) +
                ". Remove those clips before deleting it.");
              return;
            }
            if (session.activeId === media.comp.id) {
              const operation = this.editor.history.operation;
              const left = openComp(this.editor, null);
              // The Media panel already started a native history operation.
              // openComp clears history, so retain this deletion's operation.
              this.editor.history.operation = operation;
              if (!left.ok) {
                globalThis.alert(left.message);
                return;
              }
            }
          }
          const out = original.apply(this, arguments);
          notifyListeners();
          return out;
        };
      }));
    }
    // Check both entry and Start: the user can switch timelines with the
    // export options still open. Never export a composition by accident.
    ["device", "frame"].forEach(function (kind) {
      const Export = PZ.ui && PZ.ui.export && PZ.ui.export[kind];
      if (!Export) return;
      ["createOptionsPage", "createProgressPage"].forEach(function (key) {
        restores.push(patch(Export.prototype, key, function (original) {
          return function () {
            if (sessionOf(this.editor.project).activeId !== null) {
              const page = this.export.createPage("Export Main", true);
              page.appendChild(PZ.ui.controls.legacy.generateDescription({
                content: "A composition is open. Return to Main in the Compositions window before exporting.",
              }));
              return page;
            }
            return original.apply(this, arguments);
          };
        }));
      });
    });
  } catch (error) {
    restores.reverse().forEach(function (restore) { restore(); });
    throw error;
  }
  return function uninstall() {
    restores.reverse().forEach(function (restore) { restore(); });
    cachedTracks = null;
    renderDepth = 0;
  };
}

PZ.precomp = {
  version: VERSION,
  install: install,
  subscribe: function (fn) {
    listeners.add(fn);
    return function () { listeners.delete(fn); };
  },
  hasComps: function (project) { return !!project && compMedia(project).length > 0; },
  isEditing: function (project) { return !!project && sessionOf(project).activeId !== null; },
  activeName: function (editor) {
    const project = editor && editor.project;
    if (!project || sessionOf(project).activeId === null) return null;
    const media = findComp(project, sessionOf(project).activeId);
    return media ? compName(media) : null;
  },
  entries: entries,
  openComp: openComp,
  precompose: precompose,
  renameComp: renameComp,
  duplicateComp: duplicateComp,
  removeComp: removeComp,
  nextCompName: nextCompName,
  selectionSummary: selectionSummary,
  MAIN_ID: MAIN_ID,
};
