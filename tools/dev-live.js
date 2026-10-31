"use strict";

// Live development support for tools/serve-with-resources.js.
//
// The development server stages the CM3 resource graph once at startup, then
// serves Zoidium-owned files so a browser reload sees source changes without
// a restart. This module owns everything that makes that live behavior
// correct under edit/add/remove churn and under page-load request bursts:
//
// - withFsRetry: EMFILE/ENFILE get a bounded retry, never a crash.
// - createDebouncer: coalesces rapid change events into one rebuild.
// - createRecursiveWatcher: one recursive watcher per root where the platform
//   supports it (macOS/Windows), otherwise a small stat-polling fallback.
//   Never one watcher per file.
// - createLiveBundles: plugin bundles and the registry rebuilt from source in
//   memory with the same builder as build:plugin-bundles. Requests serve the
//   cache; a failed rebuild keeps serving the last good bytes and logs.
// - createLivePresets / createLiveCommunitySource: staged overlays
//   (assets/fonts/2d/*.ttf, zoidium/community-runtime-source.js) re-read from
//   their repository sources, so additions and removals need no restart.
// - createApprovalsCache: the preview-cache receipt without a child process
//   per request (the old path ran build-plugin-bundles --check synchronously
//   on every hit and wedged the event loop under parallel load).
// - createRequestGate: bounds concurrent file responses with a FIFO queue so
//   a burst of parallel asset requests degrades to waiting, not EMFILE.
// - sendBytes: buffered responses; abort-safe by construction (no streams).

const fs = require("fs");
const path = require("path");

const RETRYABLE_FS_CODES = new Set(["EMFILE", "ENFILE"]);

function isRetryableFsError(error) {
  return Boolean(error && RETRYABLE_FS_CODES.has(error.code));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs fn (sync or async), retrying EMFILE/ENFILE with bounded exponential
// backoff. Every other error, and exhaustion, rethrows to the caller.
async function withFsRetry(fn, { retries = 5, baseDelayMs = 10, onRetry = null } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableFsError(error) || attempt >= retries) throw error;
      attempt += 1;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 1000);
      if (typeof onRetry === "function") {
        try {
          onRetry(error, attempt, delayMs);
        } catch (_ignored) {
          // Retry reporting must never break the retry itself.
        }
      }
      await sleep(delayMs);
    }
  }
}

function createDebouncer(delayMs, fn) {
  let timer = null;
  let pendingArgs = null;
  const run = () => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    return fn(...args);
  };
  return {
    trigger(...args) {
      pendingArgs = args;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const next = pendingArgs;
        pendingArgs = null;
        fn(...next);
      }, Math.max(0, delayMs));
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        return run();
      }
      return undefined;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingArgs = null;
    },
    get pending() {
      return timer !== null;
    },
  };
}

function normalizeWatchRoots(roots) {
  const seen = new Set();
  const normalized = [];
  for (const root of [].concat(roots || [])) {
    if (typeof root !== "string" || !root) continue;
    const absolute = path.resolve(root);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    normalized.push(absolute);
  }
  return normalized;
}

async function snapshotTree(root) {
  const entries = new Map();
  const visit = async (target) => {
    let stat = null;
    try {
      stat = await fs.promises.stat(target);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return;
      throw error;
    }
    if (stat.isDirectory()) {
      let children = null;
      try {
        children = await fs.promises.readdir(target);
      } catch (error) {
        if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return;
        throw error;
      }
      // Dotfiles are local clutter, never runtime sources.
      for (const child of children.filter((name) => !name.startsWith("."))) {
        await visit(path.join(target, child));
      }
      return;
    }
    if (stat.isFile()) entries.set(target, `${stat.size}:${stat.mtimeMs}`);
  };
  await visit(root);
  return entries;
}

function diffSnapshots(previous, next) {
  const changed = [];
  for (const [file, signature] of next) {
    if (previous.get(file) !== signature) changed.push(file);
  }
  for (const file of previous.keys()) {
    if (!next.has(file)) changed.push(file);
  }
  return changed;
}

// One watcher per root. On macOS and Windows fs.watch observes recursively;
// everywhere else a stat-polling sweep covers edits, additions, and removals.
// Change batches are debounced into one onChange call. Watcher errors are
// reported and never thrown.
function createRecursiveWatcher(roots, onChange, options = {}) {
  const {
    debounceMs = 150,
    forcePoll = false,
    forceRecursive = false,
    pollMs = 1000,
    onError = null,
    fsWatch = fs.watch,
  } = options;
  const targets = normalizeWatchRoots(roots);
  if (typeof onChange !== "function") throw new Error("createRecursiveWatcher needs an onChange callback");
  const reportError = (error) => {
    if (typeof onError === "function") {
      try {
        onError(error);
      } catch (_ignored) {
        // Error reporting must never break the watcher.
      }
    }
  };

  const debounced = createDebouncer(debounceMs, () => {
    const changed = pendingChanged;
    pendingChanged = [];
    try {
      onChange(changed);
    } catch (error) {
      reportError(error);
    }
  });
  let closed = false;
  let pendingChanged = [];
  const watchers = [];
  let pollTimer = null;
  const recursiveSupported = forceRecursive || process.platform === "darwin" || process.platform === "win32";
  const mode = !forcePoll && recursiveSupported ? "recursive" : "poll";

  const noteChanged = (changed) => {
    if (closed || !changed || changed.length === 0) return;
    // Accumulate across the debounce window (deduplicated) so one rebuild
    // batch covers every file that changed, not just the latest event.
    pendingChanged = [...new Set([...pendingChanged, ...changed])];
    debounced.trigger();
  };

  if (mode === "recursive") {
    for (const root of targets) {
      if (!fs.existsSync(root)) continue;
      let watcher = null;
      try {
        watcher = fsWatch(root, { recursive: true, persistent: true }, (_event, filename) => {
          noteChanged([filename ? path.join(root, String(filename)) : root]);
        });
      } catch (error) {
        reportError(error);
        continue;
      }
      watcher.on("error", reportError);
      watchers.push(watcher);
    }
  } else {
    let previous = new Map();
    let sweeping = false;
    const sweep = async () => {
      if (closed || sweeping) return;
      sweeping = true;
      try {
        const next = new Map();
        for (const root of targets) {
          for (const [file, signature] of await snapshotTree(root)) next.set(file, signature);
        }
        const changed = closed ? [] : diffSnapshots(previous, next);
        previous = next;
        noteChanged(changed);
      } catch (error) {
        reportError(error);
      } finally {
        sweeping = false;
      }
    };
    // Seed silently so pre-existing files are not reported as additions.
    sweep().catch((error) => reportError(error));
    pollTimer = setInterval(() => {
      sweep().catch((error) => reportError(error));
    }, Math.max(50, pollMs));
    if (typeof pollTimer.unref === "function") pollTimer.unref();
  }

  return {
    mode,
    roots: targets,
    // Run a pending debounced batch now. Tests drive injected events through
    // this instead of waiting on wall-clock delivery.
    flush() {
      return debounced.flush();
    },
    close() {
      if (closed) return;
      closed = true;
      debounced.cancel();
      pendingChanged = [];
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch (_ignored) {
          // Close is best effort.
        }
      }
      watchers.length = 0;
    },
  };
}

// Plugin bundles and the registry, rebuilt from source in memory with the
// same builder as build:plugin-bundles. ensureFresh re-reads only when the
// registry, a manifest, or a referenced asset changed (mtime/size snapshot);
// the recursive watcher additionally warms the cache proactively.
function createLiveBundles(options = {}) {
  const builder = options.builder || require("./build-plugin-bundles");
  const root = options.root ? path.resolve(options.root) : builder.projectRoot;
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  let state = { files: new Map(), registry: null, error: null, builtAt: 0, builtCount: 0 };
  let signature = null;
  let rebuildPromise = null;

  const manifestPaths = () => {
    let directories = [];
    try {
      directories = fs.readdirSync(path.join(root, "plugins"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
    return directories
      .map((directory) => path.join(root, "plugins", directory, "manifest.json"))
      .filter((manifestPath) => fs.existsSync(manifestPath));
  };

  const statSignature = (file) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : "missing";
    } catch (error) {
      if (error && error.code === "ENOENT") return "missing";
      throw error;
    }
  };

  const computeSignature = () => {
    const parts = [`registry:${statSignature(path.join(root, "plugins", "registry.json"))}`];
    const manifests = manifestPaths();
    for (const manifestPath of manifests) parts.push(`${manifestPath}:${statSignature(manifestPath)}`);
    // Referenced assets are the common edit target; manifests alone would
    // miss source edits, so their mtimes join the signature.
    const assets = new Set();
    for (const manifestPath of manifests) {
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (_error) {
        parts.push(`${manifestPath}:unreadable`);
        continue;
      }
      const sources = [];
      for (const definition of manifest.modules || []) sources.push(definition.source);
      for (const definition of manifest.nativeEffects || []) sources.push(definition.source);
      for (const definition of manifest.effects || []) sources.push(definition.shader, definition.preset);
      for (const definition of manifest.groups || []) {
        sources.push(definition.preset, ...(definition.shaders || []));
      }
      for (const resource of manifest.resources || []) sources.push(resource.source);
      for (const script of manifest.coreScripts || []) sources.push(script.source);
      for (const source of sources) {
        if (typeof source !== "string") continue;
        const relative = String(source).split(/[?#]/, 1)[0].replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
        if (!relative || /^[a-z][a-z\d+.-]*:/i.test(relative)) continue;
        const absolute = path.resolve(root, ...relative.split("/"));
        if (!absolute.startsWith(root + path.sep) && absolute !== root) continue;
        assets.add(absolute);
      }
    }
    for (const asset of [...assets].sort()) parts.push(`${asset}:${statSignature(asset)}`);
    return parts.join("\n");
  };

  const rebuild = async () => {
    if (rebuildPromise) return rebuildPromise;
    rebuildPromise = (async () => {
      const started = Date.now();
      try {
        const built = await withFsRetry(() => builder.buildAllInMemory(root));
        signature = computeSignature();
        state = { files: built.files, registry: built.registry, error: null, builtAt: Date.now(), builtCount: built.files.size };
        onLog(`live bundles rebuilt (${built.files.size} files in ${Date.now() - started}ms)`);
      } catch (error) {
        state = { ...state, error };
        onLog(`live bundle rebuild failed (${error && error.message ? error.message : error}); serving the last good bundles`);
      } finally {
        rebuildPromise = null;
      }
      return state;
    })();
    return rebuildPromise;
  };

  const ensureFresh = async () => {
    let next = null;
    try {
      next = computeSignature();
    } catch (error) {
      if (!isRetryableFsError(error)) throw error;
      await withFsRetry(() => rebuild());
      return state;
    }
    if (next !== signature) await rebuild();
    return state;
  };

  return {
    rebuild,
    ensureFresh,
    getError: () => state.error,
    getStats: () => ({ builtAt: state.builtAt, builtCount: state.builtCount, error: state.error ? String(state.error.message || state.error) : null }),
    getRegistry: async () => {
      const current = await ensureFresh();
      return current.registry;
    },
    getFile: async (relativePath) => {
      const current = await ensureFresh();
      return current.files.get(relativePath) ?? null;
    },
  };
};

const PRESET_NAME_PATTERN = /^[A-Za-z0-9_.-][A-Za-z0-9 _.-]*$/;

function createLivePresets(options = {}) {
  const root = options.root ? path.resolve(options.root) : require("./build-plugin-bundles").projectRoot;
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};

  const readPresetList = () => {
    const listPath = path.join(root, "fonts", "presets.json");
    const entries = JSON.parse(fs.readFileSync(listPath, "utf8"));
    if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.name !== "string")) {
      throw new Error("fonts/presets.json must be an array of {name, label?} entries.");
    }
    return new Set(entries.map((entry) => entry.name));
  };

  // Returns the repository TTF bytes for a staged font URL name, or null
  // when the preset is not listed (the caller falls through to the stage).
  const getPresetBytes = async (name) => {
    if (typeof name !== "string" || !PRESET_NAME_PATTERN.test(name)) return null;
    let listed = null;
    try {
      listed = await withFsRetry(() => readPresetList());
    } catch (error) {
      onLog(`live font preset list unreadable (${error && error.message ? error.message : error})`);
      return null;
    }
    if (!listed.has(name)) return null;
    const source = path.resolve(root, "fonts", "presets", `${name}.ttf`);
    if (!source.startsWith(root + path.sep)) return null;
    try {
      const stat = await withFsRetry(() => fs.promises.lstat(source));
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return await withFsRetry(() => fs.promises.readFile(source));
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  };

  return { getPresetBytes };
}

function createLiveCommunitySource(options = {}) {
  const root = options.root ? path.resolve(options.root) : require("./build-plugin-bundles").projectRoot;
  const runtimeSource = options.runtimeSource || require("./community-runtime-source").runtimeSource;
  const files = options.files || require("./community-runtime-source").FILES;
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  let cached = null;

  const computeSignature = () => files.map((file) => {
    try {
      const stat = fs.statSync(path.join(root, "zoidium", file));
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    } catch (error) {
      if (error && error.code === "ENOENT") return `${file}:missing`;
      throw error;
    }
  }).join("\n");

  const get = async () => {
    let signature = null;
    try {
      signature = computeSignature();
    } catch (error) {
      if (isRetryableFsError(error)) {
        await withFsRetry(async () => computeSignature());
        signature = computeSignature();
      } else throw error;
    }
    if (cached && cached.signature === signature) return cached.source;
    try {
      const source = await withFsRetry(async () => {
        const text = runtimeSource();
        return `"use strict";\nglobalThis.ZoidiumCommunityRuntimeSource = ${JSON.stringify(text)};\n`;
      });
      cached = { signature, source };
      return source;
    } catch (error) {
      onLog(`live community runtime source rebuild failed (${error && error.message ? error.message : error}); serving the last good bytes`);
      if (cached) return cached.source;
      throw error;
    }
  };

  return { get };
}

// The preview-cache receipt without a child process per request. Freshness is
// recomputed at most once per ttlMs (plus explicit invalidations from the
// watcher): the fingerprint hashes the whole runtime tree, and comparing the
// live bundles against the checked-in files replaces the --check spawn.
function createApprovalsCache(options = {}) {
  const approvals = options.approvals || require("./preview-cache-approvals");
  const bundles = options.bundles || null;
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  const ttlMs = options.ttlMs ?? 5000;
  let cached = null;
  let invalidated = true;

  const readDiskText = async (relativePath) => {
    try {
      return await fs.promises.readFile(path.join(approvals.root, relativePath), "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  };

  const bundlesFresh = async (live) => {
    if (!live || !bundles) return null;
    for (const [relativePath, content] of live.files) {
      if (!relativePath.endsWith("bundle.json")) continue;
      const disk = await readDiskText(relativePath);
      if (disk !== content) return false;
    }
    return true;
  };

  // The old per-request check also caught a stale checked-in registry (its
  // integrity/version/bundle URLs lagging the manifests). Compare the live
  // registry string against the disk file the same way.
  const registryFresh = async (live) => {
    if (!live || !bundles || typeof live.registry !== "string") return null;
    return (await readDiskText("plugins/registry.json")) === live.registry;
  };

  const recompute = async () => {
    const file = path.join(approvals.root, approvals.approvalPath);
    let receipt = null;
    try {
      delete require.cache[require.resolve(file)];
      receipt = require(file);
    } catch (error) {
      onLog(`live approvals receipt unreadable (${error && error.message ? error.message : error}); serving the last response`);
      if (cached) return cached.source;
      throw error;
    }
    let current = false;
    try {
      const fingerprintCurrent = receipt.fingerprint === approvals.fingerprint();
      // A recorded rebuild error may be transient; retry once here (bounded
      // by the TTL) instead of withdrawing approvals until the next edit.
      if (bundles && typeof bundles.rebuild === "function" &&
          typeof bundles.getError === "function" && bundles.getError() != null) {
        await bundles.rebuild();
      }
      const live = bundles ? await bundles.ensureFresh() : null;
      // A failed rebuild keeps serving last-good bytes; like the old check,
      // any broken window withdraws the approvals instead of blessing them.
      const rebuildOk = !bundles || typeof bundles.getError !== "function" || bundles.getError() == null;
      const bundlesOk = live ? await bundlesFresh(live) : null;
      const registryOk = live ? await registryFresh(live) : null;
      current = fingerprintCurrent && rebuildOk && bundlesOk !== false && registryOk !== false;
    } catch (error) {
      // Fail closed, as the old path did on any check error: serve the stale
      // receipt so preview frames render live until the tree is healthy again.
      onLog(`live approvals freshness check failed (${error && error.message ? error.message : error}); serving the receipt without approvals`);
      current = false;
    }
    const source = current
      ? await fs.promises.readFile(file, "utf8")
      : approvals.source({ ...receipt, plugins: {}, stale: true });
    cached = { source, at: Date.now() };
    invalidated = false;
    return cached.source;
  };

  return {
    invalidate() {
      invalidated = true;
    },
    get: async () => {
      if (cached && !invalidated && Date.now() - cached.at < ttlMs) return cached.source;
      try {
        return await withFsRetry(recompute, { retries: 2 });
      } catch (error) {
        if (cached) return cached.source;
        throw error;
      }
    },
  };
}

// Bounds concurrent request handling with a FIFO queue: a page load that
// fans out into hundreds of parallel asset requests waits its turn instead
// of exhausting file handles.
// Runs the documentation build for the development server with bounded
// retries, then degrades to serving without docs. Any failure is retried,
// not only EMFILE-coded ones: the build runs in a child process whose file
// pressure surfaces as a generic exit failure. Returns true when the docs
// were built, false when the server should start without them.
async function buildDocsWithFallback(buildFn, { attempts = 3, baseDelayMs = 500, warn = () => {} } = {}) {
  const total = Math.max(1, Math.floor(attempts));
  let lastError = null;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      await buildFn();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < total) {
        warn(`documentation build attempt ${attempt} of ${total} failed (${error && error.message ? error.message : error}); retrying`);
        await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 5000));
      }
    }
  }
  warn(`documentation build failed after ${total} attempt(s) (${lastError && lastError.message ? lastError.message : lastError}); starting without /docs. Rebuild them with \`pnpm run docs:build\` and reload — no restart needed.`);
  return false;
}

function createRequestGate({ maxConcurrent = 64 } = {}) {  const limit = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < limit && queue.length > 0) {
      const entry = queue.shift();
      active += 1;
      Promise.resolve()
        .then(entry.fn)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        pump();
      });
    },
    stats() {
      return { active, queued: queue.length, limit };
    },
  };
}

// Buffered responses are abort-safe by construction: no open stream is left
// behind when the client disconnects. Returns false when nothing was sent.
function sendBytes(request, response, { status = 200, contentType = "application/octet-stream", bytes = "", cacheControl = "no-cache" } = {}) {
  try {
    if (!response || response.destroyed || response.writableEnded || response.headersSent) return false;
    if (request && (request.aborted || (request.destroyed && !request.readable))) return false;
    const body = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
    response.writeHead(status, {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": cacheControl,
    });
    response.end(body);
    return true;
  } catch (_error) {
    try {
      if (response && !response.destroyed) response.destroy();
    } catch (_ignored) {
      // Destroy is best effort.
    }
    return false;
  }
}

module.exports = {
  RETRYABLE_FS_CODES,
  buildDocsWithFallback,
  createApprovalsCache,
  createDebouncer,
  createLiveBundles,
  createLiveCommunitySource,
  createLivePresets,
  createRecursiveWatcher,
  createRequestGate,
  diffSnapshots,
  isRetryableFsError,
  sendBytes,
  snapshotTree,
  withFsRetry,
};
