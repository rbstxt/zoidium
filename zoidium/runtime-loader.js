(function (global) {
  "use strict";

  var SETTINGS_STORAGE_KEY = "zoidium.editor-settings";
  var started = false;
  var config = global.ZOIDIUM_RUNTIME || {};

  function resolveLocal(value) {
    return new URL(value, document.baseURI).href;
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
      global.PZ.zoidium = global.PZ.zoidium || {};
      global.PZ.zoidium.runtime = {
        editor: editor,
        layout: layout,
      };
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

  async function bootstrap() {
    if (started) return;
    started = true;

    try {
      var selected = selectRuntimeProfile();
      global.ZOIDIUM_LAYOUT = selected.layout;
      if (document.documentElement) {
        document.documentElement.dataset.zoidiumLayout = selected.layout;
      }
      await loadScript(
        resolveLocal(selected.profile.entryScript),
        selected.profile.label || "editor layout"
      );
      exposeActiveEditor(selected.layout, selected.profile);

      var overlayStyles = config.overlayStyles || [];
      for (var i = 0; i < overlayStyles.length; i += 1) {
        setDebugPhase("loading overlay stylesheet: " + overlayStyles[i]);
        await loadStylesheet(resolveLocal(overlayStyles[i]));
      }

      var preInitScripts = config.preInitScripts || [];
      for (var j = 0; j < preInitScripts.length; j += 1) {
        setDebugPhase("loading pre-init script: " + preInitScripts[j]);
        await loadScript(resolveLocal(preInitScripts[j]));
      }

      setDebugPhase("initializing " + (selected.profile.label || "editor"));
      if (typeof global.initTool !== "function") {
        throw new Error("The selected editor runtime did not expose initTool()");
      }
      await global.initTool();

      var postInitScripts = config.postInitScripts || [];
      for (var k = 0; k < postInitScripts.length; k += 1) {
        setDebugPhase("loading post-init script: " + postInitScripts[k]);
        await loadScript(resolveLocal(postInitScripts[k]));
      }

      setDebugPhase("ready");
      global.dispatchEvent(new CustomEvent("zoidium:ready"));
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
