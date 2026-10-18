// Zoidium project rescue. Run it on the still-open editor tab whose project
// can no longer be saved: through the bookmarklet on /about/rescue, or by
// pasting this ENTIRE file into the DevTools Console. It reads the live
// project into separate copies, packages them as .pz files, and offers them
// from a floating panel that also shows live progress. It never changes the
// live project, never writes restore points, and sends nothing over the
// network. Every step logs "[PZRescue]" progress; a failed or stuck step is
// named in the panel and the Console together with its error.
(function zoidiumProjectRescue(global) {
  "use strict";
  const TAG = "[PZRescue]";
  const FAILED = Symbol("failed");
  const SKIP = Symbol("skip");
  const DROP = Symbol("drop");
  const RESTORE_DB = "zoidium-restore-points";
  const RESTORE_LEASE = "__zoidium_restore_writer_lease__";
  const ASSET_ID = /^[a-f0-9]{32}(?:[a-f0-9]{32})?$/;
  const ASSET_FIELD = /^(?:asset|font|image|texture|geometry|vertexShader|fragmentShader|nodeImage|.*(?:Asset|Texture|Map|Data))$/i;
  const LARGE_BYTES = 256 * 1048576;
  const SUPPORT_URL = "https://discord.gg/PWAmY9m5bu";
  const log = global.console;

  const api = {
    version: 1, startedAt: new Date().toISOString(), previous: global.PZRescue || null,
    steps: [], issues: [], diagnosis: [], outputs: Object.create(null),
    assets: [], repairs: [], dangling: [], current: null, restorePointList: null,
  };
  global.PZRescue = api;

  // ---------------------------------------------------------------- helpers
  const now = () => (global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now());
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const megabytes = size => (Number(size || 0) / 1048576).toFixed(1) + " MB";
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function describe(error) {
    if (error == null) return "unknown error (no error object)";
    if (typeof error !== "object") return String(error);
    const name = error.name && error.name !== "Error" ? error.name + ": " : "";
    return name + (error.message || String(error));
  }
  function read(object, key) {
    try { return object == null ? undefined : object[key]; } catch (_error) { return undefined; }
  }
  function issue(level, text, detail) {
    api.issues.push({ level, text });
    const method = level === "error" ? "error" : level === "info" ? "log" : "warn";
    if (detail === undefined) log[method](TAG + " " + text);
    else log[method](TAG + " " + text, detail);
  }
  function diagnose(text) {
    api.diagnosis.push(text);
    log.warn(TAG + " DIAGNOSIS: " + text);
  }
  function withTimeout(value, milliseconds, label) {
    let timer = null;
    return Promise.race([
      Promise.resolve(value),
      new Promise((_resolve, reject) => {
        timer = global.setTimeout(() => {
          const error = new Error(label + " did not finish within " + Math.round(milliseconds / 1000) + " s. It is stuck here.");
          error.name = "RescueTimeout";
          reject(error);
        }, milliseconds);
      }),
    ]).finally(() => global.clearTimeout(timer));
  }
  // 30 s plus 1 s per 4 MB for reads, hashes and compression of large files.
  const budget = size => 30000 + Math.floor(Number(size || 0) / 4194304) * 1000;
  async function pending(promise) {
    if (!promise || typeof promise.then !== "function") return false;
    const settled = await Promise.race([
      Promise.resolve(promise).then(() => true, () => true),
      new Promise(resolve => global.setTimeout(() => resolve(false), 50)),
    ]);
    return !settled;
  }

  // Runs one named step with a deadline, a heartbeat and a logged outcome.
  // Returns FAILED instead of throwing so later fallbacks still run.
  async function step(name, milliseconds, task) {
    const record = { step: name, status: "running", ms: 0, detail: "" };
    api.steps.push(record);
    api.current = name;
    const started = now();
    log.log(TAG + " > " + name);
    refreshPanel();
    const heartbeat = global.setInterval(() => {
      log.warn(TAG + " still waiting at \"" + name + "\" (" + Math.round((now() - started) / 1000) + " s)");
    }, 5000);
    try {
      const value = await withTimeout(Promise.resolve().then(() => task(record)), milliseconds, name);
      record.status = record.status === "running" ? "ok" : record.status;
      log.log(TAG + " ok  " + name + (record.detail ? " - " + record.detail : "") + " (" + Math.round(now() - started) + " ms)");
      return value;
    } catch (error) {
      record.status = error && error.name === "RescueTimeout" ? "STUCK" : "FAILED";
      record.detail = describe(error);
      log.error(TAG + " " + record.status + " at \"" + name + "\": " + record.detail, error);
      return FAILED;
    } finally {
      global.clearInterval(heartbeat);
      record.ms = Math.round(now() - started);
      api.current = null;
      refreshPanel();
    }
  }

  async function toBytes(data, label) {
    if (data == null) throw new Error(label + " has no data.");
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data.arrayBuffer === "function") {
      return new Uint8Array(await withTimeout(data.arrayBuffer(), budget(data.size), "Reading " + label));
    }
    throw new Error(label + " is not readable data (" + Object.prototype.toString.call(data) + ").");
  }
  async function toBlob(data, label) {
    return data instanceof Blob ? data : new Blob([await toBytes(data, label)]);
  }
  async function hex(buffer) {
    const digest = await global.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  // CM3 asset IDs: SHA-256 of the first 256 MB, read as little-endian words,
  // first 32 hex digits. 64-digit IDs are a plain SHA-256.
  async function contentId(blob, name) {
    if (/^[a-f0-9]{64}$/.test(name)) return hex(await toBytes(blob, name));
    const digest = await global.crypto.subtle.digest("SHA-256", await toBytes(blob.slice(0, 268435456), name));
    return Array.from(new Uint32Array(digest), value => value.toString(16).padStart(8, "0")).join("").slice(0, 32);
  }

  // ------------------------------------------------------------ TAR + gzip
  function tarHeader(name, size) {
    const encoder = new TextEncoder();
    const header = new Uint8Array(512);
    const octal = (offset, length, value) => header.set(encoder.encode(value.toString(8).padStart(length - 1, "0") + "\0"), offset);
    header.set(encoder.encode(name));
    octal(100, 8, 0o644);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, size);
    octal(136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = 48;
    header.set(encoder.encode("ustar\0"), 257);
    header.set(encoder.encode("00"), 263);
    octal(148, 7, header.reduce((sum, value) => sum + value, 0));
    header[155] = 32;
    return header;
  }
  async function encodeArchive(entries) {
    if (typeof global.CompressionStream === "function") {
      const parts = [];
      for (const entry of entries) {
        parts.push(tarHeader(entry.name, entry.data.size), entry.data, new Uint8Array((512 - entry.data.size % 512) % 512));
      }
      parts.push(new Uint8Array(1024));
      const stream = new Blob(parts).stream().pipeThrough(new global.CompressionStream("gzip"));
      return new Blob([await new Response(stream).blob()], { type: "application/octet-stream" });
    }
    // Old browsers: CM3's own tar worker produces the same gzip TAR format.
    if (!global.PZ || typeof global.PZ.archive !== "function") throw new Error("Neither CompressionStream nor CM3's tar worker is available.");
    issue("warn", "CompressionStream is unavailable; using CM3's tar worker instead.");
    const archive = new global.PZ.archive();
    for (const entry of entries) archive.addFile(entry.name, entry.data);
    const blob = await archive.tar();
    if (!blob || !blob.size) throw new Error("CM3's tar worker returned no archive.");
    return blob;
  }
  async function decodeArchive(blob) {
    const head = await toBytes(blob.slice(0, 2), "archive header");
    let tar = blob;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof global.DecompressionStream !== "function") throw new Error("DecompressionStream is unavailable.");
      tar = await new Response(blob.stream().pipeThrough(new global.DecompressionStream("gzip"))).blob();
    }
    const entries = [];
    const decoder = new TextDecoder();
    let offset = 0;
    let longName = null;
    while (offset + 512 <= tar.size) {
      const header = await toBytes(tar.slice(offset, offset + 512), "TAR header");
      offset += 512;
      if (header.every(value => value === 0)) break;
      const text = (start, length) => decoder.decode(header.subarray(start, start + length)).split("\0")[0];
      const prefix = text(345, 155);
      const size = parseInt(text(124, 12).trim() || "0", 8);
      if (!Number.isFinite(size) || size < 0) throw new Error("Unreadable TAR size at byte " + (offset - 512) + ".");
      const type = header[156];
      const data = tar.slice(offset, offset + size);
      if (type === 76) longName = decoder.decode(await toBytes(data, "long name")).split("\0")[0];
      else if (type === 0 || type === 48) {
        entries.push({ name: longName || (prefix ? prefix + "/" : "") + text(0, 100), data });
        longName = null;
      }
      offset += Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  // ------------------------------------------------------- serialization
  // Mirrors JSON.stringify, but an object whose toJSON throws, a cycle, or a
  // throwing getter only loses that one object instead of the whole project.
  function safeSerialize(root, rootPath) {
    const ancestors = new Set();
    const generic = ["type", "objectType", "start", "length", "link", "properties", "customProperties",
      "material", "effects", "operations", "objects", "clips", "object", "title", "keyframes", "animated", "value"];
    function walk(value, key, path, depth) {
      if (depth > 256) { issue("error", path + ": nesting deeper than 256 levels was cut."); return DROP; }
      if (value !== null && (typeof value === "object" || typeof value === "function") && typeof read(value, "toJSON") === "function") {
        try { value = value.toJSON(key); } catch (error) {
          const fallback = {};
          for (const field of generic) {
            const child = read(value, field);
            if (child !== undefined && typeof child !== "function") fallback[field] = child;
          }
          if (!isObject(fallback.properties) && typeof read(fallback.properties, "toJSON") !== "function") {
            issue("error", path + ": its toJSON() threw (" + describe(error) + "). This object was left out.");
            return DROP;
          }
          issue("error", path + ": its toJSON() threw (" + describe(error) + "). A generic copy of its fields was kept.");
          value = fallback;
        }
      }
      if (value === null) return null;
      switch (typeof value) {
        case "string": case "boolean": return value;
        case "number": return Number.isFinite(value) ? value : null;
        case "bigint": return Number(value);
        case "undefined": case "function": case "symbol": return SKIP;
        default: break;
      }
      if (value instanceof Number || value instanceof String || value instanceof Boolean) return value.valueOf();
      if (ancestors.has(value)) { issue("warn", path + ": circular reference was left out."); return DROP; }
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const out = [];
          for (let index = 0; index < value.length; index += 1) {
            const child = walk(read(value, index), String(index), path + "[" + index + "]", depth + 1);
            if (child === SKIP) out.push(null);
            else if (child !== DROP) out.push(child);
          }
          return out;
        }
        const out = {};
        let keys = [];
        try { keys = Object.keys(value); } catch (error) { issue("error", path + ": keys unreadable (" + describe(error) + ")."); }
        for (const name of keys) {
          let child;
          try { child = value[name]; } catch (error) { issue("warn", path + "." + name + ": getter threw (" + describe(error) + ")."); continue; }
          const result = walk(child, name, path + "." + name, depth + 1);
          if (result !== SKIP && result !== DROP) out[name] = result;
        }
        return out;
      } finally { ancestors.delete(value); }
    }
    const result = walk(root, "", rootPath, 0);
    return result === SKIP || result === DROP ? undefined : result;
  }

  function serializeProjectByParts(project, PZ) {
    const document = {};
    document.assets = safeSerialize(read(project, "assets"), "project.assets");
    let media = read(project, "media");
    try { media = Array.from(media || []).filter(item => !read(item, "preset")); } catch (_error) { /* keep as is */ }
    document.media = safeSerialize(media, "project.media");
    document.sequence = safeSerialize(read(project, "sequence"), "project.sequence");
    const plugins = read(project, "_zoidiumProjectPlugins");
    if (Array.isArray(plugins) && plugins.length) {
      document.plugins = plugins.map(plugin => {
        const copy = {};
        for (const [key, value] of Object.entries(plugin || {})) copy[key] = value instanceof Set ? Array.from(value) : value;
        return copy;
      });
    }
    if (!PZ) issue("warn", "PZ is missing; the project was serialized without CM3 helpers.");
    return document;
  }

  // ------------------------------------------------------------ project
  function looksLikeProject(project) {
    return Boolean(project && typeof project === "object" && isObject(read(read(project, "assets"), "list")) && read(project, "sequence") && read(project, "media"));
  }
  function findEditor() {
    const named = ["CM", "editor", "VE", "ve"].map(name => read(global, name));
    for (const candidate of named) if (looksLikeProject(read(candidate, "project"))) return candidate;
    let names = [];
    try { names = Object.getOwnPropertyNames(global); } catch (_error) { /* nothing to scan */ }
    for (const name of names) {
      const candidate = read(global, name);
      if (candidate && typeof candidate === "object" && looksLikeProject(read(candidate, "project"))) return candidate;
    }
    return null;
  }
  function projectName(editor) {
    let name = "";
    try { name = read(read(read(global.PZ, "zoidium"), "projectFiles"), "getProjectName")(editor); } catch (_error) { name = read(editor, "_zoidiumProjectName"); }
    name = String(name || "project").replace(/\.pz$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().slice(0, 100);
    return name || "project";
  }

  async function diagnoseEditor(editor, project) {
    if (await pending(read(editor, "_zoidiumSavePromise"))) {
      diagnose("A previous Save has never finished. Every Save click returns that same stuck operation, so the button seems to do nothing.");
    }
    if (await pending(read(editor, "_zoidiumTransitionPromise"))) {
      diagnose("A previous open/restore operation has never finished, which blocks opening and restoring projects.");
    }
    if (await pending(read(project, "_zoidiumPluginActivationPending"))) {
      diagnose("Project plugin activation has not finished. Zoidium's Save and restore points wait for it before saving.");
    }
    const stuck = [];
    const visited = new WeakSet();
    async function visit(object, path, depth) {
      if (!object || typeof object !== "object" || visited.has(object) || depth > 64 || stuck.length >= 20) return;
      visited.add(object);
      if (await pending(read(object, "loading"))) {
        stuck.push(path + " (" + (read(object, "defaultName") || read(object, "baseTypeString") || read(object, "type") || "object") + ")");
      }
      const children = Array.isArray(object) ? object : read(object, "children");
      if (children && typeof children.length === "number") {
        for (let index = 0; index < children.length; index += 1) await visit(read(children, index), path + "/" + index, depth + 1);
      }
    }
    await visit(project, "project", 0);
    if (stuck.length) {
      diagnose("These objects never finished loading, and Zoidium's Save/restore points wait for them: " + stuck.join(", "));
    }
    try {
      const dialogs = Array.from(global.document.querySelectorAll("[class*=dialog],[class*=modal],[role=dialog]"))
        .filter(element => element.offsetParent !== null || global.getComputedStyle(element).position === "fixed");
      if (dialogs.length) {
        const names = dialogs.slice(0, 5).map(element => (element.getAttribute("aria-label") || element.className || element.tagName).toString().slice(0, 60));
        log.log(TAG + " Dialog-like elements on screen (an unanswered or hidden confirmation can hold Save open): " + names.join(" | "));
      }
    } catch (_error) { /* diagnostics only */ }
  }

  // --------------------------------------------------------------- assets
  function snapshotAssets(project) {
    const list = read(read(project, "assets"), "list") || {};
    return Object.keys(list).map(key => {
      const asset = read(list, key) || {};
      const source = read(asset, "source");
      const record = {
        key, sha256: read(asset, "sha256") || "", filename: read(asset, "filename") || "", size: Number(read(asset, "size")) || 0,
        source, external: read(asset, "external") === true, url: read(asset, "url"), file: read(asset, "file"),
        bytes: null, status: "pending", note: "",
      };
      record.name = record.sha256 || key;
      record.needsBytes = !(record.external || source === 3 || source === 4);
      return record;
    });
  }
  async function readAssetBytes(asset) {
    const label = "asset " + (asset.filename || asset.name);
    if (asset.file) {
      try {
        const file = asset.file;
        // Copy files up to 256 MB into memory so later disk changes cannot
        // break packaging; larger ones stay disk-backed after a read probe.
        if (file instanceof Blob && file.size > LARGE_BYTES) {
          await toBytes(file.slice(0, 1), label);
          await toBytes(file.slice(file.size - 1), label);
          asset.bytes = file;
        } else {
          asset.bytes = await toBlob(file, label);
        }
        if (asset.bytes.size) { asset.status = "read"; return; }
        asset.bytes = null;
        asset.note = "attached file is empty";
      } catch (error) { asset.bytes = null; asset.note = "attached file unreadable: " + describe(error); }
    }
    if (typeof asset.url === "string" && asset.url.startsWith("blob:")) {
      try {
        const response = await withTimeout(global.fetch(asset.url), 30000, "Reading the in-page copy of " + label);
        const blob = await withTimeout(response.blob(), budget(asset.size), "Reading the in-page copy of " + label);
        if (blob.size) { asset.bytes = blob; asset.status = "read from in-page copy"; return; }
      } catch (error) { asset.note += (asset.note ? "; " : "") + "in-page copy unreadable: " + describe(error); }
    }
    asset.status = asset.needsBytes ? "MISSING" : "not needed (preset/external)";
  }

  // ------------------------------------------------------------- analysis
  function findDangling(document) {
    const found = [];
    const assets = isObject(document.assets) ? document.assets : {};
    (function visit(value, path, field, depth) {
      if (depth > 256) return;
      if (typeof value === "string") {
        if (ASSET_FIELD.test(field) && ASSET_ID.test(value) && !has(assets, value)) found.push({ path, id: value });
      } else if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          if (path === "project" && key === "assets") continue;
          const nextField = ASSET_FIELD.test(field) && /^(?:value|keyframes|objects|\d+)$/.test(key) ? field : key;
          visit(value[key], path + "." + key, nextField, depth + 1);
        }
      }
    })(document, "project", "", 0);
    return found;
  }
  // Applies safe repairs to a deep copy; the live project is never touched.
  function repairDocument(document, liveAssets) {
    const repairs = [];
    const byKey = new Map(liveAssets.map(asset => [asset.key, asset]));
    for (const key of Object.keys(document.assets)) {
      if (isObject(document.assets[key])) continue;
      const live = byKey.get(key);
      if (!live) continue;
      document.assets[key] = { sha256: live.sha256, url: live.source !== 1 ? live.url : undefined, source: live.source,
        external: live.external, size: live.size, filename: live.filename };
      repairs.push("Rebuilt the asset table entry for " + (live.filename || key) + ".");
    }
    for (const live of liveAssets) {
      const entry = document.assets[live.key];
      if (live.bytes && live.verified && isObject(entry) && entry.size > 0 && entry.size !== live.bytes.size) {
        repairs.push("Corrected the recorded size of " + (live.filename || live.key) + " to its verified bytes.");
        entry.size = live.bytes.size;
      }
    }
    document.media.forEach((media, index) => {
      if (isObject(media) && "thumbnail" in media && typeof media.thumbnail !== "string") {
        delete media.thumbnail;
        repairs.push("Removed a broken runtime thumbnail from media[" + index + "].");
      }
    });
    // A Node Material's "nodeImage" only mirrors the editor's selection. A
    // stale ID there blocks old savers; clear it only when the graph itself
    // does not use that ID.
    (function visit(value, path, depth) {
      if (!value || typeof value !== "object" || depth > 256) return;
      const properties = value.properties;
      if (isObject(properties) && typeof properties.nodeImage === "string" && ASSET_ID.test(properties.nodeImage) &&
          !has(document.assets, properties.nodeImage)) {
        let graphText = null;
        try { graphText = typeof properties.graph === "string" ? properties.graph : JSON.stringify(properties.graph); } catch (_error) { graphText = null; }
        if (graphText != null && !graphText.includes(properties.nodeImage)) {
          repairs.push("Cleared a stale node-editor image selection at " + path + ".properties.nodeImage.");
          properties.nodeImage = null;
        }
      }
      for (const key of Object.keys(value)) visit(value[key], path + "." + key, depth + 1);
    })({ sequence: document.sequence, media: document.media }, "project", 0);
    return repairs;
  }

  // ------------------------------------------------------------ packaging
  async function buildEntries(meta, document, assets, name) {
    const entries = [
      { name: "meta", data: new Blob([meta]) },
      { name: "project", data: new Blob([JSON.stringify(document)]) },
    ];
    const names = new Set(["meta", "project", "zoidium.json"]);
    for (const asset of assets) {
      if (!asset.bytes || names.has(asset.name)) continue;
      if (new TextEncoder().encode(asset.name).length > 100) {
        issue("warn", "Asset " + asset.name + " has a name longer than a TAR entry allows and was skipped.");
        continue;
      }
      names.add(asset.name);
      entries.push({ name: asset.name, data: asset.bytes });
    }
    const metadata = { version: 1, name };
    const total = entries.reduce((sum, entry) => sum + entry.data.size, 0);
    if (total > 4 * LARGE_BYTES || entries.some(entry => entry.data.size > 2 * LARGE_BYTES)) {
      issue("info", "Integrity data was left out to save memory (" + megabytes(total) + "). The file still opens without it.");
    } else try {
      const integrity = {};
      for (const entry of entries) {
        integrity[entry.name] = { size: entry.data.size, sha256: await withTimeout(toBytes(entry.data, entry.name).then(hex), budget(entry.data.size), "Hashing " + entry.name) };
      }
      metadata.integrity = integrity;
    } catch (error) {
      issue("warn", "Integrity data was left out (" + describe(error) + "). The file still opens without it.");
    }
    entries.push({ name: "zoidium.json", data: new Blob([JSON.stringify(metadata)]) });
    return entries;
  }
  async function verifyArchive(blob, entries) {
    const decoded = await decodeArchive(blob);
    const byName = new Map(decoded.map(entry => [entry.name, entry]));
    for (const entry of entries) {
      const found = byName.get(entry.name);
      if (!found) throw new Error("Entry " + entry.name + " is missing after re-reading the archive.");
      if (found.data.size !== entry.data.size) throw new Error("Entry " + entry.name + " changed size after re-reading the archive.");
    }
    const document = JSON.parse(await byName.get("project").data.text());
    if (!isObject(document) || !isObject(document.sequence) || !Array.isArray(document.media)) throw new Error("The re-read project data is incomplete.");
    return decoded.length;
  }
  async function pageValidator(blob) {
    const files = read(read(global.PZ, "zoidium"), "projectFiles");
    if (!files || typeof files.openValidatedArchive !== "function") return "not available in this page";
    try {
      await files.openValidatedArchive(blob, "open");
      return "accepted";
    } catch (error) {
      return (error && error.partialArchive ? "opens with some assets missing: " : "rejected: ") + describe(error);
    }
  }
  async function packageOutput(kind, label, entries, note) {
    const record = { kind, label, filename: "", blob: null, verified: false, validator: "", note };
    await step("Package " + label, 600000, async status => {
      record.blob = await encodeArchive(entries);
      status.detail = megabytes(record.blob.size);
    });
    if (!record.blob) return null;
    await step("Re-read and check " + label, 600000, async status => {
      status.detail = (await verifyArchive(record.blob, entries)) + " entries";
      record.verified = true;
    });
    await step("Zoidium validator on " + label + " (information only)", 180000, async status => {
      // The validator holds every asset in memory; skip it for huge projects
      // so the check itself cannot crash the tab that holds the only copy.
      record.validator = record.blob.size > 2 * LARGE_BYTES ? "skipped for a project this large" : await pageValidator(record.blob);
      status.detail = record.validator;
    });
    record.filename = api.baseName + "-" + kind + ".pz";
    api.outputs[kind] = record;
    return record;
  }

  // ------------------------------------------------------------- delivery
  function anchorDownload(blob, filename) {
    const url = global.URL.createObjectURL(blob);
    const link = global.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    (global.document.body || global.document.documentElement).appendChild(link);
    try { link.click(); } catch (_error) { link.dispatchEvent(new MouseEvent("click", { bubbles: false })); }
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 600000);
    log.log(TAG + " Download started: " + filename + " (" + megabytes(blob.size) + "). If no file appears, use the buttons in the rescue panel (PZRescue.panel()) or PZRescue.urls().");
  }
  // From a button click, the File System Access picker writes the file
  // directly and bypasses the browser download system.
  async function deliver(blob, filename, allowPicker) {
    if (!blob || !blob.size) throw new Error("That file is not available. Check the step table above.");
    if (allowPicker && typeof global.showSaveFilePicker === "function") {
      try {
        const handle = await global.showSaveFilePicker({ suggestedName: filename });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        log.log(TAG + " Saved " + handle.name + " (" + megabytes(blob.size) + ").");
        return "saved";
      } catch (error) {
        if (error && error.name === "AbortError") return "cancelled";
        issue("warn", "The save picker failed (" + describe(error) + "); falling back to a download.");
      }
    }
    anchorDownload(blob, filename);
    return "download";
  }
  api.download = function (kind) {
    const output = api.outputs[kind || api.best];
    if (!output) throw new Error("No \"" + kind + "\" file. Available: " + Object.keys(api.outputs).join(", "));
    return deliver(output.blob, output.filename, false);
  };
  api.urls = function () {
    for (const output of Object.values(api.outputs)) {
      log.log(TAG + " " + output.filename + ": " + global.URL.createObjectURL(output.blob) + "  (open in a new tab; rename the download to .pz if needed)");
    }
  };
  api.downloadAssets = async function () {
    const assets = api.assets.filter(asset => asset.bytes);
    let directory = null;
    if (typeof global.showDirectoryPicker === "function") {
      try { directory = await global.showDirectoryPicker({ mode: "readwrite" }); } catch (_error) { directory = null; }
    }
    for (const asset of assets) {
      const filename = (asset.filename || asset.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
      try {
        if (directory) {
          const writable = await (await directory.getFileHandle(asset.name.slice(0, 8) + "-" + filename, { create: true })).createWritable();
          await writable.write(asset.bytes);
          await writable.close();
        } else {
          anchorDownload(asset.bytes, filename);
          await new Promise(resolve => global.setTimeout(resolve, 400));
        }
      } catch (error) { issue("error", "Could not save asset " + filename + ": " + describe(error)); }
    }
    log.log(TAG + " Asset export finished: " + assets.length + " file(s).");
  };

  // ------------------------------------------------------- restore points
  async function openRestoreDatabase() {
    if (!global.indexedDB) throw new Error("IndexedDB is unavailable in this page.");
    if (typeof global.indexedDB.databases === "function") {
      const list = await withTimeout(global.indexedDB.databases(), 10000, "Listing IndexedDB databases");
      if (!list.some(entry => entry.name === RESTORE_DB)) return null;
    }
    return withTimeout(new Promise((resolve, reject) => {
      let absent = false;
      const request = global.indexedDB.open(RESTORE_DB);
      // Never create the database when it does not exist.
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => (absent ? resolve(null) : reject(request.error || new Error("Opening restore-point storage failed.")));
      request.onblocked = () => reject(new Error("Restore-point storage is blocked by another Zoidium tab. Close other tabs and retry."));
    }), 15000, "Opening restore-point storage");
  }
  function readStore(database, store, method, argument) {
    return withTimeout(new Promise((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store)[method](argument);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Reading " + store + " failed."));
    }), 60000, "Reading restore-point " + store);
  }
  api.restorePoints = async function () {
    if (!global.indexedDB) { log.log(TAG + " IndexedDB is unavailable here, so there are no restore points to read."); return []; }
    const database = await openRestoreDatabase();
    if (!database) { log.log(TAG + " This browser profile has no restore points for this site."); return []; }
    try {
      const records = await readStore(database, "snapshots", "getAll");
      const lease = records.find(record => record && record.id === RESTORE_LEASE);
      if (lease && Number(lease.expiresAt) > Date.now()) {
        diagnose("A restore-point write lock is held until " + new Date(lease.expiresAt).toLocaleTimeString() + "; new restore points wait for it.");
      }
      api.restorePointList = records.filter(record => record && record.id !== RESTORE_LEASE)
        .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
      log.table(api.restorePointList.map((record, index) => ({
        index, name: record.projectName || "project", created: record.createdAt ? new Date(record.createdAt).toLocaleString() : "?",
        manual: record.automatic === false, kind: record.blob ? "full" : "split",
        size: megabytes((record.blob || record.projectBlob || {}).size),
      })));
      log.log(TAG + " Run await PZRescue.downloadRestorePoint(index) for any row, without validation.");
      return api.restorePointList;
    } finally { database.close(); }
  };
  // Rebuilds a restore point as a .pz without Zoidium's validator, so a
  // point the normal Download button refuses can still be inspected.
  async function restorePointBlob(record) {
    if (record.blob) {
      await toBytes(record.blob.slice(0, 1), "restore point");
      return record.blob;
    }
    if (!record.projectBlob || !Array.isArray(record.assetRefs)) throw new Error("This restore point has no archive data.");
    const entries = (await decodeArchive(record.projectBlob)).filter(entry => entry.name !== "zoidium.json");
    const database = await openRestoreDatabase();
    if (!database) throw new Error("Restore-point storage disappeared.");
    try {
      for (const ref of record.assetRefs) {
        try {
          const stored = await readStore(database, "assets", "get", ref.id);
          if (!stored || !stored.blob) { issue("error", "Restore point asset is missing: " + ref.name); continue; }
          entries.push({ name: ref.name, data: await toBlob(stored.blob, ref.name) });
        } catch (error) { issue("error", "Restore point asset " + ref.name + " is unreadable: " + describe(error)); }
      }
    } finally { database.close(); }
    entries.push({ name: "zoidium.json", data: new Blob([JSON.stringify({ version: 1, name: record.projectName || "project" })]) });
    return encodeArchive(entries);
  }
  api.downloadRestorePoint = async function (index, allowPicker) {
    const list = api.restorePointList || await api.restorePoints();
    const record = list[index];
    if (!record) throw new Error("No restore point with index " + index + ".");
    const name = String(record.projectName || "project").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
    const stamp = record.createdAt ? new Date(record.createdAt).toISOString().replace(/[:.]/g, "-") : "unknown";
    let blob;
    try { blob = await restorePointBlob(record); } catch (error) {
      log.error(TAG + " FAILED to read restore point " + index + ": " + describe(error), error);
      throw error;
    }
    return deliver(blob, name + "-restore-point-" + stamp + ".pz", allowPicker === true);
  };

  // ---------------------------------------------------------------- panel
  // Run as a bookmarklet, the panel is the whole interface: it shows live
  // progress, the failing step, the files, and where to report a bug.
  let panelClosed = false;
  function refreshPanel() {
    if (panelClosed || !global.document || !global.document.getElementById("pzrescue-panel")) return;
    try { api.panel(); } catch (_error) { /* the Console still has every message */ }
  }
  async function copyReport() {
    const text = api.report();
    try {
      await global.navigator.clipboard.writeText(text);
      return "copied";
    } catch (_error) {
      anchorDownload(new Blob([text], { type: "text/plain" }), "zoidium-rescue-report.txt");
      return "downloaded";
    }
  }
  api.panel = function () {
    const document = global.document;
    panelClosed = false;
    const old = document.getElementById("pzrescue-panel");
    if (old) old.remove();
    const panel = document.createElement("div");
    panel.id = "pzrescue-panel";
    panel.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;width:350px;max-height:85vh;overflow:auto;" +
      "background:var(--zui-bg, #1d1f24);color:var(--zui-text, #eee);font:12px/1.45 system-ui,sans-serif;padding:12px;border:2px solid var(--zui-value, #e8a33c);" +
      "border-radius:8px;box-shadow:0 6px 24px color-mix(in srgb,var(--zui-shadow, black) 67%,transparent);pointer-events:auto;user-select:text;text-align:left";
    const add = (tag, text, style, parent) => {
      const element = document.createElement(tag);
      element.textContent = text;
      if (style) element.style.cssText = style;
      (parent || panel).appendChild(element);
      return element;
    };
    const button = (text, handler, color) => {
      const element = add("button", text, "display:block;width:100%;margin:6px 0;padding:7px;color:var(--zui-text-bright, #fff);border:0;" +
        "border-radius:5px;cursor:pointer;text-align:left;font:inherit;background:" + (color || "var(--zui-accent, #2f6fd6)"));
      element.addEventListener("click", event => {
        event.stopPropagation();
        Promise.resolve().then(handler).then(result => {
          if (typeof result === "string") element.textContent = text + " - " + result;
        }, error => {
          log.error(TAG + " " + text + " failed: " + describe(error), error);
          element.textContent = text + " - failed: " + describe(error);
        });
      }, true);
      return element;
    };
    const outputs = Object.values(api.outputs);
    const packaged = outputs.some(output => output.kind !== "json");
    add("div", "Zoidium project rescue", "font-weight:bold;font-size:14px;margin-bottom:4px");
    add("div", !api.finished ? "Working: " + (api.current || "starting") + " ..." :
      packaged ? "Done. The rescued file was downloaded; it is also available below." : "Finished, but no project file could be built.",
    "margin-bottom:4px;color:" + (!api.finished ? "var(--zui-value, #9ecbff)" : packaged ? "var(--zui-value, #9be29b)" : "var(--zui-danger, #ff8a80)"));
    add("div", "Keep this tab open until a rescued file opens correctly in another tab.", "opacity:.8;margin-bottom:6px");
    const steps = add("div", "", "margin:6px 0;font-size:11px;max-height:170px;overflow:auto;border-top:1px solid var(--zui-bg-input, #444);padding-top:4px");
    for (const record of api.steps) {
      const label = { ok: "[ok] ", running: "[..] ", FAILED: "[FAILED] ", STUCK: "[STUCK] " }[record.status] || "";
      add("div", label + record.step + (record.status !== "ok" && record.detail ? ": " + record.detail : ""),
        "color:" + (record.status === "ok" ? "var(--zui-text-muted, #aaa)" : record.status === "running" ? "var(--zui-value, #9ecbff)" : "var(--zui-danger, #ff8a80)"), steps);
    }
    api.diagnosis.forEach(text => add("div", "Diagnosis: " + text, "color:var(--zui-danger, #ffd27a);font-size:11px;margin:4px 0"));
    for (const output of outputs) {
      button("Save " + output.label + " (" + megabytes(output.blob.size) + ")", () => deliver(output.blob, output.filename, true));
      add("div", output.note + (output.validator ? " Zoidium check: " + output.validator : ""), "opacity:.75;font-size:11px;margin:-2px 0 6px");
    }
    if (api.finished && api.assets.some(asset => asset.bytes)) button("Save attached asset files (images, video, audio, fonts)", () => api.downloadAssets());
    if (api.finished) {
      const pointsArea = api.pointsArea || (api.pointsArea = document.createElement("div"));
      button("List restore points", async () => {
        const list = await api.restorePoints();
        pointsArea.textContent = list.length ? "" : "No restore points.";
        list.slice(0, 40).forEach((record, index) => {
          const when = record.createdAt ? new Date(record.createdAt).toLocaleString() : "unknown time";
          const element = add("button", "Restore point " + index + ": " + (record.projectName || "project") + ", " + when,
            "display:block;width:100%;margin:4px 0;padding:5px;background:var(--zui-bg-input, #444);color:var(--zui-text-bright, #fff);border:0;border-radius:4px;cursor:pointer;text-align:left", pointsArea);
          element.addEventListener("click", event => {
            event.stopPropagation();
            api.downloadRestorePoint(index, Boolean(record.blob)).catch(error => { element.textContent += " - failed: " + describe(error); });
          }, true);
        });
      }, "var(--zui-hover, #555)");
      panel.appendChild(pointsArea);
    }
    const help = add("div", "Still not working? Report the bug on the Zoidium Discord server and paste the copied report.",
      "margin-top:10px;padding-top:8px;border-top:1px solid var(--zui-bg-input, #444)");
    const link = add("a", "Open the Zoidium Discord: " + SUPPORT_URL.replace("https://", ""), "display:block;color:var(--zui-value, #8fb8ff);margin-top:4px", help);
    link.href = SUPPORT_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    button("Copy report for the bug report", copyReport, "var(--zui-hover, #555)");
    button("Close panel (PZRescue.panel() reopens it)", () => { panelClosed = true; panel.remove(); }, "var(--zui-bg-title, #333)");
    document.documentElement.appendChild(panel);
    return panel;
  };

  api.report = function () {
    return JSON.stringify({
      startedAt: api.startedAt, page: read(global.location, "origin") + read(global.location, "pathname"),
      userAgent: read(global.navigator, "userAgent"), steps: api.steps, diagnosis: api.diagnosis, issues: api.issues, repairs: api.repairs,
      dangling: api.dangling.slice(0, 50),
      assets: api.assets.map(asset => ({ name: asset.name, filename: asset.filename, size: asset.size, status: asset.status, note: asset.note })),
      outputs: Object.values(api.outputs).map(output => ({ kind: output.kind, size: output.blob.size, verified: output.verified, validator: output.validator })),
    }, null, 2);
  };

  // ------------------------------------------------------------------ run
  async function run() {
    log.log(TAG + " Starting. Do not edit, play, refresh or close this tab until the summary appears.");
    try { api.panel(); } catch (error) { issue("error", "The rescue panel could not be shown: " + describe(error)); }
    const PZ = global.PZ;
    const editor = await step("Find the open editor and project", 20000, status => {
      const found = findEditor();
      if (!found) throw new Error("No editor with a project was found on this page. Run the rescue tool on the Zoidium editor tab (in DevTools, the Console context must be \"top\").");
      status.detail = "PZ " + (PZ ? "present" : "MISSING") + ", Zoidium " + (read(PZ, "zoidium") ? "present" : "absent");
      return found;
    });
    if (editor === FAILED) {
      await step("Check restore-point storage", 60000, async status => { status.detail = (await api.restorePoints()).length + " restore point(s)"; });
      return finish();
    }
    const project = editor.project;
    api.baseName = projectName(editor) + "-rescue-" + api.startedAt.replace(/[:.]/g, "-");
    // Hold every asset's File/Blob before anything else can change the list.
    api.assets = snapshotAssets(project);
    log.log(TAG + " " + api.assets.length + " asset(s) in the project's asset table.");
    await step("Look for stuck save and load operations", 30000, () => diagnoseEditor(editor, project));

    let projectText = null;
    let metaText = null;
    const viaCm3 = await step("Serialize with CM3's PZ.project.save", 60000, async status => {
      const archive = new PZ.archive();
      await PZ.project.save(archive, project);
      const projectEntry = archive.peekFile("project");
      const metaEntry = archive.peekFile("meta");
      if (!projectEntry) throw new Error("CM3 wrote no project entry.");
      projectText = new TextDecoder().decode(await toBytes(projectEntry.data, "project entry"));
      if (metaEntry) metaText = new TextDecoder().decode(await toBytes(metaEntry.data, "meta entry"));
      status.detail = megabytes(projectText.length);
    });
    if (viaCm3 === FAILED || !projectText || projectText.trim() === "undefined") {
      projectText = null;
      await step("Serialize with JSON.stringify(project)", 60000, status => {
        const text = JSON.stringify(project);
        if (!text || text === "undefined") throw new Error("project.toJSON() returned nothing.");
        projectText = text;
        status.detail = megabytes(text.length);
      });
    }
    let document = null;
    if (projectText) {
      try { document = JSON.parse(projectText); } catch (error) { issue("error", "Serialized project is not valid JSON: " + describe(error)); }
    }
    if (!isObject(document)) {
      await step("Serialize object by object (skips only broken objects)", 120000, status => {
        let whole = safeSerialize(project, "project");
        if (!isObject(whole) || !isObject(whole.sequence)) whole = serializeProjectByParts(project, PZ);
        document = whole;
        status.detail = "partial serialization; see warnings above for anything left out";
      });
    }
    if (!isObject(document)) {
      log.error(TAG + " The project could not be serialized by any method.");
      return finish();
    }
    await step("Check the project structure", 30000, status => {
      const parts = serializeProjectByParts.bind(null, project, PZ);
      let rebuilt = null;
      if (!isObject(document.assets)) { rebuilt = rebuilt || parts(); document.assets = rebuilt.assets || {}; issue("error", "The asset table was missing and was rebuilt from the live project."); }
      if (!Array.isArray(document.media)) { rebuilt = rebuilt || parts(); document.media = Array.isArray(rebuilt.media) ? rebuilt.media : []; issue("error", "The media list was missing and was rebuilt."); }
      if (!isObject(document.sequence)) { rebuilt = rebuilt || parts(); document.sequence = rebuilt.sequence || {}; issue("error", "The sequence was missing and was rebuilt."); }
      status.detail = Object.keys(document.assets).length + " asset entries, " + document.media.length + " media items";
    });
    if (!metaText) {
      let version = null;
      try { version = PZ.compatibility.getCurrentVersion(); } catch (_error) { version = typeof global.PZVERSION === "string" && global.PZVERSION !== "dev" ? global.PZVERSION : null; }
      if (!version) { version = "1.0.102"; issue("warn", "CM3's version is unknown; meta version 1.0.102 was written."); }
      metaText = JSON.stringify({ version });
    }
    api.json = new Blob([JSON.stringify(document)], { type: "application/json" });

    await step("Read attached asset files", 1800000, async status => {
      for (const asset of api.assets) {
        await readAssetBytes(asset);
        if (asset.status === "MISSING") {
          issue("error", "No bytes for asset \"" + (asset.filename || asset.name) + "\" (" + asset.name + ")" + (asset.note ? ": " + asset.note : "") +
            ". It will open as a missing asset; relink it with Media > Missing assets > Locate.");
        }
      }
      status.detail = api.assets.filter(asset => asset.bytes).length + " read, " + api.assets.filter(asset => asset.status === "MISSING").length + " missing";
    });
    await step("Check asset contents against their IDs", 1800000, async status => {
      if (!global.crypto || !global.crypto.subtle) { status.detail = "skipped: hashing unavailable"; return; }
      let wrong = 0;
      for (const asset of api.assets) {
        if (!asset.bytes || !ASSET_ID.test(asset.name)) continue;
        try {
          asset.verified = await withTimeout(contentId(asset.bytes, asset.name), budget(asset.bytes.size), "Hashing " + asset.name) === asset.name;
          if (!asset.verified) { wrong += 1; issue("warn", "Asset \"" + (asset.filename || asset.name) + "\" has bytes that do not match its ID " + asset.name + ". It is kept; Zoidium may open the project without it."); }
        } catch (error) { issue("warn", "Could not hash " + asset.name + ": " + describe(error)); }
      }
      status.detail = wrong ? wrong + " mismatch(es)" : "all match";
    });
    await step("Find references to assets that no longer exist", 60000, status => {
      api.dangling = findDangling(document);
      if (api.dangling.length) {
        issue("warn", api.dangling.length + " reference(s) point to assets missing from the asset table (older Zoidium refuses to save these):", api.dangling.slice(0, 20));
        diagnose("References to missing assets were found. Zoidium core < 41 refuses to save or create restore points while they exist.");
      }
      status.detail = api.dangling.length + " found";
    });

    const name = projectName(editor);
    const repaired = JSON.parse(JSON.stringify(document));
    await step("Prepare the repaired copy", 60000, status => {
      api.repairs = repairDocument(repaired, api.assets);
      api.repairs.forEach(text => log.log(TAG + " repair: " + text));
      status.detail = api.repairs.length + " repair(s)";
    });
    const best = api.repairs.length ? "repaired" : "rescued";
    const repairedEntries = await step("Assemble files for the " + best + " copy", 1800000, () => buildEntries(metaText, repaired, api.assets, name));
    if (repairedEntries !== FAILED) {
      await packageOutput(best, best + " project", repairedEntries,
        api.repairs.length ? "Current project with " + api.repairs.length + " safe repair(s). Try this first." : "Current project, as it is. Try this first.");
    }
    if (api.repairs.length) {
      const rawEntries = await step("Assemble files for the unmodified copy", 1800000, () => buildEntries(metaText, document, api.assets, name));
      if (rawEntries !== FAILED) await packageOutput("raw", "unmodified project", rawEntries, "Exact capture without repairs. Keep it as a backup.");
    }
    api.outputs.json = { kind: "json", label: "project JSON only (no media)", filename: api.baseName + "-project.json", blob: api.json, verified: true, validator: "",
      note: "Editing data without image/video/audio bytes. Last resort." };
    api.best = api.outputs[best] ? best : api.outputs.raw ? "raw" : "json";

    if (api.best !== "json") {
      await step("Start download of the " + api.best + " file", 20000, () => anchorDownload(api.outputs[api.best].blob, api.outputs[api.best].filename));
    }
    const files = read(read(PZ, "zoidium"), "projectFiles");
    if (files && typeof files.createArchive === "function") {
      await step("Diagnose Zoidium's own Save pipeline (no file is written)", 180000, async status => {
        try {
          const result = await files.createArchive(editor);
          if (!result || !result.blob) throw new Error("It returned no archive.");
          api.outputs.zoidium = { kind: "zoidium", label: "Zoidium-validated project", filename: api.baseName + "-zoidium.pz", blob: result.blob,
            verified: true, validator: "accepted", note: "Built by Zoidium's normal saver, so the Save failure is elsewhere (the file dialog or the download step)." };
          status.detail = "Zoidium's saver works from here; a Save-button or dialog problem is more likely";
          diagnose("Zoidium's normal archive builder succeeded from the rescue tool, so the broken part is the Save button flow: a stuck earlier save, a hidden dialog, or the file picker/download.");
        } catch (error) {
          diagnose("Zoidium's normal saver fails at: " + describe(error));
          throw error;
        }
      });
    }
    await step("Check restore-point storage", 60000, async status => {
      const list = await api.restorePoints();
      status.detail = list.length + " restore point(s)";
    });
    return finish();
  }

  function finish() {
    api.finished = true;
    refreshPanel();
    log.log(TAG + " ===== Summary =====");
    log.table(api.steps.map(record => ({ step: record.step, status: record.status, ms: record.ms, detail: record.detail.slice(0, 160) })));
    const bad = api.steps.filter(record => record.status !== "ok");
    if (bad.length) log.warn(TAG + " Failed or stuck steps: " + bad.map(record => "\"" + record.step + "\" (" + record.status + ": " + record.detail + ")").join("; "));
    api.diagnosis.forEach(text => log.warn(TAG + " DIAGNOSIS: " + text));
    const outputs = Object.values(api.outputs).filter(output => output.kind !== "json");
    if (outputs.length) {
      log.log(TAG + " Rescued files: " + outputs.map(output => output.filename + " (" + megabytes(output.blob.size) + (output.verified ? ", re-read OK" : ", NOT re-read") + ")").join(", "));
      log.log(TAG + " Use the orange panel, or: await PZRescue.download(\"" + api.best + "\"). Restore points: await PZRescue.restorePoints(). Report: copy(PZRescue.report())");
    } else {
      const first = bad[0];
      log.error(TAG + " No .pz file could be built." + (first ? " Stuck at \"" + first.step + "\": " + first.detail : "") +
        (api.outputs.json ? " The editing data is still available: await PZRescue.download(\"json\")." : "") +
        " Keep this tab open and report the bug on the Zoidium Discord (" + SUPPORT_URL + ") with the copy(PZRescue.report()) output.");
    }
    return api;
  }

  api.done = run().catch(error => {
    log.error(TAG + " Unexpected failure" + (api.current ? " at \"" + api.current + "\"" : "") + ": " + describe(error), error);
    return finish();
  });
  return "PZRescue is running. Watch the orange panel or the [PZRescue] lines; the summary table appears at the end.";
})(window);
