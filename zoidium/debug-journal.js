// Zoidium debug journal (split from debug-log.js).
// Redaction helpers plus the crash journal: session records, coalesced
// writes and the record()/recordException() entry points. Loads first of the
// debug-log scripts (see zoidium/runtime-config.js); later scripts read these
// exports from the shared registry (browser classic scripts) or through
// require (Node tests).
(function installZoidiumDebugJournal(global) {
  "use strict";

  var parts = global.__zoidiumDebugParts || (global.__zoidiumDebugParts = {});
  if (parts.journal) return;

  const MAX_EVENTS = 200;
  const MAX_PERSISTED_EVENTS = 120;
  const MAX_PERSISTED_EXCEPTIONS = 30;
  const MAX_PERSISTED_SESSIONS = 4;
  const MAX_TEXT_LENGTH = 2400;
  // Redaction scans at most this much input per value. A huge string logged
  // to console.warn must not cost a full regex pass on the main thread.
  const MAX_REDACT_INPUT = 8192;
  // Journal writes are coalesced: every record() used to re-serialize the whole
  // journal into localStorage synchronously. Pending writes flush after this
  // delay, and immediately on pagehide, hidden visibility and session close.
  const JOURNAL_WRITE_DELAY_MS = 250;
  // Milestones that a crash analysis relies on persist without delay. They are
  // rare: usage progress fires only at powers of two.
  const IMMEDIATE_RECORD_TYPES = new Set([
    "script-error",
    "plugin-usage-progress",
    "project-load-start",
    "project-load-complete",
    "project-opened",
    "plugin-state",
  ]);
  const JOURNAL_STORAGE_KEY = "zoidium.debug-log.journal.v2";
  const TAB_STORAGE_KEY = "zoidium.debug-log.tab.v1";

  const startedAt = new Date().toISOString();
  const events = [];

  let journal = { schemaVersion: 2, sessions: [] };
  let currentSession = null;
  let tabId = null;
  let persistenceAvailable = false;
  let persistenceError = null;

  let phase = "pre-init";

  let journalWriteTimer = 0;
  const recentErrors = new Map();

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
    let result = text(value).slice(0, MAX_REDACT_INPUT);
    for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
    return truncate(result);
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

  function scheduleJournalWrite() {
    if (journalWriteTimer || !currentSession) return;
    journalWriteTimer = global.setTimeout(function () {
      journalWriteTimer = 0;
      writeJournal();
    }, JOURNAL_WRITE_DELAY_MS);
  }

  // Writes now and cancels any scheduled write. Used at session boundaries.
  function flushJournal() {
    if (journalWriteTimer) {
      global.clearTimeout(journalWriteTimer);
      journalWriteTimer = 0;
    }
    return writeJournal();
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
    flushJournal();
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
    flushJournal();
  }

  function resumeCurrentSession() {
    if (!currentSession || currentSession.status !== "suspended") return;
    currentSession.status = "active";
    currentSession.exitReason = null;
    delete currentSession.endedAt;
    flushJournal();
  }

  function record(type, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      type: text(type, "event"),
      phase,
      ...safeRecordDetails(details),
    };
    // A failing frame callback can report the same error sixty times a
    // second. Keep its evidence and count without synchronous storage work
    // on every frame, or an error can itself make the editor unresponsive.
    const errorEvent = entry.type === "exception" || (entry.type === "console" && entry.level === "error");
    if (errorEvent) {
      const key = [entry.type, entry.source, entry.windowId, entry.message, entry.stack].join("\n");
      const previous = recentErrors.get(key);
      const now = Date.now();
      if (previous && now - previous.time < 10000) {
        previous.entry.repetitions = (previous.entry.repetitions || 1) + 1;
        previous.entry.lastAt = entry.at;
        if (previous.persisted) Object.assign(previous.persisted, {
          repetitions: previous.entry.repetitions,
          lastAt: entry.at,
        });
        scheduleJournalWrite();
        return previous.entry;
      }
      if (recentErrors.size >= 100) recentErrors.delete(recentErrors.keys().next().value);
      recentErrors.set(key, { time: now, entry, persisted: null });
    }
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
      const key = [entry.type, entry.source, entry.windowId, entry.message, entry.stack].join("\n");
      recentErrors.get(key).persisted = currentSession.exceptions.at(-1);
    }
    // Errors are rare and are the evidence a crash analysis needs, so they
    // persist synchronously. Routine records (phase, usage, warnings) are
    // coalesced so a burst of them costs one journal write.
    if (isException || IMMEDIATE_RECORD_TYPES.has(entry.type)) flushJournal();
    else scheduleJournalWrite();
    return entry;
  }

  function recordException(source, error, details = {}) {
    const normalizedSource = text(source, "unknown");
    record("exception", {
      source: normalizedSource,
      ...errorDetails(error),
      ...details,
    });
    if (/^(?:extension bootstrap|project load|project operation|project plugin activation)$/i.test(normalizedSource)) {
      try {
        var debugUi = (global.__zoidiumDebugParts || {}).ui;
        if (debugUi && typeof debugUi.mountEmergencyControls === "function") {
          debugUi.mountEmergencyControls(normalizedSource, error);
        }
      } catch (_mountError) {
        // The emergency UI is optional and must never replace the original error.
      }
    }
  }

  parts.journal = {
    startedAt: startedAt,
    MAX_PERSISTED_EVENTS: MAX_PERSISTED_EVENTS,
    MAX_PERSISTED_EXCEPTIONS: MAX_PERSISTED_EXCEPTIONS,
    MAX_PERSISTED_SESSIONS: MAX_PERSISTED_SESSIONS,
    text: text,
    truncate: truncate,
    redact: redact,
    primitive: primitive,
    errorDetails: errorDetails,
    consoleArgument: consoleArgument,
    safeRecordValue: safeRecordValue,
    safeRecordDetails: safeRecordDetails,
    diagnosticId: diagnosticId,
    record: record,
    recordException: recordException,
    scheduleJournalWrite: scheduleJournalWrite,
    flushJournal: flushJournal,
    writeJournal: writeJournal,
    initializeJournal: initializeJournal,
    closeCurrentSession: closeCurrentSession,
    resumeCurrentSession: resumeCurrentSession,
    getSession: function () { return currentSession; },
    getJournal: function () { return journal; },
    liveEvents: function () { return events; },
    getPhase: function () { return phase; },
    setPhaseValue: function (value) { phase = value; },
    isPersistenceAvailable: function () { return persistenceAvailable; },
    getPersistenceError: function () { return persistenceError; },
  };
  if (typeof module === "object" && module.exports) module.exports = parts.journal;
})(typeof window !== "undefined" ? window : globalThis);

