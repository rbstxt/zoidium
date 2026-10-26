"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const P = commonJS ? require("./community-package") : root.ZoidiumCommunityPackage;
  const D = commonJS ? require("./community-store-indexeddb") : root.ZoidiumCommunityIndexedDB;
  const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
  const empty = () => ({ schemaVersion: 1, revision: 0, records: [], blobs: {}, safeMode: false, attempts: [] });
  function fail(message, code = "COMMUNITY_STORE_ERROR") { const error = new Error(message); error.code = code; throw error; }
  async function hashBytes(bytes) {
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return "sha256-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
  }
  function hashes(record) { return [...new Set([record.selected, record.previous, record.pending].filter(Boolean))]; }
  function claims(manifest) { return [manifest.id, ...manifest.effects.map(e => e.id)]; }
  function earlySafeMode(location = root.location) {
    return root.ZOIDIUM_COMMUNITY_SAFE_MODE === true || new URLSearchParams(location?.search || "").get("communitySafeMode") === "1";
  }
  function createStore({ adapter = D.createIndexedDBAdapter(), occupied = [], limits = P.LIMITS, safeMode = earlySafeMode() } = {}) {
    const reserved = new Set(occupied);
    let current = empty(), ready = false;
    function validate(state) {
      if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
          !Array.isArray(state.records) || !state.blobs || typeof state.blobs !== "object" ||
          typeof state.safeMode !== "boolean" || !Array.isArray(state.attempts)) fail("Unsupported or corrupt community storage.");
      const ids = new Set();
      for (const r of state.records) {
        if (!P.ID.test(r.id) || ids.has(r.id) || r.schemaVersion !== 1 ||
            !Array.isArray(r.approvals) || !Array.isArray(r.verified) || typeof r.enabled !== "boolean" ||
            typeof r.staged !== "boolean" || typeof r.quarantine !== "string" ||
            ![r.selected, r.previous, r.pending].every(h => h === null || HASH.test(h)) ||
            ![...r.approvals, ...r.verified].every(h => HASH.test(h) && hashes(r).includes(h))) fail("Corrupt community package index.");
        ids.add(r.id);
      }
      for (const a of state.attempts) {
        if (!a || !P.ID.test(a.id) || !HASH.test(a.hash)) fail("Corrupt community activation record.");
      }
      quota(state);
      return state;
    }
    function quota(state) {
      const bytes = Object.values(state.blobs).reduce((sum, b) => {
        if (!(b instanceof Uint8Array) || b.byteLength > limits.packageBytes) fail("Invalid stored community bytes.");
        return sum + b.byteLength;
      }, 0);
      if (state.records.length > limits.installed || bytes > limits.storageBytes) fail("Community storage quota exceeded.", "QUOTA_EXCEEDED");
    }
    function prune(state) {
      const retained = new Set(state.records.flatMap(hashes));
      for (const hash of Object.keys(state.blobs)) if (!retained.has(hash)) delete state.blobs[hash];
      for (const r of state.records) {
        r.approvals = r.approvals.filter(h => hashes(r).includes(h));
        r.verified = r.verified.filter(h => hashes(r).includes(h));
      }
      state.attempts = state.attempts.filter(a => state.records.some(r => r.id === a.id));
    }
    // Keep the snapshot revision across awaits. A concurrent cancellation on
    // this same store must conflict instead of being overwritten by read-back.
    async function commit(next, revision = next.revision) {
      prune(next); next.revision = revision + 1; validate(next);
      await adapter.commit(revision, next);
      current = next;
      return view();
    }
    function snapshot(revision) {
      if (!ready) fail("Community storage has not opened.");
      if (revision !== current.revision) fail("Community storage changed. Refresh and try again.", "REVISION_CONFLICT");
      return structuredClone(current);
    }
    function record(state, id) {
      const r = state.records.find(r => r.id === id);
      if (!r) fail("Community package is no longer installed.");
      return r;
    }
    async function inspect(state, r, hash) {
      const bytes = state.blobs[hash];
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.packageBytes || await hashBytes(bytes) !== hash) fail("Stored package hash verification failed.");
      const bundle = P.parse(bytes, [...reserved]);
      if (bundle.manifest.id !== r.id) fail("Stored package identity changed.");
      return bundle.manifest;
    }
    function view() {
      return { schemaVersion: 1, revision: current.revision, safeMode: safeMode || current.safeMode, activationAvailable: false,
        bytes: Object.values(current.blobs).reduce((sum, b) => sum + b.byteLength, 0),
        packages: current.records.map(r => {
          let manifest;
          try { manifest = P.parse(current.blobs[r.pending || r.selected]).manifest; } catch (_) { /* Quarantine still has management controls. */ }
          const hash = r.pending || r.selected;
          const approved = r.approvals.includes(hash);
          return { ...structuredClone(r), hash, manifest, approved, installed: Boolean(r.selected),
            readiness: r.quarantine ? "Quarantined" : !approved ? "Needs approval" : r.staged ? "Pending reload" : "Unavailable until rendering support lands" };
        }) };
    }
    async function open({ reload = false } = {}) {
      ready = false;
      current = validate(await adapter.load() || empty()); ready = true;
      const next = structuredClone(current), allClaims = new Set(reserved);
      for (const r of next.records) {
        try {
          const ownClaims = new Set();
          for (const hash of hashes(r)) {
            const manifest = await inspect(next, r, hash);
            if (!r.verified.includes(hash)) fail("Package installation was interrupted before read-back verification.");
            for (const id of claims(manifest)) ownClaims.add(id);
          }
          for (const id of ownClaims) { if (allClaims.has(id)) fail("Installed package ID collision: " + id); allClaims.add(id); }
          if (next.attempts.some(a => a.id === r.id)) fail("A previous community activation did not finish.");
          if (reload && !safeMode && !next.safeMode && !r.quarantine && r.staged && r.pending && r.approvals.includes(r.pending)) {
            r.previous = r.selected; r.selected = r.pending; r.pending = null; r.staged = false;
          }
        } catch (error) { r.quarantine = error.message; r.enabled = false; r.staged = false; }
      }
      if (JSON.stringify(next.records) !== JSON.stringify(current.records)) await commit(next);
      return view();
    }
    async function importFile(file, revision) {
      // Only a native local Blob/File is accepted. Paths and URLs are never read.
      if (!(file instanceof Blob)) fail("Choose a local community package file.");
      if (file.size > limits.packageBytes) fail("Community package size limit exceeded.");
      const state = snapshot(revision), bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength !== file.size || bytes.byteLength > limits.packageBytes) fail("Invalid local package size.");
      const bundle = P.parse(bytes), id = bundle.manifest.id, hash = await hashBytes(bytes);
      const occupied = new Set(reserved);
      for (const r of state.records.filter(r => r.id !== id)) {
        for (const h of hashes(r)) for (const claim of claims((await inspect(state, r, h)))) occupied.add(claim);
      }
      P.manifest(bundle.manifest, [...occupied]);
      let r = state.records.find(r => r.id === id);
      if (r && (r.selected === hash || r.pending === hash)) fail("These exact package bytes are already installed.");
      if (!r) {
        r = { schemaVersion: 1, id, selected: null, previous: null, pending: null, approvals: [], verified: [], enabled: false, staged: false, quarantine: "" };
        state.records.push(r);
      }
      if (r.quarantine) fail("Uninstall or roll back the quarantined package before importing an update.");
      if (r.pending) fail("Cancel the pending update before importing another package.");
      r.pending = hash; r.staged = false; state.blobs[hash] = bytes.slice();
      await commit(state, revision);
      // Verify persisted bytes, not the buffer supplied to the transaction.
      // Interrupted writes remain unverified and are quarantined on the next open.
      const persisted = validate(await adapter.load());
      if (persisted.revision !== current.revision) fail("Community storage changed during import. Refresh and try again.", "REVISION_CONFLICT");
      try { await inspect(persisted, record(persisted, id), hash); }
      catch (error) {
        const broken = snapshot(current.revision); record(broken, id).quarantine = error.message;
        await commit(broken); throw error;
      }
      const verified = structuredClone(persisted), installed = record(verified, id);
      installed.verified.push(hash);
      if (!installed.selected) { installed.selected = hash; installed.pending = null; }
      return commit(verified);
    }
    async function change(id, revision, update) {
      const state = snapshot(revision); await update(record(state, id), state); return commit(state, revision);
    }
    return {
      open, view, importFile,
      approve: (id, hash, revision) => change(id, revision, async (r, state) => {
        if (r.quarantine || !hashes(r).includes(hash) || !r.verified.includes(hash)) fail("This exact package cannot be approved.");
        await inspect(state, r, hash);
        if (!r.approvals.includes(hash)) r.approvals.push(hash);
      }),
      cancel: (id, revision) => change(id, revision, (r, state) => {
        if (r.pending) { r.pending = null; r.staged = false; }
        else if (!r.approvals.includes(r.selected)) state.records = state.records.filter(item => item.id !== id);
        else fail("There is no pending import to cancel.");
        if (!r.selected) state.records = state.records.filter(item => item.id !== id);
      }),
      stageOnReload: (id, revision) => change(id, revision, async (r, state) => {
        if (r.quarantine || !r.pending || !r.verified.includes(r.pending) || !r.approvals.includes(r.pending)) fail("Approve the exact pending package before staging it.");
        await inspect(state, r, r.pending); r.staged = true;
      }),
      rollback: (id, revision) => change(id, revision, async (r, state) => {
        if (!r.previous || !r.verified.includes(r.previous) || !r.approvals.includes(r.previous)) fail("No approved rollback package is available.");
        await inspect(state, r, r.previous);
        r.pending = r.previous; r.previous = null; r.staged = true; r.quarantine = ""; r.enabled = false;
        state.attempts = state.attempts.filter(a => a.id !== id);
      }),
      uninstall: (id, revision) => change(id, revision, (_r, state) => { state.records = state.records.filter(r => r.id !== id); }),
      quarantine: (id, reason, revision) => change(id, revision, r => {
        r.quarantine = String(reason).slice(0, 4096) || "Package quarantined."; r.enabled = false; r.staged = false;
      }),
      setEnabled: (id, enabled, revision) => change(id, revision, r => {
        if (typeof enabled !== "boolean") fail("Invalid enable intent.");
        if (enabled && (r.quarantine || !r.selected || !r.approvals.includes(r.selected))) fail("Approve the selected package before enabling it.");
        r.enabled = enabled;
      }),
      setSafeMode: async (enabled, revision) => {
        if (typeof enabled !== "boolean") fail("Invalid safe mode setting.");
        const state = snapshot(revision); state.safeMode = enabled; return commit(state, revision);
      },
      beforeEvaluation: async () => {
        await open();
        if (safeMode || current.safeMode) fail("Community safe mode is enabled.", "COMMUNITY_SAFE_MODE");
        if (current.attempts.length) fail("A previous community activation did not finish.", "ACTIVATION_INTERRUPTED");
        fail("Community activation is unavailable until rendering support lands.", "RENDERING_UNAVAILABLE");
      },
      close: () => adapter.close?.(),
    };
  }
  const api = { createStore, hashBytes, earlySafeMode };
  if (commonJS) module.exports = api;
  else root.ZoidiumCommunityStore = api;
})(globalThis);
