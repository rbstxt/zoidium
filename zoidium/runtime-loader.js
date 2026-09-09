(function (global) {
  "use strict";

  var SETTINGS_STORAGE_KEY = "zoidium.editor-settings";
  var started = false;
  var config = global.ZOIDIUM_RUNTIME || {};

  // Every first-party URL shares one cache-busting counter from
  // ZOIDIUM_RUNTIME.assetVersion (see zoidium/runtime-config.js). Authors
  // never hand-edit per-file ?v= queries: the loader appends the version,
  // and a URL that already carries a query is left untouched.
  function resolveAsset(value) {
    var href = new URL(value, document.baseURI).href;
    var version = config.assetVersion;
    if (version === undefined || version === null || /[?#]/.test(value)) return href;
    return href + "?v=" + encodeURIComponent(String(version));
  }

  function setDebugPhase(value) {
    try {
      var debugLog = global.ZOIDIUM_DEBUG_LOG;
      if (debugLog && typeof debugLog.setPhase === "function") debugLog.setPhase(value);
    } catch (_error) {
      // Diagnostics must never prevent the extension layer from starting.
    }
  }

  function loadStylesheet(url) {
    return new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = resolve;
      link.onerror = function () {
        reject(new Error("Could not load Zoidium stylesheet: " + url));
      };
      document.head.appendChild(link);
    });
  }

  function loadScript(url, label) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Could not load " + (label || "Zoidium extension") + ": " + url));
      };
      document.head.appendChild(script);
    });
  }

  function readStoredLayout() {
    try {
      var raw = global.localStorage.getItem(SETTINGS_STORAGE_KEY);
      var settings = raw ? JSON.parse(raw) : null;
      return settings && typeof settings.layout === "string" ? settings.layout : null;
    } catch (_error) {
      return null;
    }
  }

  function selectRuntimeProfile() {
    var manifest = global.ZOIDIUM_RUNTIME_PROFILES || {};
    var layouts = manifest.layouts || {};
    var fallback = manifest.defaultLayout || "clipmaker";
    var requested = readStoredLayout() || fallback;
    var layout = layouts[requested] ? requested : fallback;
    var profile = layouts[layout];
    if (!profile || typeof profile.entryScript !== "string") {
      throw new Error("The selected editor layout is missing from the runtime stage");
    }
    return { layout: layout, profile: profile };
  }

  function exposeActiveEditor(layout, profile) {
    var editor = global[profile.editorGlobal];
    if (!editor || typeof editor !== "object") {
      throw new Error("The selected editor layout did not expose its editor instance");
    }

    // Video Editor uses VE while Zoidium and the shared CM3 extensions use CM.
    // Both are PZ.ui.editor instances, so expose the active instance through
    // the established CM name before any extension patch runs.
    global.CM = editor;
    global.ZOIDIUM_EDITOR = editor;
    global.ZOIDIUM_LAYOUT = layout;
    if (global.PZ) {
      var namespace = global.PZ.zoidium;
      if (!namespace || typeof namespace.define !== "function") {
        throw new Error("The Zoidium policy layer is missing: PZ.zoidium.define() is unavailable");
      }
      namespace.define("runtime", {
        editor: editor,
        layout: layout,
      }, "zoidium/runtime-loader");
    }
  }

  function showFailure(error) {
    var message = error && error.message ? error.message : String(error);
    console.error("[Zoidium] extension bootstrap failed:", error);
    var box = document.createElement("pre");
    box.textContent = "Zoidium could not start its CM3 extension layer.\n\n" + message;
    box.style.cssText =
      "position:fixed;z-index:2147483647;inset:16px;padding:16px;overflow:auto;" +
      "background:#221b1b;color:#ffd6d6;font:13px/1.5 monospace;white-space:pre-wrap";
    document.body.appendChild(box);
    global.dispatchEvent(new CustomEvent("zoidium:extension-load-error", { detail: error }));
  }

  // Startup policy: the entry script, the editor exposure, initTool(), and
  // the shared UI kit are fatal — nothing works without them. Overlay
  // stylesheets and every other pre/post-init script are isolated: a failure
  // is recorded, reported through zoidium:extension-script-error, and the
  // remaining scripts still load. zoidium:ready always carries the failure
  // list so the debug log (and agents) can tell a clean boot from a
  // degraded one.
  function isUiKitScript(url) {
    return /(^|\/)ui-kit\.js$/.test(String(url).split(/[?#]/, 1)[0]);
  }

  function reportScriptError(failures, script, phase, error) {
    var message = error && error.message ? error.message : String(error);
    console.error("[Zoidium] failed to load " + phase + " file: " + script, error);
    failures.push({ script: script, phase: phase, message: message });
    try {
      global.dispatchEvent(new CustomEvent("zoidium:extension-script-error", {
        detail: { script: script, phase: phase, message: message },
      }));
    } catch (_dispatchError) {
      // Diagnostics must never prevent the extension layer from starting.
    }
  }

  async function loadIsolated(failures, url, phase) {
    try {
      if (phase === "stylesheet") {
        setDebugPhase("loading overlay stylesheet: " + url);
        await loadStylesheet(resolveAsset(url));
      } else {
        setDebugPhase("loading " + phase + " script: " + url);
        await loadScript(resolveAsset(url), url);
      }
      return true;
    } catch (error) {
      reportScriptError(failures, url, phase, error);
      return false;
    }
  }

  function dispatchReady(failures) {
    var failedScripts = failures.map(function (failure) {
      return { script: failure.script, phase: failure.phase, message: failure.message };
    });
    setDebugPhase(failedScripts.length === 0 ? "ready" : "ready (degraded)");
    global.dispatchEvent(new CustomEvent("zoidium:ready", {
      detail: { degraded: failedScripts.length > 0, failedScripts: failedScripts },
    }));
  }

  async function bootstrap() {
    if (started) return;
    started = true;
    var failures = [];

    try {
      var selected = selectRuntimeProfile();
      global.ZOIDIUM_LAYOUT = selected.layout;
      if (document.documentElement) {
        document.documentElement.dataset.zoidiumLayout = selected.layout;
      }
      await loadScript(
        resolveAsset(selected.profile.entryScript),
        selected.profile.label || "editor layout"
      );
      exposeActiveEditor(selected.layout, selected.profile);

      var overlayStyles = config.overlayStyles || [];
      for (var i = 0; i < overlayStyles.length; i += 1) {
        await loadIsolated(failures, overlayStyles[i], "stylesheet");
      }

      var preInitScripts = config.preInitScripts || [];
      for (var j = 0; j < preInitScripts.length; j += 1) {
        await loadIsolated(failures, preInitScripts[j], "pre-init");
      }

      setDebugPhase("initializing " + (selected.profile.label || "editor"));
      if (typeof global.initTool !== "function") {
        throw new Error("The selected editor runtime did not expose initTool()");
      }
      await global.initTool();

      var postInitScripts = config.postInitScripts || [];
      for (var k = 0; k < postInitScripts.length; k += 1) {
        // The UI kit is required by every later panel: a missing kit would
        // only cascade into follow-up failures, so it stays fatal here.
        if (isUiKitScript(postInitScripts[k])) {
          setDebugPhase("loading post-init script: " + postInitScripts[k]);
          try {
            await loadScript(resolveAsset(postInitScripts[k]), postInitScripts[k]);
          } catch (error) {
            throw new Error("The shared UI kit failed to load; Settings, Restore, and Plugins depend on it: " +
              (error && error.message ? error.message : String(error)));
          }
          continue;
        }
        await loadIsolated(failures, postInitScripts[k], "post-init");
      }

      dispatchReady(failures);
    } catch (error) {
      showFailure(error);
    }
  }

  global.ZOIDIUM_BOOTSTRAP = bootstrap;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(window);
