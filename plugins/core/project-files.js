(function installProjectFiles(global) {
  "use strict";

  var PZ = global.PZ;
  var editorPrototype = PZ && PZ.ui && PZ.ui.editor && PZ.ui.editor.prototype;
  if (!editorPrototype) return;

  var PATCH_MARKER = "__zoidiumProjectFilesPatch";
  var DEFAULT_PROJECT_NAME = "project";

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
      return null;
    }
  }

  function listAssets(project) {
    var list = project && project.assets && project.assets.list;
    return list && typeof list === "object" ? Object.keys(list).map(function (key) {
      return list[key];
    }) : [];
  }

  async function bytesForData(data) {
    if (data && typeof data.arrayBuffer === "function") {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Could not inspect a project file.");
  }

  // CM3 streams the serialized project through the same origin-private file
  // named "out" that the video worker uses, and hands back a live File handle
  // to it. A later render or cleanup rewrites the bytes behind that handle, so
  // copy the archive into page memory before it reaches the save picker, a
  // download link, or a restore point.
  function isFileBackedBlob(value) {
    return Boolean(
      value &&
        Number.isFinite(Number(value.size)) &&
        typeof value.slice === "function" &&
        typeof value.stream === "function" &&
        typeof value.name === "string" &&
        value.name.length > 0,
    );
  }

  async function detachArchiveBlob(blob) {
    if (!isFileBackedBlob(blob)) return blob;
    var io = PZ.zoidiumIoSerialization;
    if (io && typeof io.detachBlob === "function") {
      return io.detachBlob(blob, "The project archive");
    }
    if (typeof Response !== "function" || Number(blob.size) <= 0) return blob;
    var copy;
    try {
      copy = await new Response(blob.stream()).blob();
    } catch (error) {
      var failure = new Error(
        "The project archive could not be copied out of the browser's temporary file.",
      );
      failure.cause = error;
      throw failure;
    }
    if (!copy || Number(copy.size) !== Number(blob.size)) {
      throw new Error(
        "The project archive was copied incompletely out of the browser's temporary file.",
      );
    }
    return copy;
  }

  async function fingerprintBytes(bytes) {
    if (global.crypto && global.crypto.subtle) {
      var digest = await global.crypto.subtle.digest("SHA-256", bytes);
      return "sha256:" + Array.from(new Uint8Array(digest)).map(function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    }

    var first = 2166136261;
    var second = 2166136261 ^ 0x9e3779b9;
    for (var index = 0; index < bytes.length; index += 1) {
      first ^= bytes[index];
      first = Math.imul(first, 16777619);
      second ^= bytes[index] + index;
      second = Math.imul(second, 16777619);
    }
    return "fallback:" + (first >>> 0).toString(16) + ":" + (second >>> 0).toString(16);
  }

  async function fingerprintArchive(archive) {
    var entries = archive.files.slice().sort(function (left, right) {
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    var encoder = new TextEncoder();
    var manifest = [];

    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var bytes = await bytesForData(entry.data);
      // Hash each entry independently. The old implementation retained every
      // asset in `parts` and then allocated one more buffer for the complete
      // archive fingerprint. A manifest of entry digests has the same change
      // detection semantics without retaining the whole project in memory.
      manifest.push(
        entry.name + "\u0000" + bytes.length + "\u0000" +
          await fingerprintBytes(bytes),
      );
    }

    return fingerprintBytes(encoder.encode(manifest.join("\n")));
  }

  function isWorkerBlob(value) {
    return Boolean(
      value &&
        Number.isFinite(Number(value.size)) &&
        typeof value.slice === "function" &&
        typeof value.arrayBuffer === "function",
    );
  }

  async function materializeArchive(archive) {
    var materialized = new PZ.archive();
    var entries = archive.files || [];
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var data = entry.data;
      // WORKERFS requires Blob-like entries. Reuse existing Blob/File values;
      // only the small serialized Uint8Array entries need wrapping. This
      // avoids reading every asset into a second Uint8Array before TAR starts.
      if (!isWorkerBlob(data)) {
        if (data && typeof data.arrayBuffer === "function") {
          data = new Blob([await data.arrayBuffer()]);
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          data = new Blob([data]);
        } else {
          throw new Error("Could not prepare a project file for archiving.");
        }
      }
      materialized.addFile(entry.name, data);
    }
    return materialized;
  }

  async function tarArchive(archive) {
    var materialized = await materializeArchive(archive);
    var io = PZ.zoidiumIoSerialization;
    var blob = io && typeof io.tarWithoutLock === "function"
      ? await io.tarWithoutLock(materialized)
      : await materialized.tar();
    if (!blob) throw new Error("Could not create the project archive.");
    return detachArchiveBlob(blob);
  }

  async function prepareProjectArchive(editor) {
    if (!editor || !editor.project) {
      throw new Error("There is no project to save.");
    }

    var archive = new PZ.archive();
    await PZ.project.save(archive, editor.project);
    var projectName = getProjectName(editor);
    archive.addFileString("zoidium.json", JSON.stringify({
      version: 1,
      name: projectName,
    }));

    return {
      archive: archive,
      projectName: projectName,
      assets: listAssets(editor.project),
    };
  }

  function assetArchiveName(asset) {
    return asset && (asset.sha256 || asset.key);
  }

  async function assetContentId(asset) {
    var declared = asset && asset.sha256 != null
      ? String(asset.sha256).trim().toLowerCase()
      : "";
    if (/^(?:sha256:)?[0-9a-f]{64}$/.test(declared)) {
      return declared.indexOf("sha256:") === 0 ? declared : "sha256:" + declared;
    }
    return fingerprintBytes(await bytesForData(asset.file));
  }

  async function collectAssetEntries(assets, archive) {
    var entries = [];
    var names = Object.create(null);
    var packagedAssetCount = 0;

    for (var index = 0; index < assets.length; index += 1) {
      var asset = assets[index];
      if (!asset || !asset.file) continue;

      var assetName = assetArchiveName(asset);
      if (!assetName || names[assetName] || (archive && archive.fileExists(assetName))) {
        continue;
      }
      names[assetName] = true;

      var entry = {
        id: await assetContentId(asset),
        name: assetName,
        size: Number.isFinite(Number(asset.file.size)) ? Number(asset.file.size) : null,
        type: typeof asset.file.type === "string" ? asset.file.type : "",
        file: asset.file,
      };
      entries.push(entry);
      if (archive) archive.addFile(assetName, asset.file);
      packagedAssetCount += 1;
    }

    return {
      entries: entries,
      packagedAssetCount: packagedAssetCount,
    };
  }

  function publicAssetRefs(entries) {
    return entries.map(function (entry) {
      return {
        id: entry.id,
        name: entry.name,
        size: entry.size,
        type: entry.type,
      };
    });
  }

  async function fingerprintRestorePoint(projectFingerprint, assetRefs) {
    var refs = assetRefs.slice().sort(function (left, right) {
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    var lines = ["project\u0000" + projectFingerprint];
    refs.forEach(function (ref) {
      lines.push("asset\u0000" + ref.name + "\u0000" + ref.id + "\u0000" + ref.size);
    });
    return fingerprintBytes(new TextEncoder().encode(lines.join("\n")));
  }

  async function createArchiveUnlocked(editor) {
    var prepared = await prepareProjectArchive(editor);
    var assetResult = await collectAssetEntries(prepared.assets, prepared.archive);
    var fingerprint = await fingerprintArchive(prepared.archive);
    var blob = await tarArchive(prepared.archive);
    return {
      blob: blob,
      projectName: prepared.projectName,
      assetCount: prepared.assets.length,
      packagedAssetCount: assetResult.packagedAssetCount,
      fingerprint: fingerprint,
    };
  }

  async function createRestorePointUnlocked(editor) {
    var prepared = await prepareProjectArchive(editor);
    // Automatic backups store the project archive separately from the media.
    // The media is placed in the restore-point content store by the restore
    // layer, so unchanged assets are never copied into every snapshot.
    var assetResult = await collectAssetEntries(prepared.assets, null);
    var projectFingerprint = await fingerprintArchive(prepared.archive);
    var assetRefs = publicAssetRefs(assetResult.entries);
    var fingerprint = await fingerprintRestorePoint(projectFingerprint, assetRefs);
    var projectBlob = await tarArchive(prepared.archive);
    return {
      version: 2,
      projectBlob: projectBlob,
      projectName: prepared.projectName,
      assetCount: prepared.assets.length,
      packagedAssetCount: assetResult.packagedAssetCount,
      archiveSize: projectBlob.size + assetResult.entries.reduce(function (total, entry) {
        return total + (Number(entry.size) || 0);
      }, 0),
      assetRefs: assetRefs,
      assets: assetResult.entries,
      fingerprint: fingerprint,
    };
  }

  function runArchiveOperation(kind, task) {
    var io = PZ.zoidiumIoSerialization;
    if (io && typeof io.run === "function" && typeof io.tarWithoutLock === "function") {
      return io.run(kind, task);
    }
    return task();
  }

  function createArchive(editor) {
    return runArchiveOperation("project-save", function () {
      return createArchiveUnlocked(editor);
    });
  }

  function createRestorePoint(editor) {
    return runArchiveOperation("project-backup", function () {
      return createRestorePointUnlocked(editor);
    });
  }

  async function restorePointToArchive(point, assetRecords) {
    if (!point || !point.projectBlob || !Array.isArray(point.assetRefs)) {
      throw new Error("This restore point is incomplete.");
    }

    var byId = Object.create(null);
    (assetRecords || []).forEach(function (record) {
      if (record && record.id && record.blob) byId[record.id] = record.blob;
    });

    var archive = new PZ.archive();
    await archive.untar(point.projectBlob);
    point.assetRefs.forEach(function (ref) {
      var blob = byId[ref.id];
      if (!blob) {
        throw new Error("Restore point asset is missing: " + ref.name);
      }
      archive.addFile(ref.name, blob);
    });
    return archive;
  }

  function createArchiveFromRestorePoint(point, assetRecords) {
    return runArchiveOperation("restore-download", async function () {
      var archive = await restorePointToArchive(point, assetRecords);
      return tarArchive(archive);
    });
  }

  function triggerDownload(blob, filename) {
    if (!blob) throw new Error("No project archive is available to download.");

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
    }, 1000);
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
      download: archiveResult && archiveResult.blob
        ? function () {
            triggerDownload(archiveResult.blob, filename);
          }
        : null,
    });
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
      archiveResult = await createArchive(editor);
    } catch (error) {
      emitError(editor, error, null, function () {
        return saveProject(editor);
      });
      return null;
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
      writable = await targetHandle.createWritable();
      await writable.write(archiveResult.blob);
      await writable.close();
      editor._zoidiumSaveFileHandle = targetHandle;
      editor._zoidiumSaveFileName = filename;
      if (
        editor.project === savedProject &&
        getProjectRevision(editor) === savedRevision &&
        editor.project &&
        editor.project.ui
      ) {
        editor.project.ui.dirty = false;
      }
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
          await writable.abort();
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

  var originalNew = editorPrototype.new;
  if (typeof originalNew === "function") {
    editorPrototype.new = function () {
      var previousProject = this.project;
      var result = originalNew.apply(this, arguments);
      if (this.project && this.project !== previousProject) {
        this._zoidiumSaveFileHandle = null;
        this._zoidiumSaveFileName = null;
        setProjectName(this, DEFAULT_PROJECT_NAME);
      }
      return result;
    };
  }

  editorPrototype.open = function () {
    var editor = this;
    if (!editor.confirmIfDirty()) return;

    editor.showFilePicker(async function (event) {
      var file = event.currentTarget.files && event.currentTarget.files[0];
      if (!file) return;

      try {
        var archive = new PZ.archive();
        await archive.untar(file);
        var project = await editor.loadProject(archive);
        editor.project = project;
        editor._zoidiumSaveFileHandle = null;
        editor._zoidiumSaveFileName = null;
        var metadata = decodeArchiveMetadata(archive);
        setProjectName(
          editor,
          metadata && metadata.name
            ? metadata.name
            : projectNameFromFileName(file.name),
        );
        dispatch("zoidium:project-opened", {
          editor: editor,
          filename: file.name,
        });
      } catch (error) {
        dispatch("zoidium:project-error", {
          editor: editor,
          error: error,
          message: errorMessage(error, "Could not open the project."),
          retry: function () {
            return editor.open();
          },
          download: null,
        });
      }
    }, ".pz");
  };

  PZ.zoidium.define("projectFiles", {
    defaultProjectName: DEFAULT_PROJECT_NAME,
    getProjectName: getProjectName,
    setProjectName: setProjectName,
    setRawProjectName: setRawProjectName,
    getProjectRevision: getProjectRevision,
    fileNameForProject: fileNameForProject,
    createArchive: createArchive,
    createRestorePoint: createRestorePoint,
    restorePointToArchive: restorePointToArchive,
    createArchiveFromRestorePoint: createArchiveFromRestorePoint,
    fingerprintArchive: fingerprintArchive,
    triggerDownload: triggerDownload,
    saveProject: saveProject,
  }, "core/project-files");
})(window);
