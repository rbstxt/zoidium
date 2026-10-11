(function installProjectRestore(global) {
  "use strict";

  // In the browser the three part files above load first as classic scripts
  // (see zoidium/runtime-config.js) and share their exports through this
  // registry. Node tests load them with require.
  var parts = global.__zoidiumRestoreParts || (global.__zoidiumRestoreParts = {});
  if (typeof module === "object" && module.exports) {
    parts.store = require("./project-restore-store.js");
    parts.snapshots = require("./project-restore-snapshots.js");
    parts.toasts = require("./project-restore-toasts.js");
    global.__zoidiumRestoreParts = parts;
  }
  var store = parts.store;
  var snapshots = parts.snapshots;
  var toasts = parts.toasts;
  if (!store || !snapshots || !toasts) {
    throw new Error("[Zoidium] project-restore-store.js, project-restore-snapshots.js and project-restore-toasts.js must load before project-restore.js.");
  }
  var state = store.state;
  var BACKUP_INTERVAL_MS = store.BACKUP_INTERVAL_MS;
  var openDatabase = store.openDatabase;
  var assetsAvailable = store.assetsAvailable;
  var saveAssets = store.saveAssets;
  var loadAssets = store.loadAssets;
  var listSnapshots = store.listSnapshots;
  var saveSnapshot = store.saveSnapshot;
  var deleteSnapshot = store.deleteSnapshot;
  var deleteAllSnapshots = store.deleteAllSnapshots;
  var pruneAutomaticSnapshots = store.pruneAutomaticSnapshots;
  var formatBytes = snapshots.formatBytes;
  var formatSnapshotTime = snapshots.formatSnapshotTime;
  var snapshotFilename = snapshots.snapshotFilename;
  var snapshotDisplayName = snapshots.snapshotDisplayName;
  var isStaleFileReference = snapshots.isStaleFileReference;
  var STALE_SNAPSHOT_MESSAGE = snapshots.STALE_SNAPSHOT_MESSAGE;
  var matchesSnapshot = snapshots.matchesSnapshot;
  var loadSnapshotForAction = snapshots.loadSnapshotForAction;
  var restorePointToArchive = snapshots.restorePointToArchive;
  var archiveFromPoint = snapshots.archiveFromPoint;
  var downloadSnapshot = snapshots.downloadSnapshot;
  var showToast = toasts.showToast;
  var showProjectError = toasts.showProjectError;

  var PZ = global.PZ;
  var editor = global.CM;
  var projectFiles = PZ && PZ.zoidium && PZ.zoidium.projectFiles;
  if (!PZ || !editor || !projectFiles) return;

  var AUTOMATIC_HEAP_LIMIT = 0.72;
  var BACKUP_INTERVAL_STORAGE_KEY = "zoidium.restore.interval";
  var BACKUP_INTERVAL_OPTIONS = [
    { value: 1 * 60 * 1000, label: "1 minute" },
    { value: 5 * 60 * 1000, label: "5 minutes" },
    { value: 10 * 60 * 1000, label: "10 minutes" },
    { value: 15 * 60 * 1000, label: "15 minutes" },
    { value: 30 * 60 * 1000, label: "30 minutes" },
    { value: 60 * 60 * 1000, label: "1 hour" },
    { value: 0, label: "Never" },
  ];

  function isBackupInterval(value) {
    return BACKUP_INTERVAL_OPTIONS.some(function (option) {
      return option.value === value;
    });
  }

  function readBackupInterval() {
    try {
      var stored = global.localStorage.getItem(BACKUP_INTERVAL_STORAGE_KEY);
      var value = stored === null ? NaN : Number(stored);
      return isBackupInterval(value) ? value : BACKUP_INTERVAL_MS;
    } catch (_error) {
      // Storage may be blocked; the default interval still backs up.
      return BACKUP_INTERVAL_MS;
    }
  }

  function writeBackupInterval(value) {
    try {
      global.localStorage.setItem(BACKUP_INTERVAL_STORAGE_KEY, String(value));
    } catch (_error) {
      // A private browsing context may make localStorage unavailable.
    }
  }

  function backupIntervalLabel(value) {
    var option = BACKUP_INTERVAL_OPTIONS.find(function (item) {
      return item.value === value;
    });
    return option ? option.label : "5 minutes";
  }

  function createButton(iconName, title, className) {
    var button = global.ZoidiumUI.createButton({
      title: title,
      icon: iconName,
      className: className || "zoidium-restore-action",
      onClick: null,
    });
    return button;
  }

  function scheduleBackups(includeStartup) {
    if (state.startupTimer) {
      global.clearTimeout(state.startupTimer);
      state.startupTimer = null;
    }
    if (state.backupTimer) {
      global.clearInterval(state.backupTimer);
      state.backupTimer = null;
    }
    if (!state.backupIntervalMs) return;

    if (includeStartup) {
      state.startupTimer = global.setTimeout(function () {
        state.startupTimer = null;
        requestAutomaticBackup();
      }, 2500);
    }
    state.backupTimer = global.setInterval(requestAutomaticBackup, state.backupIntervalMs);
  }

  function createPanel() {
    var panel = global.document.createElement("section");
    panel.className = "editorpanel zoidium-restore-panel";
    panel.setAttribute("aria-label", "Restore points");
    panel.tabIndex = 0;
    panel.style.display = "none";
    // Page headers share one builder so Restore and Plugins render the
    // same CM3 proprow/proptitle chrome. ZoidiumUI always loads before
    // this file (see postInitScripts in zoidium/runtime-config.js).
    var header = global.ZoidiumUI.createPageHeader("Restore");
    header.classList.add("zoidium-restore-header");
    var headerLabel = header.querySelector(".proplabel");
    if (headerLabel) headerLabel.classList.add("zoidium-restore-title");
    panel.appendChild(header);
    panel.innerHTML =
      panel.innerHTML +
      '<div class="zoidium-restore-note">' +
      '<label class="zoidium-backup-setting">' +
      '<span>Automatic backup interval</span>' +
      '<select class="pz-inputbox zoidium-backup-interval" aria-label="Automatic backup interval"></select>' +
      '</label>' +
      '</div>' +
      '<div class="zoidium-restore-warning">' +
      'Restore is designed to prevent project data loss caused by unexpected crashes and is not intended as a location for permanent file storage. ' +
      'It may be easily lost over time, during computer cleanup, or through other actions.' +
      '</div>' +
      '<div class="zoidium-restore-backup-control">' +
      '</div>' +
      '<div class="zoidium-restore-section-title noselect">RESTORE POINTS</div>' +
      '<div class="zoidium-restore-list" role="list"></div>' +
      '<div class="zoidium-restore-delete-footer">' +
      '</div>';
    var intervalSelect = panel.querySelector(".zoidium-backup-interval");
    BACKUP_INTERVAL_OPTIONS.forEach(function (option) {
      var element = global.document.createElement("option");
      element.value = String(option.value);
      element.textContent = option.label;
      intervalSelect.appendChild(element);
    });
    intervalSelect.value = String(state.backupIntervalMs);
    intervalSelect.addEventListener("change", function () {
      var value = Number(intervalSelect.value);
      if (!isBackupInterval(value)) return;
      state.backupIntervalMs = value;
      writeBackupInterval(value);
      scheduleBackups(false);
      showToast({
        title: "Saved.",
        message: value ? "Automatic backup: " + backupIntervalLabel(value) + "." : "Automatic backup disabled.",
      });
    });
    state.intervalSelect = intervalSelect;
    // Panel buttons share the CM3 chrome builder; the panel CSS keeps the
    // full-width layout the raw buttons had.
    var backupNow = global.ZoidiumUI.createButton({
      title: "Backup now",
      className: "zoidium-backup-now",
      onClick: function () {
        // Failures already surface through the snapshot toast; this only
        // avoids an unhandled rejection on a fire-and-forget click.
        createSnapshot(true, false).catch(function () {});
      },
    });
    panel.querySelector(".zoidium-restore-backup-control").appendChild(backupNow);
    state.deleteAllButton = global.ZoidiumUI.createButton({
      title: "Delete all",
      className: "zoidium-delete-all",
      onClick: function () {
        removeAllSnapshots();
      },
    });
    panel.querySelector(".zoidium-restore-delete-footer").appendChild(state.deleteAllButton);
    state.panel = panel;
    state.list = panel.querySelector(".zoidium-restore-list");
    return panel;
  }

  function renderListError(error) {
    if (!state.list) return;
    if (state.deleteAllButton) state.deleteAllButton.disabled = true;
    state.list.innerHTML = "";
    var message = global.document.createElement("div");
    message.className = "zoidium-restore-empty is-error";
    message.textContent = error && error.message
      ? error.message
      : "Restore-point storage is unavailable.";
    state.list.appendChild(message);
  }

  function renderSnapshots() {
    if (!state.list) return;
    if (state.deleteAllButton) {
      state.deleteAllButton.disabled = state.snapshots.length === 0;
    }
    state.list.innerHTML = "";
    if (state.snapshots.length === 0) {
      var empty = global.ZoidiumUI.controls.note("No restore points yet.").element;
      empty.classList.add("zoidium-restore-empty");
      state.list.appendChild(empty);
      return;
    }

    state.snapshots.forEach(function (snapshot) {
      var entry = global.document.createElement("article");
      entry.className = "zoidium-restore-entry";
      entry.setAttribute("role", "listitem");

      var copy = global.document.createElement("div");
      copy.className = "zoidium-restore-copy";
      var name = global.document.createElement("div");
      name.className = "zoidium-restore-name";
      name.textContent = snapshotDisplayName(snapshot);
      name.title = name.textContent;
      var time = global.document.createElement("div");
      time.className = "zoidium-restore-meta";
      time.textContent = formatSnapshotTime(snapshot.createdAt);
      var stats = global.document.createElement("div");
      stats.className = "zoidium-restore-meta";
      var assetCount = Number(snapshot.assetCount) || 0;
      stats.textContent = formatBytes(snapshot.size) + ", " + assetCount +
        " asset" + (assetCount === 1 ? "" : "s");
      copy.appendChild(name);
      copy.appendChild(time);
      copy.appendChild(stats);

      var actions = global.document.createElement("div");
      actions.className = "zoidium-restore-actions";
      var restoreButton = createButton(
        "reset",
        "Restore " + snapshotDisplayName(snapshot),
      );
      restoreButton.addEventListener("click", function () {
        restoreSnapshot(snapshot);
      });
      var downloadButton = createButton(
        "download",
        "Download " + snapshotDisplayName(snapshot),
      );
      downloadButton.addEventListener("click", function () {
        downloadSnapshot(snapshot);
      });
      if (snapshot.blob && isStaleFileReference(snapshot.blob)) {
        entry.classList.add("is-unusable");
        stats.textContent = STALE_SNAPSHOT_MESSAGE;
        restoreButton.disabled = true;
        downloadButton.disabled = true;
      }
      var deleteButton = createButton(
        "delete",
        "Delete " + snapshotDisplayName(snapshot),
      );
      deleteButton.addEventListener("click", function () {
        removeSnapshot(snapshot);
      });
      actions.appendChild(restoreButton);
      actions.appendChild(downloadButton);
      actions.appendChild(deleteButton);
      entry.appendChild(copy);
      entry.appendChild(actions);
      state.list.appendChild(entry);
    });
  }

  async function refreshSnapshots() {
    try {
      state.snapshots = await listSnapshots();
      renderSnapshots();
    } catch (error) {
      renderListError(error);
    }
  }

  function currentBackupKey() {
    var project = editor.project;
    var assets = project && project.assets && project.assets.list;
    return {
      project: project || null,
      revision: projectFiles.getProjectRevision(editor),
      name: projectFiles.getProjectName(editor),
      assetCount: assets && typeof assets === "object" ? Object.keys(assets).length : 0,
    };
  }

  function unchangedSinceLastBackup() {
    var last = state.lastBackup;
    var current = currentBackupKey();
    return Boolean(
      last &&
        last.project === current.project &&
        last.revision === current.revision &&
        last.name === current.name &&
        last.assetCount === current.assetCount,
    );
  }

  function automaticBackupMemoryAvailable() {
    var memory = global.performance && global.performance.memory;
    if (!memory) return true;
    var used = Number(memory.usedJSHeapSize);
    var limit = Number(memory.jsHeapSizeLimit);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return true;
    return used / limit < AUTOMATIC_HEAP_LIMIT;
  }

  function installProjectLoadGuard() {
    if (!global.document || typeof global.document.addEventListener !== "function") return;
    global.document.addEventListener("zoidium:project-load-start", function () {
      state.projectLoadInProgress = true;
      state.pendingAutomaticBackup = true;
    });
    function onProjectLoadSettled() {
      state.projectLoadInProgress = false;
      if (state.pendingAutomaticBackup && state.backupIntervalMs) {
        state.pendingAutomaticBackup = false;
        requestAutomaticBackup();
      }
    }
    global.document.addEventListener("zoidium:project-load-complete", onProjectLoadSettled);
    global.document.addEventListener("zoidium:project-load-error", onProjectLoadSettled);
  }

  function runWhenIdle(task) {
    if (typeof global.requestIdleCallback === "function") {
      global.requestIdleCallback(task, { timeout: 30000 });
    } else {
      global.setTimeout(task, 0);
    }
  }

  function requestAutomaticBackup() {
    if (state.snapshotPromise || state.backupQueued) return;
    if (state.projectLoadInProgress) {
      state.pendingAutomaticBackup = true;
      return;
    }
    if (unchangedSinceLastBackup()) return;
    state.backupQueued = true;
    runWhenIdle(function () {
      state.backupQueued = false;
      if (state.projectLoadInProgress) {
        state.pendingAutomaticBackup = true;
        return;
      }
      // Failures already surface through the snapshot toast; this only avoids
      // an unhandled rejection on a fire-and-forget backup.
      createSnapshot(false, true).catch(function () {});
    });
  }

  function createSnapshot(showResult, automatic) {
    var isAutomatic = automatic !== false;
    if (state.snapshotPromise) {
      // A manual request must not inherit the metadata and result UI of an
      // automatic snapshot already in flight. Queue one manual point behind
      // it; repeated clicks still join the same queued operation.
      if (!isAutomatic && state.snapshotAutomatic !== false) {
        if (!state.manualSnapshotPromise) {
          state.manualSnapshotPromise = state.snapshotPromise
            // A queued manual point must wait out the in-flight failure first.
            .catch(function () {})
            .then(function () {
              return createSnapshot(true, false);
            })
            .finally(function () {
              state.manualSnapshotPromise = null;
            });
        }
        return state.manualSnapshotPromise;
      }
      return state.snapshotPromise;
    }

    var archiveResult = null;
    var restorePoint = null;
    // Captured before serialization starts: an edit made while the archive is
    // being built must still count as a change for the next automatic check.
    var startKey = currentBackupKey();
    state.snapshotAutomatic = isAutomatic;
    state.snapshotPromise = (async function () {
      // refreshSnapshots normally completes before this runs, but loading here
      // also covers a very fast startup timer or a delayed IndexedDB response.
      if (!state.snapshots.length) state.snapshots = await listSnapshots();
      if (isAutomatic && unchangedSinceLastBackup()) return null;
      // A backup that cannot improve the last point only adds serialization
      // and GC pressure. Defer automatic work while the heap is already under
      // pressure; a manual "Backup now" remains available.
      if (isAutomatic && !automaticBackupMemoryAvailable()) return null;
      // Split (v2) restore points store the project archive separately from
      // the media so unchanged assets are never copied into every snapshot.
      // They need the project-files split-point API and the assets store;
      // otherwise this build keeps writing legacy full-archive records, which
      // every build (v1 or v2) can still read.
      var database = await openDatabase();
      if (typeof projectFiles.createRestorePoint === "function" && assetsAvailable(database)) {
        restorePoint = await projectFiles.createRestorePoint(editor);
        if (isAutomatic && await matchesSnapshot(state.snapshots[0] || null, restorePoint.fingerprint)) {
          state.lastBackup = startKey;
          if (showResult) {
            showToast({ title: "No changes.", message: "Restore point not created." });
          }
          return null;
        }
        var splitRecord = {
          id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
          createdAt: Date.now(),
          format: 2,
          projectName: restorePoint.projectName,
          size: restorePoint.archiveSize,
          assetCount: restorePoint.assetCount,
          projectBlob: restorePoint.projectBlob,
          assetRefs: restorePoint.assetRefs,
          fingerprint: restorePoint.fingerprint,
          automatic: isAutomatic,
        };
        await saveAssets(restorePoint.assets);
        await saveSnapshot(splitRecord);
        state.lastBackup = startKey;
        // Manual points are not counted toward the automatic retention limits,
        // but creating one still triggers cleanup of old automatic points.
        state.snapshots = await pruneAutomaticSnapshots();
        renderSnapshots();
        if (showResult) {
          showToast({ title: "Saved.", message: "Restore point created." });
        }
        return splitRecord;
      }
      // The archive builder validates the project data first and only builds
      // the TAR when the content differs from the newest restore point.
      archiveResult = await projectFiles.createArchive(editor, {
        shouldSkip: function (fingerprint) {
          return isAutomatic && matchesSnapshot(state.snapshots[0] || null, fingerprint);
        },
      });
      if (archiveResult.skipped) {
        state.lastBackup = startKey;
        if (showResult) {
          showToast({ title: "No changes.", message: "Restore point not created." });
        }
        return null;
      }
      var record = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        createdAt: Date.now(),
        projectName: archiveResult.projectName,
        size: archiveResult.blob.size,
        assetCount: archiveResult.assetCount,
        blob: archiveResult.blob,
        fingerprint: archiveResult.fingerprint,
        automatic: isAutomatic,
      };
      await saveSnapshot(record);
      state.lastBackup = startKey;
      // Manual points are not counted toward the automatic retention limits,
      // but creating one still triggers cleanup of old automatic points.
      state.snapshots = await pruneAutomaticSnapshots();
      renderSnapshots();
      if (showResult) {
        showToast({ title: "Saved.", message: "Restore point created." });
      }
      return record;
    })()
      .catch(function (error) {
        var download = null;
        if (archiveResult && archiveResult.blob) {
          download = function () {
            projectFiles.triggerDownload(
              archiveResult.blob,
              projectFiles.fileNameForProject(archiveResult.projectName),
            );
          };
        } else if (restorePoint && restorePoint.projectBlob) {
          download = function () {
            var assetBlobs = (restorePoint.assets || []).map(function (entry) {
              return { id: entry.id, blob: entry.file };
            });
            return archiveFromPoint(restorePoint, assetBlobs).then(function (blob) {
              projectFiles.triggerDownload(
                blob,
                projectFiles.fileNameForProject(restorePoint.projectName),
              );
            });
          };
        }
        showProjectError({
          message: error && error.message ? error.message : "Could not create a restore point.",
          retry: function () {
            return createSnapshot(true, isAutomatic);
          },
          download: download,
        });
        throw error;
      })
      .finally(function () {
        state.snapshotPromise = null;
        state.snapshotAutomatic = null;
      });
    return state.snapshotPromise;
  }

  async function findLatestValidSnapshot() {
    var records = await listSnapshots();
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index];
      if (!record) continue;
      if (record.blob) {
        if (isStaleFileReference(record.blob)) continue;
        try {
          await projectFiles.openValidatedArchive(record.blob, "restore");
          return record;
        } catch (_error) {
          // Keep looking for an older point that can still be read.
        }
      } else if (record.projectBlob && record.assetRefs) {
        try {
          var assets = await loadAssets(record.assetRefs);
          await restorePointToArchive(record, assets);
          return record;
        } catch (_splitError) {
          // Keep looking for an older point that can still be read.
        }
      }
    }
    return null;
  }

  async function recoverFromLatestBackup() {
    var record = await findLatestValidSnapshot();
    if (!record) {
      showProjectError({
        message: "No valid restore point is available to recover from.",
        retry: null,
        download: null,
      });
      return;
    }
    return restoreSnapshot(record);
  }

  async function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.blob && isStaleFileReference(snapshot.blob)) {
      showProjectError({
        message: STALE_SNAPSHOT_MESSAGE,
        retry: null,
        download: null,
      });
      return;
    }
    if (!editor.confirmIfDirty()) return;

    try {
      var record = await loadSnapshotForAction(snapshot);
      var archive = null;
      if (record.blob) {
        if (isStaleFileReference(record.blob)) {
          throw new Error(STALE_SNAPSHOT_MESSAGE);
        }
        archive = await projectFiles.openValidatedArchive(record.blob, "restore");
      } else {
        var assets = await loadAssets(record.assetRefs);
        archive = await restorePointToArchive(record, assets);
      }
      var restoredProject = await editor.loadProject(archive);
      editor.project = restoredProject;
      editor._zoidiumSaveFileHandle = null;
      editor._zoidiumSaveFileName = null;
      global.dispatchEvent(new CustomEvent("zoidium:project-changed", {
        detail: { editor: editor, reason: "restore" },
      }));
      projectFiles.setProjectName(
        editor,
        projectFiles.displayNameForUi(record.projectName || "project"),
      );
      if (restoredProject.ui) restoredProject.ui.dirty = true;
      showToast({ title: "Restored.", message: snapshotDisplayName(record) });
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not restore the project.",
        retry: function () {
          return restoreSnapshot(snapshot);
        },
        download: function () {
          return downloadSnapshot(snapshot);
        },
        recoverable: projectFiles.isProjectDataError(error),
      });
    }
  }

  async function removeSnapshot(snapshot) {
    if (!snapshot) return;
    var approved = await global.ZoidiumUI.confirm({
      title: "Delete restore point",
      message: "Delete this restore point?",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteSnapshot(snapshot.id);
      state.snapshots = state.snapshots.filter(function (item) {
        return item.id !== snapshot.id;
      });
      renderSnapshots();
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not delete the restore point.",
        retry: function () {
          return removeSnapshot(snapshot);
        },
        download: function () {
          return downloadSnapshot(snapshot);
        },
      });
    }
  }

  async function removeAllSnapshots() {
    if (!state.snapshots.length) return;
    var approved = await global.ZoidiumUI.confirm({
      title: "Delete all restore points",
      message: "Delete all restore points?",
      confirmLabel: "Delete all",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!approved) return;
    var confirmed = await global.ZoidiumUI.confirm({
      title: "Delete all restore points",
      message: "This will permanently remove every restore point. Continue?",
      confirmLabel: "Delete everything",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteAllSnapshots();
      state.snapshots = [];
      renderSnapshots();
      showToast({ title: "Deleted.", message: "All restore points deleted." });
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not delete the restore points.",
        retry: function () {
          return removeAllSnapshots();
        },
        download: null,
      });
    }
  }

  function createTab(panel) {
    // Elevator tab chrome lives in the shared UI kit, which always loads
    // before this file (see postInitScripts in zoidium/runtime-config.js).
    global.ZoidiumUI.createMenubarTab({
      title: "Restore",
      icon: "reset",
      panel: panel,
      tabClass: "zoidium-restore-tab",
      editor: editor,
    });
  }

  function installProjectNameField() {
    var toolbar = global.document.querySelector("#controls .toolbarpanel") ||
      global.document.querySelector(".toolbarpanel");
    if (!toolbar) return false;
    toolbar.classList.add("zoidium-project-toolbar");
    var field = toolbar.querySelector(".zoidium-project-name");

    if (!field) {
      field = global.document.createElement("label");
      field.className = "zoidium-project-name";
      field.title = "Project name";
      var input = global.document.createElement("input");
      input.type = "text";
      input.className = "pz-inputbox";
      input.name = "project-name";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 120;
      input.setAttribute("aria-label", "Project name");
      input.value = projectFiles.displayNameForUi(projectFiles.getProjectName(editor));
      input.title = input.value;
      input.addEventListener("input", function () {
        projectFiles.setRawProjectName(editor, input.value);
        input.title = input.value;
      });
      input.addEventListener("blur", function () {
        var currentName = projectFiles.getProjectName(editor);
        var displayName = projectFiles.displayNameForUi(currentName);
        if (input.value !== displayName) {
          currentName = projectFiles.setProjectName(editor, input.value);
        }
        input.value = projectFiles.displayNameForUi(currentName);
        input.title = input.value;
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          input.blur();
        }
        event.stopPropagation();
      });
      field.appendChild(input);
      toolbar.insertBefore(field, toolbar.firstElementChild);

      global.addEventListener("zoidium:project-name-changed", function (event) {
        var detail = event.detail || {};
        if (detail.editor !== editor || global.document.activeElement === input) return;
        input.value = projectFiles.displayNameForUi(detail.name);
        input.title = input.value;
      });
    }

    var actions = toolbar.querySelector(".zoidium-project-actions");
    if (!actions) {
      actions = global.document.createElement("div");
      actions.className = "zoidium-project-actions";
    }
    Array.from(toolbar.children).forEach(function (child) {
      if (child !== field && child !== actions) actions.appendChild(child);
    });
    if (toolbar.firstElementChild !== field || toolbar.lastElementChild !== actions) {
      toolbar.appendChild(field);
      toolbar.appendChild(actions);
    }
    return true;
  }

  global.addEventListener("zoidium:project-saved", function (event) {
    var detail = event.detail || {};
    if (detail.editor !== editor) return;
    showToast({
      title: detail.delivery === "download" ? "Downloaded." : "Saved.",
      message:
        detail.delivery === "download"
          ? (detail.filename || "Project file downloaded.")
          : (detail.filename || "Project file updated."),
    });
  });
  global.addEventListener("zoidium:notification", function (event) {
    showToast(event.detail || {});
  });
  global.addEventListener("zoidium:project-error", function (event) {
    var detail = event.detail || {};
    if (detail.editor !== editor) return;
    showProjectError(detail);
  });

  var toolbarObserver;
  var toolbarTimer = global.setInterval(function () {
    if (installProjectNameField()) {
      global.clearInterval(toolbarTimer);
    }
  }, 100);
  toolbarObserver = new MutationObserver(function () {
    installProjectNameField();
  });
  toolbarObserver.observe(global.document.body, { childList: true, subtree: true });
  if (installProjectNameField()) {
    global.clearInterval(toolbarTimer);
  }

  parts.panel = { recoverFromLatestBackup: recoverFromLatestBackup };
  var panel = createPanel();
  createTab(panel);
  state.backupIntervalMs = readBackupInterval();
  if (state.intervalSelect) state.intervalSelect.value = String(state.backupIntervalMs);
  installProjectLoadGuard();
  refreshSnapshots();
  scheduleBackups(true);

  global.addEventListener("beforeunload", function () {
    if (state.backupTimer) global.clearInterval(state.backupTimer);
    if (state.startupTimer) global.clearTimeout(state.startupTimer);
    toolbarObserver.disconnect();
  });
})(window);

