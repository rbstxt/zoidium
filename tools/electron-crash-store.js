"use strict";

const fs = require("fs");
const path = require("path");

const MAX_ENTRIES = 20;
const MAX_TEXT_LENGTH = 2400;
const MAX_JOURNAL_SESSIONS = 4;
const MAX_JOURNAL_SESSION_BYTES = 1024 * 1024;
const REDACTIONS = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[redacted]"],
  [
    /((?:token|csrf|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[redacted]",
  ],
  [/([?&](?:token|csrf|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]+/gi, "$1[redacted]"],
  [/(file:\/\/\/Users\/)[^/]+/gi, "$1[redacted]"],
  [/(\/Users\/)[^/]+/g, "$1[redacted]"],
  [/(file:\/\/\/[A-Za-z]:\/Users\/)[^/]+/gi, "$1[redacted]"],
  [/(\\Users\\)[^\\]+/gi, "$1[redacted]"],
];

function safeText(value, fallback = "") {
  try {
    let result = String(value ?? fallback);
    for (const [pattern, replacement] of REDACTIONS) {
      result = result.replace(pattern, replacement);
    }
    return result.slice(0, MAX_TEXT_LENGTH);
  } catch (_error) {
    return fallback;
  }
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function safeError(error) {
  if (!error) return null;
  return {
    name: safeText(error.name, "Error"),
    message: safeText(error.message || error, "Unknown error"),
    ...(typeof error.stack === "string" ? { stack: safeText(error.stack) } : {}),
    ...(error.code != null ? { code: safeText(error.code) } : {}),
  };
}

function safeEntry(entry) {
  const value = entry && typeof entry === "object" ? entry : {};
  return {
    at: safeText(value.at, new Date().toISOString()),
    processType: safeText(value.processType, "unknown"),
    reason: safeText(value.reason, "unknown"),
    exitCode: safeNumber(value.exitCode),
    ...(value.name ? { name: safeText(value.name) } : {}),
    ...(value.serviceName ? { serviceName: safeText(value.serviceName) } : {}),
    ...(value.error ? { error: safeError(value.error) } : {}),
  };
}

function readCrashDiagnostics(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_ENTRIES).map(safeEntry);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.error("[Zoidium] failed to read Electron crash diagnostics:", error);
    }
    return [];
  }
}

function readDebugJournal(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.sessions)) {
      return { schemaVersion: 2, sessions: [] };
    }
    return {
      schemaVersion: 2,
      sessions: parsed.sessions
        .filter((session) => session && typeof session.id === "string")
        .slice(-MAX_JOURNAL_SESSIONS),
    };
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.error("[Zoidium] failed to read Electron debug journal:", error);
    }
    return { schemaVersion: 2, sessions: [] };
  }
}

function writeJsonAtomically(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filename);
}

function mergeDebugSession(filename, value) {
  try {
    const session = value && typeof value === "object" ? value : null;
    if (!session || typeof session.id !== "string" || !session.id) return false;
    const serialized = JSON.stringify(session);
    if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_SESSION_BYTES) return false;
    const safeSession = JSON.parse(serialized);
    const journal = readDebugJournal(filename);
    const sessions = journal.sessions.filter((entry) => entry.id !== safeSession.id);
    sessions.push(safeSession);
    sessions.sort((left, right) => String(left.startedAt || "").localeCompare(String(right.startedAt || "")));
    writeJsonAtomically(filename, {
      schemaVersion: 2,
      sessions: sessions.slice(-MAX_JOURNAL_SESSIONS),
    });
    return true;
  } catch (error) {
    console.error("[Zoidium] failed to save Electron debug journal:", error);
    return false;
  }
}

function appendCrashDiagnostic(filename, entry) {
  try {
    const entries = readCrashDiagnostics(filename);
    entries.push(safeEntry(entry));
    const trimmed = entries.slice(-MAX_ENTRIES);
    writeJsonAtomically(filename, trimmed);
    return true;
  } catch (error) {
    console.error("[Zoidium] failed to save Electron crash diagnostics:", error);
    return false;
  }
}

module.exports = {
  MAX_ENTRIES,
  appendCrashDiagnostic,
  mergeDebugSession,
  readCrashDiagnostics,
  readDebugJournal,
  safeEntry,
};
