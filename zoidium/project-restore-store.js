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
  var LEASE_ID = "__zoidium_restore_writer_lease__";
  var LEASE_MS = 120000;
  var activeLeaseToken = null;

  var sessionId = global.crypto && typeof global.crypto.randomUUID === "function"
    ? global.crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2);

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

  function bounded(value, label, cancel) {
    var io = global.PZ && global.PZ.zoidiumProjectArchive;
    return io ? io.bounded(value, label, 10000, cancel) : value;
  }

  function transactionDone(transaction, label) {
    return bounded(new Promise(function (resolve, reject) {
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error || new Error(label)); };
      transaction.onabort = transaction.onerror;
    }), label, function () { transaction.abort(); });
  }

  async function updateWriterLease(token, action) {
    var database = await openDatabase();
    var transaction = database.transaction(STORE_NAME, "readwrite");
    var done = transactionDone(transaction, "Coordinating restore-point writers");
    var store = transaction.objectStore(STORE_NAME);
    var acquired = false;
    var request = store.get(LEASE_ID);
    request.onsuccess = function () {
      var lease = request.result;
      var owned = lease && lease.token === token;
      if (action === "release") {
        if (owned) store.delete(LEASE_ID);
      } else if (owned || (action === "acquire" && (!lease || lease.expiresAt <= Date.now()))) {
        acquired = true;
        store.put({ id: LEASE_ID, token: token, expiresAt: Date.now() + LEASE_MS });
      }
    };
    await done;
    return acquired;
  }

  async function withWriterLease(task) {
    var locks = global.navigator && global.navigator.locks;
    if (locks && typeof locks.request === "function") {
      var controller = new global.AbortController();
      var acquired;
      var ready = new Promise(function (resolve) { acquired = resolve; });
      var operation = locks.request("zoidium-restore-writer", { signal: controller.signal }, function () {
        acquired();
        return task();
      });
      operation.catch(function () {});
      // Abort only a pending acquisition. A running task retains the lock
      // until its actual completion, even if its caller reaches a deadline.
      await bounded(Promise.race([ready, operation]), "Waiting for the restore-point writer", function () { controller.abort(); });
      return operation;
    }
    var token = sessionId + "-" + Math.random().toString(36).slice(2);
    var deadline = Date.now() + 10000;
    while (!await updateWriterLease(token, "acquire")) {
      if (Date.now() >= deadline) throw new Error("Another tab is updating restore points. The current project was kept. Retry shortly.");
      await new Promise(function (resolve) { global.setTimeout(resolve, 100); });
    }
    activeLeaseToken = token;
    var timer = global.setInterval(function () {
      updateWriterLease(token, "renew").catch(function () {});
    }, 15000);
    try { return await task(); }
    finally {
      global.clearInterval(timer);
      activeLeaseToken = null;
      await updateWriterLease(token, "release").catch(function () {});
    }
  }

  function mutateWithLease(store, transaction, mutation) {
    var outcome = { error: null };
    function apply() {
      try { mutation(); }
      catch (error) { outcome.error = error; transaction.abort(); }
    }
    if (!activeLeaseToken) { apply(); return outcome; }
    var token = activeLeaseToken;
    var request = store.get(LEASE_ID);
    request.onsuccess = function () {
      var lease = request.result;
      if (!lease || lease.token !== token || lease.expiresAt <= Date.now()) {
        outcome.error = new Error("The restore-point writer lease expired. Previous verified points were kept. Retry shortly.");
        transaction.abort();
        return;
      }
      apply();
    };
    return outcome;
  }

  async function blobHash(blob) {
    var io = global.PZ && global.PZ.zoidiumProjectArchive;
    if (io) return io.hash(blob);
    if (!blob || typeof blob.arrayBuffer !== "function" || !global.crypto || !global.crypto.subtle) {
      throw new Error("Restore-point bytes cannot be verified.");
    }
    var digest = await global.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), function (value) { return value.toString(16).padStart(2, "0"); }).join("");
  }

  async function verifySnapshot(record, entries) {
    if (!record) throw new Error("The restore point is missing.");
    var blob = record.blob || record.projectBlob;
    if (!blob || !(blob.size > 0)) throw new Error("The restore point archive is empty.");
    if (record.integrity && (blob.size !== record.integrity.size || await blobHash(blob) !== record.integrity.sha256)) {
      throw new Error("Restore point archive has the wrong size or SHA-256 hash: " + record.id);
    }
    var files = global.PZ && global.PZ.zoidium && global.PZ.zoidium.projectFiles;
    if (record.blob && files) await files.openValidatedArchive(record.blob, "restore");
    if (record.projectBlob) {
      var assets = entries ? record.assetRefs.map(function (ref) {
        var entry = entries.find(function (value) { return value.id === ref.id; });
        if (!entry) throw new Error("Restore point asset is missing: " + ref.name);
        return { id: entry.id, blob: entry.file };
      }) : await loadAssets(record.assetRefs);
      for (var index = 0; index < assets.length; index += 1) {
        var ref = record.assetRefs[index];
        if (ref.size !== undefined && assets[index].blob.size !== ref.size) throw new Error("Restore point asset has the wrong size: " + ref.name);
        if (ref.sha256 && await blobHash(assets[index].blob) !== ref.sha256) throw new Error("Restore point asset has the wrong hash: " + ref.name);
      }
      var snapshots = global.__zoidiumRestoreParts && global.__zoidiumRestoreParts.snapshots;
      if (snapshots) await snapshots.restorePointToArchive(record, assets);
    }
    return record;
  }

  function requestPromise(request) {
    return bounded(new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB request failed."));
      };
    }), "Reading restore-point storage");
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
    var abandoned = false;
    return bounded(new Promise(function (resolve, reject) {
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
        if (abandoned) { database.close(); return; }
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
      request.onblocked = function () { abandoned = true; reject(new Error("Restore-point storage is blocked by another tab. Close the other tab and retry.")); };
    }), "Opening restore-point storage", function () { abandoned = true; });
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
        transactionDone(transaction, "Storing restore-point assets").then(resolve, reject);
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
        transaction.onabort = transaction.onerror;
      });
    });
  }

  async function deleteOrphanAssets() {
    var database = await openDatabase();
    if (!assetsAvailable(database)) return;
    // Reference discovery and deletion share a readwrite transaction. Another
    // tab cannot commit a split record between the scan and asset deletion.
    var transaction = database.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
    var done = transactionDone(transaction, "Organizing restore-point assets");
    var request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = function () {
      var referenced = Object.create(null);
      request.result.forEach(function (snapshot) {
        (snapshot.assetRefs || []).forEach(function (ref) { if (ref && ref.id) referenced[ref.id] = true; });
      });
      var assets = transaction.objectStore(ASSET_STORE_NAME);
      var keys = assets.getAllKeys();
      keys.onsuccess = function () {
        keys.result.forEach(function (id) { if (!referenced[id]) assets.delete(id); });
      };
    };
    return done;
  }

  async function listSnapshots() {
    var database = await openDatabase();
    var transaction = database.transaction(STORE_NAME, "readonly");
    var records = await requestPromise(transaction.objectStore(STORE_NAME).getAll());
    return records.filter(function (record) { return record.id !== LEASE_ID; }).sort(compareSnapshots);
  }

  async function commitSnapshot(record, entries) {
    var database = await openDatabase();
    var names = record.projectBlob ? [STORE_NAME, ASSET_STORE_NAME] : STORE_NAME;
    var transaction = database.transaction(names, "readwrite");
    var done = transactionDone(transaction, "Storing restore point");
    // add() refuses a colliding ID rather than replacing another tab's point.
    var mutation = mutateWithLease(transaction.objectStore(STORE_NAME), transaction, function () {
      transaction.objectStore(STORE_NAME).add(record);
      (entries || []).forEach(function (entry) {
        transaction.objectStore(ASSET_STORE_NAME).put({ id: entry.id, blob: entry.file, size: entry.file.size });
      });
    });
    await done.catch(function (error) { throw mutation.error || error; });
  }

  function snapshotGroup(record) {
    return String(record.owner || "legacy") + ":" + String(record.projectName || "project");
  }

  async function dropOldestExtra() {
    var records = await listSnapshots();
    var protectedIds = new Set();
    var groups = new Set();
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index];
      var group = snapshotGroup(record);
      if (groups.has(group)) continue;
      try {
        await verifySnapshot(record);
        protectedIds.add(record.id);
        groups.add(group);
      } catch (_error) { /* Invalid points are never the last good backup. */ }
    }
    var extra = records.slice().reverse().find(function (record) {
      return isAutomaticSnapshot(record) && !protectedIds.has(record.id);
    });
    if (!extra) return false;
    await bounded(deleteSnapshot(extra.id), "Freeing restore-point storage");
    return true;
  }

  async function saveSnapshot(record, entries) {
    var blob = record.blob || record.projectBlob;
    record.integrity = { size: blob && blob.size, sha256: await blobHash(blob) };
    // Verify the bytes before committing, then read the actual stored record
    // back and hash it before any rotation is allowed.
    await verifySnapshot(record, entries);
    for (;;) {
      try { await commitSnapshot(record, entries); break; }
      catch (error) {
        if (error.name !== "QuotaExceededError") throw error;
        if (!await dropOldestExtra()) {
          var full = new Error("Restore-point storage is full. The last verified backup for each project was kept. Download the project and free storage before retrying.");
          full.name = "QuotaExceededError";
          full.cause = error;
          throw full;
        }
      }
    }
    try {
      var stored = await getSnapshot(record.id);
      if (!stored || !stored.integrity || stored.integrity.size !== record.integrity.size || stored.integrity.sha256 !== record.integrity.sha256) {
        throw new Error("The restore-point metadata failed its read-back check: " + record.id);
      }
      await verifySnapshot(stored);
    } catch (error) {
      // Keep every previous point. The new unreadable record must not be used
      // for unchanged-content detection or automatic retention.
      await bounded(deleteSnapshot(record.id), "Removing an invalid restore point").catch(function () {});
      throw error;
    }
    return record;
  }

  function deleteSnapshot(id) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var mutation = mutateWithLease(transaction.objectStore(STORE_NAME), transaction, function () {
          transaction.objectStore(STORE_NAME).delete(id);
        });
        transaction.oncomplete = function () {
          deleteOrphanAssets().then(resolve, reject);
        };
        transaction.onerror = function () {
          reject(mutation.error || transaction.error || new Error("Could not delete the restore point."));
        };
        transaction.onabort = transaction.onerror;
      });
    });
  }

  async function deleteAllSnapshots() {
    var database = await openDatabase();
    var names = assetsAvailable(database) ? [STORE_NAME, ASSET_STORE_NAME] : STORE_NAME;
    var transaction = database.transaction(names, "readwrite");
    var done = transactionDone(transaction, "Deleting all restore points");
    transaction.objectStore(STORE_NAME).clear();
    if (assetsAvailable(database)) transaction.objectStore(ASSET_STORE_NAME).clear();
    return done;
  }

  function deleteSnapshots(ids) {
    if (!ids.length) return Promise.resolve();
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);
        var mutation = mutateWithLease(store, transaction, function () {
          ids.forEach(function (id) { store.delete(id); });
        });
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(mutation.error || transaction.error || new Error("Could not organize the restore points."));
        };
        transaction.onabort = function () {
          reject(mutation.error || transaction.error || new Error("Could not organize the restore points."));
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
    var protectedIds = new Set();
    var groups = new Set();
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index];
      var group = snapshotGroup(record);
      if (groups.has(group)) continue;
      try { await verifySnapshot(record); protectedIds.add(record.id); groups.add(group); }
      catch (_error) { /* Preserve older valid points when a newer one is damaged. */ }
    }
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
        if (!protectedIds.has(snapshot.id)) removedIds.push(snapshot.id);
        return;
      }

      titleCounts[title] = titleCount + 1;
      bucketCounts[bucket] = bucketCount + 1;
      retainedCount += 1;
    });

    if (!removedIds.length) return records;
    await bounded(deleteSnapshots(removedIds), "Rotating restore points");
    await deleteOrphanAssets();
    return listSnapshots();
  }

  parts.store = {
    state: state,
    sessionId: sessionId,
    verifySnapshot: verifySnapshot,
    BACKUP_INTERVAL_MS: BACKUP_INTERVAL_MS,
    openDatabase: openDatabase,
    assetsAvailable: assetsAvailable,
    getSnapshot: getSnapshot,
    saveAssets: saveAssets,
    loadAssets: function (refs) { return bounded(loadAssets(refs), "Reading restore-point assets"); },
    deleteOrphanAssets: deleteOrphanAssets,
    listSnapshots: listSnapshots,
    saveSnapshot: function (record, entries) {
      if (record.id === LEASE_ID) return Promise.reject(new Error("Reserved restore-point ID."));
      return withWriterLease(function () { return saveSnapshot(record, entries); });
    },
    deleteSnapshot: function (id) { return bounded(deleteSnapshot(id), "Deleting restore point"); },
    deleteAllSnapshots: deleteAllSnapshots,
    pruneAutomaticSnapshots: function () { return withWriterLease(pruneAutomaticSnapshots); },
  };
  if (typeof module === "object" && module.exports) module.exports = parts.store;
})(window);

