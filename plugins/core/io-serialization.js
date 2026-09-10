(function installIoSerializationPatch(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumIoSerializationPatch";
  const RETRY_DELAY_MS = 100;
  const MAX_ATTEMPTS = 200;
  const CLEANUP_TIMEOUT_MS = 5000;
  const DIAGNOSTICS_KEY = "zoidiumIoSerialization";

  // The CM3 video encoder worker (worker/av.js) and the project archive
  // worker (worker/tar.js) share one origin-private file named "out":
  // each job removes, recreates, and streams through that path with no
  // locking. A project save (Ctrl+S) started while a video render is in
  // flight interleaves gzip tar bytes into the WebM output, so the
  // exported file starts with a gzip header and players report damage.
  // Serialize every "out" user behind one main-thread FIFO mutex. The
  // workers themselves are fetched runtime resources, so patching their
  // bytes is not an option; the extension layer owns this fix instead.
  function createIoSerializer(hooks) {
    hooks = hooks || {};
    const notifyWaiter =
      typeof hooks.notifyWaiter === "function" ? hooks.notifyWaiter : null;
    const deleteOutFile =
      typeof hooks.deleteOutFile === "function"
        ? hooks.deleteOutFile
        : defaultDeleteOutFile;

    let tail = Promise.resolve();
    let queued = 0;
    let running = null;
    let completed = 0;

    function state() {
      return {
        queued,
        running: running ? running.kind : null,
        completed,
      };
    }

    function settle(holder) {
      if (!holder || holder.settled) return;
      holder.settled = true;
      if (running === holder) running = null;
    }

    function enqueue(kind, task) {
      const previous = tail;
      let releaseTail = null;
      let tailReleased = false;
      tail = new Promise((resolve) => {
        releaseTail = () => {
          if (tailReleased) return;
          tailReleased = true;
          resolve();
        };
      });
      if (notifyWaiter && (queued > 0 || running)) {
        notifyWaiter(kind, state());
      }
      queued += 1;
      const holder = {
        kind,
        running: false,
        settled: false,
        release: () => {
          settle(holder);
          releaseTail();
        },
      };
      const start = () => {
        queued -= 1;
        holder.running = true;
        running = holder;
        let result;
        try {
          result = task();
        } catch (error) {
          holder.release();
          throw error;
        }
        return Promise.resolve(result).then(
          (value) => {
            holder.release();
            completed += 1;
            return value;
          },
          (error) => {
            holder.release();
            throw error;
          },
        );
      };
      return previous.then(start, start);
    }

    // PZ.av.stop() terminates the encoder worker without settling the
    // in-flight encode promise (cancel and waveform paths pend forever by
    // design), so a cancelled render must force-release its mutex slot or
    // every later save and render would wait forever. Only an encode
    // holder is released here; save and cleanup holders are never owned
    // by the encoder and must keep their turn.
    function releaseEncodeHolder() {
      if (running && running.kind === "encode" && running.running) {
        running.release();
      }
    }

    function wrapEncode(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedEncode() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("encode", () => original.apply(receiver, args));
      };
      wrapped[PATCH_MARKER] = true;
      return wrapped;
    }

    function wrapTar(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedTar() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("tar", () => original.apply(receiver, args));
      };
      wrapped[PATCH_MARKER] = true;
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
          releaseEncodeHolder();
        }
      };
      wrapped[PATCH_MARKER] = true;
      return wrapped;
    }

    // PZ.file.cleanUp() deletes "out" through an untracked async callback.
    // Running the stock version outside the mutex would let a stale delete
    // land after a queued save recreates the file, so cleanup waits for
    // its turn and releases the mutex only once the delete settles.
    function wrapCleanUp(original) {
      void original;
      const wrapped = function zoidiumSerializedCleanUp() {
        return enqueue("cleanup", () => deleteOutFile());
      };
      wrapped[PATCH_MARKER] = true;
      return wrapped;
    }

    return {
      enqueue,
      releaseEncodeHolder,
      state,
      wrapCleanUp,
      wrapEncode,
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
            " (shared render/save workspace).",
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
    if (!targets || !targets.av || !targets.archive || !targets.file) {
      return false;
    }
    if (
      typeof targets.av.encode !== "function" ||
      typeof targets.av.stop !== "function" ||
      typeof targets.archive.tar !== "function" ||
      typeof targets.file.cleanUp !== "function"
    ) {
      return false;
    }
    const serializer =
      targets.serializer || createIoSerializer({ notifyWaiter });
    targets.av.encode = serializer.wrapEncode(targets.av.encode);
    targets.av.stop = serializer.wrapStop(targets.av.stop);
    targets.archive.tar = serializer.wrapTar(targets.archive.tar);
    targets.file.cleanUp = serializer.wrapCleanUp(targets.file.cleanUp);
    try {
      if (targets.PZ && !targets.PZ[DIAGNOSTICS_KEY]) {
        targets.PZ[DIAGNOSTICS_KEY] = { state: serializer.state };
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
      });
    if (ready || attempt >= MAX_ATTEMPTS) {
      if (!ready) {
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "Zoidium: render/save serialization is unavailable; concurrent saves during renders may damage video exports.",
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
      CLEANUP_TIMEOUT_MS,
      MAX_ATTEMPTS,
      RETRY_DELAY_MS,
      createIoSerializer,
      install,
    };
    return;
  }

  installWithRetry(1);
})(typeof window !== "undefined" ? window : null);
