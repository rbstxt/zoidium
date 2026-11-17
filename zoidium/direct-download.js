(function installDirectDownload(global) {
  "use strict";

  var PATCH_MARKER = "__zoidiumDirectDownloadPatch";

  function isDownloadPage(value, baseUrl) {
    if (typeof value !== "string") return false;
    try {
      var base = new URL(baseUrl);
      var target = new URL(value, base);
      if (target.origin !== base.origin) return false;
      var pathname = target.pathname;
      return /(?:^|\/)download(?:\/index)?\.html$|\/download\/?$/i.test(pathname);
    } catch (_error) {
      // A value that is not parseable as a URL is never a download page.
      return false;
    }
  }

  function isBlobLike(value) {
    return Boolean(
      value &&
        Number.isFinite(Number(value.size)) &&
        typeof value.slice === "function",
    );
  }

  // The CM3 workers hand back the File they wrote into the origin-private file
  // system. That handle keeps reading the shared file named "out", so a later
  // render, project save, or cleanup replaces the bytes of an export that was
  // already captured. A File is also the only blob shape here that is backed by
  // a file rather than by page memory.
  function isFileBackedBlob(value) {
    return Boolean(
      isBlobLike(value) &&
        typeof value.stream === "function" &&
        typeof value.name === "string" &&
        value.name.length > 0,
    );
  }

  function createDownloadManager(options) {
    options = options || {};
    var globalObject = options.globalObject || null;
    var documentObject = options.document || (globalObject && globalObject.document);
    var urlApi = options.URL || (globalObject && globalObject.URL);
    var ResponseCtor =
      options.Response ||
      (globalObject && globalObject.Response) ||
      (typeof Response === "function" ? Response : null);
    var downloadArtifact = options.downloadArtifact || null;
    var nextId = 0;

    function detach(blob) {
      if (!isFileBackedBlob(blob) || typeof ResponseCtor !== "function") {
        return Promise.resolve(blob);
      }
      var expectedSize = Number(blob.size);
      return Promise.resolve()
        .then(function () {
          // Stream instead of arrayBuffer(): a single ArrayBuffer cannot hold a
          // long render, and the copy must not touch the shared file twice.
          return new ResponseCtor(blob.stream()).blob();
        })
        .catch(function (error) {
          var failure = new Error(
            "The export could not be copied out of the browser's temporary file.",
          );
          failure.cause = error;
          throw failure;
        })
        .then(function (copy) {
          if (!isBlobLike(copy) || Number(copy.size) !== expectedSize) {
            throw new Error(
              "The export was copied incompletely out of the browser's temporary file.",
            );
          }
          return copy;
        });
    }

    function capture(blob, filename) {
      if (!isBlobLike(blob)) return null;
      var source = blob;
      var copyError = null;
      var copyPromise = null;
      if (isFileBackedBlob(blob)) {
        copyPromise = detach(blob).then(
          function (copy) {
            return copy;
          },
          function (error) {
            copyError = error;
            throw error;
          },
        );
        // Not every finished page is downloaded. Keep a failed copy from
        // surfacing as an unhandled rejection until the user clicks.
        copyPromise.catch(function () {});
      }
      return Object.freeze({
        id: ++nextId,
        blob: source,
        filename: String(filename || "zoidium-download"),
        detached: function () {
          return copyPromise || Promise.resolve(source);
        },
        copyError: function () {
          return copyError;
        },
      });
    }

    function trigger(artifact) {
      if (!artifact || !isBlobLike(artifact.blob)) return Promise.resolve(false);
      var artifactBlob =
        typeof artifact.detached === "function"
          ? artifact.detached()
          : artifact.blob;
      return Promise.resolve(artifactBlob).then(async function (blob) {
        if (!isBlobLike(blob)) return false;
        // An empty file is never a valid export. Report it instead of saving a
        // zero-byte download that looks like a successful render.
        if (!(Number(blob.size) > 0)) {
          throw new Error("The export is empty, so nothing was downloaded. Render it again and retry.");
        }
        if (/\.pz$/i.test(artifact.filename)) {
          var files = globalObject && globalObject.PZ && globalObject.PZ.zoidium && globalObject.PZ.zoidium.projectFiles;
          if (!files || typeof files.openValidatedArchive !== "function") {
            throw new Error("Project validation is unavailable. Nothing was downloaded.");
          }
          await files.openValidatedArchive(blob, "restore");
        }
        if (downloadArtifact) {
          return Promise.resolve(downloadArtifact(blob, artifact.filename, artifact.id)).then(function () { return true; });
        }
        if (
          !documentObject ||
          !documentObject.body ||
          !urlApi ||
          typeof urlApi.createObjectURL !== "function"
        ) {
          return false;
        }

        var objectUrl = urlApi.createObjectURL(blob);
        var link = documentObject.createElement("a");
        link.href = objectUrl;
        link.download = artifact.filename;
        link.rel = "noopener";
        link.style.display = "none";
        documentObject.body.appendChild(link);
        var setTimer =
          globalObject && typeof globalObject.setTimeout === "function"
            ? globalObject.setTimeout.bind(globalObject)
            : setTimeout;
        try {
          link.click();
        } finally {
          link.remove();
          setTimer(function () {
            urlApi.revokeObjectURL(objectUrl);
          }, 60000);
        }
        return true;
      });
    }

    function bind(button, artifact) {
      if (!button || !artifact || typeof button.addEventListener !== "function") {
        return false;
      }
      var downloading = false;
      button.addEventListener(
        "click",
        function downloadCapturedArtifact(event) {
          // Claim the click before the artifact is read: reading a file-backed
          // export takes a moment, and the legacy download page must not open.
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (event && typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
          }
          if (downloading || button.disabled) return;
          downloading = true;
          var wasDisabled = button.disabled;
          button.disabled = true;
          Promise.resolve().then(function () { return trigger(artifact); }).then(
            function (started) {
              downloading = false;
              button.disabled = wasDisabled;
              if (!started) emitDownloadError(globalObject, artifactError(artifact), artifact.filename);
            },
            function (error) {
              downloading = false;
              button.disabled = wasDisabled;
              emitDownloadError(globalObject, error, artifact.filename);
            },
          );
        },
        true,
      );
      return true;
    }

    return { bind: bind, capture: capture, trigger: trigger };
  }

  function findDownloadButton(page) {
    if (!page) return null;
    var last = page.lastElementChild;
    if (last && String(last.tagName || "").toLowerCase() === "button") return last;
    if (typeof page.querySelectorAll !== "function") return last || null;
    var buttons = page.querySelectorAll("button");
    for (var index = buttons.length - 1; index >= 0; index -= 1) {
      var label = String(
        buttons[index].innerText || buttons[index].textContent || "",
      ).toLowerCase();
      if (label.indexOf("download") !== -1) return buttons[index];
    }
    return null;
  }

  var EXPORT_FORMATS = ["mkv", "webm", "mp4", "png", "jpeg", "webp", "gif"];
  // Start times stashed by the progress wrapper so the finished-page record
  // can carry the render duration. Keyed by export instance, never retained
  // past its own finished page.
  var renderStartTimes = new WeakMap();
  // Errors stashed by the render wrapper so the native error page can record
  // the real failure instead of a constant string.
  var renderFailures = new WeakMap();

  function exportFormatForFilename(filename) {
    var match = /(?:\.([a-z0-9]+))$/i.exec(String(filename || ""));
    var extension = match ? match[1].toLowerCase() : "";
    if (extension === "jpg") extension = "jpeg";
    return EXPORT_FORMATS.indexOf(extension) !== -1 ? extension : "unknown";
  }

  function finiteOrNull(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function debugExportApi(globalObject) {
    try {
      var api = globalObject && globalObject.ZOIDIUM_DEBUG_LOG;
      if (api && typeof api === "object") return api;
    } catch (_error) {
      // Diagnostics must never interrupt the download flow.
    }
    return null;
  }

  function recordExportComplete(globalObject, details) {
    var api = debugExportApi(globalObject);
    if (!api || typeof api.recordExportComplete !== "function") return;
    try {
      api.recordExportComplete(details);
    } catch (_error) {
      // Diagnostics must never interrupt the download flow.
    }
  }

  function recordExportStart(globalObject, details) {
    var api = debugExportApi(globalObject);
    if (!api || typeof api.recordExportStart !== "function") return;
    try {
      api.recordExportStart(details);
    } catch (_error) {
      // Diagnostics must never interrupt the export flow.
    }
  }

  function recordExportError(globalObject, error, details) {
    var api = debugExportApi(globalObject);
    if (!api || typeof api.recordExportError !== "function") return;
    try {
      api.recordExportError(error, details);
    } catch (_error) {
      // Diagnostics must never interrupt the download flow.
    }
  }

  function exportFormatForParams(params) {
    // Native device formats read like "webm_vp8_opus" or start with "mkv";
    // the MP4 plugin records its own richer lifecycle events.
    var format = String((params && params.format) || "");
    if (format === "mp4_h264") return "mp4";
    if (/^mkv/i.test(format)) return "mkv";
    if (/^webm/i.test(format)) return "webm";
    return exportFormatForFilename(format);
  }

  function patchFinishedPage(prototype, manager, pz, filenameForInstance, globalObject) {
    if (
      !prototype ||
      typeof prototype.createFinishedPage !== "function" ||
      prototype.createFinishedPage[PATCH_MARKER]
    ) {
      return false;
    }
    var original = prototype.createFinishedPage;
    var wrapped = function createIsolatedFinishedPage() {
      var filename =
        (typeof filenameForInstance === "function" &&
          filenameForInstance(this)) ||
        pz.downloadFilename;
      var artifact = manager.capture(pz.downloadBlob, filename);
      var page = original.apply(this, arguments);
      if (artifact) {
        manager.bind(findDownloadButton(page), artifact);
        // The finished page appears only after a successful render, so page
        // creation is the render-completion record for native exports. The
        // MP4 plugin records its own completion and never reaches this hook,
        // but the skip keeps the pairing exact if wrapping order changes.
        if (!isMp4Instance(this)) {
          var started = renderStartTimes.has(this) ? renderStartTimes.get(this) : null;
          renderStartTimes.delete(this);
          recordExportComplete(globalObject, {
            format: exportFormatForFilename(filename),
            durationMs: started == null ? null : Math.max(0, Date.now() - started),
            bytes: finiteOrNull(artifact.blob && artifact.blob.size),
            filename: filename,
          });
        }
      }
      return page;
    };
    wrapped[PATCH_MARKER] = true;
    wrapped.__zoidiumDirectDownloadOriginal = original;
    prototype.createFinishedPage = wrapped;
    return true;
  }

  function stashRenderFailure(instance, error) {
    try {
      if (instance && (typeof instance === "object" || typeof instance === "function")) {
        renderFailures.set(instance, error);
      }
    } catch (_ignored) {
      // A frozen instance still fails; only its diagnosis is lost.
    }
  }

  function isMp4Instance(instance) {
    try {
      return Boolean(instance && instance.params && instance.params.format === "mp4_h264");
    } catch (_error) {
      return false;
    }
  }

  function patchDeviceLifecycle(prototype, globalObject) {
    // Render start and the native "Render error" page live in CM3-owned code
    // the repository does not copy. These guarded wrappers only observe the
    // lifecycle from the outside; the MP4 plugin records its own events.
    if (!prototype) return false;
    var patched = false;
    if (
      typeof prototype.createProgressPage === "function" &&
      !prototype.createProgressPage[PATCH_MARKER]
    ) {
      var originalProgress = prototype.createProgressPage;
      var wrappedProgress = function createProgressPageWithExportStart() {
        try {
          var params = (this && this.params) || {};
          if (!isMp4Instance(this)) {
            try {
              renderStartTimes.set(this, Date.now());
            } catch (_ignored) {
              // A frozen or sealed instance still exports without timing.
            }
            recordExportStart(globalObject, {
              format: exportFormatForParams(params),
              width: finiteOrNull(params.width),
              height: finiteOrNull(params.height),
              fps: finiteOrNull(params.rate),
              bitrateScale: finiteOrNull(params.bitrateScale),
            });
          }
        } catch (_ignored) {
          // A missing params shape must not stop the export.
        }
        return originalProgress.apply(this, arguments);
      };
      wrappedProgress[PATCH_MARKER] = true;
      wrappedProgress.__zoidiumDirectDownloadOriginal = originalProgress;
      prototype.createProgressPage = wrappedProgress;
      patched = true;
    }
    if (
      typeof prototype.render === "function" &&
      !prototype.render[PATCH_MARKER]
    ) {
      // Mirrors the frame-export pattern: CM3 shows its "Render error" page
      // through createErrorPage without passing the failure along, so the
      // render wrapper stashes the real error for the error page to record.
      var originalRender = prototype.render;
      var wrappedRender = function renderWithExportFailure() {
        var self = this;
        try {
          var result = originalRender.apply(this, arguments);
        } catch (error) {
          stashRenderFailure(self, error);
          throw error;
        }
        if (result && typeof result.then === "function") {
          return result.then(
            function (value) { return value; },
            function (error) {
              stashRenderFailure(self, error);
              throw error;
            },
          );
        }
        return result;
      };
      wrappedRender[PATCH_MARKER] = true;
      wrappedRender.__zoidiumDirectDownloadOriginal = originalRender;
      prototype.render = wrappedRender;
      patched = true;
    }
    if (
      typeof prototype.createErrorPage === "function" &&
      !prototype.createErrorPage[PATCH_MARKER]
    ) {
      var originalError = prototype.createErrorPage;
      var wrappedError = function createErrorPageWithExportError() {
        try {
          // A failure stashed by the render wrapper carries the real message
          // and cause chain. Without one there is nothing truthful to record,
          // so the page renders unrecorded rather than with a constant.
          if (!isMp4Instance(this) && renderFailures.has(this)) {
            var failure = renderFailures.get(this);
            renderFailures.delete(this);
            recordExportError(globalObject, failure, {
              format: exportFormatForParams((this && this.params) || {}),
              stage: "render",
            });
          }
        } catch (_ignored) {
          // A missing params shape must not stop the error page.
        }
        return originalError.apply(this, arguments);
      };
      wrappedError[PATCH_MARKER] = true;
      wrappedError.__zoidiumDirectDownloadOriginal = originalError;
      prototype.createErrorPage = wrappedError;
      patched = true;
    }
    return patched;
  }

  function patchExportFinishedPages(globalObject, manager) {
    var pz = globalObject && globalObject.PZ;
    var exportUi = pz && pz.ui && pz.ui.export;
    if (!exportUi) return false;
    var devicePatched = patchFinishedPage(
      exportUi.device && exportUi.device.prototype,
      manager,
      pz,
      function (instance) {
        return instance &&
          instance.params &&
          String(instance.params.format || "").indexOf("mkv") === 0
          ? "video.mkv"
          : "video.webm";
      },
      globalObject,
    );
    var framePatched = patchFinishedPage(
      exportUi.frame && exportUi.frame.prototype,
      manager,
      pz,
      function (instance) {
        return "image." +
          String((instance && instance.params && instance.params.format) || "png");
      },
      globalObject,
    );
    var deviceLifecyclePatched = patchDeviceLifecycle(
      exportUi.device && exportUi.device.prototype,
      globalObject,
    );
    return devicePatched || framePatched || deviceLifecyclePatched;
  }

  function artifactError(artifact) {
    var error =
      artifact && typeof artifact.copyError === "function"
        ? artifact.copyError()
        : null;
    return error && error.message
      ? error
      : new Error("The requested export is no longer available.");
  }

  function emitDownloadError(globalObject, error, filename) {
    // Only real export failures are export errors: a stale project link or
    // any other non-export download keeps its console and event report but
    // stays out of the export lifecycle records.
    if (exportFormatForFilename(filename) !== "unknown") {
      var format = exportFormatForFilename(filename);
      recordExportError(globalObject, error, { format: format, stage: "download" });
    }
    var message =
      error && error.message
        ? error.message
        : "The requested export is no longer available.";
    try {
      if (typeof globalObject.dispatchEvent === "function") {
        globalObject.dispatchEvent(
          new globalObject.CustomEvent("zoidium:download-error", {
            detail: { message: message },
          }),
        );
      }
    } catch (_error) {
      // A missing optional event listener must not open the legacy blank page.
    }
    try {
      if (globalObject.console && globalObject.console.error) {
        globalObject.console.error("Zoidium: " + message);
      }
    } catch (_error) {
      // Console diagnostics are optional.
    }
  }

  function emitMissingArtifact(globalObject, filename) {
    emitDownloadError(
      globalObject,
      new Error("The requested export is no longer available."),
      filename,
    );
  }

  function install(globalObject, options) {
    if (!globalObject) return null;
    if (globalObject.open && globalObject.open[PATCH_MARKER]) {
      return globalObject.open.__zoidiumDownloadManager || null;
    }

    options = options || {};
    options.globalObject = globalObject;
    var manager = createDownloadManager(options);
    var originalOpen = globalObject.open;
    var baseUrl =
      globalObject.location && globalObject.location.href
        ? globalObject.location.href
        : "http://localhost/";

    function openWithDownloadFallback() {
      if (isDownloadPage(arguments[0], baseUrl)) {
        var pz = globalObject.PZ || {};
        var artifact = manager.capture(pz.downloadBlob, pz.downloadFilename);
        if (!artifact) {
          emitMissingArtifact(globalObject, pz.downloadFilename);
          return null;
        }
        Promise.resolve(manager.trigger(artifact)).then(
          function (started) {
            if (!started) {
              emitDownloadError(globalObject, artifactError(artifact), artifact.filename);
              return;
            }
            // The legacy download page has no finished-page hook, so a
            // delivered export-stage file completes the record here. Project
            // files keep their own validation path and stay unlabeled.
            if (exportFormatForFilename(artifact.filename) !== "unknown") {
              recordExportComplete(globalObject, {
                format: exportFormatForFilename(artifact.filename),
                bytes: finiteOrNull(artifact.blob && artifact.blob.size),
                filename: artifact.filename,
              });
            }
          },
          function (error) {
            emitDownloadError(globalObject, error, artifact.filename);
          },
        );
        return null;
      }
      return typeof originalOpen === "function"
        ? originalOpen.apply(this, arguments)
        : null;
    }

    openWithDownloadFallback[PATCH_MARKER] = true;
    openWithDownloadFallback.__zoidiumDownloadManager = manager;
    openWithDownloadFallback.__zoidiumDirectDownloadOriginal = originalOpen;
    globalObject.open = openWithDownloadFallback;
    if (globalObject.window) globalObject.window.open = openWithDownloadFallback;
    patchExportFinishedPages(globalObject, manager);
    globalObject.ZoidiumDownloads = manager;
    return manager;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      createDownloadManager: createDownloadManager,
      install: install,
      isDownloadPage: isDownloadPage,
      patchExportFinishedPages: patchExportFinishedPages,
    };
    return;
  }

  install(global);
})(typeof window !== "undefined" ? window : null);
