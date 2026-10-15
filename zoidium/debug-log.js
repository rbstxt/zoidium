(function installZoidiumDebugLog(global) {
  "use strict";

  if (global.ZOIDIUM_DEBUG_LOG?.version >= 2) return;

  // In the browser the two part files above load first as classic scripts
  // (see zoidium/runtime-config.js) and share their exports through this
  // registry. Node tests load them with require.
  var parts = global.__zoidiumDebugParts || (global.__zoidiumDebugParts = {});
  if (typeof module === "object" && module.exports) {
    parts.journal = require("./debug-journal.js");
    parts.crash = require("./debug-crash.js");
    global.__zoidiumDebugParts = parts;
  }
  var journal = parts.journal;
  var crash = parts.crash;
  if (!journal || !crash) {
    throw new Error("[Zoidium] debug-journal.js and debug-crash.js must load before debug-log.js.");
  }
  var redact = journal.redact;
  var truncate = journal.truncate;
  var record = journal.record;
  var recordException = journal.recordException;
  var flushJournal = journal.flushJournal;
  var closeCurrentSession = journal.closeCurrentSession;
  var resumeCurrentSession = journal.resumeCurrentSession;
  var initializeJournal = journal.initializeJournal;
  var getSession = journal.getSession;
  var liveEvents = journal.liveEvents;
  var getPhase = journal.getPhase;
  var setPhaseValue = journal.setPhaseValue;
  var errorDetails = journal.errorDetails;
  var mainWindowContext = crash.mainWindowContext;
  var installWindowHooks = crash.installWindowHooks;
  var checkpointDiagnostics = crash.checkpointDiagnostics;
  var sampleHealth = crash.sampleHealth;
  var installLongTaskObserver = crash.installLongTaskObserver;
  var collectRuntime = crash.collectRuntime;
  var collectEnvironment = crash.collectEnvironment;
  var collectPlugins = crash.collectPlugins;
  var collectWindows = crash.collectWindows;
  var previousSessions = crash.previousSessions;
  var safeStoredEvent = crash.safeStoredEvent;
  var exceptionEvents = crash.exceptionEvents;
  var analyzeCrash = crash.analyzeCrash;
  var HEALTH_SAMPLE_INTERVAL_MS = crash.HEALTH_SAMPLE_INTERVAL_MS;

  var PZ = (global.PZ = global.PZ || {});
  PZ.zoidium = PZ.zoidium || {};
  let contextLossNotified = false;

  const COPY = {
    en: {
      section: "Debug information",
      description:
        "Saves your OS, browser, enabled plugins, and recent crash evidence for a bug report. Crash data survives a reload. Project content is not included; review before sharing. Desktop users can use the Debug menu if this panel is unavailable.",
      button: "Download debug log",
      success: "Debug log downloaded",
      failure: "Debug log download failed",
    },
  };

  function copy() {
    return COPY.en;
  }

  const SUPPORT_URL = "https://discord.gg/PWAmY9m5bu";
  let emergencyBanner = null;
  let emergencyMountQueued = false;

  function mountEmergencyControls(source, error) {
    const documentObject = global.document;
    if (!documentObject?.createElement) return;
    const mount = () => {
      if (
        emergencyBanner ||
        !documentObject.body ||
        documentObject.querySelector?.("[data-zoidium-bootstrap-error]")
      ) return;

      const banner = documentObject.createElement("section");
      banner.className = "zoidium-debug-emergency";
      banner.setAttribute("role", "alert");
      banner.style.cssText =
        "position:fixed;z-index:2147483646;right:16px;bottom:16px;max-width:520px;" +
        "padding:12px 14px;background:#231d1d;color:#f4dddd;border:1px solid #a94b4b;" +
        "border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,.45);font:13px/1.45 sans-serif";

      const title = documentObject.createElement("strong");
      title.textContent = "Zoidium recorded an error";
      title.style.display = "block";
      title.style.marginBottom = "4px";
      banner.appendChild(title);

      const message = documentObject.createElement("div");
      const details = errorDetails(error);
      message.textContent = truncate(
        details.message + " (" + source + "). Download the log and attach it to the report.",
        500,
      );
      banner.appendChild(message);

      // Point to the rescue tool for unsaved work, and to Discord for the
      // bug report the log belongs to.
      const help = documentObject.createElement("div");
      help.style.cssText = "margin-top:6px";
      [
        ["If your project can't be saved, ", null],
        ["try the rescue tool", ["/about/rescue", "opener"]],
        [". ", null],
        ["Report the bug on Discord", [SUPPORT_URL, "noopener noreferrer"]],
        [".", null],
      ].forEach(([text, target]) => {
        const part = documentObject.createElement(target ? "a" : "span");
        part.textContent = text;
        if (target) {
          part.href = target[0];
          part.target = "_blank";
          part.rel = target[1];
          part.style.color = "#ffd0d0";
        }
        help.appendChild(part);
      });
      banner.appendChild(help);

      const actions = documentObject.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;margin-top:10px";
      // The banner must work when the rest of the UI failed, so the shared
      // button builder is used only when it is available; otherwise plain
      // markup with the same labels and behavior.
      function emergencyButton(label, onClick) {
        const kit = global.ZoidiumUI;
        if (kit && typeof kit.createButton === "function") {
          try {
            return kit.createButton({ title: label, onClick });
          } catch (_error) { /* fall through to plain markup */ }
        }
        const fallback = documentObject.createElement("button");
        fallback.type = "button";
        fallback.textContent = label;
        fallback.style.cssText =
          "padding:6px 9px;background:#3a2b2b;color:#ffe4e4;border:1px solid #dca8a8;" +
          "border-radius:3px;cursor:pointer;font:inherit";
        fallback.addEventListener("click", onClick);
        return fallback;
      }
      const downloadButton = emergencyButton(copy().button, async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = "Preparing debug log...";
        try {
          await download();
          downloadButton.textContent = copy().success;
        } catch (downloadError) {
          recordException("debug log download", downloadError);
          downloadButton.disabled = false;
          downloadButton.textContent = copy().failure;
        }
      });
      actions.appendChild(downloadButton);

      const dismissButton = emergencyButton("Dismiss", () => {
        banner.remove();
        emergencyBanner = null;
      });
      actions.appendChild(dismissButton);
      banner.appendChild(actions);
      documentObject.body.appendChild(banner);
      emergencyBanner = banner;
    };

    if (documentObject.body) {
      mount();
    } else if (!emergencyMountQueued && documentObject.addEventListener) {
      emergencyMountQueued = true;
      documentObject.addEventListener("DOMContentLoaded", mount, { once: true });
    }
  }

  function snapshot() {
    const phase = getPhase();
    const startedAt = journal.startedAt;
    const persistenceAvailable = journal.isPersistenceAvailable();
    const persistenceError = journal.getPersistenceError();
    const currentSession = getSession();
    const events = liveEvents();
    checkpointDiagnostics("debug-log-snapshot");
    const runtime = collectRuntime();
    const environment = collectEnvironment();
    const plugins = collectPlugins();
    const windows = collectWindows();
    const allEvents = events.map((event) => ({ ...event }));
    const retainedSessions = previousSessions();
    const currentExceptions = (currentSession?.exceptions || [])
      .map(safeStoredEvent)
      .filter(Boolean)
      .map((event) => ({ sessionId: currentSession?.id || null, ...event }));
    const retainedExceptions = retainedSessions.flatMap((session) =>
      exceptionEvents(session).map((event) => ({
        sessionId: session.id,
        sessionStatus: session.status,
        ...event,
      }))
    );
    return {
      schemaVersion: 2,
      product: "Zoidium debug log",
      generatedAt: new Date().toISOString(),
      session: {
        id: currentSession?.id || null,
        startedAt,
        phase,
        persistence: {
          available: persistenceAvailable,
          localStorage: persistenceAvailable,
          ...(persistenceError ? { error: persistenceError } : {}),
        },
      },
      runtime,
      environment,
      plugins,
      windows,
      crashAnalysis: analyzeCrash(retainedSessions),
      previousSessions: retainedSessions,
      exceptions: [...retainedExceptions, ...currentExceptions],
      events: allEvents,
    };
  }

  parts.ui = { mountEmergencyControls: mountEmergencyControls };

  async function download() {
    const payload = `${JSON.stringify(snapshot(), null, 2)}\n`;
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = global.URL.createObjectURL(blob);
    const link = global.document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `zoidium-debug-${stamp}.json`;
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    global.document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    record("download", { filename, bytes: payload.length });
    return { filename, bytes: payload.length };
  }

  function setButtonLabel(button, value, state) {
    const label = button.querySelector("span") || button;
    label.textContent = value;
    if (state) button.dataset.state = state;
    if (button.__zoidiumResetTimer) global.clearTimeout(button.__zoidiumResetTimer);
    button.__zoidiumResetTimer = global.setTimeout(() => {
      const current = copy();
      label.textContent = current.button;
      button.dataset.state = "ready";
    }, 4000);
  }

  function createControls(panel) {
    if (!panel?.appendChild || panel.querySelector?.("[data-zoidium-debug-log]")) return false;
    const legacy = PZ.ui?.controls?.legacy;
    if (!legacy?.generateDescription || !legacy?.generateButton) return false;
    const currentCopy = copy();
    const block = global.document.createElement("section");
    block.className = "zoidium-debug-log";
    block.dataset.zoidiumDebugLog = "true";
    block.setAttribute("aria-label", currentCopy.section);

    const title = legacy.generateTitle
      ? legacy.generateTitle({ title: currentCopy.section })
      : global.ZoidiumUI.createPageHeader(currentCopy.section);
    title.classList.add("zoidium-debug-log-title");

    const description = legacy.generateDescription({ content: "" });
    description.classList.add("zoidium-debug-log-description");
    const descriptionText = description.querySelector("span");
    if (descriptionText) descriptionText.textContent = currentCopy.description;

    const button = legacy.generateButton({ title: currentCopy.button, clickfn() {} });
    button.type = "button";
    button.style.cursor = "pointer";
    button.classList.add("zoidium-debug-log-button");
    button.dataset.state = "ready";
    button.setAttribute("aria-label", currentCopy.button);
    button.setAttribute("aria-describedby", "zoidium-debug-log-description");
    button.title = currentCopy.button;
    description.id = "zoidium-debug-log-description";
    button.onclick = async function () {
      try {
        await download();
        setButtonLabel(button, copy().success, "success");
      } catch (error) {
        recordException("debug log download", error);
        setButtonLabel(button, copy().failure, "failure");
      }
    };

    block.append(title, description);
    if (legacy.generateSpacer) block.appendChild(legacy.generateSpacer());
    block.appendChild(button);
    panel.appendChild(block);
    return true;
  }

  function installEventListeners() {
    installWindowHooks(mainWindowContext);
    global.addEventListener("pagehide", (event) => {
      var pageSession = getSession();
      if (event?.persisted && pageSession) {
        pageSession.status = "suspended";
        pageSession.exitReason = "back-forward-cache";
        pageSession.endedAt = new Date().toISOString();
        flushJournal();
        return;
      }
      closeCurrentSession("pagehide");
    });
    global.addEventListener("pageshow", (event) => {
      if (event?.persisted) resumeCurrentSession();
    });
    global.document?.addEventListener("visibilitychange", () => {
      // A hidden tab can be discarded without pagehide: persist pending events.
      if (global.document.visibilityState === "hidden") flushJournal();
      sampleHealth();
    });
    global.document?.addEventListener("webglcontextlost", (event) => {
      var lostSession = getSession();
      if (lostSession?.health) lostSession.health.webglContextLosses += 1;
      record("webgl-context-lost", {
        statusMessage: redact(event?.statusMessage || ""),
      });
      if (!contextLossNotified) {
        contextLossNotified = true;
        const detail = {
          title: "Graphics context lost",
          message: "The preview may stop responding. Save your project, then reload the editor to restore graphics.",
        };
        try {
          if (global.ZoidiumUI?.notify) global.ZoidiumUI.notify(detail);
          else global.dispatchEvent(new CustomEvent("zoidium:notification", { detail }));
        } catch (_error) { /* Diagnostics must not interrupt the editor. */ }
      }
    }, true);
    global.document?.addEventListener("webglcontextrestored", () => {
      var restoredSession = getSession();
      if (restoredSession?.health) restoredSession.health.webglContextRestores += 1;
      record("webgl-context-restored");
    }, true);
    global.addEventListener("zoidium:extension-load-error", (event) => {
      setPhaseValue("bootstrap-error");
      recordException("extension bootstrap", event?.detail);
    });
    global.addEventListener("zoidium:extension-script-error", (event) => {
      const detail = event?.detail || {};
      record("script-error", {
        script: redact(detail.script),
        phase: redact(detail.phase),
        message: redact(detail.message),
      });
      if (/^(?:pre-init|post-init)$/.test(String(detail.phase || ""))) {
        try {
          mountEmergencyControls(
            "extension script",
            new Error(detail.message || "A Zoidium extension script failed to load."),
          );
        } catch (_mountError) {
          // The emergency UI is optional.
        }
      }
    });
    global.addEventListener("zoidium:ready", (event) => {
      const failedScripts = event?.detail?.failedScripts || [];
      setPhaseValue(failedScripts.length === 0 ? "ready" : "ready-degraded");
      record("lifecycle", {
        message: failedScripts.length === 0
          ? "Zoidium extension ready"
          : "Zoidium extension ready with " + failedScripts.length + " failed scripts",
        degraded: failedScripts.length > 0,
        failedScriptCount: failedScripts.length,
      });
      checkpointDiagnostics("zoidium-ready");
    });
    global.document?.addEventListener("zoidium:plugin-state-change", (event) => {
      const detail = event?.detail || {};
      record("plugin-state", {
        pluginId: redact(detail.pluginId),
        enabled: Boolean(detail.enabled),
        featureCount: Number.isFinite(detail.effectCount) ? detail.effectCount : null,
      });
      checkpointDiagnostics("plugin-state-change");
    });
    global.document?.addEventListener("zoidium:plugin-usage-progress", (event) => {
      const detail = event?.detail || {};
      record("plugin-usage-progress", {
        pluginId: redact(detail.pluginId),
        pluginName: redact(detail.pluginName),
        kind: redact(detail.kind),
        itemId: redact(detail.itemId),
        itemName: redact(detail.itemName),
        count: Number.isFinite(detail.count) ? detail.count : null,
      });
    });
    global.document?.addEventListener("zoidium:project-load-start", (event) => {
      const detail = event?.detail || {};
      record("project-load-start", {
        pluginCount: Number.isFinite(detail.pluginCount) ? detail.pluginCount : null,
        pluginIds: Array.isArray(detail.pluginIds)
          ? detail.pluginIds.slice(0, 100).map((pluginId) => redact(pluginId))
          : [],
        pluginVersions: Array.isArray(detail.pluginVersions)
          ? detail.pluginVersions.slice(0, 100).map((version) => redact(version))
          : [],
      });
    });
    global.document?.addEventListener("zoidium:project-load-complete", (event) => {
      const detail = event?.detail || {};
      record("project-load-complete", {
        pluginCount: Number.isFinite(detail.pluginCount) ? detail.pluginCount : null,
        pluginIds: Array.isArray(detail.pluginIds)
          ? detail.pluginIds.slice(0, 100).map((pluginId) => redact(pluginId))
          : [],
      });
      checkpointDiagnostics("project-load-complete");
      global.setTimeout(() => checkpointDiagnostics("project-load-settled"), 1000);
    });
    global.document?.addEventListener("zoidium:project-load-error", (event) => {
      const detail = event?.detail || {};
      recordException("project load", detail.error, {
        pluginCount: Number.isFinite(detail.pluginCount) ? detail.pluginCount : null,
        pluginIds: Array.isArray(detail.pluginIds)
          ? detail.pluginIds.slice(0, 100).map((pluginId) => redact(pluginId))
          : [],
      });
      checkpointDiagnostics("project-load-error");
    });
    global.document?.addEventListener("zoidium:project-plugin-activation-error", (event) => {
      const detail = event?.detail || {};
      recordException("project plugin activation", detail.error, {
        pluginIds: Array.isArray(detail.pluginIds)
          ? detail.pluginIds.slice(0, 100).map((pluginId) => redact(pluginId))
          : [],
      });
      checkpointDiagnostics("project-plugin-activation-error");
    });
    global.addEventListener("zoidium:project-opened", (event) => {
      const detail = event?.detail || {};
      record("project-opened", {
        filename: redact(detail.filename),
        size: Number.isFinite(detail.size) ? detail.size : null,
        type: redact(detail.type),
        lastModified: Number.isFinite(detail.lastModified) ? detail.lastModified : null,
      });
      checkpointDiagnostics("project-opened");
    });
    global.addEventListener("zoidium:project-error", (event) => {
      const detail = event?.detail || {};
      if (detail.error) {
        recordException("project operation", detail.error, {
          filename: redact(detail.filename),
          size: Number.isFinite(detail.size) ? detail.size : null,
          type: redact(detail.type),
        });
      } else {
        record("project-error", {
          message: redact(detail.message),
          filename: redact(detail.filename),
          size: Number.isFinite(detail.size) ? detail.size : null,
        });
      }
    });
    sampleHealth();
    global.setInterval(sampleHealth, HEALTH_SAMPLE_INTERVAL_MS);
    installLongTaskObserver();
  }

  const api = Object.freeze({
    version: 2,
    record,
    recordException,
    setPhase(nextPhase) {
      var value = redact(nextPhase || "unknown");
      setPhaseValue(value);
      record("phase", { name: value });
    },
    getSnapshot: snapshot,
    download,
    createControls,
  });

  global.ZOIDIUM_DEBUG_LOG = api;
  PZ.zoidium.define("debugLog", api, "zoidium/debug-log");
  initializeJournal();
  installEventListeners();
})(window);

