"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_ENTRIES,
  appendCrashDiagnostic,
  mergeDebugSession,
  readCrashDiagnostics,
  readDebugJournal,
} = require("../tools/electron-crash-store");

test("Electron crash diagnostics survive restart and remain bounded", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-crash-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "crashes.json");

  for (let index = 0; index < MAX_ENTRIES + 3; index += 1) {
    assert.equal(appendCrashDiagnostic(filename, {
      at: `2026-09-15T00:00:${String(index).padStart(2, "0")}.000Z`,
      processType: "renderer",
      reason: index === MAX_ENTRIES + 2 ? "oom" : "crashed",
      exitCode: index,
    }), true);
  }

  const entries = readCrashDiagnostics(filename);
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries.at(-1).reason, "oom");
  assert.equal(entries.at(-1).exitCode, MAX_ENTRIES + 2);
  assert.equal(entries[0].exitCode, 3);
});

test("Electron crash diagnostics serialize fatal error details", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-crash-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "crashes.json");
  const error = new Error("main process failure");
  error.stack = "Error: main process failure\n at /Users/alice/app.js?token=private";

  appendCrashDiagnostic(filename, {
    processType: "browser",
    reason: "uncaught-exception",
    exitCode: 1,
    error,
  });

  const [entry] = readCrashDiagnostics(filename);
  assert.equal(entry.error.name, "Error");
  assert.equal(entry.error.message, "main process failure");
  assert.match(entry.error.stack, /main process failure/);
  assert.match(entry.error.stack, /\/Users\/\[redacted\]/);
  assert.match(entry.error.stack, /token=\[redacted\]/);
});

test("Electron debug sessions merge by ID and survive a changed web origin", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-debug-journal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "debug-journal.json");

  mergeDebugSession(filename, {
    id: "session-1",
    startedAt: "2026-09-15T00:00:00.000Z",
    status: "active",
    exceptions: [{ message: "retained exception" }],
  });
  mergeDebugSession(filename, {
    id: "session-2",
    startedAt: "2026-09-15T00:01:00.000Z",
    status: "active",
  });
  mergeDebugSession(filename, {
    id: "session-1",
    startedAt: "2026-09-15T00:00:00.000Z",
    status: "interrupted",
    exceptions: [{ message: "retained exception" }],
  });

  const journal = readDebugJournal(filename);
  assert.equal(journal.sessions.length, 2);
  assert.equal(journal.sessions[0].id, "session-1");
  assert.equal(journal.sessions[0].status, "interrupted");
  assert.equal(journal.sessions[0].exceptions[0].message, "retained exception");
});
