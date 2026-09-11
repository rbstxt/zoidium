(function installIoSerializationPatch(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumIoSerializationPatch";
  const ORIGINAL_MARKER = "__zoidiumIoSerializationOriginal";
  const RETRY_DELAY_MS = 100;
  const MAX_ATTEMPTS = 200;
  const CLEANUP_TIMEOUT_MS = 5000;
  const DIAGNOSTICS_KEY = "zoidiumIoSerialization";
  const CROSS_TAB_LOCK_NAME = "zoidium-export-workspace-v2";
  const MINIMUM_WORKSPACE_BYTES = 100 * 1024 * 1024;
  const ARCHIVE_HEADROOM_BYTES = 16 * 1024 * 1024;
  const LEASE_DATABASE_NAME = "zoidium-coordination";
  const LEASE_STORE_NAME = "locks";
  const LEASE_DURATION_MS = 5 * 60 * 1000;
  const LEASE_RENEW_MS = 30 * 1000;
  const LEASE_RETRY_MS = 250;
  const CANCELLED = Object.freeze({ cancelled: true });

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function createWebLockRunner(lockManager) {
    return function runWithWebLock(_kind, task, cancellation) {
      const options = { mode: "exclusive" };
      if (cancellation && cancellation.signal) {
        options.signal = cancellation.signal;
      }

      return Promise.resolve()
        .then(() =>
          lockManager.request(CROSS_TAB_LOCK_NAME, options, function () {
            if (cancellation && cancellation.isCancelled()) return CANCELLED;
            const result = Promise.resolve().then(task);
            return cancellation
              ? Promise.race([result, cancellation.promise])
              : result;
          }),
        )
        .catch((error) => {
          if (
            cancellation &&
            cancellation.isCancelled() &&
            error &&
            error.name === "AbortError"
          ) {
            return CANCELLED;
          }
          throw error;
        });
    };
  }

  function openLeaseDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(LEASE_DATABASE_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(LEASE_STORE_NAME)) {
          request.result.createObjectStore(LEASE_STORE_NAME);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not open the export coordination database."));
      };
      request.onblocked = function () {
        reject(new Error("The export coordination database is blocked by another tab."));
      };
    });
  }

  function createIndexedDbLockRunner(globalObject) {
    const indexedDb = globalObject && globalObject.indexedDB;
    if (!indexedDb || typeof indexedDb.open !== "function") return null;

    const databasePromise = openLeaseDatabase(indexedDb);
    const ownerPrefix =
      String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    let requestCounter = 0;

    async function updateLease(token, action) {
      const database = await databasePromise;
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(LEASE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(LEASE_STORE_NAME);
        const request = store.get(CROSS_TAB_LOCK_NAME);
        let result = { acquired: false, expiresAt: 0 };

        request.onsuccess = function () {
          const now = Date.now();
          const current = request.result;
          if (action === "claim") {
            if (!current || current.expiresAt <= now || current.owner === token) {
              const expiresAt = now + LEASE_DURATION_MS;
              store.put({ owner: token, expiresAt }, CROSS_TAB_LOCK_NAME);
              result = { acquired: true, expiresAt };
            } else {
              result.expiresAt = current.expiresAt;
            }
            return;
          }

          if (!current || current.owner !== token) return;
          if (action === "renew") {
            const expiresAt = now + LEASE_DURATION_MS;
            store.put({ owner: token, expiresAt }, CROSS_TAB_LOCK_NAME);
            result = { acquired: true, expiresAt };
          } else if (action === "release") {
            store.delete(CROSS_TAB_LOCK_NAME);
            result = { acquired: true, expiresAt: 0 };
          }
        };
        request.onerror = function () {
          try {
            transaction.abort();
          } catch (_error) {
            // The transaction may already have failed.
          }
        };
        transaction.oncomplete = function () {
          resolve(result);
        };
        transaction.onerror = function () {
          reject(
            transaction.error ||
              request.error ||
              new Error("Could not coordinate export access between tabs."),
          );
        };
        transaction.onabort = transaction.onerror;
      });
    }

    return async function runWithIndexedDbLease(_kind, task, cancellation) {
      const token = ownerPrefix + "-" + String(++requestCounter);
      let acquired = false;
      while (!acquired) {
        if (cancellation && cancellation.isCancelled()) return CANCELLED;
        const attempt = await updateLease(token, "claim");
        acquired = attempt.acquired;
        if (!acquired) {
          const wait = Math.max(
            25,
            Math.min(LEASE_RETRY_MS, attempt.expiresAt - Date.now()),
          );
          if (cancellation) {
            const result = await Promise.race([delay(wait), cancellation.promise]);
            if (result === CANCELLED) return CANCELLED;
          } else {
            await delay(wait);
          }
        }
      }

      const renewTimer = setInterval(function () {
        updateLease(token, "renew").catch(function () {});
      }, LEASE_RENEW_MS);
      try {
        if (cancellation) {
          return await Promise.race([
            Promise.resolve().then(task),
            cancellation.promise,
          ]);
        }
        return await task();
      } finally {
        clearInterval(renewTimer);
        await updateLease(token, "release").catch(function () {});
      }
    };
  }

  function createOriginLockRunner(globalObject) {
    const lockManager =
      globalObject && globalObject.navigator && globalObject.navigator.locks;
    if (lockManager && typeof lockManager.request === "function") {
      return {
        mode: "web-locks",
        run: createWebLockRunner(lockManager),
      };
    }

    const indexedDbRunner = createIndexedDbLockRunner(globalObject);
    if (indexedDbRunner) {
      return { mode: "indexeddb-lease", run: indexedDbRunner };
    }

    return {
      mode: "page-only",
      run: function runWithoutCrossTabLock(_kind, task, cancellation) {
        const result = Promise.resolve().then(task);
        return cancellation
          ? Promise.race([result, cancellation.promise])
          : result;
      },
    };
  }

  function byteLength(value) {
    if (!value) return 0;
    if (Number.isFinite(Number(value.size))) return Math.max(0, Number(value.size));
    if (Number.isFinite(Number(value.byteLength))) {
      return Math.max(0, Number(value.byteLength));
    }
    return 0;
  }

  function estimateArchiveStorageBytes(files) {
    let inputBytes = 0;
    for (const file of files || []) inputBytes += byteLength(file && file.data);
    return Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(inputBytes * 1.25 + ARCHIVE_HEADROOM_BYTES),
    );
  }

  function estimateVideoStorageBytes(params, profiles) {
    params = params || {};
    const width = Math.max(1, Number(params.width) || 640);
    const height = Math.max(1, Number(params.height) || 360);
    const rate = Math.max(1, Number(params.rate) || 30);
    const frames = Math.max(0, Number(params.length) || 0);
    const quality = Math.max(0, Math.floor(Number(params.quality) || 0));
    const profile = profiles && profiles[quality] ? profiles[quality] : {};
    const bitrateScale = Number(profile.bitrate) || 1;
    const audioScale = Number(profile.abr) || 1;
    let videoBitrate = (width / 640) * (height / 360) * 1000000;
    if (rate > 30) videoBitrate *= 1.5;
    videoBitrate *= bitrateScale;
    const audioBitrate = 64000 * audioScale;
    const expectedOutput = ((videoBitrate + audioBitrate) * (frames / rate)) / 8;
    return Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(expectedOutput * 1.5 + ARCHIVE_HEADROOM_BYTES),
    );
  }

  function requestPersistentQuota(globalObject, requestedBytes, fallback) {
    const requested = Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(Number(requestedBytes) || MINIMUM_WORKSPACE_BYTES),
    );
    const storage =
      globalObject &&
      globalObject.navigator &&
      globalObject.navigator.webkitPersistentStorage;
    if (!storage || typeof storage.requestQuota !== "function") {
      return typeof fallback === "function"
        ? Promise.resolve().then(() => fallback(requested))
        : Promise.resolve(requested);
    }

    return new Promise((resolve, reject) => {
      try {
        storage.requestQuota(
          requested,
          function (grantedBytes) {
            const granted = Number(grantedBytes);
            if (Number.isFinite(granted) && granted < requested) {
              reject(
                new Error(
                  "The browser did not grant enough temporary storage for this export.",
                ),
              );
              return;
            }
            resolve(Number.isFinite(granted) ? granted : requested);
          },
          function (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("The browser denied temporary storage for this export."),
            );
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async function assertBlobPrefix(blob, expected, description) {
    if (!blob) return blob;
    if (byteLength(blob) < expected.length) {
      throw new Error(description + " output was empty or incomplete.");
    }
    if (!blob.slice || typeof blob.slice(0, expected.length).arrayBuffer !== "function") {
      return blob;
    }
    const prefix = new Uint8Array(await blob.slice(0, expected.length).arrayBuffer());
    for (let index = 0; index < expected.length; index += 1) {
      if (prefix[index] !== expected[index]) {
        throw new Error(description + " output failed its file-integrity check.");
      }
    }
    return blob;
  }

  // The video worker and the archive worker both stream through the same
  // origin-private file named "out" and resolve with a File handle to it. That
  // handle stays live: the next render, project save, or cleanup rewrites or
  // removes the file and the captured bytes change under the caller. Copy the
  // export into page memory while the worker still owns the file.
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

  async function detachFileBackedBlob(blob, description) {
    if (!isFileBackedBlob(blob)) return blob;
    if (typeof Response !== "function" || byteLength(blob) === 0) return blob;

    let copy;
    try {
      // Reading through a stream avoids materializing a single ArrayBuffer,
      // which caps out well below the size of a long render.
      copy = await new Response(blob.stream()).blob();
    } catch (error) {
      const failure = new Error(
        description + " could not be read back from the browser's temporary file.",
      );
      failure.cause = error;
      throw failure;
    }
    if (!copy || byteLength(copy) !== byteLength(blob)) {
      throw new Error(
        description + " was copied incompletely from the browser's temporary file.",
      );
    }
    return copy;
  }

  // The CM3 video and archive workers both remove, recreate, and stream
  // through the origin-private file named "out". This serializer protects
  // that file across tabs and also keeps all renderers in one tab from
  // mutating the same sequence and media elements at the same time.
  function createIoSerializer(hooks) {
    hooks = hooks || {};
    const notifyWaiter =
      typeof hooks.notifyWaiter === "function" ? hooks.notifyWaiter : null;
    const deleteOutFile =
      typeof hooks.deleteOutFile === "function"
        ? hooks.deleteOutFile
        : defaultDeleteOutFile;
    const coordination = hooks.runExclusive
      ? { mode: hooks.coordinationMode || "custom", run: hooks.runExclusive }
      : createOriginLockRunner(global);
    const ensureQuota =
      typeof hooks.ensureQuota === "function"
        ? hooks.ensureQuota
        : function () {
            return Promise.resolve();
          };

    let tail = Promise.resolve();
    let queued = 0;
    let running = null;
    let completed = 0;
    let originalTar = null;
    let resetRemuxQueue = null;

    function state() {
      return {
        queued,
        running: running ? running.kind : null,
        completed,
        coordination: coordination.mode,
      };
    }

    function settle(holder) {
      if (!holder || holder.settled) return;
      holder.settled = true;
      if (running === holder) running = null;
    }

    function enqueue(kind, task, options) {
      options = options || {};
      const previous = tail;
      let releaseTail = null;
      let tailReleased = false;
      tail = new Promise((resolve) => {
        releaseTail = function () {
          if (tailReleased) return;
          tailReleased = true;
          resolve();
        };
      });
      if (notifyWaiter && (queued > 0 || running)) {
        notifyWaiter(kind, state());
      }
      queued += 1;

      let resolveCancellation = null;
      const abortController =
        typeof AbortController === "function" ? new AbortController() : null;
      const cancellationPromise = new Promise((resolve) => {
        resolveCancellation = resolve;
      });
      const holder = {
        kind,
        taskSettled: false,
        encodeSettled: false,
        cancelled: false,
        settled: false,
        releaseTail,
        cancel: function () {
          if (holder.cancelled || holder.taskSettled) return;
          holder.cancelled = true;
          if (abortController) abortController.abort();
          resolveCancellation(CANCELLED);
        },
      };
      const cancellation = {
        promise: cancellationPromise,
        signal: abortController && abortController.signal,
        isCancelled: function () {
          return holder.cancelled;
        },
      };

      const start = function () {
        queued -= 1;
        running = holder;
        const guardedTask = function () {
          if (holder.cancelled) return CANCELLED;
          let taskResult;
          try {
            taskResult = task(holder);
          } catch (error) {
            holder.taskSettled = true;
            throw error;
          }
          return Promise.resolve(taskResult).then(
            (value) => {
              holder.taskSettled = true;
              return value;
            },
            (error) => {
              holder.taskSettled = true;
              throw error;
            },
          );
        };
        const operation =
          options.crossTab === false
            ? Promise.race([guardedTask(), cancellationPromise])
            : coordination.run(kind, guardedTask, cancellation);

        return Promise.resolve(operation).then(
          (value) => {
            holder.releaseTail();
            settle(holder);
            if (value === CANCELLED) return new Promise(function () {});
            completed += 1;
            return value;
          },
          (error) => {
            holder.releaseTail();
            settle(holder);
            throw error;
          },
        );
      };
      return previous.then(start, start);
    }

    // PZ.av.stop() also runs inside the encoder's normal completion handler.
    // Release the page-local queue immediately, then wait one task before
    // treating the call as cancellation. A successful encode settles during
    // the same callback; a user-cancelled encode never settles on its own.
    function releaseEncodeHolder() {
      const holder = running;
      if (!holder || holder.kind !== "encode" || holder.settled) return;
      holder.releaseTail();
      setTimeout(function () {
        if (!holder.encodeSettled) holder.cancel();
      }, 0);
    }

    function wrapEncode(original, profiles) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedEncode() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("encode", async function (holder) {
          await ensureQuota(estimateVideoStorageBytes(args[1], profiles));
          let blob;
          try {
            blob = await original.apply(receiver, args);
          } finally {
            holder.encodeSettled = true;
          }
          return assertBlobPrefix(
            await detachFileBackedBlob(blob, "The rendered video"),
            [0x1a, 0x45, 0xdf, 0xa3],
            "Video",
          );
        });
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    function wrapImageEncode(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedImageEncode() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        // Image encoding does not use the shared "out" file, so tabs may run
        // images independently. It still joins the page-local queue because
        // video and image export share sequence state and HTMLMediaElements.
        return enqueue(
          "image",
          () => original.apply(receiver, args),
          { crossTab: false },
        );
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    async function runTar(original, receiver, args) {
      await ensureQuota(estimateArchiveStorageBytes(receiver && receiver.files));
      const blob = await original.apply(receiver, args || []);
      return assertBlobPrefix(
        await detachFileBackedBlob(blob, "The project archive"),
        [0x1f, 0x8b],
        "Project archive",
      );
    }

    function tarWithoutLock(receiver, args) {
      if (typeof originalTar !== "function") {
        return Promise.reject(new Error("The project archive writer is unavailable."));
      }
      return runTar(originalTar, receiver, args);
    }

    function wrapTar(original) {
      if (typeof original !== "function") return original;
      if (original[PATCH_MARKER]) {
        if (!originalTar) originalTar = original[ORIGINAL_MARKER];
        return original;
      }
      if (!originalTar) originalTar = original;
      const wrapped = function zoidiumSerializedTar() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("archive", () => runTar(original, receiver, args));
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    function wrapStop(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumStopWithIoRelease() {
        try {
          return original.apply(this, arguments);
        } finally {
          if (resetRemuxQueue) resetRemuxQueue();
          releaseEncodeHolder();
        }
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    function wrapCleanUp(original) {
      if (typeof original === "function" && original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedCleanUp() {
        return enqueue("cleanup", () => deleteOutFile());
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    function wrapRemux(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      let remuxTail = Promise.resolve();
      resetRemuxQueue = function () {
        remuxTail = Promise.resolve();
      };
      const wrapped = function zoidiumSerializedRemux() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        const result = remuxTail.then(() => original.apply(receiver, args));
        remuxTail = result.catch(function () {});
        return result;
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    function wrapQuota(original) {
      if (typeof original === "function" && original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumCheckedQuota(bytes) {
        return ensureQuota(bytes || MINIMUM_WORKSPACE_BYTES);
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }

    return {
      enqueue,
      releaseEncodeHolder,
      state,
      tarWithoutLock,
      wrapCleanUp,
      wrapEncode,
      wrapImageEncode,
      wrapQuota,
      wrapRemux,
      wrapStop,
      wrapTar,
    };
  }

  function defaultDeleteOutFile() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        if (typeof webkitRequestFileSystem !== "function") {
          finish();
          return;
        }
        webkitRequestFileSystem(
          PERSISTENT,
          0,
          (fs) => {
            try {
              fs.root.getFile(
                "out",
                null,
                (entry) => {
                  try {
                    entry.remove(finish, finish);
                  } catch (_error) {
                    finish();
                  }
                },
                finish,
              );
            } catch (_error) {
              finish();
            }
          },
          finish,
        );
        setTimeout(finish, CLEANUP_TIMEOUT_MS);
      } catch (_error) {
        finish();
      }
    });
  }

  function notifyWaiter(kind, snapshot) {
    try {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "Zoidium: waiting for the " +
            (snapshot.running || "previous") +
            " file operation to finish before starting " +
            kind +
            ".",
        );
      }
    } catch (_error) {
      // Diagnostics must never break the render or save path.
    }
    try {
      if (
        global &&
        typeof global.dispatchEvent === "function" &&
        typeof CustomEvent === "function"
      ) {
        global.dispatchEvent(
          new CustomEvent("zoidium:io-waiting", {
            detail: { kind, snapshot },
          }),
        );
      }
    } catch (_error) {
      // Event listeners are optional.
    }
  }

  function install(targets) {
    if (
      !targets ||
      !targets.av ||
      !targets.archive ||
      !targets.file ||
      !targets.imageEncoder
    ) {
      return false;
    }
    if (
      typeof targets.av.encode !== "function" ||
      typeof targets.av.stop !== "function" ||
      typeof targets.av.remux !== "function" ||
      typeof targets.archive.tar !== "function" ||
      typeof targets.file.cleanUp !== "function" ||
      typeof targets.imageEncoder.encode !== "function"
    ) {
      return false;
    }

    let api = targets.PZ && targets.PZ[DIAGNOSTICS_KEY];
    const existingSerializer = api && api._serializer;
    const originalQuota = targets.file.getQuota;
    const serializer =
      targets.serializer ||
      existingSerializer ||
      createIoSerializer({
        notifyWaiter,
        ensureQuota: function (bytes) {
          return requestPersistentQuota(
            global,
            bytes,
            typeof originalQuota === "function"
              ? originalQuota.bind(targets.file)
              : null,
          );
        },
      });

    targets.av.encode = serializer.wrapEncode(
      targets.av.encode,
      targets.av.profiles,
    );
    targets.av.remux = serializer.wrapRemux(targets.av.remux);
    targets.av.stop = serializer.wrapStop(targets.av.stop);
    targets.archive.tar = serializer.wrapTar(targets.archive.tar);
    targets.file.cleanUp = serializer.wrapCleanUp(targets.file.cleanUp);
    targets.file.getQuota = serializer.wrapQuota(targets.file.getQuota);
    targets.imageEncoder.encode = serializer.wrapImageEncode(
      targets.imageEncoder.encode,
    );

    try {
      if (targets.PZ && !existingSerializer) {
        api = {
          _serializer: serializer,
          detachBlob: detachFileBackedBlob,
          run: serializer.enqueue,
          state: serializer.state,
          tarWithoutLock: serializer.tarWithoutLock,
        };
        targets.PZ[DIAGNOSTICS_KEY] = api;
      }
    } catch (_error) {
      // Diagnostics are best effort.
    }
    return true;
  }

  function installWithRetry(attempt) {
    if (!global) return;
    attempt = attempt || 1;
    const PZ = global.PZ;
    const ready =
      PZ &&
      install({
        PZ,
        archive: PZ.archive && PZ.archive.prototype,
        av: PZ.av,
        file: PZ.file,
        imageEncoder: PZ.imageEncoder,
      });
    if (ready || attempt >= MAX_ATTEMPTS) {
      if (!ready) {
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "Zoidium: export serialization is unavailable. Do not render and save at the same time.",
            );
          }
        } catch (_error) {
          // Diagnostics must never break startup.
        }
      }
      return;
    }
    setTimeout(() => installWithRetry(attempt + 1), RETRY_DELAY_MS);
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      ARCHIVE_HEADROOM_BYTES,
      CLEANUP_TIMEOUT_MS,
      CROSS_TAB_LOCK_NAME,
      MAX_ATTEMPTS,
      MINIMUM_WORKSPACE_BYTES,
      RETRY_DELAY_MS,
      createIoSerializer,
      createOriginLockRunner,
      createWebLockRunner,
      detachFileBackedBlob,
      estimateArchiveStorageBytes,
      estimateVideoStorageBytes,
      install,
      isFileBackedBlob,
      requestPersistentQuota,
    };
    return;
  }

  installWithRetry(1);
})(typeof window !== "undefined" ? window : null);
