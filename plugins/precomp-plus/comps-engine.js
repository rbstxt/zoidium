// Precomp+ engine (split from comps.js).
// Editing sessions, public operations, nested rendering and scheduling, and
// the project-serialization helper. Loaded through the shared bundle module
// loader with PZ in scope.
const model = require("./comps-model.js");
const timeline = require("./comps-timeline.js");
const COMP_TYPE = model.COMP_TYPE;
const MAIN_ID = model.MAIN_ID;
const MAX_DEPTH = model.MAX_DEPTH;
const clone = model.clone;
const result = model.result;
const fail = model.fail;
const isCompMedia = model.isCompMedia;
const compMedia = model.compMedia;
const findComp = model.findComp;
const compName = model.compName;
const lengthOf = model.lengthOf;
const liveTracks = model.liveTracks;
const compTracks = model.compTracks;
const mainTracks = model.mainTracks;
const mainLength = model.mainLength;
const commitActive = model.commitActive;
const sequenceFor = model.sequenceFor;
const newCompId = model.newCompId;
const cloneCompRef = model.cloneCompRef;
const nameProblem = model.nameProblem;
const uniqueName = model.uniqueName;
const collectCompRefs = model.collectCompRefs;
const usageOf = model.usageOf;
const describeUsage = model.describeUsage;
const reaches = model.reaches;
const collectAssetKeys = model.collectAssetKeys;
const snapshotMedia = model.snapshotMedia;
const insertMedia = model.insertMedia;
const trackSwitches = model.trackSwitches;
const applyTrackSwitches = model.applyTrackSwitches;
const findTimelineTracks = timeline.findTimelineTracks;
const refreshTimeline = timeline.refreshTimeline;
const applySequence = timeline.applySequence;
const clearHistory = timeline.clearHistory;
const runOperation = timeline.runOperation;
const cmdInsertComp = timeline.cmdInsertComp;
const cmdRemoveComp = timeline.cmdRemoveComp;
const cmdRenameComp = timeline.cmdRenameComp;
const sessions = new WeakMap();
const listeners = new Set();

let renderDepth = 0;

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
  const pickedVideo = [];
  const pickedAudio = [];
  seq.videoTracks.forEach(function (track, trackIdx) {
    track.clips.forEach(function (clip) {
      if (selected.has(clip)) pickedVideo.push({ clip: clip, trackIdx: trackIdx });
    });
  });
  seq.audioTracks.forEach(function (track, trackIdx) {
    track.clips.forEach(function (clip) {
      if (selected.has(clip)) pickedAudio.push({ clip: clip, trackIdx: trackIdx });
    });
  });
  const picked = pickedVideo.concat(pickedAudio);
  if (!picked.length) return fail("Select one or more clips on the timeline first.");

  const minStart = Math.min.apply(null, picked.map(function (p) { return p.clip.start; }));
  const maxEnd = Math.max.apply(null, picked.map(function (p) { return p.clip.start + p.clip.length; }));

  // Only a video selection leaves a composition clip on Main, so only video
  // tracks need a free span for it.
  let trackIdx = -1;
  if (pickedVideo.length) {
    trackIdx = freeTrackFor(seq, pickedVideo, minStart, maxEnd);
    if (trackIdx < 0) {
      return fail("The selected clips overlap other clips on their tracks. Move those clips first.");
    }
  }

  const moved = picked.map(function (p) { return clone(p.clip); });
  if (session.activeId !== null && reaches(project, session, moved, session.activeId)) {
    return fail("A composition cannot contain itself.");
  }

  // Group the moved clips by source track so multi-track selections keep
  // their layering, preserving each track's switches.
  function groupByTrack(list, kind) {
    const byTrack = new Map();
    list.forEach(function (p) {
      if (!byTrack.has(p.trackIdx)) {
        byTrack.set(p.trackIdx, {
          trackIdx: p.trackIdx,
          switches: trackSwitches(kind === 0 ? seq.videoTracks[p.trackIdx] : seq.audioTracks[p.trackIdx]),
          clips: [],
        });
      }
      byTrack.get(p.trackIdx).clips.push(p);
    });
    return Array.from(byTrack.values()).sort(function (a, b) { return a.trackIdx - b.trackIdx; }).map(function (group) {
      const clips = group.clips.slice().sort(function (a, b) { return a.clip.start - b.clip.start; });
      const json = Object.assign({ type: kind, clips: clips.map(function (p) {
        const clipJSON = clone(p.clip);
        clipJSON.start -= minStart;
        clipJSON.link = null;
        return clipJSON;
      }) }, group.switches);
      return json;
    });
  }
  const data = groupByTrack(pickedVideo, 0).concat(groupByTrack(pickedAudio, 1));

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
    if (pickedVideo.length) {
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
    }
  });
  notifyListeners();
  return result(true, "", {
    id: id,
    name: name,
    moved: pickedVideo.length,
    movedAudio: pickedAudio.length,
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

function openSourceOfClip(editor, clip) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return fail("Open a project first.");
  if (!clip) return fail("Select a clip first.");
  const direct = clip.object && typeof clip.object.compId === "string" ? clip.object.compId : null;
  if (direct) {
    const hit = openComp(editor, direct);
    if (!hit.ok) return fail("That composition no longer exists.");
    return result(true);
  }
  let name = "";
  try {
    name = String(clip.properties.name.get());
  } catch (error) {
    name = "";
  }
  if (name) {
    const byName = compMedia(project).find(function (media) { return compName(media) === name; });
    if (byName) return openComp(editor, byName.comp.id);
    const bySource = compMedia(project).find(function (media) {
      const source = (media.comp && media.comp.compSource) || media.compSource;
      return Array.isArray(source) && source.indexOf(name) >= 0;
    });
    if (bySource) return openComp(editor, bySource.comp.id);
  }
  return fail("This clip did not come from a composition.");
}

function newEmptyComp(editor) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return fail("Open a project first.");
  const snapshot = {
    name: nextCompName(project),
    data: [{ type: 0, clips: [] }],
    assets: [],
    comp: { id: newCompId(project), clipLinks: null },
  };
  runOperation(editor, function () {
    cmdInsertComp({ editor: editor, project: project, snapshot: snapshot, index: project.media.length });
  });
  notifyListeners();
  return result(true, "", { id: snapshot.comp.id, name: snapshot.name });
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

// Detached copies of closed authored timelines for read-only consumers. The
// open timeline is walked live; exposing it here would count render clones or
// stale media.data. Never commitActive or switch compositions for this query.
function referenceSources(editor) {
  const project = editor && editor.project;
  if (!project || !project.sequence) return [];
  const session = sessions.get(project) || { activeId: null, mainJSON: null };
  const main = session.mainJSON || {};
  return [{ id: MAIN_ID, name: "Main", editing: session.activeId === null,
    tracks: session.activeId === null ? null : clone((main.videoTracks || []).concat(main.audioTracks || [])) }]
    .concat(compMedia(project).map(media => ({ id: media.comp.id, name: compName(media),
      editing: session.activeId === media.comp.id,
      tracks: session.activeId === media.comp.id ? null : clone(media.data || []) })));
}

function nextCompName(project) {
  for (let n = 1; ; n++) {
    const candidate = "Comp " + n;
    if (!nameProblem(project, candidate, null)) return candidate;
  }
}

function selectionSummary(editor) {
  const tracks = findTimelineTracks(editor);
  if (!tracks) return { video: 0, audio: 0, ready: false };
  tracks.selectClips();
  const selected = Array.from(tracks.selection || []);
  const seq = editor.project.sequence;
  let video = 0;
  let audio = 0;
  seq.videoTracks.forEach(function (track) {
    track.clips.forEach(function (clip) {
      if (selected.indexOf(clip) >= 0) video += 1;
    });
  });
  seq.audioTracks.forEach(function (track) {
    track.clips.forEach(function (clip) {
      if (selected.indexOf(clip) >= 0) audio += 1;
    });
  });
  return { video: video, audio: audio, ready: true };
}

const EMPTY = [];

const CompLayer = Object.create(PZ.layer.composite.prototype);

function adoptCompLayer(layer, json) {
  Object.setPrototypeOf(layer, CompLayer);
  layer.compId = json.compId;
  layer.offset = Number.isFinite(json.offset) ? json.offset : 0;
  layer.nested = null;
  layer.nestedAudio = null;
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
  // Builds the composition's video tracks once per layer. Audio tracks are
  // built by nestedAudioTracks below and scheduled as proxies.
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
      applyTrackSwitches(track, json);
      tracks.push(track);
    }, this);
    this.nested = tracks;
    return tracks;
  },

  // Builds the composition's audio tracks once per layer. They are not drawn
  // as children; analyzeVideo turns them into Main-time proxies so nested
  // audio plays and exports through the normal CM3 audio pipeline.
  nestedAudioTracks() {
    if (this.nestedAudio) return this.nestedAudio;
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
      if (json.type !== 1) return;
      const track = new PZ.track.audio();
      track.parent = this;
      track.load(json);
      applyTrackSwitches(track, json);
      tracks.push(track);
    }, this);
    this.nestedAudio = tracks;
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
      if (tracks[i].enabled === false) continue;
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
    (this.nestedAudio || []).forEach(function (track) {
      Array.from(track.clips).forEach(function (clip) { clip.unload(); });
    });
    this.nested = null;
    this.nestedAudio = null;
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

function makeAudioProxy(clip, origin, start, length) {
  const shift = start - origin;
  function shifted(getter) {
    return function (frame) {
      return getter ? getter(frame + shift) : 0;
    };
  }
  const time = clip.properties && clip.properties.time;
  const volume = clip.object && clip.object.properties && clip.object.properties.volume;
  const pan = clip.object && clip.object.properties && clip.object.properties.pan;
  return {
    start: start,
    length: length,
    origin: origin,
    media: clip.media,
    properties: {
      time: { get: shifted(time && time.get ? time.get.bind(time) : null) },
    },
    object: {
      properties: {
        volume: { get: shifted(volume && volume.get ? volume.get.bind(volume) : null) },
        pan: { get: shifted(pan && pan.get ? pan.get.bind(pan) : null) },
      },
    },
    update: function () {
      if (clip.object && typeof clip.object.update === "function") clip.object.update();
    },
    prepare: async function () {
      if (clip.object && typeof clip.object.prepare === "function") await clip.object.prepare();
    },
  };
}

function collectNestedAudio(layerClip, origin, winStart, winEnd, out, path) {
  const layer = layerClip.object;
  if (!layer || typeof layer.nestedAudioTracks !== "function") return;
  if (path.has(layer.compId) || path.size >= MAX_DEPTH) return;
  path.add(layer.compId);
  layer.nestedAudioTracks().forEach(function (track) {
    track.clips.forEach(function (clip) {
      const clipOrigin = origin + clip.start - layer.offset;
      const start = Math.max(winStart, clipOrigin);
      const end = Math.min(winEnd, clipOrigin + clip.length);
      if (end <= start) return;
      if (clip.media) out.push(makeAudioProxy(clip, clipOrigin, start, end - start));
    });
  });
  if (typeof layer.nestedTracks === "function") {
    layer.nestedTracks().forEach(function (track) {
      track.clips.forEach(function (clip) {
        if (clip.object && typeof clip.object.nestedAudioTracks === "function") {
          const clipOrigin = origin + clip.start - layer.offset;
          const start = Math.max(winStart, clipOrigin);
          const end = Math.min(winEnd, clipOrigin + clip.length);
          if (end <= start) return;
          collectNestedAudio(clip, clipOrigin, start, end, out, path);
        }
      });
    });
  }
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
  const audio = sched.combineTracks(seq.audioTracks);
  const extraAudio = [];
  clips.forEach(function (clip) {
    if (clip.object && typeof clip.object.nestedAudioTracks === "function") {
      collectNestedAudio(clip, clip.start, clip.start, clip.start + clip.length, extraAudio, new Set());
    }
  });
  const allAudio = extraAudio.length
    ? audio.concat(extraAudio).sort(function (a, b) { return a.start - b.start; })
    : audio;
  sched.updateSchedules(seq, seq.audioSchedules, allAudio, sched.type.AUDIO);
}

function activeProjectJSON(project, json) {
  const session = sessions.get(project);
  if (!session || session.activeId === null || !session.mainJSON) return json;
  if (!json || typeof json !== "object") return json;
  try {
    const media = Array.isArray(json.media) ? json.media.map(function (item) {
      if (!isCompMedia(item) || item.comp.id !== session.activeId) return item;
      const entry = item.toJSON();
      entry.data = liveTracks(project.sequence);
      entry.comp = cloneCompRef({ id: item.comp.id, compSource: item.comp.compSource, clipLinks: project.sequence.clipLinks });
      entry.isComp = true;
      entry.compLength = lengthOf(entry.data);
      entry.compSource = entry.comp.compSource !== undefined ? clone(entry.comp.compSource) : null;
      return entry;
    }) : json.media;
    return Object.assign({}, json, { sequence: clone(session.mainJSON), media: media });
  } catch (error) {
    console.error("[Precomp+] could not serialize the open composition:", error);
    return Object.assign({}, json, { sequence: clone(session.mainJSON) });
  }
}

// The sequence rate is shared by every composition. Keep the parked Main
// timeline and stored compositions available to the core timing command.
function timingState(project) {
  const session = sessionOf(project);
  const roots = compMedia(project).map(media => ({ id: media.comp.id, data: clone(media.data) }));
  if (session.mainJSON) roots.push({ id: MAIN_ID, data: clone(session.mainJSON) });
  return roots;
}

function restoreTimingState(project, roots) {
  const session = sessionOf(project);
  for (const root of roots) {
    if (root.id === MAIN_ID) session.mainJSON = clone(root.data);
    else {
      const media = findComp(project, root.id);
      if (media) media.data = clone(root.data);
    }
  }
  function invalidate(node) {
    if (node.compId) {
      // These are render instances, never authored timeline objects. Release
      // media and GPU resources before rebuilding them at the new rate.
      for (const track of [...(node.nested || []), ...(node.nestedAudio || [])]) {
        for (const clip of track.clips) clip.unload();
      }
      node.nested = null;
      node.nestedAudio = null;
      node.activeClips.length = 0;
      node.objects.length = 0;
      return;
    }
    if (Array.isArray(node)) node.forEach(invalidate);
    else for (const child of node.children || []) invalidate(child);
  }
  invalidate(project.sequence);
  notifyListeners();
}

function resetRenderDepth() {
  renderDepth = 0;
}

function subscribe(fn) {
  listeners.add(fn);
  return function () { listeners.delete(fn); };
}

function hasComps(project) { return !!project && compMedia(project).length > 0; }

function isEditing(project) { return !!project && sessionOf(project).activeId !== null; }

function activeName(editor) {
  const project = editor && editor.project;
  if (!project || sessionOf(project).activeId === null) return null;
  const media = findComp(project, sessionOf(project).activeId);
  return media ? compName(media) : null;
}

module.exports = {
  sessionOf: sessionOf,
  timingState: timingState,
  restoreTimingState: restoreTimingState,
  notifyListeners: notifyListeners,
  subscribe: subscribe,
  hasComps: hasComps,
  isEditing: isEditing,
  activeName: activeName,
  entries: entries,
  referenceSources: referenceSources,
  openComp: openComp,
  openSourceOfClip: openSourceOfClip,
  newEmptyComp: newEmptyComp,
  precompose: precompose,
  renameComp: renameComp,
  duplicateComp: duplicateComp,
  removeComp: removeComp,
  nextCompName: nextCompName,
  selectionSummary: selectionSummary,
  timelineTracks: findTimelineTracks,
  adoptCompLayer: adoptCompLayer,
  analyzeVideo: analyzeVideo,
  activeProjectJSON: activeProjectJSON,
  resetRenderDepth: resetRenderDepth,
};

