"use strict";

// Coverage for zoidium/project-restore.js database handling: v1 -> v2
// upgrade keeps snapshots, an existing v2 database opens, and a database
// already bumped past DB_VERSION falls back to a versionless open instead of
// surfacing the raw VersionError.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const RESTORE_SOURCES = (() => {
  // After the split this loads the part files in browser order; before it,
  // the single entry file. The assertions below are unchanged either way.
  const parts = [
    "zoidium/project-restore-store.js",
    "zoidium/project-restore-snapshots.js",
    "zoidium/project-restore-toasts.js",
    "zoidium/project-restore.js",
  ];
  if (parts.every((relative) => fs.existsSync(path.join(__dirname, "..", relative)))) {
    return parts.map((relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8"));
  }
  return [
    fs.readFileSync(path.join(__dirname, "..", "zoidium", "project-restore.js"), "utf8"),
  ];
})();

function flush(rounds = 16) {
  let chain = Promise.resolve();
  for (let index = 0; index < rounds; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  read() {
    return new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
  }

  write(values) {
    this.element.className = Array.from(values).join(" ");
  }

  add(...tokens) {
    const values = this.read();
    tokens.forEach((token) => values.add(token));
    this.write(values);
  }

  remove(...tokens) {
    const values = this.read();
    tokens.forEach((token) => values.delete(token));
    this.write(values);
  }

  toggle(token, force) {
    const values = this.read();
    const active = force === undefined ? !values.has(token) : Boolean(force);
    if (active) values.add(token);
    else values.delete(token);
    this.write(values);
    return active;
  }

  contains(token) {
    return this.read().has(token);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.className = "";
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.title = "";
    this.value = "";
    this.type = "";
    this.name = "";
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.innerMarkup = "";
    this.queryCache = new Map();
    this.parent = null;
  }

  get innerHTML() {
    return this.innerMarkup;
  }

  set innerHTML(markup) {
    this.innerMarkup = String(markup);
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  fire(type, event) {
    (this.listeners[type] || []).forEach((listener) => listener.call(this, event || {}));
  }

  click() {
    this.fire("click", { preventDefault() {}, stopPropagation() {} });
  }

  blur() {}

  querySelector(selector) {
    if (!this.queryCache.has(selector)) {
      this.queryCache.set(selector, new FakeElement("div"));
    }
    return this.queryCache.get(selector);
  }
}

function notFoundError(message) {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function versionError(requested, existing) {
  const error = new Error(
    `The requested version (${requested}) is less than the existing version (${existing}).`,
  );
  error.name = "VersionError";
  return error;
}

// Minimal IndexedDB double with real version semantics: opening below the
// stored version fails with VersionError, opening above runs an upgrade, and
// opening without a version uses the stored version untouched.
class FakeIndexedDB {
  constructor(seed) {
    this.databases = seed || {};
    this.openCalls = [];
  }

  open(name, version) {
    this.openCalls.push({ name, version });
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setImmediate(() => {
      const existing = this.databases[name];
      const requested = version === undefined
        ? (existing ? existing.version : 1)
        : version;
      if (!existing) {
        this.databases[name] = { version: requested, stores: {} };
        const connection = makeConnection(this, name);
        request.result = connection;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: request, oldVersion: 0, newVersion: requested });
        }
        if (request.onsuccess) request.onsuccess({ target: request });
        return;
      }
      if (requested < existing.version) {
        request.error = versionError(requested, existing.version);
        if (request.onerror) request.onerror({ target: request });
        return;
      }
      const connection = makeConnection(this, name);
      request.result = connection;
      if (requested > existing.version) {
        const oldVersion = existing.version;
        existing.version = requested;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: request, oldVersion, newVersion: requested });
        }
      }
      if (request.onsuccess) request.onsuccess({ target: request });
    });
    return request;
  }
}

function makeConnection(idb, name) {
  const entry = () => idb.databases[name];
  return {
    get version() {
      return entry().version;
    },
    objectStoreNames: {
      contains(storeName) {
        return Object.prototype.hasOwnProperty.call(entry().stores, storeName);
      },
    },
    createObjectStore(storeName, options) {
      const stores = entry().stores;
      if (!stores[storeName]) {
        stores[storeName] = {
          keyPath: (options && options.keyPath) || "id",
          records: new Map(),
        };
      }
      return { createIndex() {} };
    },
    transaction(storeNames, mode) {
      const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
      const stores = entry().stores;
      if (!Object.prototype.hasOwnProperty.call(stores, storeName)) {
        throw notFoundError(`No object store named ${storeName}.`);
      }
      const store = stores[storeName];
      void mode;
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        pending: 0,
        done: false,
      };
      const previous = Object.fromEntries(Object.entries(stores).map(([name, value]) => [name, new Map(value.records)]));
      function abort(error) {
        transaction.done = true;
        transaction.error = error || new Error("Transaction aborted");
        for (const [name, records] of Object.entries(previous)) stores[name].records = records;
        queueMicrotask(() => transaction.onabort?.({ target: transaction }));
      }
      function finish() {
        if (transaction.pending === 0 && !transaction.done) {
          transaction.done = true;
          queueMicrotask(() => {
            if (transaction.oncomplete) transaction.oncomplete({ target: transaction });
          });
        }
      }
      function track(apply) {
        const op = { result: undefined, error: null, onsuccess: null, onerror: null };
        transaction.pending += 1;
        queueMicrotask(() => {
          let failed = null;
          try {
            op.result = apply();
          } catch (error) {
            failed = error;
            op.error = error;
          }
          if (failed) {
            if (op.onerror) op.onerror({ target: op });
            abort(failed);
          } else if (op.onsuccess) {
            try { op.onsuccess({ target: op }); }
            catch (error) { abort(error); }
          }
          transaction.pending -= 1;
          finish();
        });
        return op;
      }
      return {
        abort: () => abort(),
        get error() { return transaction.error; },
        objectStore(name) {
          const store = stores[name || storeName];
          return {
            getAll() {
              return track(() => Array.from(store.records.values()));
            },
            getAllKeys() {
              return track(() => Array.from(store.records.keys()));
            },
            get(key) {
              return track(() => store.records.get(key));
            },
            add(record) {
              return track(() => {
                if (store.records.has(record[store.keyPath])) throw new Error("Duplicate restore point");
                store.records.set(record[store.keyPath], record);
              });
            },
            put(record) {
              return track(() => {
                store.records.set(record[store.keyPath], record);
                return record[store.keyPath];
              });
            },
            delete(key) {
              return track(() => {
                store.records.delete(key);
                return undefined;
              });
            },
            clear() {
              return track(() => {
                store.records.clear();
                return undefined;
              });
            },
          };
        },
        get oncomplete() {
          return transaction.oncomplete;
        },
        set oncomplete(handler) {
          transaction.oncomplete = handler;
        },
        get onerror() {
          return transaction.onerror;
        },
        set onerror(handler) {
          transaction.onerror = handler;
        },
        get onabort() {
          return transaction.onabort;
        },
        set onabort(handler) {
          transaction.onabort = handler;
        },
      };
    },
  };
}

function seedV1Database() {
  return {
    "zoidium-restore-points": {
      version: 1,
      stores: {
        snapshots: {
          keyPath: "id",
          records: new Map([
            ["v1-point", {
              id: "v1-point",
              createdAt: Date.now() - 60000,
              projectName: "legacy project",
              size: 12,
              assetCount: 2,
              blob: { size: 12 },
              fingerprint: "fp-legacy",
              automatic: false,
            }],
          ]),
        },
      },
    },
  };
}

function seedV2Database() {
  return {
    "zoidium-restore-points": {
      version: 2,
      stores: {
        snapshots: {
          keyPath: "id",
          records: new Map([
            ["v2-point", {
              id: "v2-point",
              createdAt: Date.now() - 60000,
              format: 2,
              projectName: "split project",
              size: 90,
              assetCount: 1,
              projectBlob: { size: 30 },
              assetRefs: [{ id: "asset-1", name: "clip.png", size: 60, type: "image/png" }],
              fingerprint: "fp-split",
              automatic: true,
            }],
          ]),
        },
        assets: {
          keyPath: "id",
          records: new Map([
            ["asset-1", { id: "asset-1", blob: { size: 60 }, size: 60, type: "image/png" }],
          ]),
        },
      },
    },
  };
}

function seedFutureDatabase() {
  return {
    "zoidium-restore-points": {
      version: 3,
      stores: {
        snapshots: {
          keyPath: "id",
          records: new Map([
            ["future-point", {
              id: "future-point",
              createdAt: Date.now() - 60000,
              projectName: "future project",
              size: 20,
              assetCount: 0,
              blob: { size: 20 },
              fingerprint: "fp-future",
              automatic: true,
            }],
          ]),
        },
      },
    },
  };
}

function loadRestore(options = {}) {
  const idb = new FakeIndexedDB(options.seed || {});
  const timeouts = [];
  const intervals = [];
  const globalListeners = {};
  const documentListeners = {};
  const menubarTabs = [];
  const downloads = [];
  let timerId = 0;

  const documentObject = {
    body: new FakeElement("body"),
    activeElement: null,
    createElement(tag) {
      return new FakeElement(tag);
    },
    querySelector() {
      return null;
    },
    addEventListener(type, listener) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(listener);
    },
  };

  const storage = new Map();
  if (options.localStorage) {
    Object.entries(options.localStorage).forEach(([key, value]) => storage.set(key, value));
  }

  const editor = {
    project: { id: "project-1" },
    confirmIfDirty: () => true,
    loadProject: async () => ({ ui: {} }),
  };

  const projectFiles = {
    fileNameForProject: (name) => `${(name && String(name).trim()) || "project"}.pz`,
    displayNameForUi: (name) => (name && String(name).trim()) || "project",
    getProjectName: () => "project",
    setProjectName: (target, value) => String(value || "project"),
    setRawProjectName: () => {},
    getProjectRevision: () => 0,
    createArchive: async () => ({
      blob: new Blob(["0123456789"]),
      projectName: "project",
      assetCount: 0,
      fingerprint: "fp-test",
    }),
    fingerprintArchive: async () => "fp-test",
    openValidatedArchive: async () => ({}),
    isProjectDataError: () => false,
    triggerDownload: (blob, filename) => downloads.push({ blob, filename }),
    ...(options.projectFiles || {}),
  };

  const sandbox = {
    crypto: require("node:crypto").webcrypto,
    Uint8Array,
    PZ: {
      zoidium: { projectFiles },
      ui: { generateIcon: () => new FakeElement("svg") },
      archive: class Archive {
        async untar() {}
        addFile() {}
        async tar() {
          return { size: 1 };
        }
      },
    },
    CM: editor,
    document: documentObject,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    indexedDB: idb,
    ZoidiumUI: {
      createPageHeader: () => new FakeElement("header"),
      createMenubarTab: (tab) => {
        menubarTabs.push(tab);
        return {};
      },
      createButton: (options) => {
        const button = new FakeElement("button");
        button.textContent = (options && options.title) || "";
        const extra = options && options.className ? String(options.className).split(/\s+/) : [];
        button.classList.add("proprow", "propbutton", ...extra.filter(Boolean));
        if (options && typeof options.onClick === "function") {
          button.addEventListener("click", options.onClick);
        }
        return button;
      },
      confirm: options.confirm || (async () => true),
      controls: {
        note: (message, variant) => {
          const note = new FakeElement("p");
          note.classList.add("zoidium-note");
          if (variant) note.classList.add(variant);
          note.textContent = message || "";
          return { element: note };
        },
      },
    },
    MutationObserver: class MutationObserver {
      observe() {}
      disconnect() {}
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = (init && init.detail) || {};
      }
    },
    setTimeout: (...args) => {
      timeouts.push(args);
      timerId += 1;
      return timerId;
    },
    clearTimeout: () => {},
    setInterval: (...args) => {
      intervals.push(args);
      timerId += 1;
      return timerId;
    },
    clearInterval: () => {},
    addEventListener: (type, listener) => {
      if (!globalListeners[type]) globalListeners[type] = [];
      globalListeners[type].push(listener);
    },
    dispatchEvent: () => true,
    location: { reload: () => {} },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  RESTORE_SOURCES.forEach((source, index) => {
    vm.runInContext(source, sandbox, { filename: `project-restore-part-${index}.js` });
  });

  const panel = menubarTabs.length ? menubarTabs[0].panel : null;
  const toasts = () => documentObject.body.children.filter(
    (child) => child.tagName === "ASIDE",
  );
  const errorToasts = () => toasts().filter(
    (toast) => toast.classList.contains("is-error")
      && toast.querySelector(".zoidium-project-toast-title").textContent === "Error!",
  );
  return {
    sandbox, idb, panel, editor, projectFiles, downloads, storage,
    timeouts, intervals, globalListeners, documentListeners, toasts, errorToasts,
  };
}

function listEntries(harness) {
  assert.ok(harness.panel, "expected the Restore panel to be created");
  return harness.panel.querySelector(".zoidium-restore-list").children;
}

test("upgrading a v1 database to v2 keeps existing snapshots", async () => {
  const harness = loadRestore({ seed: seedV1Database() });
  await flush();

  const stored = harness.idb.databases["zoidium-restore-points"];
  assert.equal(stored.version, 2);
  assert.ok(stored.stores.assets, "expected the assets store to be created");
  assert.ok(stored.stores.snapshots.records.has("v1-point"), "expected the v1 record to survive");

  const entries = listEntries(harness);
  assert.equal(entries.length, 1);
  assert.match(entries[0].className, /zoidium-restore-entry/);
  assert.deepEqual(harness.errorToasts(), []);
});

test("an existing v2 database with split records opens without errors", async () => {
  const harness = loadRestore({ seed: seedV2Database() });
  await flush();

  const stored = harness.idb.databases["zoidium-restore-points"];
  assert.equal(stored.version, 2);
  assert.ok(stored.stores.assets.records.has("asset-1"), "expected stored assets to survive");

  const entries = listEntries(harness);
  assert.equal(entries.length, 1);
  const stats = entries[0].children[0].children[2].textContent;
  assert.match(stats, /1 asset/);
  assert.deepEqual(harness.errorToasts(), []);
});

test("a database bumped past DB_VERSION falls back to a versionless open", async () => {
  const harness = loadRestore({ seed: seedFutureDatabase() });
  await flush();

  const versions = harness.idb.openCalls.map((call) => call.version);
  assert.ok(versions.includes(2), "expected a versioned open attempt first");
  assert.ok(versions.includes(undefined), "expected a versionless fallback open");

  // The existing snapshots must render instead of an error message, and the
  // raw VersionError text must never reach the UI.
  const entries = listEntries(harness);
  assert.equal(entries.length, 1);
  assert.match(entries[0].className, /zoidium-restore-entry/);
  entries.forEach((entry) => {
    assert.doesNotMatch(entry.textContent || "", /less than the existing version/);
  });
  assert.deepEqual(harness.errorToasts(), []);
  assert.deepEqual(harness.toasts(), [], "expected no toast at all on a clean start");
});

test("the backup interval select persists and rejects unknown values", async () => {
  const harness = loadRestore({ seed: seedV1Database() });
  await flush();

  const select = harness.panel.querySelector(".zoidium-backup-interval");
  select.value = "0";
  select.fire("change");
  assert.equal(harness.storage.get("zoidium.restore.interval"), "0");

  select.value = "bogus";
  select.fire("change");
  assert.equal(harness.storage.get("zoidium.restore.interval"), "0");

  const visible = harness.toasts().filter((toast) => toast.classList.contains("is-visible"));
  assert.equal(visible.length, 1);
  assert.equal(
    visible[0].querySelector(".zoidium-project-toast-message").textContent,
    "Automatic backup disabled.",
  );
});

test("new restore points use a complete archive with a stored integrity hash", async () => {
  const harness = loadRestore();
  await flush();
  harness.panel.querySelector(".zoidium-restore-backup-control").children[0].click();
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  const stored = harness.idb.databases["zoidium-restore-points"];
  const snapshots = Array.from(stored.stores.snapshots.records.values());
  assert.equal(snapshots.length, 1);
  assert.ok(snapshots[0].blob instanceof Blob);
  assert.equal(snapshots[0].integrity.size, snapshots[0].blob.size);
  assert.match(snapshots[0].integrity.sha256, /^[a-f0-9]{64}$/);
  assert.equal(stored.stores.assets.records.size, 0);
});

test("deleting one restore point asks once and removes it", async () => {
  const confirms = [];
  const harness = loadRestore({
    seed: seedV2Database(),
    confirm: async (options) => {
      confirms.push(options);
      return true;
    },
  });
  await flush();
  assert.equal(listEntries(harness).length, 1);

  const entry = listEntries(harness)[0];
  const actions = entry.children[entry.children.length - 1];
  const deleteButton = actions.children.find((button) => /^Delete /.test(button.textContent));
  assert.ok(deleteButton, "expected a per-point Delete button");
  deleteButton.click();
  await flush();

  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].message, "Delete this restore point?");
  assert.equal(confirms[0].danger, true);
  const stored = harness.idb.databases["zoidium-restore-points"];
  assert.equal(stored.stores.snapshots.records.size, 0, "expected the record deleted");
  const remaining = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(remaining.length, 0);
  assert.match(listEntries(harness)[0].textContent, /No restore points yet/);
});

test("cancelling the delete keeps the restore point", async () => {
  const harness = loadRestore({ seed: seedV2Database(), confirm: async () => false });
  await flush();

  const entry = listEntries(harness)[0];
  const actions = entry.children[entry.children.length - 1];
  actions.children.find((button) => /^Delete /.test(button.textContent)).click();
  await flush();

  assert.equal(listEntries(harness).length, 1);
});

test("delete-all asks twice with the exact wordings", async () => {
  const confirms = [];
  const harness = loadRestore({
    seed: seedV2Database(),
    confirm: async (options) => {
      confirms.push(options);
      return true;
    },
  });
  await flush();

  const footer = harness.panel.querySelector(".zoidium-restore-delete-footer");
  assert.equal(footer.children.length, 1, "expected the shared Delete all button");
  footer.children[0].click();
  await flush();

  assert.deepEqual(confirms.map((options) => options.message), [
    "Delete all restore points?",
    "This will permanently remove every restore point. Continue?",
  ]);
  assert.ok(confirms.every((options) => options.danger), "both steps are destructive");
  const stored = harness.idb.databases["zoidium-restore-points"];
  assert.equal(stored.stores.snapshots.records.size, 0, "expected every record deleted");
  const remaining = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(remaining.length, 0);
});

test("declining the second delete-all step keeps everything", async () => {
  let calls = 0;
  const harness = loadRestore({
    seed: seedV2Database(),
    confirm: async () => {
      calls += 1;
      return calls === 1;
    },
  });
  await flush();

  harness.panel.querySelector(".zoidium-restore-delete-footer").children[0].click();
  await flush();

  assert.equal(calls, 2);
  assert.equal(listEntries(harness).length, 1);
});

// Characterization pins for the retention and scheduling behavior the
// round-9 split (storage, snapshot validation, panel UI, toasts) must keep:
// per-title/total/time-bucket pruning, unchanged automatic backups skipped
// without serializing, manual backups reported, and stale pre-copy records
// rendered unusable instead of restorable.

function seedAutomaticSnapshots(count, options = {}) {
  const now = Date.now();
  const records = new Map();
  for (let index = 0; index < count; index += 1) {
    const ageHours = typeof options.ageHours === "function"
      ? options.ageHours(index)
      : (options.ageHours || 0);
    const title = typeof options.title === "function"
      ? options.title(index)
      : (options.title || "project");
    records.set(`auto-${index}`, {
      id: `auto-${index}`,
      createdAt: now - ageHours * 60 * 60 * 1000 - index * 1000,
      projectName: title,
      size: 10,
      assetCount: 0,
      blob: new Blob(["0123456789"]),
      fingerprint: `fp-${index}`,
      automatic: true,
    });
  }
  return {
    "zoidium-restore-points": {
      version: 2,
      stores: {
        snapshots: { keyPath: "id", records },
        assets: { keyPath: "id", records: new Map() },
      },
    },
  };
}

function clickBackupNow(harness) {
  harness.panel.querySelector(".zoidium-restore-backup-control").children[0].click();
}

function runAllTimeouts(harness) {
  const pending = harness.timeouts.splice(0);
  pending.forEach(([callback]) => callback());
}

test("pruning keeps at most 12 automatic points per project title", async () => {
  // One point per hour over 20 hours: no single hour bucket binds (buckets
  // past the second keep 1 each), so the per-title limit of 12 decides.
  const harness = loadRestore({ seed: seedAutomaticSnapshots(20, { ageHours: (i) => i }) });
  await flush();
  assert.equal(listEntries(harness).length, 20);

  clickBackupNow(harness);
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  await flush();

  const automatic = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(automatic.length, 13, "12 automatic points plus the manual one");
});

test("pruning keeps at most 24 automatic points in total", async () => {
  const harness = loadRestore({
    seed: seedAutomaticSnapshots(30, { ageHours: (i) => i, title: (i) => `project ${i % 5}` }),
  });
  await flush();

  clickBackupNow(harness);
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  await flush();

  const automatic = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.ok(automatic.length <= 25, `expected at most 24 automatic plus manual, got ${automatic.length}`);
  assert.equal(automatic.length, 25);
});

test("pruning keeps only recent points per hour bucket", async () => {
  // Ten automatic points within the current hour: the first-hour bucket
  // keeps 4 of them.
  const harness = loadRestore({ seed: seedAutomaticSnapshots(10, { ageHours: 0 }) });
  await flush();

  clickBackupNow(harness);
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  await flush();

  const automatic = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(automatic.length, 5, "4 automatic points plus the manual one");
});

test("an unchanged automatic backup is skipped without a new record", async () => {
  const harness = loadRestore({ seed: seedAutomaticSnapshots(0) });
  await flush();

  runAllTimeouts(harness);
  // Startup queues an idle callback; run it and await the actual snapshot.
  // A fixed number of event-loop turns does not await WebCrypto completion.
  runAllTimeouts(harness);
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  await flush();
  const first = await harness.sandbox.__zoidiumRestoreParts.store.listSnapshots();
  assert.equal(first.length, 1);

  const skipped = await harness.sandbox.__zoidiumRestoreParts.panel.createSnapshot(false, true);
  await flush();
  assert.equal(skipped, null);
  assert.equal((await harness.sandbox.__zoidiumRestoreParts.store.listSnapshots())[0].id, first[0].id);
  const entries = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(entries.length, 1, "no second point when nothing changed");
});

test("a manual backup reports that it was created", async () => {
  const harness = loadRestore({ seed: seedAutomaticSnapshots(0) });
  await flush();

  clickBackupNow(harness);
  await harness.sandbox.__zoidiumRestoreParts.store.state.snapshotPromise;
  await flush();

  assert.equal(listEntries(harness).length, 1);
  const visible = harness.toasts().filter((toast) => toast.classList.contains("is-visible"));
  assert.equal(visible.length, 1);
  assert.equal(
    visible[0].querySelector(".zoidium-project-toast-message").textContent,
    "Restore point created.",
  );
});

test("a stale pre-copy record is unusable and cannot be restored", async () => {
  const seed = seedAutomaticSnapshots(0);
  seed["zoidium-restore-points"].stores.snapshots.records.set("stale-point", {
    id: "stale-point",
    createdAt: Date.now() - 60000,
    projectName: "old project",
    size: 12,
    assetCount: 0,
    blob: { name: "shared.tmp", size: 12, slice() { return null; } },
    fingerprint: "fp-stale",
    automatic: false,
  });
  const harness = loadRestore({ seed });
  await flush();

  const entries = listEntries(harness).filter((entry) => /zoidium-restore-entry/.test(entry.className));
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.match(entry.className, /is-unusable/);
  const stats = entry.children[0].children[2].textContent;
  assert.match(stats, /before exports were copied/);
  const actions = entry.children[entry.children.length - 1];
  assert.equal(actions.children[0].disabled, true, "restore disabled");
  assert.equal(actions.children[1].disabled, true, "download disabled");
  assert.equal(actions.children[2].disabled, false, "delete stays available");
});

module.exports = { loadRestore, seedAutomaticSnapshots, flush, FakeIndexedDB };

for (const [automatic, changed, quiet] of [[true,true,true],[true,false,false],[false,true,false]]) {
  test(`superseded archive: automatic=${automatic}, changed=${changed}`, async () => {
    const message = "The project changed while the archive was built. Nothing was replaced. Retry saving the current project.";
    const harness = loadRestore({ projectFiles: { createArchive: async editor => {
      if (changed) editor.project = { id: "replacement" };
      throw new Error(message);
    } } });
    await flush();
    const promise = harness.sandbox.__zoidiumRestoreParts.panel.createSnapshot(false,automatic);
    if (quiet) assert.equal(await promise,null);
    else await assert.rejects(promise,{message});
    const errors = harness.toasts().filter(toast => toast.classList.contains("is-visible") && toast.classList.contains("is-error"));
    assert.equal(errors.length,quiet?0:1);
    assert.equal((await harness.sandbox.__zoidiumRestoreParts.store.listSnapshots()).length,0);
  });
}
