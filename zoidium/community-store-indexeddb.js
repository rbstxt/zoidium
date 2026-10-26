"use strict";

(function (root) {
  // One database record makes package bytes and their index one atomic commit.
  // A transaction reads the revision before writing, including across tabs.
  function createIndexedDBAdapter(indexedDB = root.indexedDB, name = "zoidium-community-plugins") {
    let opening;
    function database() {
      if (!opening) opening = new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error("Community storage is unavailable in this browser.")); return; }
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore("store");
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Community storage is blocked by another tab. Close it and reload."));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); opening = null; };
          resolve(db);
        };
      });
      return opening;
    }
    async function transaction(mode, revision, next) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("store", mode), store = tx.objectStore("store");
        let value, failure;
        const request = store.get("state");
        request.onsuccess = () => {
          value = request.result || null;
          if (mode === "readwrite") {
            if ((value?.revision || 0) !== revision) {
              failure = new Error("Community storage changed in another tab. Refresh and try again.");
              failure.code = "REVISION_CONFLICT"; tx.abort(); return;
            }
            store.put(next, "state");
          }
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(failure || tx.error || new Error("Community storage failed."));
        tx.onabort = () => reject(failure || tx.error || new Error("Community storage transaction was interrupted."));
      });
    }
    return {
      load: () => transaction("readonly"),
      commit: (revision, next) => transaction("readwrite", revision, next),
      async close() { if (opening) (await opening).close(); opening = null; },
    };
  }
  const api = { createIndexedDBAdapter };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumCommunityIndexedDB = api;
})(globalThis);
