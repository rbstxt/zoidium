// Precomp+ engine entry (split from comps.js).
// Host hooks (timeline, media, schedule, export patches) and the PZ.precomp
// surface. Requires the model, timeline and engine parts through the shared
// bundle module loader (see precomp-runtime.js), which evaluates this file
// as function (module, exports, require, PZ).
if (PZ.precomp && PZ.precomp.version === 3) return;

const VERSION = 3;
const model = require("./comps-model.js");
const timeline = require("./comps-timeline.js");
const engine = require("./comps-engine.js");
const MAIN_ID = model.MAIN_ID;
const isCompMedia = model.isCompMedia;
const compMedia = model.compMedia;
const cloneCompRef = model.cloneCompRef;
const lengthOf = model.lengthOf;
const clone = model.clone;
const usageOf = model.usageOf;
const describeUsage = model.describeUsage;
const compName = model.compName;
const newCompId = model.newCompId;
const sessionOf = engine.sessionOf;
const notifyListeners = engine.notifyListeners;
const openComp = engine.openComp;
const analyzeVideo = engine.analyzeVideo;
const activeProjectJSON = engine.activeProjectJSON;
const adoptCompLayer = engine.adoptCompLayer;
// Engine-level messages surface through the shared toast channel (the same
// one ZoidiumUI.notify uses) instead of blocking engine alerts, so the
// editor and desktop builds behave the same.
function notifyHost(title, message) {
  try {
    if (typeof globalThis !== "undefined"
      && typeof globalThis.dispatchEvent === "function"
      && typeof CustomEvent === "function") {
      globalThis.dispatchEvent(new CustomEvent("zoidium:notification", {
        detail: { title: title, message: message },
      }));
      return true;
    }
  } catch (_error) { /* the toast channel is optional */ }
  return false;
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
          json.comp = cloneCompRef(this.comp);
          // Mirror the OpenZoid fields so Davidium and OpenZoid projects
          // keep reading compositions saved by Zoidium.
          json.isComp = true;
          json.compLength = lengthOf(this.data || []);
          json.compSource = this.comp.compSource !== undefined ? clone(this.comp.compSource) : null;
        }
        return json;
      };
    }));
    restores.push(patch(PZ.media.prototype, "load", function (original) {
      return function (e) {
        if (e && typeof e === "object" && e.comp && typeof e.comp.id === "string") {
          this.comp = cloneCompRef(e.comp);
        } else if (e && typeof e === "object" && e.isComp) {
          // Migrate OpenZoid / Davidium composition media into the Zoidium
          // model: a stable id plus the optional source-name list. The
          // length is derived from the tracks, like any other composition.
          let refProject = null;
          try {
            refProject = this.parentProject || null;
          } catch (error) {
            refProject = null;
          }
          this.comp = { id: newCompId(refProject), clipLinks: null };
          if (e.compSource !== undefined && e.compSource !== null) {
            this.comp.compSource = clone(e.compSource);
          }
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
            if (this.timeline && this.timeline.editor) timeline.rememberTimelineTracks(this);
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
              notifyHost(compName(media) + " is in use.",
                compName(media) + " is used by " + describeUsage(usage) +
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
                notifyHost("Cannot open the composition.", left.message);
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
    timeline.clearTimelineCache();
    engine.resetRenderDepth();
  };
}

PZ.precomp = {
  version: VERSION,
  install: install,
  subscribe: engine.subscribe,
  hasComps: engine.hasComps,
  isEditing: engine.isEditing,
  activeName: engine.activeName,
  entries: engine.entries,
  openComp: engine.openComp,
  openSourceOfClip: engine.openSourceOfClip,
  newEmptyComp: engine.newEmptyComp,
  precompose: engine.precompose,
  renameComp: engine.renameComp,
  duplicateComp: engine.duplicateComp,
  removeComp: engine.removeComp,
  nextCompName: engine.nextCompName,
  selectionSummary: engine.selectionSummary,
  timelineTracks: timeline.findTimelineTracks,
  MAIN_ID: MAIN_ID,
};

