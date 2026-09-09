(function installZoidiumDebugLog(global) {
  "use strict";

  if (global.ZOIDIUM_DEBUG_LOG?.version === 1) return;

  const MAX_EVENTS = 200;
  const MAX_TEXT_LENGTH = 2400;
  const PZ = (global.PZ = global.PZ || {});
  PZ.zoidium = PZ.zoidium || {};
  const startedAt = new Date().toISOString();
  const events = [];
  const childWindows = [];
  const windowContexts = new WeakMap();
  const consoleHooks = new WeakMap();
  const windowOpenHooks = new WeakSet();
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
        "Saves your OS, browser, enabled plugins, and recent errors for a bug report. Project content is not included; review before sharing.",
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

  function record(type, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      type: text(type, "event"),
      phase,
      ...safeRecordDetails(details),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
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
      ["Electron", /\bElectron\/([\d.]+)/i],
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
      mode: global.zoidiumDesktop ? "Electron" : "Browser",
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

  function snapshot() {
    const runtime = collectRuntime();
    const environment = collectEnvironment();
    const plugins = collectPlugins();
    const windows = collectWindows();
    const allEvents = events.map((event) => ({ ...event }));
    return {
      schemaVersion: 1,
      product: "Zoidium debug log",
      generatedAt: new Date().toISOString(),
      session: {
        startedAt,
        phase,
      },
      runtime,
      environment,
      plugins,
      windows,
      exceptions: allEvents.filter(
        (event) => event.type === "exception" || (event.type === "console" && event.level === "error")
      ),
      events: allEvents,
    };
  }

  function download() {
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
    button.onclick = function () {
      try {
        download();
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
    global.addEventListener("zoidium:extension-load-error", (event) => {
      phase = "bootstrap-error";
      recordException("extension bootstrap", event?.detail);
    });
    global.addEventListener("zoidium:ready", () => {
      phase = "ready";
      record("lifecycle", { message: "Zoidium extension ready" });
    });
    global.document?.addEventListener("zoidium:plugin-state-change", (event) => {
      const detail = event?.detail || {};
      record("plugin-state", {
        pluginId: redact(detail.pluginId),
        enabled: Boolean(detail.enabled),
        featureCount: Number.isFinite(detail.effectCount) ? detail.effectCount : null,
      });
    });
  }

  const api = Object.freeze({
    version: 1,
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
  PZ.zoidium.debugLog = api;
  installEventListeners();
})(window);
