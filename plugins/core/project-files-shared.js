// Project naming, disk-state tracking, and open-readiness helpers shared by
// the project-files core scripts. Consumers load this file first and read
// the helpers off PZ.zoidium.projectFilesShared.
(function installProjectFilesShared(global) {
  "use strict";

  var PZ = global.PZ;
  if (!PZ) return;

  PZ.zoidium = PZ.zoidium || {};
  if (PZ.zoidium.projectFilesShared) return;

  var DEFAULT_PROJECT_NAME = "project";

  function normalizeProjectName(value) {
    var name = String(value == null ? "" : value).trim();
    return name || DEFAULT_PROJECT_NAME;
  }

  function fileNameForProject(value) {
    var name = normalizeProjectName(value)
      .replace(/\.pz$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return (name || DEFAULT_PROJECT_NAME) + ".pz";
  }

  function projectNameFromFileName(value) {
    var name = String(value || "").replace(/\.pz$/i, "").trim();
    return normalizeProjectName(name);
  }

  // Older desktop builds replaced non-ASCII names with labels such as
  // "Project [U+3046 U+304A]" before the renderer's font path was fixed.
  // Decode that exact legacy format at the UI boundary so existing restore
  // points become readable without changing unrelated user-entered names.
  function decodeLegacyDisplayName(value) {
    var name = normalizeProjectName(value);
    var match = /^Project \[((?:U\+[0-9A-Fa-f]{1,6})(?: U\+[0-9A-Fa-f]{1,6})*)\]$/.exec(name);
    if (!match) return name;

    var tokens = match[1].split(" ");
    var codePoints = [];
    for (var index = 0; index < tokens.length; index += 1) {
      var codePoint = Number.parseInt(tokens[index].slice(2), 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return name;
      }
      codePoints.push(codePoint);
    }

    try {
      return String.fromCodePoint.apply(String, codePoints) || name;
    } catch (_error) {
      // Overlong escapes fall back to the raw filename.
      return name;
    }
  }

  // Keep this as a single display-name hook so project-name rendering stays
  // consistent across the toolbar, restore points, and accessibility labels.
  // Electron's font backend is configured in the desktop main process; the
  // renderer must not replace a user's real name with an artificial label.
  function displayNameForUi(value) {
    return decodeLegacyDisplayName(value);
  }

  function fileDiagnostics(file) {
    if (!file) return {};
    return {
      filename: typeof file.name === "string" ? file.name : "",
      size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
      type: typeof file.type === "string" ? file.type : "",
      lastModified: Number.isFinite(Number(file.lastModified))
        ? Number(file.lastModified)
        : null,
    };
  }

  function errorMessage(error, fallback) {
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  var VALIDATION_PREFIX = {
    save: "Nothing was saved.",
    open: "This project file cannot be opened.",
    restore: "This restore point cannot be opened.",
  };

  function isProjectDataError(error) {
    return Boolean(error && error.name === "ProjectDataError");
  }

  function projectDataError(mode, detail) {
    var error = new Error((VALIDATION_PREFIX[mode] || VALIDATION_PREFIX.open) + " " + String(detail).replace(/[.]+$/, "") + ".");
    error.name = "ProjectDataError";
    return error;
  }

  // Warms each video clip's first frame when a project opens, including clips
  // on tracks outside the visible timeline and clips that start later. Clips
  // warm concurrently. A clip whose content fails or never settles (CM3 opens
  // projects with a failed object; a missing font file never settles) must
  // not stop the open: the viewport prepares again at the live frame, so
  // giving up after CLIP_WARM_MS only delays that clip's first draw.
  var CLIP_WARM_MS = 10000;
  function warmClip(object, sequence) {
    var timer;
    var warmed = Promise.resolve().then(function () {
      return PZ.zoidium.projectResources
        ? PZ.zoidium.projectResources.prepare(sequence.parentProject, function () { return object.prepare(0, { sequence: sequence }); })
        : object.prepare(0, { sequence: sequence });
    }).then(function () { return true; }, function (error) {
      if (global.console) global.console.warn("[Zoidium] Clip content could not be prepared; it opens with what is available.", error);
      return true;
    });
    var limit = new Promise(function (resolve) { timer = global.setTimeout(function () { resolve(false); }, CLIP_WARM_MS); });
    return Promise.race([warmed, limit]).then(function (settled) {
      global.clearTimeout(timer);
      if (!settled && global.console) global.console.warn("[Zoidium] Clip content is still preparing; the project opens now.");
    });
  }
  function warmProjectClips(project) {
    var sequence = project && project.sequence;
    var pending = [];
    for (var track of (sequence && sequence.videoTracks) || []) {
      for (var clip of track.clips || []) {
        if (clip && clip.object && typeof clip.object.prepare === "function") pending.push(warmClip(clip.object, sequence));
      }
    }
    return Promise.all(pending);
  }

  // Keep a single serialized baseline for dirty-state checks after undo.
  // Ordinary edits only set a flag; they never serialize the document.
  var diskStates = new WeakMap();
  function diskContent(project) {
    try { return JSON.stringify(project); } catch (_error) { return null; }
  }
  function captureDiskState(editor) {
    var files = PZ.zoidium.projectFiles;
    return { project: editor.project, revision: files.getProjectRevision(editor),
      name: files.getProjectName(editor), content: diskContent(editor.project) };
  }
  function notifyDirty(editor) {
    if (typeof global.dispatchEvent !== "function" || typeof global.CustomEvent !== "function") return;
    global.dispatchEvent(new global.CustomEvent("zoidium:project-dirty-changed", { detail: { editor: editor } }));
  }
  function updateProjectDirty(editor, compareContent) {
    var state = diskStates.get(editor), project = editor.project;
    if (!state || state.project !== project || !project?.ui) return;
    if (compareContent) state.contentDirty = state.content === null || diskContent(project) !== state.content;
    project.ui.dirty = state.contentDirty || PZ.zoidium.projectFiles.getProjectName(editor) !== state.name;
    notifyDirty(editor);
  }
  function projectEdited(editor) {
    var state = diskStates.get(editor);
    if (state && state.project === editor.project) {
      state.contentDirty = true;
      updateProjectDirty(editor, false);
    }
  }
  function recordDiskSave(editor, snapshot) {
    if (editor.project !== snapshot.project) return;
    diskStates.set(editor, { ...snapshot, contentDirty: false });
    updateProjectDirty(editor, PZ.zoidium.projectFiles.getProjectRevision(editor) !== snapshot.revision);
  }
  function diskUnsaved(editor) {
    var state = diskStates.get(editor);
    return state && state.project === editor.project ? !!editor.project.ui?.dirty : null;
  }
  function trackFirstFrame(editor) {
    var viewport = editor.mainViewport;
    if (!viewport || typeof viewport._render !== "function") return;
    viewport._zoidiumFirstFrameStart = Date.now();
    if (viewport._zoidiumFirstFrameTracked) return;
    viewport._zoidiumFirstFrameTracked = true;
    var render = viewport._render;
    viewport._render = function () {
      var previous = this.lastFrame;
      var result = render.apply(this, arguments);
      if (this._zoidiumFirstFrameStart != null && Number.isFinite(this.lastFrame) && !Object.is(previous, this.lastFrame)) {
        var duration = Date.now() - this._zoidiumFirstFrameStart;
        this._zoidiumFirstFrameStart = null;
        try { global.ZOIDIUM_DEBUG_LOG?.record("project-span", { name: "first frame", durationMs: duration, status: "complete" }); }
        catch (_error) { /* Diagnostics must never interrupt rendering. */ }
      }
      return result;
    };
  }
  if (typeof global.addEventListener === "function") global.addEventListener("zoidium:project-changed", function (event) {
    var editor = event.detail?.editor;
    if (!editor) return;
    trackFirstFrame(editor);
    diskStates.delete(editor);
    if (event.detail.reason === "open") recordDiskSave(editor, captureDiskState(editor));
    else if (event.detail.reason === "restore" && editor.project?.ui) editor.project.ui.dirty = true;
  });
  // Native history increments the revision on undo too. Compare the saved
  // document after undo or redo has finished.
  for (const method of ["undo", "redo"]) {
    var original = PZ.ui?.history?.prototype[method];
    if (!original) continue;
    PZ.ui.history.prototype[method] = function (fn) {
      return function () {
        var result = fn.apply(this, arguments);
        updateProjectDirty(this.editor, true);
        return result;
      };
    }(original);
  }

  // Temporal operators must exist before the first schedule preparation.
  // CM3 creates nested effects asynchronously but returns a project before
  // those loads finish, so its first frame can bypass a saved time operator.
  async function prepareProject(project, wait) {
    if (!project) return project;
    // Opening waits as long as CM3 does: a slow but valid load is not a failure.
    wait = wait || function (promise) { return promise; };
    if (project._zoidiumPluginActivationPending) {
      await PZ.zoidiumProjectArchive.span("plugin activation", function () { return wait(project._zoidiumPluginActivationPending, "Project plugin activation"); });
    }
    var visited = new WeakSet();
    async function visit(object) {
      if (!object || typeof object !== "object" || visited.has(object)) return;
      visited.add(object);
      if (object.loading && typeof object.loading.then === "function") {
        // CM3 opened projects with one failed object (its own rejection is
        // reported there); only a decision to stop waiting aborts the open.
        await wait(object.loading.catch(function () {}), (object.defaultName || object.baseTypeString || "Project object") + " loading");
      }
      var children = Array.isArray(object) ? object : object.children;
      if (children) {
        for (var index = 0; index < children.length; index += 1) {
          await visit(children[index]);
        }
      }
    }
    await visit(project);
    global.ZoidiumPluginApis?.timeline?.restoreTrackFields(project);
    return project;
  }

  function settledWithin(promise, milliseconds) {
    var timer;
    return Promise.race([
      Promise.resolve(promise).then(function () { return true; }, function () { return true; }),
      new Promise(function (resolve) { timer = global.setTimeout(function () { resolve(false); }, milliseconds); }),
    ]).finally(function () { global.clearTimeout(timer); });
  }

  // A step of a user-started save or open that outlives its size-scaled
  // budget asks instead of failing: reading a large video from a slow or
  // cloud-backed disk is valid. The question closes itself when the step
  // finishes meanwhile. Without the UI kit the deadline fails as before.
  function slowStepQuestion(action) {
    if (!global.ZoidiumUI || typeof global.ZoidiumUI.confirm !== "function") return undefined;
    return function (label, signal) {
      return global.ZoidiumUI.confirm({
        title: "Still working",
        message: label + " is taking longer than expected. A slow, network or cloud drive can cause this.\nKeep waiting, or stop " + action + "?",
        confirmLabel: "Keep waiting",
        cancelLabel: "Stop " + action,
        signal: signal,
      });
    };
  }

  // Saving waits for loading objects, but a load that failed or never ends
  // must not make the project unsaveable: the user decides after 10 seconds.
  // Automatic backups simply skip this round.
  function saveReadinessWait(interactive) {
    var saveNow = false;
    return async function (promise, label) {
      while (!saveNow && !await settledWithin(promise, 10000)) {
        if (!interactive || !global.ZoidiumUI || typeof global.ZoidiumUI.confirm !== "function") {
          throw new Error(label + " did not finish within 10 seconds. No incomplete archive was delivered.");
        }
        saveNow = await global.ZoidiumUI.confirm({
          title: "Still loading",
          message: label + " has not finished. Saving now may store that object without its loaded data.\nSave now, or keep waiting?",
          confirmLabel: "Save now",
          cancelLabel: "Keep waiting",
        });
      }
    };
  }

  function transitionBusy(editor) {
    if (!editor._zoidiumTransitionPromise) return false;
    if (editor._zoidiumTransitionProgress) editor._zoidiumTransitionProgress.show(true);
    return true;
  }

  function transitionProgress(editor, title) {
    var token = {};
    var message = "Saving a restore point before replacing the current project.";
    var visible = false;
    var begin = Date.now();
    var timer = global.setTimeout(function () { progress.show(false); }, 300);
    var progress = {
      show: function (repeated) {
        visible = true;
        global.__zoidiumRestoreParts?.toasts?.showToast({
          title: repeated ? "Already working" : title,
          message: message,
          progressToken: token,
        });
      },
      update: function (value) { message = value; if (visible) progress.show(false); },
      finish: function () {
        global.clearTimeout(timer);
        global.__zoidiumRestoreParts?.toasts?.hideProgress(token);
        editor._zoidiumTransitionProgress = null;
        try { global.ZOIDIUM_DEBUG_LOG?.record("project-span", { name: title, durationMs: Date.now() - begin, status: "settled" }); }
        catch (_error) { /* Diagnostics must never interrupt a transition. */ }
      },
    };
    editor._zoidiumTransitionProgress = progress;
    return progress;
  }

  // An export renders the editor's project directly, and the export pages hold
  // editor.enabled false for as long as they own it. Replacing the project would
  // release GPU resources the export is using and leave its progress page over
  // an unrelated timeline, so every replacement path stops here instead.
  var EXPORT_BUSY_MESSAGE = "An export is using this project. Finish or cancel it on the Export page, then try again. The current project was kept.";

  function isExportBusy(editor) {
    return Boolean(editor) && editor.enabled === false;
  }

  function refuseDuringExport(editor, message) {
    if (!isExportBusy(editor)) return false;
    try {
      global.dispatchEvent(new CustomEvent("zoidium:project-error", {
        detail: { editor: editor, message: message || EXPORT_BUSY_MESSAGE, retry: null, download: null, recoverable: false },
      }));
    } catch (_error) {
      // A failed notification must not let the replacement continue.
    }
    return true;
  }

  // The toolbar and shortcuts reach undo and redo while the panels are disabled,
  // and an edit halfway through an export would mix two versions of the project.
  var historyPrototype = PZ.ui && PZ.ui.history && PZ.ui.history.prototype;
  ["undo", "redo"].forEach(function (method) {
    var original = historyPrototype && historyPrototype[method];
    if (typeof original !== "function") return;
    historyPrototype[method] = function () {
      var name = method === "undo" ? "Undo" : "Redo";
      if (refuseDuringExport(this.editor, name + " is unavailable while an export is using this project. Finish or cancel it on the Export page, then try again.")) return;
      return original.apply(this, arguments);
    };
  });

  PZ.zoidium.projectFilesShared = {
    EXPORT_BUSY_MESSAGE, isExportBusy, refuseDuringExport,
    captureDiskState, recordDiskSave, projectEdited, updateProjectDirty, diskUnsaved,
    prepareProject, slowStepQuestion, saveReadinessWait, transitionBusy, transitionProgress,
    DEFAULT_PROJECT_NAME: DEFAULT_PROJECT_NAME,
    normalizeProjectName: normalizeProjectName,
    fileNameForProject: fileNameForProject,
    projectNameFromFileName: projectNameFromFileName,
    decodeLegacyDisplayName: decodeLegacyDisplayName,
    displayNameForUi: displayNameForUi,
    fileDiagnostics: fileDiagnostics,
    errorMessage: errorMessage,
    isPlainObject: isPlainObject,
    VALIDATION_PREFIX: VALIDATION_PREFIX,
    isProjectDataError: isProjectDataError,
    projectDataError: projectDataError,
    warmProjectClips: warmProjectClips,
  };
})(window);
