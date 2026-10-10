(function installProjectRestore(global) {
  "use strict";

  var PZ = global.PZ;
  var editor = global.CM;
  var projectFiles = PZ && PZ.zoidium && PZ.zoidium.projectFiles;
  if (!PZ || !editor || !projectFiles) return;

  var DB_NAME = "zoidium-restore-points";
  // Version 2 adds the shared "assets" content store so large media blobs are
  // stored once and referenced by every snapshot. Databases created by either
  // version stay usable with the other: v1 databases upgrade in place and
  // keep their snapshots, while a database already bumped past this version
  // falls back to a versionless open (see openDatabase).
  var DB_VERSION = 2;
  var STORE_NAME = "snapshots";
  var ASSET_STORE_NAME = "assets";
  var MAX_AUTOMATIC_PER_TITLE = 12;
  var MAX_AUTOMATIC_TOTAL = 24;
  var HOUR_MS = 60 * 60 * 1000;
  var TIME_BUCKET_LIMITS = [4, 3, 2];
  var BACKUP_INTERVAL_MS = 5 * 60 * 1000;
  // Automatic backups are deferred while the JS heap is already under
  // pressure; a manual "Backup now" remains available.
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
  var state = {
    dbPromise: null,
    dbDatabase: null,
    // Store availability observed when a versionless fallback open was used
    // (a newer build already bumped this origin's database). Null after a
    // normal versioned open, where both stores are guaranteed.
    compatStores: null,
    snapshots: [],
    panel: null,
    list: null,
    toast: null,
    deleteAllButton: null,
    intervalSelect: null,
    backupIntervalMs: BACKUP_INTERVAL_MS,
    snapshotPromise: null,
    backupTimer: null,
    startupTimer: null,
    projectLoadInProgress: false,
    pendingAutomaticBackup: false,
    // Identity of the project state covered by the newest automatic check.
    lastBackup: null,
    backupQueued: false,
  };

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

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB request failed."));
      };
    });
  }

  function isVersionError(error) {
    if (!error) return false;
    if (error.name === "VersionError") return true;
    return /less than the existing version/i.test(error.message || "");
  }

  function ensureStores(database) {
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      var store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    }
    if (!database.objectStoreNames.contains(ASSET_STORE_NAME)) {
      database.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
    }
  }

  function openDatabaseWithVersion(version) {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = version === undefined
          ? global.indexedDB.open(DB_NAME)
          : global.indexedDB.open(DB_NAME, version);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = function () {
        // Upgrading from a v1 database only adds the assets store; the
        // existing snapshots store and its records are left untouched.
        ensureStores(request.result);
      };
      request.onsuccess = function () {
        var database = request.result;
        // Another tab (or another build on this origin) upgrading the database
        // waits until every connection closes. Close this one and reopen on the
        // next use instead of blocking that upgrade.
        database.onversionchange = function () {
          database.close();
          if (state.dbPromise && state.dbDatabase === database) {
            state.dbPromise = null;
            state.dbDatabase = null;
          }
        };
        state.dbDatabase = database;
        resolve(database);
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not open restore-point storage."));
      };
    });
  }

  function openDatabase() {
    if (state.dbPromise) return state.dbPromise;
    if (!global.indexedDB) {
      state.dbPromise = Promise.reject(new Error("IndexedDB is unavailable."));
      return state.dbPromise;
    }

    var databasePromise = openDatabaseWithVersion(DB_VERSION).catch(function (error) {
      // Another build already upgraded this origin's database past our
      // version. Reopen without a version number and use the existing stores
      // when they are compatible instead of surfacing the raw VersionError.
      if (!isVersionError(error)) throw error;
      return openDatabaseWithVersion(undefined).then(function (database) {
        var stores = { snapshots: false, assets: false };
        try {
          stores.snapshots = database.objectStoreNames.contains(STORE_NAME);
          stores.assets = database.objectStoreNames.contains(ASSET_STORE_NAME);
        } catch (_storeError) {
          // A store listing that cannot be read is treated as incompatible.
        }
        state.compatStores = stores;
        if (!stores.snapshots) {
          throw new Error("Restore-point storage is unavailable.");
        }
        return database;
      });
    });
    state.dbPromise = databasePromise;
    databasePromise.catch(function () {
      if (state.dbPromise === databasePromise) state.dbPromise = null;
    });
    return databasePromise;
  }

  function compareSnapshots(left, right) {
    var timeDifference = (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
    if (timeDifference) return timeDifference;
    return String(right.id || "").localeCompare(String(left.id || ""));
  }

  function isAutomaticSnapshot(snapshot) {
    // Records created before automatic/manual tracking was added are kept as
    // automatic points for retention compatibility.
    return !snapshot || snapshot.automatic !== false;
  }

  function assetsAvailable(database) {
    try {
      return Boolean(
        database && database.objectStoreNames.contains(ASSET_STORE_NAME),
      );
    } catch (_storeError) {
      return false;
    }
  }

  function getSnapshot(id) {
    return openDatabase().then(function (database) {
      var transaction = database.transaction(STORE_NAME, "readonly");
      return requestPromise(transaction.objectStore(STORE_NAME).get(id));
    });
  }

  // Media blobs are stored once in the assets store, keyed by content id, so
  // unchanged assets are never copied into every snapshot.
  function saveAssets(entries) {
    var unique = Object.create(null);
    var pending = (entries || []).filter(function (entry) {
      if (!entry || !entry.id || !entry.file || unique[entry.id]) return false;
      unique[entry.id] = true;
      return true;
    });
    if (!pending.length) return Promise.resolve();

    return openDatabase().then(function (database) {
      if (!assetsAvailable(database)) return null;
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
        var store = transaction.objectStore(ASSET_STORE_NAME);
        pending.forEach(function (entry) {
          var request = store.get(entry.id);
          request.onsuccess = function () {
            if (request.result) return;
            store.put({
              id: entry.id,
              blob: entry.file,
              size: entry.size,
              type: entry.type,
            });
          };
          request.onerror = function () {
            try {
              transaction.abort();
            } catch (_error) {
              // The transaction may already be aborting.
            }
          };
        });
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not store restore-point assets."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not store restore-point assets."));
        };
      });
    });
  }

  function loadAssets(refs) {
    refs = Array.isArray(refs) ? refs : [];
    if (!refs.length) return Promise.resolve([]);

    return openDatabase().then(function (database) {
      if (!assetsAvailable(database)) {
        return Promise.reject(new Error("Restore-point storage is unavailable."));
      }
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(ASSET_STORE_NAME, "readonly");
        var store = transaction.objectStore(ASSET_STORE_NAME);
        var records = new Array(refs.length);
        var missing = null;

        refs.forEach(function (ref, index) {
          var request = store.get(ref.id);
          request.onsuccess = function () {
            if (!request.result || !request.result.blob) {
              missing = missing || new Error("Restore point asset is missing: " + ref.name);
              return;
            }
            records[index] = {
              id: ref.id,
              blob: request.result.blob,
            };
          };
          request.onerror = function () {
            missing = missing || request.error || new Error("Could not read a restore-point asset.");
          };
        });
        transaction.oncomplete = function () {
          if (missing) reject(missing);
          else resolve(records);
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not read restore-point assets."));
        };
      });
    });
  }

  async function deleteOrphanAssets() {
    var database = await openDatabase();
    if (!assetsAvailable(database)) return;
    var snapshots = await listSnapshots();
    var referenced = Object.create(null);
    snapshots.forEach(function (snapshot) {
      (snapshot.assetRefs || []).forEach(function (ref) {
        if (ref && ref.id) referenced[ref.id] = true;
      });
    });

    return new Promise(function (resolve, reject) {
      var transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
      var store = transaction.objectStore(ASSET_STORE_NAME);
      var request = store.getAllKeys();
      request.onsuccess = function () {
        request.result.forEach(function (id) {
          if (!referenced[id]) store.delete(id);
        });
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not organize restore-point assets."));
      };
      transaction.oncomplete = resolve;
      transaction.onerror = function () {
        reject(transaction.error || new Error("Could not organize restore-point assets."));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("Could not organize restore-point assets."));
      };
    });
  }

  async function listSnapshots() {
    var database = await openDatabase();
    var transaction = database.transaction(STORE_NAME, "readonly");
    var records = await requestPromise(transaction.objectStore(STORE_NAME).getAll());
    return records.sort(compareSnapshots);
  }

  function saveSnapshot(record) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = function () {
          resolve();
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not store the restore point."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not store the restore point."));
        };
      });
    });
  }

  function deleteSnapshot(id) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.oncomplete = function () {
          deleteOrphanAssets().then(resolve, reject);
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not delete the restore point."));
        };
      });
    });
  }

  function deleteAllSnapshots() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = function () {
          if (!assetsAvailable(database)) {
            resolve();
            return;
          }
          var assetTransaction = database.transaction(ASSET_STORE_NAME, "readwrite");
          assetTransaction.objectStore(ASSET_STORE_NAME).clear();
          assetTransaction.oncomplete = resolve;
          assetTransaction.onerror = function () {
            reject(assetTransaction.error || new Error("Could not delete restore-point assets."));
          };
          assetTransaction.onabort = function () {
            reject(assetTransaction.error || new Error("Could not delete restore-point assets."));
          };
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not delete the restore points."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not delete the restore points."));
        };
      });
    });
  }

  function deleteSnapshots(ids) {
    if (!ids.length) return Promise.resolve();
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);
        ids.forEach(function (id) {
          store.delete(id);
        });
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not organize the restore points."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not organize the restore points."));
        };
      });
    });
  }

  function automaticTimeBucket(snapshot, now) {
    var age = Math.max(0, now - (Number(snapshot.createdAt) || 0));
    return Math.floor(age / HOUR_MS);
  }

  async function pruneAutomaticSnapshots() {
    var records = await listSnapshots();
    var automatic = records.filter(isAutomaticSnapshot).sort(compareSnapshots);
    var titleCounts = Object.create(null);
    var bucketCounts = Object.create(null);
    var retainedCount = 0;
    var removedIds = [];
    var now = Date.now();

    automatic.forEach(function (snapshot) {
      var title = String(snapshot.projectName || "project");
      var bucket = automaticTimeBucket(snapshot, now);
      var bucketLimit = bucket < TIME_BUCKET_LIMITS.length
        ? TIME_BUCKET_LIMITS[bucket]
        : 1;
      var titleCount = titleCounts[title] || 0;
      var bucketCount = bucketCounts[bucket] || 0;

      if (
        retainedCount >= MAX_AUTOMATIC_TOTAL ||
        titleCount >= MAX_AUTOMATIC_PER_TITLE ||
        bucketCount >= bucketLimit
      ) {
        removedIds.push(snapshot.id);
        return;
      }

      titleCounts[title] = titleCount + 1;
      bucketCounts[bucket] = bucketCount + 1;
      retainedCount += 1;
    });

    if (!removedIds.length) return records;
    await deleteSnapshots(removedIds);
    await deleteOrphanAssets();
    return listSnapshots();
  }

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

  // Restore points recorded before exports were copied out of the shared
  // temporary file kept the archive worker's live File handle instead of the
  // archive bytes. That handle now exposes whatever the editor last wrote
  // there, so such a record would restore the wrong project. It is reported as
  // unusable and can only be deleted.
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

  // Rebuilds a full project archive from a split (v2) restore point. Prefers
  // the shared project-files implementation when it exists so both code paths
  // stay in agreement; otherwise reconstructs locally with the same schema.
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
      showProjectError({
        message: error && error.message ? error.message : "Could not download the restore point.",
        retry: function () {
          return downloadSnapshot(snapshot);
        },
        download: null,
      });
    }
  }

  function createButton(iconName, title, className) {
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = className || "zoidium-restore-action";
    button.title = title;
    button.setAttribute("aria-label", title);
    var icon = PZ.ui.generateIcon(iconName);
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    return button;
  }

  function createToast() {
    var toast = global.document.createElement("aside");
    toast.className = "zoidium-project-toast";
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("role", "status");
    toast.innerHTML =
      '<div class="zoidium-project-toast-head">' +
      '<span class="zoidium-project-toast-title"></span>' +
      '<button type="button" class="zoidium-project-toast-close" aria-label="Dismiss notification">×</button>' +
      "</div>" +
      '<div class="zoidium-project-toast-message"></div>' +
      '<div class="zoidium-project-toast-actions">' +
      '<button type="button" class="proprow propbutton" data-toast-action="retry">Retry</button>' +
      '<button type="button" class="proprow propbutton" data-toast-action="download">Download</button>' +
      '<button type="button" class="proprow propbutton" data-toast-action="recover">Restore backup</button>' +
      '<button type="button" class="proprow propbutton" data-toast-action="reload">Reload</button>' +
      "</div>";
    global.document.body.appendChild(toast);
    toast.querySelector(".zoidium-project-toast-close").addEventListener("click", function () {
      hideToast();
    });
    toast.querySelector('[data-toast-action="retry"]').addEventListener("click", function () {
      runToastAction(toast._zoidiumRetry);
    });
    toast.querySelector('[data-toast-action="download"]').addEventListener("click", function () {
      runToastAction(toast._zoidiumDownload);
    });
    toast.querySelector('[data-toast-action="recover"]').addEventListener("click", function () {
      runToastAction(toast._zoidiumRecover);
    });
    toast.querySelector('[data-toast-action="reload"]').addEventListener("click", function () {
      hideToast();
      global.location.reload();
    });
    state.toast = toast;
    return toast;
  }

  function hideToast() {
    if (!state.toast) return;
    state.toast.classList.remove("is-visible");
    state.toast._zoidiumRetry = null;
    state.toast._zoidiumDownload = null;
    state.toast._zoidiumRecover = null;
  }

  function runToastAction(action) {
    if (typeof action !== "function") return;
    Promise.resolve()
      .then(action)
      .catch(function (error) {
        showToast({
          type: "error",
          message: error && error.message ? error.message : "The action failed.",
          retry: action,
        });
      });
  }

  var toastHideTimer = null;
  function showToast(detail) {
    var toast = state.toast || createToast();
    var isError = detail && detail.type === "error";
    toast.classList.toggle("is-error", isError);
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.querySelector(".zoidium-project-toast-title").textContent = isError
      ? "Error!"
      : detail.title || "Saved.";
    toast.querySelector(".zoidium-project-toast-message").textContent = detail.message || "";
    var actions = toast.querySelector(".zoidium-project-toast-actions");
    var retryButton = actions.querySelector('[data-toast-action="retry"]');
    var downloadButton = actions.querySelector('[data-toast-action="download"]');
    var recoverButton = actions.querySelector('[data-toast-action="recover"]');
    var reloadButton = actions.querySelector('[data-toast-action="reload"]');
    // Each action button appears only when its handler exists. Retry and
    // Download apply to error toasts; Reload appears for reload prompts
    // such as the layout switch notice. Buttons without handlers stay
    // hidden instead of rendering as disabled controls.
    var hasRetry = isError && typeof detail.retry === "function";
    var hasDownload = isError && typeof detail.download === "function";
    var hasRecover = isError && typeof detail.recover === "function";
    var hasReload = !!detail.reload;
    retryButton.hidden = !hasRetry;
    downloadButton.hidden = !hasDownload;
    recoverButton.hidden = !hasRecover;
    reloadButton.hidden = !hasReload;
    retryButton.disabled = !hasRetry;
    downloadButton.disabled = !hasDownload;
    recoverButton.disabled = !hasRecover;
    actions.hidden = !hasRetry && !hasDownload && !hasRecover && !hasReload;
    toast._zoidiumRetry = detail.retry || null;
    toast._zoidiumDownload = detail.download || null;
    toast._zoidiumRecover = hasRecover ? detail.recover : null;
    toast.classList.add("is-visible");
    if (toastHideTimer) global.clearTimeout(toastHideTimer);
    // Reload prompts stay visible until dismissed so the action cannot be
    // missed while the user reads the message.
    if (!isError && !hasReload) {
      toastHideTimer = global.setTimeout(hideToast, 3000);
    }
  }

  function showProjectError(detail) {
    showToast({
      type: "error",
      message: detail.message || "The project operation failed.",
      retry: detail.retry,
      download: detail.download,
      recover: detail.recoverable ? recoverFromLatestBackup : null,
    });
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
      '<button type="button" class="proprow propbutton zoidium-backup-now">Backup now</button>' +
      '</div>' +
      '<div class="zoidium-restore-section-title noselect">RESTORE POINTS</div>' +
      '<div class="zoidium-restore-list" role="list"></div>' +
      '<div class="zoidium-restore-delete-footer">' +
      '<button type="button" class="proprow propbutton zoidium-delete-all">Delete all</button>' +
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
    state.deleteAllButton = panel.querySelector(".zoidium-delete-all");
    state.deleteAllButton.addEventListener("click", function () {
      removeAllSnapshots();
    });
    panel.querySelector(".zoidium-backup-now").addEventListener("click", function () {
      createSnapshot(true, false).catch(function () {});
    });
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
      var empty = global.document.createElement("div");
      empty.className = "zoidium-restore-empty";
      empty.textContent = "No restore points yet.";
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

  // Automatic checks compare the project identity, its change counter, name,
  // and asset count against the state of the last check. An unchanged project
  // is not serialized at all, which keeps the periodic timer cheap.
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

  // Automatic backups must not serialize the project while another part of
  // the editor is still loading one. The plugin manager dispatches these
  // document events around project loads.
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

  // Runs work when the browser is idle so an automatic backup does not start
  // while the user is interacting. The timeout guarantees it still runs.
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

  // Newest restore point whose archive opens and passes the project-data
  // checks. Points recorded before the file-copy fix are skipped, as are
  // split points whose assets are no longer in the assets store.
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
    if (!snapshot || !global.confirm("Delete this restore point?")) return;
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
    if (!state.snapshots.length || !global.confirm("Delete all restore points?")) return;
    if (!global.confirm("This will permanently remove every restore point. Continue?")) return;
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
