// Zoidium project-restore storage (split from project-restore.js).
// IndexedDB versioning, snapshot/asset CRUD and automatic-point pruning, plus
// the shared state object every restore part reads. Loads first of the
// restore scripts (see zoidium/runtime-config.js); later scripts read these
// exports from the shared registry (browser classic scripts) or through
// require (Node tests).
(function installProjectRestoreStore(global) {
  "use strict";

  var parts = global.__zoidiumRestoreParts || (global.__zoidiumRestoreParts = {});
  if (parts.store) return;

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
      // A failed open must not stick; the rejection still reaches its callers.
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
      // An unreadable store list means split-asset storage is unusable.
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

  parts.store = {
    state: state,
    BACKUP_INTERVAL_MS: BACKUP_INTERVAL_MS,
    openDatabase: openDatabase,
    assetsAvailable: assetsAvailable,
    getSnapshot: getSnapshot,
    saveAssets: saveAssets,
    loadAssets: loadAssets,
    deleteOrphanAssets: deleteOrphanAssets,
    listSnapshots: listSnapshots,
    saveSnapshot: saveSnapshot,
    deleteSnapshot: deleteSnapshot,
    deleteAllSnapshots: deleteAllSnapshots,
    pruneAutomaticSnapshots: pruneAutomaticSnapshots,
  };
  if (typeof module === "object" && module.exports) module.exports = parts.store;
})(window);

