(function installDirectDownload(global) {
  "use strict";

  var PATCH_MARKER = "__zoidiumDirectDownloadPatch";
  var ARTIFACT_KEY = "__zoidiumDownloadArtifact";

  function isDownloadPage(value, baseUrl) {
    if (typeof value !== "string") return false;
    try {
      var base = new URL(baseUrl);
      var target = new URL(value, base);
      if (target.origin !== base.origin) return false;
      var pathname = target.pathname;
      return /(?:^|\/)download(?:\/index)?\.html$|\/download\/?$/i.test(pathname);
    } catch (_error) {
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

  function createDownloadManager(options) {
    options = options || {};
    var globalObject = options.globalObject || null;
    var documentObject = options.document || (globalObject && globalObject.document);
    var urlApi = options.URL || (globalObject && globalObject.URL);
    var downloadArtifact = options.downloadArtifact || null;
    var nextId = 0;

    function capture(blob, filename) {
      if (!isBlobLike(blob)) return null;
      return Object.freeze({
        id: ++nextId,
        blob: blob,
        filename: String(filename || "zoidium-download"),
      });
    }

    function trigger(artifact) {
      if (!artifact || !isBlobLike(artifact.blob)) return false;
      if (downloadArtifact) {
        downloadArtifact(artifact.blob, artifact.filename, artifact.id);
        return true;
      }
      if (
        !documentObject ||
        !documentObject.body ||
        !urlApi ||
        typeof urlApi.createObjectURL !== "function"
      ) {
        return false;
      }

      var objectUrl = urlApi.createObjectURL(artifact.blob);
      var link = documentObject.createElement("a");
      link.href = objectUrl;
      link.download = artifact.filename;
      link.rel = "noopener";
      link.style.display = "none";
      documentObject.body.appendChild(link);
      link.click();
      link.remove();
      var setTimer =
        globalObject && typeof globalObject.setTimeout === "function"
          ? globalObject.setTimeout.bind(globalObject)
          : setTimeout;
      setTimer(function () {
        urlApi.revokeObjectURL(objectUrl);
      }, 1000);
      return true;
    }

    function bind(button, artifact) {
      if (!button || !artifact || typeof button.addEventListener !== "function") {
        return false;
      }
      button.addEventListener(
        "click",
        function downloadCapturedArtifact(event) {
          if (!trigger(artifact)) return;
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (event && typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
          }
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

  function patchFinishedPage(prototype, manager, pz, filenameForInstance) {
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
        this[ARTIFACT_KEY] = artifact;
        manager.bind(findDownloadButton(page), artifact);
      }
      return page;
    };
    wrapped[PATCH_MARKER] = true;
    wrapped.__zoidiumDirectDownloadOriginal = original;
    prototype.createFinishedPage = wrapped;
    return true;
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
    );
    var framePatched = patchFinishedPage(
      exportUi.frame && exportUi.frame.prototype,
      manager,
      pz,
      function (instance) {
        return "image." +
          String((instance && instance.params && instance.params.format) || "png");
      },
    );
    return devicePatched || framePatched;
  }

  function emitMissingArtifact(globalObject) {
    try {
      if (typeof globalObject.dispatchEvent === "function") {
        globalObject.dispatchEvent(
          new globalObject.CustomEvent("zoidium:download-error", {
            detail: { message: "The requested export is no longer available." },
          }),
        );
      }
    } catch (_error) {
      // A missing optional event listener must not open the legacy blank page.
    }
    try {
      if (globalObject.console && globalObject.console.error) {
        globalObject.console.error(
          "Zoidium: the requested export is no longer available.",
        );
      }
    } catch (_error) {
      // Console diagnostics are optional.
    }
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
        if (artifact && manager.trigger(artifact)) return null;
        emitMissingArtifact(globalObject);
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
