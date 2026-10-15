// Precomp+ data model (split from comps.js).
// Composition queries, naming, usage, media insert/snapshot and track
// switches. PZ is only touched inside insertMedia. Loaded through the shared
// bundle module loader with PZ in scope (see precomp-runtime.js).
const COMP_TYPE = 2;
const MAX_NAME_LENGTH = 60;
const MAIN_ID = "main";
const MAX_DEPTH = 16;

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
  media.comp = cloneCompRef({ id: media.comp.id, compSource: media.comp.compSource, clipLinks: project.sequence.clipLinks });
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
  } while (project && findComp(project, id));
  return id;
}

// The reference a composition media entry carries. `compSource` (OpenZoid /
// Davidium origin: the names of the clips a pre-compose moved) is optional
// and only kept for source lookup of older projects.
function cloneCompRef(comp) {
  const ref = { id: comp.id, clipLinks: clone(comp.clipLinks) };
  if (comp && comp.compSource !== undefined) ref.compSource = clone(comp.compSource);
  return ref;
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
    comp: cloneCompRef(media.comp),
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
  media.comp = cloneCompRef(snapshot.comp);
  media.assets = [];
  (snapshot.assets || []).forEach(function (key) {
    const asset = project.assets.load(key, true);
    if (asset) media.assets.push(asset);
  });
  media.loaded = true;
  project.media.splice(index, 0, media);
  return media;
}

// Track-level switches that must travel with the clips. The host only keeps
// `type` and `clips` in track JSON, so pre-compose copies the live switches
// explicitly (matching OpenZoid): the eye (`enabled`) and the Camera+ `3D`
// switch (`track3d`, owned by Camera+ via registerTrackField) plus the
// video `skip` flag when present.
function trackSwitches(track) {
  const switches = {};
  if (track) {
    if (track.enabled !== undefined) switches.enabled = !!track.enabled;
    if (track.track3d !== undefined) switches.track3d = !!track.track3d;
    if (track.skip !== undefined) switches.skip = !!track.skip;
  }
  return switches;
}


// Applies stored track switches to a live track. The host track loader keeps
// only clips, so compositions and comp switches reapply `enabled`/`track3d`
// after every load. Fields absent from the JSON leave the live value alone,
// so tracks from older projects behave exactly as before.
function applyTrackSwitches(track, json) {
  if (!track || !json || typeof json !== "object") return;
  if (Object.prototype.hasOwnProperty.call(json, "enabled")) track.enabled = !!json.enabled;
  if (Object.prototype.hasOwnProperty.call(json, "track3d")) track.track3d = !!json.track3d;
  if (Object.prototype.hasOwnProperty.call(json, "skip")) track.skip = !!json.skip;
}

module.exports = {
  COMP_TYPE: COMP_TYPE,
  MAX_NAME_LENGTH: MAX_NAME_LENGTH,
  MAIN_ID: MAIN_ID,
  MAX_DEPTH: MAX_DEPTH,
  clone: clone,
  result: result,
  fail: fail,
  isCompMedia: isCompMedia,
  compMedia: compMedia,
  findComp: findComp,
  compName: compName,
  lengthOf: lengthOf,
  liveTracks: liveTracks,
  compTracks: compTracks,
  mainTracks: mainTracks,
  mainLength: mainLength,
  commitActive: commitActive,
  sequenceFor: sequenceFor,
  newCompId: newCompId,
  cloneCompRef: cloneCompRef,
  nameProblem: nameProblem,
  uniqueName: uniqueName,
  collectCompRefs: collectCompRefs,
  usageOf: usageOf,
  describeUsage: describeUsage,
  reaches: reaches,
  collectAssetKeys: collectAssetKeys,
  snapshotMedia: snapshotMedia,
  insertMedia: insertMedia,
  trackSwitches: trackSwitches,
  applyTrackSwitches: applyTrackSwitches,
};

