(function installZoidiumDebugLog(global) {
  "use strict";

  if (global.ZOIDIUM_DEBUG_LOG?.version >= 2) return;

  const MAX_EVENTS = 200;
  const MAX_PERSISTED_EVENTS = 120;
  const MAX_PERSISTED_EXCEPTIONS = 30;
  const MAX_PERSISTED_SESSIONS = 4;
  const MAX_TEXT_LENGTH = 2400;
  const JOURNAL_STORAGE_KEY = "zoidium.debug-log.journal.v2";
  const TAB_STORAGE_KEY = "zoidium.debug-log.tab.v1";
  const HEALTH_SAMPLE_INTERVAL_MS = 10000;
  const LONG_TASK_WARNING_MS = 1000;
  const PZ = (global.PZ = global.PZ || {});
  PZ.zoidium = PZ.zoidium || {};
  const startedAt = new Date().toISOString();
  const events = [];
  const childWindows = [];
  const windowContexts = new WeakMap();
  const consoleHooks = new WeakMap();
  const windowOpenHooks = new WeakSet();
  let journal = { schemaVersion: 2, sessions: [] };
  let currentSession = null;
  let tabId = null;
  let persistenceAvailable = false;
  let persistenceError = null;
  let longTaskObserver = null;
  let childWindowSequence = 0;
  let phase = "pre-init";

  const REDACTIONS = [
    [
      /(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi,
      "$1[redacted]",
    ],
    [
      /((?:token|csrf|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    ],
    [
      /([?&](?:token|csrf|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]+/gi,
      "$1[redacted]",
    ],
    [/(file:\/\/\/Users\/)[^/]+/gi, "$1[redacted]"],
    [/(\/Users\/)[^/]+/g, "$1[redacted]"],
    [/(file:\/\/\/[A-Za-z]:\/Users\/)[^/]+/gi, "$1[redacted]"],
    [/(\\Users\\)[^\\]+/gi, "$1[redacted]"],
  ];

  const COPY = {
    en: {
      section: "Debug information",
      description:
        "Saves your OS, browser, enabled plugins, and recent crash evidence for a bug report. Crash data survives a reload. Project content is not included; review before sharing.",
      button: "Download debug log",
      success: "Debug log downloaded",
      failure: "Debug log download failed",
    },
  };

  function text(value, fallback = "") {
    try {
      return String(value ?? fallback);
    } catch (_error) {
      return fallback;
    }
  }

  function truncate(value, limit = MAX_TEXT_LENGTH) {
    const source = text(value);
    return source.length > limit ? `${source.slice(0, limit)}…` : source;
  }

  function redact(value) {
    let result = text(value);
    for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
    return truncate(result);
  }

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
    openedAt: startedAt,
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

  function primitive(value) {
    if (value == null) return null;
    if (typeof value === "string") return redact(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    return redact(value);
  }

  function isErrorLike(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        (value instanceof Error ||
          typeof value.message === "string" ||
          typeof value.stack === "string")
    );
  }

  function errorDetails(error) {
    let name = "Error";
    let message = "Unknown error";
    let stack = "";
    let code = null;
    try {
      if (error && typeof error.name === "string" && error.name.trim()) name = error.name;
      if (error && typeof error.message === "string" && error.message.trim()) {
        message = error.message;
      } else if (error != null && !isErrorLike(error)) {
        message = text(error);
      }
      if (error && typeof error.stack === "string") stack = error.stack;
      if (error && (typeof error.code === "string" || typeof error.code === "number")) {
        code = error.code;
      }
    } catch (_error) {
      message = "Could not read error details";
    }

    const details = {
      name: redact(name),
      message: redact(message),
    };
    if (stack) details.stack = redact(stack);
    if (code != null) details.code = primitive(code);
    return details;
  }

  function consoleArgument(value) {
    if (isErrorLike(value)) {
      const details = errorDetails(value);
      return details.message;
    }
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return redact(value);
    }
    try {
      const name = typeof value.constructor?.name === "string" ? value.constructor.name : "Object";
      const fields = ["name", "message", "code", "status", "statusText", "type"]
        .map((key) => {
          try {
            return value[key] == null ? null : `${key}=${primitive(value[key])}`;
          } catch (_error) {
            return null;
          }
        })
        .filter(Boolean);
      return fields.length > 0 ? `[${name}: ${fields.join(", ")}]` : `[${name}]`;
    } catch (_error) {
      return "[Object]";
    }
  }

  function safeRecordValue(value) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return primitive(value);
    }
    if (Array.isArray(value)) return value.slice(0, 20).map(safeRecordValue);
    return "[Object]";
  }

  function safeRecordDetails(details) {
    if (!details || typeof details !== "object" || Array.isArray(details)) return {};
    return Object.fromEntries(
      Object.entries(details)
        .slice(0, 32)
        .map(([key, value]) => [redact(key), safeRecordValue(value)]),
    );
  }

  function diagnosticId(prefix) {
    try {
      if (typeof global.crypto?.randomUUID === "function") {
        return `${prefix}-${global.crypto.randomUUID()}`;
      }
    } catch (_error) {
      // A timestamp and random suffix are sufficient for local session grouping.
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readTabId() {
    try {
      const inherited = global.sessionStorage?.getItem(TAB_STORAGE_KEY);
      let hasOpener = false;
      try {
        hasOpener = Boolean(global.opener);
      } catch (_error) {
        hasOpener = false;
      }
      tabId = inherited && !hasOpener ? inherited : diagnosticId("tab");
      global.sessionStorage?.setItem(TAB_STORAGE_KEY, tabId);
      return tabId;
    } catch (_error) {
      tabId = diagnosticId("tab");
      return tabId;
    }
  }

  function readJournal() {
    try {
      const raw = global.localStorage?.getItem(JOURNAL_STORAGE_KEY);
      if (!raw) {
        persistenceAvailable = Boolean(global.localStorage);
        return { schemaVersion: 2, sessions: [] };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.sessions)) {
        throw new Error("Unsupported crash journal format");
      }
      persistenceAvailable = true;
      return {
        schemaVersion: 2,
        sessions: parsed.sessions
          .filter((session) => session && typeof session === "object")
          .slice(-MAX_PERSISTED_SESSIONS),
      };
    } catch (error) {
      persistenceAvailable = Boolean(global.localStorage);
      persistenceError = errorDetails(error);
      return { schemaVersion: 2, sessions: [] };
    }
  }

  function writeJournal() {
    if (!currentSession) return false;
    currentSession.lastSeenAt = new Date().toISOString();
    currentSession.phase = phase;
    currentSession.events = events.slice(-MAX_PERSISTED_EVENTS).map((event) => ({ ...event }));
    journal.sessions = journal.sessions.slice(-MAX_PERSISTED_SESSIONS);
    let saved = false;
    if (persistenceAvailable) {
      try {
        global.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journal));
        persistenceError = null;
        saved = true;
      } catch (error) {
        persistenceAvailable = false;
        persistenceError = errorDetails(error);
      }
    }
    return saved;
  }

  function initializeJournal() {
    journal = readJournal();
    const currentTabId = readTabId();
    let interrupted = null;
    for (let index = journal.sessions.length - 1; index >= 0; index -= 1) {
      const candidate = journal.sessions[index];
      if (candidate.tabId !== currentTabId || candidate.status !== "active") continue;
      interrupted = candidate;
      candidate.status = "interrupted";
      candidate.exitReason = "no-clean-page-shutdown";
      candidate.recoveredAt = startedAt;
      break;
    }

    currentSession = {
      id: diagnosticId("session"),
      tabId: currentTabId,
      startedAt,
      lastSeenAt: startedAt,
      status: "active",
      exitReason: null,
      phase,
      events: [],
      exceptions: [],
      health: {
        samples: 0,
        lastSample: null,
        maxHeapUsed: null,
        maxHeapRatio: null,
        longTasks: {
          count: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          lastAt: null,
        },
        webglContextLosses: 0,
        webglContextRestores: 0,
      },
      diagnostics: null,
    };
    journal.sessions.push(currentSession);
    writeJournal();
    if (interrupted) {
      record("previous-session-interrupted", {
        previousSessionId: redact(interrupted.id),
        previousPhase: redact(interrupted.phase),
        previousLastSeenAt: redact(interrupted.lastSeenAt),
      });
    }
  }

  function closeCurrentSession(reason) {
    if (!currentSession || currentSession.status !== "active") return;
    currentSession.status = "closed";
    currentSession.exitReason = redact(reason || "pagehide");
    currentSession.endedAt = new Date().toISOString();
    writeJournal();
  }

  function resumeCurrentSession() {
    if (!currentSession || currentSession.status !== "suspended") return;
    currentSession.status = "active";
    currentSession.exitReason = null;
    delete currentSession.endedAt;
    writeJournal();
  }

  function record(type, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      type: text(type, "event"),
      phase,
      ...safeRecordDetails(details),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    const isException =
      currentSession &&
      (entry.type === "exception" || (entry.type === "console" && entry.level === "error"));
    if (isException) {
      currentSession.exceptions = Array.isArray(currentSession.exceptions)
        ? currentSession.exceptions
        : [];
      currentSession.exceptions.push({ ...entry });
      currentSession.exceptions = currentSession.exceptions.slice(-MAX_PERSISTED_EXCEPTIONS);
    }
    writeJournal();
    return entry;
  }

  function recordException(source, error, details = {}) {
    record("exception", {
      source: text(source, "unknown"),
      ...errorDetails(error),
      ...details,
    });
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

  function copy() {
    return COPY.en;
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
      context = {
        id: `popup-${++childWindowSequence}`,
        kind: "popup",
        window: targetWindow,
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
    const documentObject = global.document;
    if (!documentObject?.createElement) return { supported: false };
    try {
      const canvas = documentObject.createElement("canvas");
      const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
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
      return info;
    } catch (_error) {
      return { supported: false };
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
    if (!currentSession) return null;
    const diagnostics = {
      capturedAt: new Date().toISOString(),
      reason: redact(reason || "checkpoint"),
      runtime: collectRuntime(),
      plugins: collectPlugins(),
      projectUsage: collectProjectUsage(),
    };
    currentSession.diagnostics = diagnostics;
    writeJournal();
    return diagnostics;
  }

  function sampleHealth() {
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
    writeJournal();
  }

  function installLongTaskObserver() {
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
        writeJournal();
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
        closed = Boolean(context.window?.closed);
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
    return journal.sessions
      .filter((session) => session !== currentSession)
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
    const candidates = [...sessions, safeStoredSession(currentSession)].filter(Boolean).reverse();
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

  function snapshot() {
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
      : global.document.createElement("div");
    if (!legacy.generateTitle) {
      title.className = "proprow proptitle noselect";
      title.textContent = currentCopy.section;
    }
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
      if (event?.persisted && currentSession) {
        currentSession.status = "suspended";
        currentSession.exitReason = "back-forward-cache";
        currentSession.endedAt = new Date().toISOString();
        writeJournal();
        return;
      }
      closeCurrentSession("pagehide");
    });
    global.addEventListener("pageshow", (event) => {
      if (event?.persisted) resumeCurrentSession();
    });
    global.document?.addEventListener("visibilitychange", () => {
      sampleHealth();
    });
    global.document?.addEventListener("webglcontextlost", (event) => {
      if (currentSession?.health) currentSession.health.webglContextLosses += 1;
      record("webgl-context-lost", {
        statusMessage: redact(event?.statusMessage || ""),
      });
    }, true);
    global.document?.addEventListener("webglcontextrestored", () => {
      if (currentSession?.health) currentSession.health.webglContextRestores += 1;
      record("webgl-context-restored");
    }, true);
    global.addEventListener("zoidium:extension-load-error", (event) => {
      phase = "bootstrap-error";
      recordException("extension bootstrap", event?.detail);
    });
    global.addEventListener("zoidium:extension-script-error", (event) => {
      const detail = event?.detail || {};
      record("script-error", {
        script: redact(detail.script),
        phase: redact(detail.phase),
        message: redact(detail.message),
      });
    });
    global.addEventListener("zoidium:ready", (event) => {
      const failedScripts = event?.detail?.failedScripts || [];
      phase = failedScripts.length === 0 ? "ready" : "ready-degraded";
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
      record("project-load-start", {
        pluginCount: Number.isFinite(event?.detail?.pluginCount)
          ? event.detail.pluginCount
          : null,
      });
    });
    global.document?.addEventListener("zoidium:project-load-complete", (event) => {
      record("project-load-complete", {
        pluginCount: Number.isFinite(event?.detail?.pluginCount)
          ? event.detail.pluginCount
          : null,
      });
      checkpointDiagnostics("project-load-complete");
      global.setTimeout(() => checkpointDiagnostics("project-load-settled"), 1000);
    });
    global.document?.addEventListener("zoidium:project-load-error", (event) => {
      recordException("project load", event?.detail?.error, {
        pluginCount: Number.isFinite(event?.detail?.pluginCount)
          ? event.detail.pluginCount
          : null,
      });
      checkpointDiagnostics("project-load-error");
    });
    global.addEventListener("zoidium:project-opened", () => {
      record("project-opened");
      checkpointDiagnostics("project-opened");
    });
    global.addEventListener("zoidium:project-error", (event) => {
      if (event?.detail?.error) {
        recordException("project operation", event.detail.error);
      } else {
        record("project-error", { message: redact(event?.detail?.message) });
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
      phase = redact(nextPhase || "unknown");
      record("phase", { name: phase });
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
