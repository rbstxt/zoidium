// Zoidium crash capture (split from debug-log.js).
// Window/error tracking, environment and plugin evidence, health sampling and
// crash analysis. Loads after debug-journal.js; the export and UI entry
// (debug-log.js) loads last.
(function installZoidiumDebugCrash(global) {
  "use strict";

  var parts = global.__zoidiumDebugParts || (global.__zoidiumDebugParts = {});
  if (parts.crash) return;
  var journal = parts.journal;
  if (!journal) {
    throw new Error("[Zoidium] debug-journal.js must load before debug-crash.js.");
  }
  var text = journal.text;
  var truncate = journal.truncate;
  var redact = journal.redact;
  var primitive = journal.primitive;
  var errorDetails = journal.errorDetails;
  var isErrorLike = journal.isErrorLike;
  var consoleArgument = journal.consoleArgument;
  var safeRecordDetails = journal.safeRecordDetails;
  var record = journal.record;
  var recordException = journal.recordException;
  var scheduleJournalWrite = journal.scheduleJournalWrite;
  var MAX_PERSISTED_EVENTS = journal.MAX_PERSISTED_EVENTS;
  var MAX_PERSISTED_EXCEPTIONS = journal.MAX_PERSISTED_EXCEPTIONS;
  var MAX_PERSISTED_SESSIONS = journal.MAX_PERSISTED_SESSIONS;

  const HEALTH_SAMPLE_INTERVAL_MS = 10000;
  const LONG_TASK_WARNING_MS = 1000;
  const PZ = (global.PZ = global.PZ || {});
  PZ.zoidium = PZ.zoidium || {};

  const childWindows = [];
  const windowContexts = new WeakMap();
  const consoleHooks = new WeakMap();
  const windowOpenHooks = new WeakSet();

  let longTaskObserver = null;
  let childWindowSequence = 0;

  let webglInfo = null;

  function classifyWindowUrl(value) {
    const raw = text(value).trim();
    if (!raw) return "unknown";
    if (/^about:blank(?:[?#].*)?$/i.test(raw)) return "about:blank";
    try {
      const parsed = new URL(raw, global.location?.href);
      if (parsed.protocol === "about:") return "about";
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin === text(global.location?.origin) ? "same-origin" : "cross-origin";
      }
      return `${parsed.protocol.replace(/:$/, "")}:redacted`;
    } catch (_error) {
      return "unparseable";
    }
  }

  const mainWindowContext = {
    id: "main",
    kind: "main",
    window: global,
    openedAt: journal.startedAt,
    requestedUrl: "same-origin",
    currentUrl: "same-origin",
    sameOrigin: true,
    listenersInstalled: false,
  };
  windowContexts.set(global, mainWindowContext);

  function currentWindowUrl(context) {
    if (!context?.window) return context?.currentUrl || "unknown";
    try {
      const value = classifyWindowUrl(context.window.location?.href);
      context.currentUrl = value;
      if (value === "cross-origin") context.sameOrigin = false;
      else if (value === "same-origin" || value === "about:blank") context.sameOrigin = true;
      return value;
    } catch (_error) {
      context.currentUrl = "cross-origin";
      context.sameOrigin = false;
      return context.currentUrl;
    }
  }

  function windowDetails(context) {
    if (!context) return {};
    const details = {
      windowId: context.id,
      windowKind: context.kind,
    };
    if (context.kind === "popup") details.windowUrl = currentWindowUrl(context);
    return details;
  }

  function recordConsole(level, args, context = mainWindowContext) {
    const values = Array.from(args || []);
    const error = values.find(isErrorLike);
    const details = error ? errorDetails(error) : {};
    record("console", {
      level,
      message: redact(values.map(consoleArgument).join(" ")) || `[console.${level}]`,
      ...(details.stack ? { stack: details.stack } : {}),
      ...windowDetails(context),
    });
  }

  function installConsoleHook(name, targetWindow = global, context = mainWindowContext) {
    let consoleObject;
    try {
      consoleObject = targetWindow?.console;
    } catch (_error) {
      return;
    }
    const original = consoleObject?.[name];
    if (typeof original !== "function") return;
    let hookedNames = consoleHooks.get(consoleObject);
    if (!hookedNames) {
      hookedNames = new Set();
      consoleHooks.set(consoleObject, hookedNames);
    }
    if (hookedNames.has(name)) return;
    const wrapped = function (...args) {
      recordConsole(name, args, context);
      return original.apply(this, args);
    };
    try {
      consoleObject[name] = wrapped;
      hookedNames.add(name);
    } catch (_error) {
      // Some embedded runtimes expose a read-only console.
    }
  }

  function installWindowErrorListeners(context) {
    const targetWindow = context?.window;
    if (!targetWindow?.addEventListener || context.listenersInstalled) return;

    const handleError = (event) => {
      const details = {
        ...windowDetails(context),
        filename: redact(event?.filename),
        line: Number.isFinite(event?.lineno) ? event.lineno : null,
        column: Number.isFinite(event?.colno) ? event.colno : null,
      };
      if (event?.error) {
        recordException("window.error", event.error, details);
      } else {
        record("exception", {
          source: "window.error",
          name: "ErrorEvent",
          message: redact(event?.message || "Unknown window error"),
          ...details,
        });
      }
    };

    try {
      targetWindow.addEventListener("error", handleError, true);
      targetWindow.addEventListener(
        "unhandledrejection",
        (event) => recordException("unhandledrejection", event?.reason, windowDetails(context)),
      );
      targetWindow.addEventListener("load", () => {
        currentWindowUrl(context);
        installConsoleHook("error", targetWindow, context);
        installConsoleHook("warn", targetWindow, context);
        installWindowOpenHook(context);
        if (context.kind === "popup") {
          record("window-load", windowDetails(context));
        }
      });
      context.listenersInstalled = true;
    } catch (error) {
      recordException("debug window listener", error, windowDetails(context));
    }
  }

  function installWindowOpenHook(context) {
    const targetWindow = context?.window;
    if (!targetWindow || windowOpenHooks.has(targetWindow)) return;

    let originalOpen;
    try {
      originalOpen = targetWindow.open;
    } catch (_error) {
      return;
    }
    if (typeof originalOpen !== "function") return;

    const wrapped = function (...args) {
      let childWindow;
      try {
        childWindow = originalOpen.apply(this, args);
      } catch (error) {
        recordException("window.open", error, windowDetails(context));
        throw error;
      }
      if (childWindow && childWindow !== global && childWindow !== targetWindow) {
        registerChildWindow(childWindow, args[0], context);
      }
      return childWindow;
    };

    try {
      targetWindow.open = wrapped;
      if (targetWindow.open === wrapped) windowOpenHooks.add(targetWindow);
    } catch (_error) {
      // Some embedded runtimes expose a read-only window.open.
    }
  }

  function installWindowHooks(context) {
    installWindowErrorListeners(context);
    installConsoleHook("error", context.window, context);
    installConsoleHook("warn", context.window, context);
    installWindowOpenHook(context);
  }

  function registerChildWindow(targetWindow, requestedUrl, openerContext = mainWindowContext) {
    if (
      !targetWindow ||
      (typeof targetWindow !== "object" && typeof targetWindow !== "function") ||
      targetWindow === global
    ) {
      return null;
    }

    const requested = classifyWindowUrl(requestedUrl || "about:blank");
    let context = windowContexts.get(targetWindow);
    const reused = Boolean(context);
    if (!context) {
      const reference = new WeakRef(targetWindow);
      context = {
        id: `popup-${++childWindowSequence}`,
        kind: "popup",
        get window() { return reference.deref(); },
        openedAt: new Date().toISOString(),
        requestedUrl: requested,
        currentUrl: requested,
        sameOrigin: null,
        listenersInstalled: false,
        openerId: openerContext?.id || "main",
        closedAt: null,
      };
      windowContexts.set(targetWindow, context);
      childWindows.push(context);
      // Retain a bounded diagnostic history without retaining popup heaps.
      if (childWindows.length > 50) childWindows.splice(0, childWindows.length - 50);
      installWindowHooks(context);
    }

    context.lastRequestedUrl = requested;
    currentWindowUrl(context);
    record("window-opened", {
      ...windowDetails(context),
      requestedUrl: requested,
      reused,
      openerId: openerContext?.id || "main",
    });
    return context;
  }

  function matchVersion(userAgent, pattern) {
    const match = text(userAgent).match(pattern);
    return match?.[1] || null;
  }

  function detectBrowser(userAgent) {
    const candidates = [
      ["Microsoft Edge", /\b(?:Edg|EdgA|EdgiOS)\/([\d.]+)/i],
      ["Opera", /\b(?:OPR|Opera)\/([\d.]+)/i],
      ["Firefox", /\b(?:Firefox|FxiOS)\/([\d.]+)/i],
      ["Google Chrome", /\b(?:Chrome|CriOS)\/([\d.]+)/i],
      ["Chromium", /\bChromium\/([\d.]+)/i],
      ["Safari", /\bVersion\/([\d.]+).*\bSafari\//i],
    ];
    for (const [name, pattern] of candidates) {
      const version = matchVersion(userAgent, pattern);
      if (version) return { name, version };
    }
    return { name: "Unknown", version: null };
  }

  function detectOs(userAgent, platform) {
    const source = text(userAgent);
    if (/CrOS/i.test(source)) return { name: "ChromeOS", version: null };
    if (/Android/i.test(source)) {
      return { name: "Android", version: matchVersion(source, /Android\s([\d.]+)/i) };
    }
    if (/iPhone|iPad|iPod/i.test(source)) {
      return {
        name: "iOS",
        version: matchVersion(source, /(?:OS|CPU(?: iPhone)? OS)\s([\d_]+)/i)?.replace(/_/g, ".") || null,
      };
    }
    if (/Windows/i.test(source)) return { name: "Windows", version: null };
    if (/Mac OS X/i.test(source)) {
      return {
        name: "macOS",
        version: matchVersion(source, /Mac OS X\s([\d_\.]+)/i)?.replace(/_/g, ".") || null,
      };
    }
    if (/Linux/i.test(source) || /Linux/i.test(text(platform))) return { name: "Linux", version: null };
    return { name: text(platform, "Unknown"), version: null };
  }

  function collectUserAgentData(navigatorObject) {
    const data = navigatorObject?.userAgentData;
    if (!data) return null;
    try {
      return {
        platform: primitive(data.platform),
        mobile: Boolean(data.mobile),
        brands: Array.isArray(data.brands)
          ? data.brands.slice(0, 12).map((brand) => ({
              brand: redact(brand?.brand),
              version: redact(brand?.version),
            }))
          : [],
      };
    } catch (_error) {
      return null;
    }
  }

  function collectWebgl() {
    if (webglInfo) return { ...webglInfo };
    const documentObject = global.document;
    if (!documentObject?.createElement) return { supported: false };
    let context = null;
    try {
      const canvas = documentObject.createElement("canvas");
      context = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!context) return { supported: false };
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      const info = {
        supported: true,
        api:
          typeof global.WebGL2RenderingContext === "function" &&
          context instanceof global.WebGL2RenderingContext
            ? "WebGL2"
            : "WebGL",
      };
      if (debugInfo) {
        info.vendor = redact(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        info.renderer = redact(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      }
      webglInfo = info;
      return { ...info };
    } catch (_error) {
      return { supported: false };
    } finally {
      // Diagnostic probes own their contexts. Leaving one alive per snapshot
      // can exhaust the browser's context limit and evict the editor's GPU.
      try { context?.getExtension("WEBGL_lose_context")?.loseContext(); } catch (_error) {}
    }
  }

  function collectEnvironment() {
    const navigatorObject = global.navigator || {};
    const userAgent = text(navigatorObject.userAgent, "Unknown");
    const screenObject = global.screen || {};
    return {
      os: detectOs(userAgent, navigatorObject.platform),
      browser: detectBrowser(userAgent),
      userAgent: redact(userAgent),
      userAgentData: collectUserAgentData(navigatorObject),
      platform: primitive(navigatorObject.platform),
      language: primitive(navigatorObject.language),
      hardwareConcurrency: Number.isFinite(navigatorObject.hardwareConcurrency)
        ? navigatorObject.hardwareConcurrency
        : null,
      deviceMemory: Number.isFinite(navigatorObject.deviceMemory) ? navigatorObject.deviceMemory : null,
      maxTouchPoints: Number.isFinite(navigatorObject.maxTouchPoints)
        ? navigatorObject.maxTouchPoints
        : null,
      screen: {
        width: Number.isFinite(screenObject.width) ? screenObject.width : null,
        height: Number.isFinite(screenObject.height) ? screenObject.height : null,
        pixelRatio: Number.isFinite(global.devicePixelRatio) ? global.devicePixelRatio : null,
      },
      viewport: {
        width: Number.isFinite(global.innerWidth) ? global.innerWidth : null,
        height: Number.isFinite(global.innerHeight) ? global.innerHeight : null,
      },
      webgl: collectWebgl(),
    };
  }

  function safePluginError(value) {
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const key of ["operation", "at", "name", "message", "stack", "code"]) {
      if (value[key] == null) continue;
      result[key] = primitive(value[key]);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function safePlugin(value) {
    if (!value || typeof value !== "object") return null;
    const result = {
      id: redact(value.id),
      name: redact(value.name),
      version: redact(value.version),
      enabled: Boolean(value.enabled),
      phase: redact(value.phase),
      kind: value.kind == null ? null : redact(value.kind),
      visibility: value.visibility == null ? null : redact(value.visibility),
      hidden: Boolean(value.hidden),
      persistedEnabled: Boolean(value.persistedEnabled),
      featureCount: Number.isFinite(value.featureCount) ? value.featureCount : null,
    };
    const lastError = safePluginError(value.lastError);
    if (lastError) result.lastError = lastError;
    return result;
  }

  function safeProjectPlugin(value) {
    if (!value || typeof value !== "object") return null;
    const result = {
      id: redact(value.id),
      name: redact(value.name),
      version: redact(value.version),
      effects: Array.isArray(value.effects) ? value.effects.slice(0, 100).map((item) => redact(item)) : [],
      materials: Array.isArray(value.materials)
        ? value.materials.slice(0, 100).map((item) => redact(item))
        : [],
      objects: Array.isArray(value.objects) ? value.objects.slice(0, 100).map((item) => redact(item)) : [],
      sprites: Array.isArray(value.sprites) ? value.sprites.slice(0, 100).map((item) => redact(item)) : [],
      features: Array.isArray(value.features)
        ? value.features.slice(0, 100).map((item) => redact(item))
        : [],
    };
    return result;
  }

  function collectPlugins() {
    let installed = [];
    try {
      const provider = PZ.zoidium?.getDebugPlugins;
      if (typeof provider === "function") installed = provider() || [];
    } catch (error) {
      recordException("plugin state collection", error);
    }

    const safeInstalled = Array.isArray(installed) ? installed.map(safePlugin).filter(Boolean) : [];
    let project = null;
    try {
      const descriptors = global.CM?.project?._zoidiumProjectPlugins;
      project = Array.isArray(descriptors)
        ? descriptors.map(safeProjectPlugin).filter(Boolean)
        : null;
    } catch (error) {
      recordException("project plugin collection", error);
    }
    return {
      enabled: safeInstalled.filter((plugin) => plugin.enabled),
      installed: safeInstalled,
      project,
    };
  }

  function safeProjectUsage(value) {
    if (!value || typeof value !== "object") {
      return { totalInstances: 0, missingInstances: 0, items: [] };
    }
    const items = Array.isArray(value.items)
      ? value.items.slice(0, 200).map((item) => ({
          pluginId: redact(item?.pluginId),
          pluginName: redact(item?.pluginName),
          kind: redact(item?.kind),
          itemId: redact(item?.itemId),
          itemName: redact(item?.itemName),
          count: Number.isFinite(item?.count) ? item.count : 0,
          missingCount: Number.isFinite(item?.missingCount) ? item.missingCount : 0,
        }))
      : [];
    return {
      totalInstances: Number.isFinite(value.totalInstances)
        ? value.totalInstances
        : items.reduce((total, item) => total + item.count, 0),
      missingInstances: Number.isFinite(value.missingInstances)
        ? value.missingInstances
        : items.reduce((total, item) => total + item.missingCount, 0),
      items,
    };
  }

  function collectProjectUsage() {
    try {
      const provider = PZ.zoidium?.getDebugProjectUsage;
      return typeof provider === "function"
        ? safeProjectUsage(provider())
        : { totalInstances: 0, missingInstances: 0, items: [] };
    } catch (error) {
      recordException("project usage collection", error);
      return { totalInstances: 0, missingInstances: 0, items: [] };
    }
  }

  function checkpointDiagnostics(reason) {
    var currentSession = journal.getSession();
    if (!currentSession) return null;
    const diagnostics = {
      capturedAt: new Date().toISOString(),
      reason: redact(reason || "checkpoint"),
      runtime: collectRuntime(),
      plugins: collectPlugins(),
      projectUsage: collectProjectUsage(),
    };
    currentSession.diagnostics = diagnostics;
    scheduleJournalWrite();
    return diagnostics;
  }

  function sampleHealth() {
    var currentSession = journal.getSession();
    if (!currentSession?.health) return;
    const health = currentSession.health;
    const memory = global.performance?.memory;
    const usedHeap = Number.isFinite(memory?.usedJSHeapSize) ? memory.usedJSHeapSize : null;
    const heapLimit = Number.isFinite(memory?.jsHeapSizeLimit) ? memory.jsHeapSizeLimit : null;
    const heapRatio = usedHeap != null && heapLimit > 0 ? usedHeap / heapLimit : null;
    const sample = {
      at: new Date().toISOString(),
      visibility: redact(global.document?.visibilityState || "unknown"),
      usedJsHeapBytes: usedHeap,
      totalJsHeapBytes: Number.isFinite(memory?.totalJSHeapSize) ? memory.totalJSHeapSize : null,
      jsHeapLimitBytes: heapLimit,
      heapRatio: heapRatio == null ? null : Math.round(heapRatio * 10000) / 10000,
    };
    health.samples += 1;
    health.lastSample = sample;
    if (usedHeap != null) {
      health.maxHeapUsed = Math.max(health.maxHeapUsed || 0, usedHeap);
    }
    if (heapRatio != null) {
      health.maxHeapRatio = Math.max(health.maxHeapRatio || 0, sample.heapRatio);
    }
    if (health.samples % 3 === 0) checkpointDiagnostics("periodic-health-sample");
    scheduleJournalWrite();
  }

  function installLongTaskObserver() {
    var currentSession = journal.getSession();
    if (typeof global.PerformanceObserver !== "function" || !currentSession?.health) return;
    try {
      longTaskObserver = new global.PerformanceObserver((list) => {
        const longTasks = currentSession.health.longTasks;
        for (const entry of list.getEntries()) {
          const duration = Number.isFinite(entry?.duration) ? Math.round(entry.duration) : 0;
          longTasks.count += 1;
          longTasks.totalDurationMs += duration;
          longTasks.maxDurationMs = Math.max(longTasks.maxDurationMs, duration);
          longTasks.lastAt = new Date().toISOString();
          if (duration >= LONG_TASK_WARNING_MS) {
            record("long-task", { durationMs: duration });
          }
        }
        scheduleJournalWrite();
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch (_error) {
      longTaskObserver = null;
    }
  }

  function readCm3Version(kind) {
    try {
      if (kind === "tool" && typeof PZTOOLVERSION !== "undefined") return PZTOOLVERSION;
      if (kind === "core" && typeof PZVERSION !== "undefined") return PZVERSION;
    } catch (_error) {
      // Older builds may not expose these global bindings.
    }
    return kind === "tool" ? global.PZTOOLVERSION : global.PZVERSION;
  }

  function collectRuntime() {
    const config = global.ZOIDIUM_RUNTIME || {};
    return {
      mode: "Browser",
      zoidiumVersion: redact(config.version || "unknown"),
      cm3: {
        toolVersion: primitive(readCm3Version("tool")),
        coreVersion: primitive(readCm3Version("core")),
      },
      policy: {
        account: redact(config.policy?.account || "unknown"),
        ads: redact(config.policy?.ads || "unknown"),
        community: redact(config.policy?.community || "unknown"),
      },
      extensionFiles: {
        overlayStyles: Array.isArray(config.overlayStyles)
          ? config.overlayStyles.slice(0, 100).map((item) => redact(item))
          : [],
        preInitScripts: Array.isArray(config.preInitScripts)
          ? config.preInitScripts.slice(0, 100).map((item) => redact(item))
          : [],
        postInitScripts: Array.isArray(config.postInitScripts)
          ? config.postInitScripts.slice(0, 100).map((item) => redact(item))
          : [],
      },
      origin: text(global.location?.origin, "unknown"),
    };
  }

  function collectWindows() {
    return childWindows.map((context) => {
      let closed = false;
      try {
        closed = !context.window || Boolean(context.window.closed);
      } catch (_error) {
        closed = false;
      }
      if (closed && !context.closedAt) context.closedAt = new Date().toISOString();
      return {
        id: context.id,
        kind: context.kind,
        openedAt: context.openedAt,
        closed,
        ...(context.closedAt ? { closedAt: context.closedAt } : {}),
        openerId: context.openerId,
        requestedUrl: context.requestedUrl,
        lastRequestedUrl: context.lastRequestedUrl || context.requestedUrl,
        currentUrl: currentWindowUrl(context),
        sameOrigin: context.sameOrigin,
      };
    });
  }

  function safeStoredEvent(value) {
    if (!value || typeof value !== "object") return null;
    const details = safeRecordDetails(value);
    return {
      ...details,
      at: redact(value.at),
      type: redact(value.type || "event"),
      phase: redact(value.phase || "unknown"),
    };
  }

  function safeStoredHealth(value) {
    const health = value && typeof value === "object" ? value : {};
    const longTasks = health.longTasks && typeof health.longTasks === "object"
      ? health.longTasks
      : {};
    const sample = health.lastSample && typeof health.lastSample === "object"
      ? {
          at: redact(health.lastSample.at),
          visibility: redact(health.lastSample.visibility),
          usedJsHeapBytes: Number.isFinite(health.lastSample.usedJsHeapBytes)
            ? health.lastSample.usedJsHeapBytes
            : null,
          totalJsHeapBytes: Number.isFinite(health.lastSample.totalJsHeapBytes)
            ? health.lastSample.totalJsHeapBytes
            : null,
          jsHeapLimitBytes: Number.isFinite(health.lastSample.jsHeapLimitBytes)
            ? health.lastSample.jsHeapLimitBytes
            : null,
          heapRatio: Number.isFinite(health.lastSample.heapRatio)
            ? health.lastSample.heapRatio
            : null,
        }
      : null;
    return {
      samples: Number.isFinite(health.samples) ? health.samples : 0,
      lastSample: sample,
      maxHeapUsed: Number.isFinite(health.maxHeapUsed) ? health.maxHeapUsed : null,
      maxHeapRatio: Number.isFinite(health.maxHeapRatio) ? health.maxHeapRatio : null,
      longTasks: {
        count: Number.isFinite(longTasks.count) ? longTasks.count : 0,
        totalDurationMs: Number.isFinite(longTasks.totalDurationMs)
          ? longTasks.totalDurationMs
          : 0,
        maxDurationMs: Number.isFinite(longTasks.maxDurationMs) ? longTasks.maxDurationMs : 0,
        lastAt: longTasks.lastAt ? redact(longTasks.lastAt) : null,
      },
      webglContextLosses: Number.isFinite(health.webglContextLosses)
        ? health.webglContextLosses
        : 0,
      webglContextRestores: Number.isFinite(health.webglContextRestores)
        ? health.webglContextRestores
        : 0,
    };
  }

  function safeStoredRuntime(value) {
    if (!value || typeof value !== "object") return null;
    return {
      mode: redact(value.mode),
      zoidiumVersion: redact(value.zoidiumVersion),
      cm3: {
        toolVersion: primitive(value.cm3?.toolVersion),
        coreVersion: primitive(value.cm3?.coreVersion),
      },
      policy: {
        account: redact(value.policy?.account),
        ads: redact(value.policy?.ads),
        community: redact(value.policy?.community),
      },
      origin: redact(value.origin),
    };
  }

  function safeStoredDiagnostics(value) {
    if (!value || typeof value !== "object") return null;
    const plugins = value.plugins && typeof value.plugins === "object" ? value.plugins : {};
    return {
      capturedAt: redact(value.capturedAt),
      reason: redact(value.reason),
      runtime: safeStoredRuntime(value.runtime),
      plugins: {
        enabled: Array.isArray(plugins.enabled)
          ? plugins.enabled.map(safePlugin).filter(Boolean).slice(0, 100)
          : [],
        installed: Array.isArray(plugins.installed)
          ? plugins.installed.map(safePlugin).filter(Boolean).slice(0, 100)
          : [],
        project: Array.isArray(plugins.project)
          ? plugins.project.map(safeProjectPlugin).filter(Boolean).slice(0, 100)
          : null,
      },
      projectUsage: safeProjectUsage(value.projectUsage),
    };
  }

  function safeStoredSession(value) {
    if (!value || typeof value !== "object") return null;
    return {
      id: redact(value.id),
      startedAt: redact(value.startedAt),
      lastSeenAt: redact(value.lastSeenAt),
      ...(value.endedAt ? { endedAt: redact(value.endedAt) } : {}),
      ...(value.recoveredAt ? { recoveredAt: redact(value.recoveredAt) } : {}),
      status: redact(value.status || "unknown"),
      exitReason: value.exitReason == null ? null : redact(value.exitReason),
      phase: redact(value.phase || "unknown"),
      health: safeStoredHealth(value.health),
      diagnostics: safeStoredDiagnostics(value.diagnostics),
      exceptions: Array.isArray(value.exceptions)
        ? value.exceptions
            .map(safeStoredEvent)
            .filter(Boolean)
            .slice(-MAX_PERSISTED_EXCEPTIONS)
        : [],
      events: Array.isArray(value.events)
        ? value.events.map(safeStoredEvent).filter(Boolean).slice(-MAX_PERSISTED_EVENTS)
        : [],
    };
  }

  function previousSessions() {
    return journal.getJournal().sessions
      .filter((session) => session !== journal.getSession())
      .map(safeStoredSession)
      .filter(Boolean)
      .slice(-(MAX_PERSISTED_SESSIONS - 1));
  }

  function exceptionEvents(session) {
    const retained = Array.isArray(session?.exceptions) && session.exceptions.length > 0
      ? session.exceptions
      : session?.events || [];
    return retained.filter(
      (event) => event.type === "exception" || (event.type === "console" && event.level === "error")
    );
  }

  function addPluginIdsFromText(target, value) {
    const source = text(value);
    const patterns = [
      /(?:^|[\\/])plugins[\\/]([a-z0-9][a-z0-9-]*)[\\/]/gi,
      /\bzoidium:([a-z0-9][a-z0-9-]*)\//gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source))) target.add(match[1]);
    }
  }

  function candidatePlugins(session) {
    const directIds = new Set();
    const activityIds = new Set();
    const sessionEvents = [
      ...(session?.events || []),
      ...(session?.exceptions || []),
    ];
    for (const event of sessionEvents) {
      const errorRelated =
        event.type === "exception" ||
        (event.type === "console" && event.level === "error") ||
        event.type === "script-error";
      if (event.pluginId) {
        (errorRelated ? directIds : activityIds).add(redact(event.pluginId));
      }
      if (errorRelated) {
        for (const key of ["source", "message", "stack", "script"]) {
          addPluginIdsFromText(directIds, event[key]);
        }
      }
    }

    const usage = session?.diagnostics?.projectUsage?.items || [];
    const usageByPlugin = new Map();
    for (const item of usage) {
      if (!item.pluginId || item.count <= 0) continue;
      let summary = usageByPlugin.get(item.pluginId);
      if (!summary) {
        summary = {
          id: item.pluginId,
          name: item.pluginName || item.pluginId,
          instanceCount: 0,
          topItems: [],
        };
        usageByPlugin.set(item.pluginId, summary);
      }
      summary.instanceCount += item.count;
      summary.topItems.push({
        kind: item.kind,
        id: item.itemId,
        name: item.itemName,
        count: item.count,
      });
    }

    for (const event of sessionEvents) {
      if (event.type !== "plugin-usage-progress" || !event.pluginId || event.count <= 0) continue;
      let summary = usageByPlugin.get(event.pluginId);
      if (!summary) {
        summary = {
          id: event.pluginId,
          name: event.pluginName || event.pluginId,
          instanceCount: 0,
          topItems: [],
        };
        usageByPlugin.set(event.pluginId, summary);
      }
      const existing = summary.topItems.find(
        (item) => item.kind === event.kind && item.id === event.itemId
      );
      if (existing) existing.count = Math.max(existing.count, event.count);
      else {
        summary.topItems.push({
          kind: event.kind,
          id: event.itemId,
          name: event.itemName || event.itemId,
          count: event.count,
        });
      }
      summary.instanceCount = Math.max(
        summary.instanceCount,
        summary.topItems.reduce((total, item) => total + item.count, 0)
      );
    }

    const ids = new Set([...directIds, ...usageByPlugin.keys(), ...activityIds]);
    return Array.from(ids, (id) => {
      const usageSummary = usageByPlugin.get(id);
      const directEvidence = directIds.has(id);
      const workloadEvidence = Boolean(usageSummary);
      return {
        id,
        name: usageSummary?.name || id,
        evidence: directEvidence
          ? "error-reference"
          : workloadEvidence
            ? "project-workload"
            : "recent-activity",
        confidence: directEvidence ? "high" : "low",
        instanceCount: usageSummary?.instanceCount || 0,
        topItems: (usageSummary?.topItems || [])
          .sort((left, right) => right.count - left.count)
          .slice(0, 5),
      };
    })
      .sort((left, right) =>
        Number(right.evidence === "error-reference") - Number(left.evidence === "error-reference") ||
        Number(right.evidence === "project-workload") - Number(left.evidence === "project-workload") ||
        right.instanceCount - left.instanceCount ||
        left.id.localeCompare(right.id)
      )
      .slice(0, 10);
  }

  function analyzeCrash(sessions) {
    const candidates = [...sessions, safeStoredSession(journal.getSession())].filter(Boolean).reverse();
    const assessed = candidates.find((session) =>
      session.status === "interrupted" || exceptionEvents(session).length > 0
    ) || candidates[0] || null;
    const errors = exceptionEvents(assessed);
    const lastError = errors.at(-1) || null;
    const health = assessed?.health || safeStoredHealth(null);
    const evidence = [];
    let category = "none";
    let confidence = "low";
    let summary = "No crash signal was found in the retained sessions.";

    if (lastError) {
      category = "uncaught-exception";
      confidence = "high";
      summary = `The session recorded an uncaught error: ${truncate(lastError.message || "Unknown error", 400)}`;
      evidence.push(`Error source: ${lastError.source || lastError.type || "unknown"}`);
    } else if ((health.webglContextLosses || 0) > 0) {
      category = "webgl-context-loss";
      confidence = "medium";
      summary = "The WebGL context was lost before the session ended.";
      evidence.push(`WebGL context losses: ${health.webglContextLosses}`);
    } else if ((health.maxHeapRatio || 0) >= 0.9) {
      category = "memory-pressure";
      confidence = "medium";
      summary = "JavaScript heap use reached at least 90% of the reported limit.";
      evidence.push(`Maximum JavaScript heap ratio: ${health.maxHeapRatio}`);
    } else if ((health.longTasks?.maxDurationMs || 0) >= 5000) {
      category = "main-thread-stall";
      confidence = "medium";
      summary = "The page recorded a main-thread task lasting at least five seconds.";
      evidence.push(`Longest task: ${health.longTasks.maxDurationMs} ms`);
    } else if (assessed?.status === "interrupted") {
      category = "unclean-session-end";
      confidence = "medium";
      summary = "The previous page session disappeared without a normal page shutdown event.";
      evidence.push(`Last recorded phase: ${assessed.phase}`);
      evidence.push(`Last heartbeat: ${assessed.lastSeenAt}`);
    }

    if ((health.maxHeapRatio || 0) > 0) {
      evidence.push(`Peak JavaScript heap ratio: ${health.maxHeapRatio}`);
    }
    if ((health.longTasks?.count || 0) > 0) {
      evidence.push(
        `Long tasks: ${health.longTasks.count}; longest: ${health.longTasks.maxDurationMs} ms`
      );
    }

    return {
      category,
      confidence,
      summary,
      assessedSessionId: assessed?.id || null,
      evidence,
      candidatePlugins: candidatePlugins(assessed),
      note:
        "A workload or recent-activity candidate is not proof of fault. It identifies plugin code or instances present near the failure.",
    };
  }

  parts.crash = {
    HEALTH_SAMPLE_INTERVAL_MS: HEALTH_SAMPLE_INTERVAL_MS,
    LONG_TASK_WARNING_MS: LONG_TASK_WARNING_MS,
    mainWindowContext: mainWindowContext,
    currentWindowUrl: currentWindowUrl,
    windowDetails: windowDetails,
    recordConsole: recordConsole,
    installConsoleHook: installConsoleHook,
    installWindowHooks: installWindowHooks,
    registerChildWindow: registerChildWindow,
    collectRuntime: collectRuntime,
    collectEnvironment: collectEnvironment,
    collectPlugins: collectPlugins,
    collectProjectUsage: collectProjectUsage,
    collectWindows: collectWindows,
    checkpointDiagnostics: checkpointDiagnostics,
    sampleHealth: sampleHealth,
    installLongTaskObserver: installLongTaskObserver,
    previousSessions: previousSessions,
    safeStoredEvent: safeStoredEvent,
    exceptionEvents: exceptionEvents,
    analyzeCrash: analyzeCrash,
  };
  if (typeof module === "object" && module.exports) module.exports = parts.crash;
})(typeof window !== "undefined" ? window : globalThis);

