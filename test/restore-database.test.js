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

const RESTORE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "zoidium", "project-restore.js"),
  "utf8",
);

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
    transaction(storeName, mode) {
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
          } else if (op.onsuccess) {
            op.onsuccess({ target: op });
          }
          transaction.pending -= 1;
          finish();
        });
        return op;
      }
      return {
        objectStore() {
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
      blob: { size: 10 },
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
    confirm: () => true,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(RESTORE_SOURCE, sandbox, { filename: "project-restore.js" });

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

test("split restore points deduplicate assets in the v2 store", async () => {
  const assetFile = { size: 30 };
  const harness = loadRestore({
    projectFiles: {
      createRestorePoint: async () => ({
        projectBlob: { size: 30 },
        projectName: "project",
        assetCount: 2,
        archiveSize: 60,
        assetRefs: [{ id: "asset-9", name: "clip.png", size: 30, type: "image/png" }],
        assets: [
          { id: "asset-9", name: "clip.png", size: 30, type: "image/png", file: assetFile },
          { id: "asset-9", name: "clip.png", size: 30, type: "image/png", file: assetFile },
        ],
        fingerprint: "fp-dedup",
      }),
    },
  });
  await flush();

  harness.panel.querySelector(".zoidium-backup-now").click();
  await flush();

  const stored = harness.idb.databases["zoidium-restore-points"];
  assert.equal(stored.version, 2);
  const snapshots = Array.from(stored.stores.snapshots.records.values());
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].format, 2);
  assert.deepEqual(
    Array.from(stored.stores.assets.records.keys()),
    ["asset-9"],
  );
  const entries = listEntries(harness);
  assert.equal(entries.length, 1);
  assert.deepEqual(harness.errorToasts(), []);
});
