(function installProjectFiles(global) {
  "use strict";

  var PZ = global.PZ;
  var editorPrototype = PZ && PZ.ui && PZ.ui.editor && PZ.ui.editor.prototype;
  if (!editorPrototype) return;

  var PATCH_MARKER = "__zoidiumProjectFilesPatch";
  var DEFAULT_PROJECT_NAME = "project";
  var archiveIO = PZ.zoidiumProjectArchive;
  if (!archiveIO) throw new Error("Project archive support is unavailable.");

  if (editorPrototype[PATCH_MARKER]) return;
  editorPrototype[PATCH_MARKER] = true;

  PZ.zoidium = PZ.zoidium || {};

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

  function dispatch(type, detail) {
    try {
      global.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    } catch (_error) {
      // Status notifications must never interrupt file operations.
    }
  }

  function getProjectName(editor) {
    return normalizeProjectName(editor && editor._zoidiumProjectName);
  }

  function setProjectName(editor, value) {
    if (!editor) return DEFAULT_PROJECT_NAME;
    var name = normalizeProjectName(value);
    editor._zoidiumProjectName = name;
    dispatch("zoidium:project-name-changed", { editor: editor, name: name });
    return name;
  }

  function setRawProjectName(editor, value) {
    if (!editor) return;
    editor._zoidiumProjectName = String(value == null ? "" : value);
    dispatch("zoidium:project-name-changed", {
      editor: editor,
      name: getProjectName(editor),
    });
  }

  function getProjectRevision(editor) {
    var project = editor && editor.project;
    if (!project) return 0;
    if (editor._zoidiumRevisionProject === project) {
      return editor._zoidiumProjectRevision || 0;
    }

    var previousProject = editor._zoidiumRevisionProject;
    var previousWatcher = editor._zoidiumRevisionWatcher;
    if (
      previousProject &&
      previousProject.ui &&
      previousProject.ui.onChanged &&
      typeof previousProject.ui.onChanged.unwatch === "function" &&
      previousWatcher
    ) {
      previousProject.ui.onChanged.unwatch(previousWatcher);
    }

    editor._zoidiumRevisionProject = project;
    editor._zoidiumProjectRevision = 0;
    editor._zoidiumRevisionWatcher = function () {
      if (editor._zoidiumRevisionProject === project) {
        editor._zoidiumProjectRevision += 1;
      }
    };
    if (
      project.ui &&
      project.ui.onChanged &&
      typeof project.ui.onChanged.watch === "function"
    ) {
      project.ui.onChanged.watch(editor._zoidiumRevisionWatcher);
    }
    return 0;
  }

  function decodeArchiveMetadata(archive) {
    if (!archive || typeof archive.peekFile !== "function") return null;
    var entry = archive.peekFile("zoidium.json");
    if (!entry || entry.data == null) return null;

    try {
      var data = entry.data;
      if (data instanceof ArrayBuffer) data = new Uint8Array(data);
      if (ArrayBuffer.isView(data)) {
        data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      var text = new TextDecoder().decode(data);
      var metadata = JSON.parse(text);
      return metadata && typeof metadata.name === "string" ? metadata : null;
    } catch (_error) {
      // Entries without readable metadata simply carry no display name.
      return null;
    }
  }

  function listAssets(project) {
    var list = project && project.assets && project.assets.list;
    return list && typeof list === "object" ? Object.keys(list).map(function (key) {
      return list[key];
    }) : [];
  }

  function bytesForData(data) {
    return archiveIO.bytes(data, "Project entry");
  }

  var PROJECT_ENTRY = "project";
  var META_ENTRY = "meta";
  var VALIDATION_PREFIX = {
    save: "Nothing was saved.",
    open: "This project file cannot be opened.",
    restore: "This restore point cannot be opened.",
  };

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isProjectDataError(error) {
    return Boolean(error && error.name === "ProjectDataError");
  }

  function projectDataError(mode, detail) {
    var error = new Error((VALIDATION_PREFIX[mode] || VALIDATION_PREFIX.open) + " " + String(detail).replace(/[.]+$/, "") + ".");
    error.name = "ProjectDataError";
    return error;
  }

  // Reads an archive entry without removing it. CM3's getFile() splices the
  // entry out of the archive, so the validator must never use it.
  async function decodeEntryText(data) {
    if (typeof data === "string") return data;
    return new TextDecoder().decode(await bytesForData(data));
  }

  async function readJsonEntry(archive, name, mode, label) {
    var entry = archive.peekFile(name);
    if (!entry || entry.data == null) {
      throw projectDataError(mode, label + " is missing from the archive");
    }
    var text;
    try {
      text = await decodeEntryText(entry.data);
    } catch (_error) {
      throw projectDataError(mode, label + " could not be read");
    }
    var trimmed = String(text).trim();
    if (!trimmed) throw projectDataError(mode, label + " is empty");
    // JSON.stringify(undefined) is undefined, and a Blob built from it holds
    // the text "undefined". Name that cause instead of a parser message.
    if (trimmed === "undefined") {
      throw projectDataError(mode, label + " contains the placeholder text \"undefined\" instead of JSON");
    }
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      throw projectDataError(mode, label + " is not valid JSON");
    }
  }

  // Archives written by the pre-Gen3 CM2 and BG4 builds have their own layout
  // and are handled by CM3's compatibility loaders, so the Gen3 structure
  // checks do not apply to them.
  function isLegacyArchive(archive) {
    var compatibility = PZ.compatibility;
    if (!compatibility) return false;
    return Boolean(
      (compatibility.CM2 && compatibility.CM2.check(archive)) ||
        (compatibility.BG4 && compatibility.BG4.check(archive)),
    );
  }

  function checkAssetReferences(document, mode) {
    var assetFields = /^(?:asset|font|image|texture|geometry|vertexShader|fragmentShader|nodeImage|.*(?:Asset|Texture|Map|Data))$/i;
    function visit(value, path, field, depth) {
      if (depth > 128) throw projectDataError(mode, "The project data exceeds the 128-level nesting limit");
      if (typeof value === "string" && assetFields.test(field) && /^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(value)) {
        if (!document.assets || !Object.prototype.hasOwnProperty.call(document.assets, value)) {
          throw projectDataError(mode, "Asset reference " + path + " (" + value + ") has no asset metadata");
        }
      } else if (value && typeof value === "object") {
        Object.keys(value).forEach(function (key) {
          if (path === "project" && key === "assets") return;
          var referenceField = assetFields.test(field) && /^(?:value|keyframes|objects|\d+)$/.test(key) ? field : key;
          visit(value[key], path + "." + key, referenceField, depth + 1);
        });
      }
    }
    visit(document, "project", "", 0);
  }

  // Checks that an archive holds the project document CM3 would parse. The
  // "save" mode runs before anything is written; "open" and "restore" run
  // before the document is handed to the loader, so damaged files fail with a
  // clear message instead of a JSON.parse error.
  async function validateProjectArchive(archive, mode) {
    if (!archive || typeof archive.peekFile !== "function") {
      throw projectDataError(mode, "The project archive is not available");
    }
    if (mode !== "save" && isLegacyArchive(archive)) {
      return { legacy: true, mediaCount: 0 };
    }

    var document = await readJsonEntry(archive, PROJECT_ENTRY, mode, "The project data");
    // Shape of PZ.project.prototype.toJSON: { assets, media, sequence }.
    if (!isPlainObject(document) || !isPlainObject(document.sequence) || !Array.isArray(document.media) ||
        ((mode === "save" || document.assets != null) && !isPlainObject(document.assets))) {
      throw projectDataError(mode, "The project data has no sequence or media list");
    }

    if (mode === "save" || archive.peekFile(META_ENTRY)) {
      var meta = await readJsonEntry(archive, META_ENTRY, mode, "The project metadata");
      // Saves always write a version; older files opened by CM3 may not have one.
      if (!isPlainObject(meta) || (mode === "save" && meta.version == null)) {
        throw projectDataError(mode, "The project metadata has no version");
      }
    }
    checkAssetReferences(document, mode);
    var metadata = null;
    if (archive.peekFile("zoidium.json")) {
      metadata = await readJsonEntry(archive, "zoidium.json", mode, "The Zoidium metadata");
    }
    await archiveIO.checkAssets(archive, document, metadata, mode);
    return { legacy: false, mediaCount: document.media.length };
  }

  // CM3 gives a media item's thumbnail to URL.createObjectURL unless it is a
  // string, and a thumbnail only exists at runtime (CM3 never writes one). An
  // older build saved a Blob thumbnail as {}, which then broke every reopen.
  // Drop any non-string thumbnail so CM3 falls back to the media icon. Only the
  // in-memory "project" entry is rewritten; a saved file on disk is untouched.
  // Returns the number of thumbnails removed.
  async function sanitizeProjectArchive(archive) {
    var entry = archive.peekFile(PROJECT_ENTRY);
    if (!entry || entry.data == null || isLegacyArchive(archive)) return 0;
    var document;
    try {
      document = JSON.parse(String(await decodeEntryText(entry.data)).trim());
    } catch (_error) {
      // Unreadable project data is reported by validation, not repaired here.
      return 0;
    }
    if (!isPlainObject(document) || !Array.isArray(document.media)) return 0;

    var removed = 0;
    document.media.forEach(function (media) {
      if (isPlainObject(media) && "thumbnail" in media && typeof media.thumbnail !== "string") {
        delete media.thumbnail;
        removed += 1;
      }
    });
    if (removed === 0) return 0;

    // Store the entry as bytes, as CM3's addFileString does. PZ.project.load
    // reads it with getFileString, which yields nothing from a Blob.
    var index = archive.files.indexOf(entry);
    archive.files[index] = {
      name: PROJECT_ENTRY,
      data: new TextEncoder().encode(JSON.stringify(document)),
    };
    return removed;
  }

  // Unpacks a saved project (or restore point) and checks its project data
  // before anything is loaded from it. Every failure is a ProjectDataError with
  // an English message.
  async function openValidatedArchive(source, mode) {
    if (!(Number(source && source.size) > 0)) {
      throw projectDataError(mode, "The archive is empty");
    }
    var archive;
    try {
      archive = await archiveIO.bounded(archiveIO.decode(source, PZ.archive), "Decoding the project file", archiveIO.budget(source.size, 60000));
    } catch (error) {
      throw projectDataError(mode, errorMessage(error, "The archive is not readable"));
    }
    await archiveIO.bounded(validateProjectArchive(archive, mode), "Validating the project file", archiveIO.budget(source.size, 60000));
    await sanitizeProjectArchive(archive);
    return archive;
  }

  // Runs CM3's project serializer and turns a thrown error (for example a
  // plugin toJSON that throws) into a save failure with a clear cause.
  async function serializeProject(archive, project) {
    try {
      await archiveIO.bounded(PZ.project.save(archive, project), "Project serialization");
    } catch (error) {
      throw projectDataError(
        "save",
        "The project could not be serialized (" + errorMessage(error, "unknown error") + ")",
      );
    }
  }

  async function fingerprintBytes(bytes) {
    return "sha256:" + await archiveIO.hash(bytes);
  }

  async function fingerprintArchive(archive) {
    var entries = archive.files.slice().sort(function (left, right) {
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    var encoder = new TextEncoder();
    var summaries = [];
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var bytes = await bytesForData(entry.data);
      summaries.push([entry.name, bytes.length, await fingerprintBytes(bytes)]);
    }
    // Version the algorithm. Restore points with an older fingerprint can cause
    // only one extra automatic snapshot.
    return "entries-v4:" + await fingerprintBytes(encoder.encode(JSON.stringify(summaries)));
  }

  // options.shouldSkip(fingerprint) lets automatic backups stop before the
  // TAR is produced when the content is already stored. The result then has
  // skipped: true and no blob.
  async function createArchiveUnlocked(editor, options) {
    if (!editor || !editor.project) {
      throw new Error("There is no project to save.");
    }

    var sourceProject = editor.project;
    var sourceRevision = getProjectRevision(editor);
    var archive = new PZ.archive();

    // Await serialized object/plugin initialization, not preview decoders.
    // Otherwise a still-loading object can serialize its default properties.
    await prepareProject(sourceProject, saveReadinessWait(Boolean(options && options.interactive)));
    await serializeProject(archive, editor.project);
    // Runtime-only media thumbnails must never reach a saved file.
    await sanitizeProjectArchive(archive);
    // Refuse to continue with a missing, empty, or "undefined" project entry.
    // Nothing has been written to disk or to a restore point at this point.
    var projectName = getProjectName(editor);
    var assets = listAssets(editor.project);
    var assetLabels = Object.create(null);
    var fileNames = new Set(archive.files.map(function (entry) { return entry.name; }));

    var packagedAssetCount = 0;
    for (var index = 0; index < assets.length; index += 1) {
      var asset = assets[index];
      if (!asset || !asset.file) continue;

      var assetName = asset.sha256 || asset.key;
      if (!assetName) continue;
      assetLabels[assetName] = asset.filename;
      if (fileNames.has(assetName)) continue;
      fileNames.add(assetName);
      archive.addFile(assetName, asset.file);
      packagedAssetCount += 1;
    }

    // Materialize every local asset before hashing. Preview font/texture
    // decoders are irrelevant to saving attached bytes and are never awaited.
    var totalBytes = archive.files.reduce(function (total, entry) {
      return total + Number(entry.data && (entry.data.size || entry.data.byteLength) || 0);
    }, 0);
    if (totalBytes > archiveIO.MAX_BYTES) throw new Error("The project exceeds the " + archiveIO.LIMIT_LABEL + " safety limit. Nothing was replaced.");
    for (var fileIndex = 0; fileIndex < archive.files.length; fileIndex += 1) {
      var fileEntry = archive.files[fileIndex];
      var label = "Entry " + fileEntry.name + (assetLabels[fileEntry.name] ? " (" + assetLabels[fileEntry.name] + ")" : "");
      fileEntry.data = new Blob([await archiveIO.bytes(fileEntry.data, label)]);
    }
    archive.addFileString("zoidium.json", JSON.stringify({
      version: 1, name: projectName, integrity: await archiveIO.integrity(archive),
    }));
    await validateProjectArchive(archive, "save");
    var fingerprint = await fingerprintArchive(archive);

    var result = {
      blob: null,
      skipped: false,
      projectName: projectName,
      assetCount: assets.length,
      packagedAssetCount: packagedAssetCount,
      fingerprint: fingerprint,
    };
    if (options && typeof options.shouldSkip === "function" && await options.shouldSkip(fingerprint)) {
      result.skipped = true;
      return result;
    }

    var blob = await archiveIO.bounded(archiveIO.encode(archive), "Project archive creation", archiveIO.budget(totalBytes));
    // Decode the finished bytes using exactly the open validator. Only this
    // verified, memory-backed Blob may reach a writer or download link.
    await openValidatedArchive(blob, "save");
    if (editor.project !== sourceProject || getProjectRevision(editor) !== sourceRevision || getProjectName(editor) !== projectName) {
      throw new Error("The project changed while the archive was built. Nothing was replaced. Retry saving the current project.");
    }
    result.blob = blob;
    return result;
  }

  function createArchive(editor, options) {
    // Project TAR now uses page memory, so saving never queues behind a
    // pending video export or a lease held by another tab. Every step inside
    // has its own size-scaled deadline; an outer fixed deadline would fail
    // large valid projects and leave the build running in the background.
    return createArchiveUnlocked(editor, options);
  }

  async function triggerDownload(blob, filename) {
    await openValidatedArchive(blob, "restore");
    if (!blob || !(Number(blob.size) > 0)) {
      throw new Error("No project archive is available to download.");
    }

    var url = URL.createObjectURL(blob);
    var link = global.document.createElement("a");
    link.href = url;
    link.download = filename || fileNameForProject(DEFAULT_PROJECT_NAME);
    link.rel = "noopener";
    link.style.display = "none";
    global.document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  function errorMessage(error, fallback) {
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  function emitError(editor, error, archiveResult, retry) {
    var filename = fileNameForProject(getProjectName(editor));
    dispatch("zoidium:project-error", {
      editor: editor,
      error: error,
      message: errorMessage(error, "Could not save the project."),
      blob: archiveResult && archiveResult.blob,
      filename: filename,
      retry: retry,
      recoverable: false,
      download: archiveResult && archiveResult.blob
        ? function () {
            return triggerDownload(archiveResult.blob, filename);
          }
      : null,
    });
  }

  function isUserGesturePickerError(error) {
    if (!error || error.name !== "SecurityError") return false;
    return /showSaveFilePicker|user gesture|user activation/i.test(
      String(error.message || ""),
    );
  }

  function markProjectSavedIfUnchanged(editor, savedProject, savedRevision) {
    if (
      editor.project === savedProject &&
      getProjectRevision(editor) === savedRevision &&
      editor.project &&
      editor.project.ui
    ) {
      editor.project.ui.dirty = false;
    }
  }

  async function saveAsDownloadFallback(
    editor,
    archiveResult,
    filename,
    savedProject,
    savedRevision,
  ) {
    await triggerDownload(archiveResult.blob, filename);
    markProjectSavedIfUnchanged(editor, savedProject, savedRevision);
    dispatch("zoidium:project-saved", {
      editor: editor,
      filename: filename,
      size: archiveResult.blob.size,
      assetCount: archiveResult.assetCount,
      delivery: "download",
    });
    return archiveResult;
  }

  async function runSaveProject(editor) {
    var projectName = getProjectName(editor);
    var filename = fileNameForProject(projectName);
    var handle = editor._zoidiumSaveFileHandle || null;
    var pickerError = null;
    var pickedHandle = null;

    // The picker must be called before the first await so browsers can use the
    // user gesture which initiated Ctrl+S or the toolbar button.
    if (!handle) {
      if (typeof global.showSaveFilePicker !== "function") {
        pickerError = new Error("File System Access is unavailable in this browser.");
      } else {
        try {
          pickedHandle = await global.showSaveFilePicker({
            suggestedName: filename,
            types: [{
              description: "Panzoid project",
              accept: { "application/octet-stream": [".pz"] },
            }],
          });
        } catch (error) {
          if (error && error.name === "AbortError") return null;
          pickerError = error;
        }
      }
    }

    // File System Access returns the actual name selected in the picker. Keep
    // the project metadata and the toolbar field in sync when that name was
    // changed by the user.
    if (pickedHandle && typeof pickedHandle.name === "string" && pickedHandle.name.trim()) {
      projectName = projectNameFromFileName(pickedHandle.name);
      setProjectName(editor, projectName);
      filename = pickedHandle.name.trim();
    }

    var savedProject = editor.project;
    var savedRevision = getProjectRevision(editor);
    var archiveResult = null;
    try {
      archiveResult = await createArchive(editor, { interactive: true });
    } catch (error) {
      emitError(editor, error, null, function () {
        return saveProject(editor);
      });
      return null;
    }

    // Browsers without the File System Access picker (and picker calls the
    // browser refuses without a user gesture) save through a download instead.
    var pickerUnavailable = typeof global.showSaveFilePicker !== "function";
    if (pickerError && (pickerUnavailable || isUserGesturePickerError(pickerError))) {
      try {
        return await saveAsDownloadFallback(
          editor,
          archiveResult,
          filename,
          savedProject,
          savedRevision,
        );
      } catch (error) {
        emitError(editor, error, archiveResult, function () {
          return saveProject(editor);
        });
        return null;
      }
    }

    if (pickerError) {
      emitError(editor, pickerError, archiveResult, function () {
        return saveProject(editor);
      });
      return null;
    }

    var targetHandle = handle || pickedHandle;
    if (!targetHandle) {
      emitError(
        editor,
        new Error("No writable project file was selected."),
        archiveResult,
        function () {
          return saveProject(editor);
        },
      );
      return null;
    }

    var writable = null;
    try {
      var opening = targetHandle.createWritable();
      writable = await archiveIO.bounded(opening, "Opening the writable project file", 10000, function () {
        // A late handle still owns a staged file. Abort it even though the
        // caller has already received the timeout and may have retried.
        Promise.resolve(opening).then(function (lateWritable) {
          if (lateWritable && typeof lateWritable.abort === "function") return lateWritable.abort();
        }).catch(function () {});
      });
      var writeBudget = archiveIO.budget(archiveResult.blob.size);
      await archiveIO.bounded(writable.write(archiveResult.blob), "Writing the project file", writeBudget);
      await archiveIO.bounded(writable.close(), "Committing the project file", writeBudget);
      if (editor.project === savedProject) {
        editor._zoidiumSaveFileHandle = targetHandle;
        editor._zoidiumSaveFileName = filename;
      }
      markProjectSavedIfUnchanged(editor, savedProject, savedRevision);
      dispatch("zoidium:project-saved", {
        editor: editor,
        filename: filename,
        size: archiveResult.blob.size,
        assetCount: archiveResult.assetCount,
      });
      return archiveResult;
    } catch (error) {
      if (writable && typeof writable.abort === "function") {
        try {
          await archiveIO.bounded(writable.abort(), "Aborting the failed project write");
        } catch (_abortError) {
          // Keep the original write error for the user.
        }
      }
      emitError(editor, error, archiveResult, function () {
        return saveProject(editor);
      });
      return null;
    }
  }

  function saveProject(editor) {
    if (editor._zoidiumSavePromise) return editor._zoidiumSavePromise;

    // runSaveProject reaches showSaveFilePicker before its first await. Keep
    // this wrapper synchronous so the initiating click or Ctrl+S retains its
    // transient user activation.
    var operation = runSaveProject(editor);
    editor._zoidiumSavePromise = operation;
    operation.then(
      function () {
        if (editor._zoidiumSavePromise === operation) {
          editor._zoidiumSavePromise = null;
        }
      },
      function () {
        if (editor._zoidiumSavePromise === operation) {
          editor._zoidiumSavePromise = null;
        }
      },
    );
    return operation;
  }

  // CM3's toolbar calls editor.save(). Route that action through the
  // File System Access path so the selected file can be overwritten later.
  if (typeof editorPrototype.save === "function") {
    editorPrototype.save = function () {
      return saveProject(this);
    };
  }

  async function backupBeforeReplace(editor, reason) {
    var expected = { project: editor.project, revision: getProjectRevision(editor), name: getProjectName(editor) };
    var panel = global.__zoidiumRestoreParts && global.__zoidiumRestoreParts.panel;
    if (!panel || typeof panel.createSnapshot !== "function") {
      throw new Error("Restore-point storage is not ready. The current project was kept.");
    }
    try {
      await panel.createSnapshot(false, false);
    } catch (error) {
      // A full storage quota or a project too large for restore points must
      // not lock the user into the current project. Ask instead.
      if (!global.ZoidiumUI || typeof global.ZoidiumUI.confirm !== "function") throw error;
      var proceed = await global.ZoidiumUI.confirm({
        title: "Backup failed",
        message: "The current project could not be backed up before " + reason + " (" +
          errorMessage(error, "unknown error") + ").\nContinue without a backup?",
        confirmLabel: "Continue without backup",
        cancelLabel: "Keep current project",
      });
      if (!proceed) throw error;
    }
    assertProjectUnchanged(editor, expected);
    return expected;
  }

  function assertProjectUnchanged(editor, expected) {
    if (editor.project !== expected.project || getProjectRevision(editor) !== expected.revision || getProjectName(editor) !== expected.name) {
      throw new Error("The current project changed during the operation. It was kept. Retry after editing has finished.");
    }
  }

  var originalNew = editorPrototype.new;
  if (typeof originalNew === "function") {
    editorPrototype.new = function () {
      if (!this.project) return originalNew.apply(this, arguments);
      return newProjectWithBackup.call(this, arguments);
    };
    async function newProjectWithBackup(args) {
      if (this._zoidiumTransitionPromise || !this.confirmIfDirty()) return;
      var editor = this;
      var previousProject = editor.project;
      var operation = (async function () {
        await backupBeforeReplace(editor, "creating a new project");
        var confirm = editor.confirmIfDirty;
        try {
          editor.confirmIfDirty = function () { return true; };
          originalNew.apply(editor, args);
        } finally {
          editor.confirmIfDirty = confirm;
        }
        if (editor.project && editor.project !== previousProject) {
          editor._zoidiumSaveFileHandle = null;
          editor._zoidiumSaveFileName = null;
          setProjectName(editor, DEFAULT_PROJECT_NAME);
          dispatch("zoidium:project-changed", { editor: editor, reason: "new" });
        }
      })();
      editor._zoidiumTransitionPromise = operation;
      try { await operation; }
      catch (error) { emitError(editor, error, null, function () { return editor.new(); }); }
      finally { editor._zoidiumTransitionPromise = null; }
    }
  }

  // Temporal operators must exist before the first schedule preparation.
  // CM3 creates nested effects asynchronously but returns a project before
  // those loads finish, so its first frame can bypass a saved time operator.
  async function prepareProject(project, wait) {
    if (!project) return project;
    // Opening waits as long as CM3 does: a slow but valid load is not a failure.
    wait = wait || function (promise) { return promise; };
    if (project._zoidiumPluginActivationPending) {
      await wait(project._zoidiumPluginActivationPending, "Project plugin activation");
    }
    var visited = new WeakSet();
    async function visit(object) {
      if (!object || typeof object !== "object" || visited.has(object)) return;
      visited.add(object);
      if (object.loading && typeof object.loading.then === "function") {
        await wait(object.loading, (object.defaultName || object.baseTypeString || "Project object") + " loading");
      }
      var children = Array.isArray(object) ? object : object.children;
      if (children) {
        for (var index = 0; index < children.length; index += 1) {
          await visit(children[index]);
        }
      }
    }
    await visit(project);
    return project;
  }

  // Resolves true once the promise settles either way, false after the delay.
  function settledWithin(promise, milliseconds) {
    var timer;
    return Promise.race([
      Promise.resolve(promise).then(function () { return true; }, function () { return true; }),
      new Promise(function (resolve) { timer = global.setTimeout(function () { resolve(false); }, milliseconds); }),
    ]).finally(function () { global.clearTimeout(timer); });
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

  var originalLoadProject = editorPrototype.loadProject;
  if (typeof originalLoadProject === "function") {
    editorPrototype.loadProject = async function () {
      var project = await originalLoadProject.apply(this, arguments);
      return prepareProject(project);
    };
  }

  editorPrototype.open = function (selectedFile) {
    var editor = this;
    if (editor._zoidiumTransitionPromise || !editor.confirmIfDirty()) return;

    async function loadFile(file) {
      if (!file) return;
      if (editor._zoidiumTransitionPromise) return;
      var releaseTransition;
      editor._zoidiumTransitionPromise = new Promise(function (resolve) { releaseTransition = resolve; });
      var originalFilename = typeof file.name === "string" ? file.name : "";
      try {
        // Toolbar and desktop opens share validation, plugin activation,
        // assets, project naming, and error/recovery notifications.
        var archive;
        try { archive = await openValidatedArchive(file, "open"); }
        catch (error) {
          if (!error.partialArchive || !global.ZoidiumUI) throw error;
          var approved = await global.ZoidiumUI.confirm({
            title: "Damaged project assets",
            message: error.message + "\nOpen the readable project data? Missing assets remain unavailable until attached again. Restore points are available in Restore.",
            confirmLabel: "Open readable parts", cancelLabel: "Keep current project",
          });
          if (!approved) throw error;
          archive = error.partialArchive;
          await sanitizeProjectArchive(archive);
          dispatch("zoidium:notification", { title: "Opened readable parts", message: error.message.replace(" Nothing was replaced.", "") + " Reattach the unavailable assets before saving. The source file and previous restore points are unchanged." });
        }
        var metadata = decodeArchiveMetadata(archive);
        var expected = await backupBeforeReplace(editor, "opening another project");
        var project = await editor.loadProject(archive);
        assertProjectUnchanged(editor, expected);
        editor.project = project;
        editor._zoidiumSaveFileHandle = null;
        editor._zoidiumSaveFileName = null;
        dispatch("zoidium:project-changed", { editor: editor, reason: "open" });
        setProjectName(
          editor,
          metadata && metadata.name
            ? metadata.name
            : projectNameFromFileName(originalFilename),
        );
        dispatch("zoidium:project-opened", {
          editor: editor,
          ...fileDiagnostics(file),
        });
      } catch (error) {
        dispatch("zoidium:project-error", {
          editor: editor,
          error: error,
          message: errorMessage(error, "Could not open the project."),
          ...fileDiagnostics(file),
          retry: function () { return editor.open(selectedFile); },
          recoverable: isProjectDataError(error),
          download: null,
        });
      } finally {
        releaseTransition();
        editor._zoidiumTransitionPromise = null;
      }
    }

    // The desktop bridge supplies a browser File, never a filesystem path.
    if (global.Blob && selectedFile instanceof global.Blob) return loadFile(selectedFile);
    editor.showFilePicker(function (event) {
      var fileInput = event.currentTarget;
      var file = fileInput && fileInput.files && fileInput.files[0];
      // Remove the filename from the live native control on macOS/Electron.
      try { if (fileInput) fileInput.value = ""; } catch (_error) { /* best effort */ }
      return loadFile(file);
    }, ".pz");
  };

  var desktopProjects = global.ZoidiumDesktopProjects;
  if (desktopProjects) {
    desktopProjects.onFile(async function (message) {
      var editor = global.CM;
      try {
        var response = await archiveIO.bounded(global.fetch(message.url), "Desktop project read");
        if (!response.ok) throw new Error("The project file is no longer available.");
        var length = response.headers && response.headers.get ? response.headers.get("content-length") : 0;
        var file = new global.File([await archiveIO.bounded(response.blob(), "Desktop project transfer", archiveIO.budget(length, 60000))], message.name);
        if (editor._zoidiumTransitionPromise) {
          await archiveIO.bounded(editor._zoidiumTransitionPromise, "Waiting for the current project operation", 60000);
        }
        await editor.open(file);
      } catch (error) {
        dispatch("zoidium:project-error", {
          editor: editor, error: error,
          message: errorMessage(error, "Could not open the project."),
        });
      } finally {
        desktopProjects.complete(message.id);
      }
    });
    // initTool and post-init extensions finish before this event. DOM load
    // alone does not mean CM3 or the project/plugin loader is usable.
    global.addEventListener("zoidium:ready", function () {
      if (global.CM && PZ.zoidium.projectFiles) desktopProjects.ready();
    }, { once: true });
  }

  PZ.zoidium.define("projectFiles", {
    defaultProjectName: DEFAULT_PROJECT_NAME,
    getProjectName: getProjectName,
    setProjectName: setProjectName,
    setRawProjectName: setRawProjectName,
    fileNameForProject: fileNameForProject,
    displayNameForUi: displayNameForUi,
    createArchive: createArchive,
    prepareProject: prepareProject,
    backupBeforeReplace: backupBeforeReplace,
    assertProjectUnchanged: assertProjectUnchanged,
    fingerprintArchive: fingerprintArchive,
    getProjectRevision: getProjectRevision,
    validateProjectArchive: validateProjectArchive,
    sanitizeProjectArchive: sanitizeProjectArchive,
    openValidatedArchive: openValidatedArchive,
    isProjectDataError: isProjectDataError,
    triggerDownload: triggerDownload,
    saveProject: saveProject,
  }, "core/project-files");
})(window);
