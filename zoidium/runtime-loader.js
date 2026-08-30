(function (global) {
  "use strict";

  var started = false;
  var config = global.ZOIDIUM_RUNTIME || {};

  function resolveLocal(value) {
    return new URL(value, document.baseURI).href;
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

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Could not load Zoidium extension: " + url));
      };
      document.head.appendChild(script);
    });
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
      var overlayStyles = config.overlayStyles || [];
      for (var i = 0; i < overlayStyles.length; i += 1) {
        await loadStylesheet(resolveLocal(overlayStyles[i]));
      }

      var preInitScripts = config.preInitScripts || [];
      for (var j = 0; j < preInitScripts.length; j += 1) {
        await loadScript(resolveLocal(preInitScripts[j]));
      }

      if (typeof global.initTool !== "function") {
        throw new Error("CM3 runtime did not expose initTool()");
      }
      await global.initTool();

      var postInitScripts = config.postInitScripts || [];
      for (var k = 0; k < postInitScripts.length; k += 1) {
        await loadScript(resolveLocal(postInitScripts[k]));
      }

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
