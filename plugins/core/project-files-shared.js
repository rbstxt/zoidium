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
  if (typeof global.addEventListener === "function") global.addEventListener("zoidium:project-changed", function (event) {
    var editor = event.detail?.editor;
    if (!editor) return;
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

  PZ.zoidium.projectFilesShared = {
    captureDiskState, recordDiskSave, projectEdited, updateProjectDirty, diskUnsaved,
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
