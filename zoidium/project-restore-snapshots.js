// Zoidium project-restore snapshots (split from project-restore.js).
// Snapshot validation: stale-record detection, fingerprint comparison and
// rebuilding full project archives from split records. Loads after
// project-restore-store.js; error reporting resolves lazily because the
// toast part loads later.
(function installProjectRestoreSnapshots(global) {
  "use strict";

  var parts = global.__zoidiumRestoreParts || (global.__zoidiumRestoreParts = {});
  if (parts.snapshots) return;
  var store = parts.store;
  if (!store) {
    throw new Error("[Zoidium] project-restore-store.js must load before project-restore-snapshots.js.");
  }
  var getSnapshot = store.getSnapshot;
  var loadAssets = store.loadAssets;

  var PZ = global.PZ;
  var editor = global.CM;
  var projectFiles = PZ && PZ.zoidium && PZ.zoidium.projectFiles;

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + "B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(2) + "KB";
    return (value / (1024 * 1024)).toFixed(2) + "MB";
  }

  function formatAbsoluteTime(timestamp) {
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function formatAge(timestamp) {
    var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + " minute" + (minutes === 1 ? "" : "s") + " ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    var days = Math.floor(hours / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function formatSnapshotTime(timestamp) {
    return formatAge(timestamp) + " (" + formatAbsoluteTime(timestamp) + ")";
  }

  function snapshotFilename(snapshot) {
    return projectFiles.fileNameForProject(snapshot.projectName);
  }

  function snapshotDisplayName(snapshot) {
    return projectFiles.displayNameForUi(snapshot && snapshot.projectName);
  }

  function isStaleFileReference(blob) {
    return Boolean(
      blob &&
        typeof blob.name === "string" &&
        blob.name.length > 0 &&
        typeof blob.slice === "function",
    );
  }

  var STALE_SNAPSHOT_MESSAGE =
    "This restore point was recorded before exports were copied out of the browser's shared temporary file and can no longer be read. Delete it and create a new one.";

  async function matchesSnapshot(snapshot, fingerprint) {
    if (!snapshot) return false;
    if (snapshot.fingerprint) return snapshot.fingerprint === fingerprint;
    // Split (v2) records always carry a fingerprint; legacy records without
    // one are loaded in full below. Anything else cannot be compared, so it
    // counts as changed and a fresh point is created.
    var record = snapshot.blob ? snapshot : await getSnapshot(snapshot.id);
    if (!record || !record.blob) return false;
    if (isStaleFileReference(record.blob)) return false;
    try {
      // Older restore points do not have a stored fingerprint. Rebuild their
      // archive index so they can still be compared to the current content.
      var archive = new PZ.archive();
      await archive.untar(record.blob);
      return (await projectFiles.fingerprintArchive(archive)) === fingerprint;
    } catch (_error) {
      return false;
    }
  }

  async function loadSnapshotForAction(snapshot) {
    if (!snapshot) throw new Error("The restore point is unavailable.");
    if (snapshot.blob || snapshot.projectBlob) return snapshot;
    var record = await getSnapshot(snapshot.id);
    if (!record) throw new Error("The restore point is unavailable.");
    return record;
  }

  function localPointToArchive(point, assetRecords) {
    if (!point || !point.projectBlob || !Array.isArray(point.assetRefs)) {
      return Promise.reject(new Error("This restore point is incomplete."));
    }
    var byId = Object.create(null);
    (assetRecords || []).forEach(function (record) {
      if (record && record.id && record.blob) byId[record.id] = record.blob;
    });
    var archive = new PZ.archive();
    return archive.untar(point.projectBlob).then(function () {
      point.assetRefs.forEach(function (ref) {
        var blob = byId[ref.id];
        if (!blob) throw new Error("Restore point asset is missing: " + ref.name);
        archive.addFile(ref.name, blob);
      });
      return archive;
    });
  }

  function restorePointToArchive(point, assetRecords) {
    if (projectFiles && typeof projectFiles.restorePointToArchive === "function") {
      return projectFiles.restorePointToArchive(point, assetRecords);
    }
    return localPointToArchive(point, assetRecords);
  }

  function archiveFromPoint(point, assetRecords) {
    if (projectFiles && typeof projectFiles.createArchiveFromRestorePoint === "function") {
      return projectFiles.createArchiveFromRestorePoint(point, assetRecords);
    }
    return localPointToArchive(point, assetRecords).then(function (archive) {
      return archive.tar();
    });
  }

  async function downloadSnapshot(snapshot) {
    try {
      var record = await loadSnapshotForAction(snapshot);
      if (record.blob) {
        if (isStaleFileReference(record.blob)) {
          throw new Error(STALE_SNAPSHOT_MESSAGE);
        }
        projectFiles.triggerDownload(record.blob, snapshotFilename(record));
        return;
      }
      var assets = await loadAssets(record.assetRefs);
      var blob = await archiveFromPoint(record, assets);
      projectFiles.triggerDownload(blob, snapshotFilename(record));
    } catch (error) {
      var toasts = parts.toasts;
      if (!toasts) throw error;
      toasts.showProjectError({
        message: error && error.message ? error.message : "Could not download the restore point.",
        retry: function () {
          return downloadSnapshot(snapshot);
        },
        download: null,
      });
    }
  }

  parts.snapshots = {
    formatBytes: formatBytes,
    formatSnapshotTime: formatSnapshotTime,
    snapshotFilename: snapshotFilename,
    snapshotDisplayName: snapshotDisplayName,
    isStaleFileReference: isStaleFileReference,
    STALE_SNAPSHOT_MESSAGE: STALE_SNAPSHOT_MESSAGE,
    matchesSnapshot: matchesSnapshot,
    loadSnapshotForAction: loadSnapshotForAction,
    restorePointToArchive: restorePointToArchive,
    archiveFromPoint: archiveFromPoint,
    downloadSnapshot: downloadSnapshot,
  };
  if (typeof module === "object" && module.exports) module.exports = parts.snapshots;
})(window);

