"use strict";

// OpenZoid Legacy — True datamosh export pass.
//
// The realtime Datamosh effect only simulates compression breaks. The bundled
// datamosh-render.js performs byte-exact I-frame removal on an exported
// WebM/Matroska file. This module installs that renderer as PZ.datamoshRender
// and adds an opt-in post-export pass to the Device render page, ported from
// the OpenZoid export page:
//
//   - "True datamosh" dropdown on the Device render options page:
//     off / full video / at clip cuts (off by default).
//   - After the render finishes, the pass drops keyframes at the container
//     level, delivers "video-moshed.webm", and shows a finished note
//     ("TRUE MOSH: dropped N of M keyframes").
//   - A failed pass falls back to the clean render with a failure note.
//
// The pass hooks the export path through a reversible wrapper owned by this
// plugin: it wraps PZ.ui.export.device.prototype.createOptionsPage and
// createFinishedPage and restores both on disposal. It never edits zoidium/*
// or plugins/core/*, and it chains with the direct-download wrapper (which
// captures PZ.downloadBlob when the finished page is created, after the mosh
// pass has replaced the blob). Preview rendering is untouched: the
// deterministic datamosh effect stays preview-only.

const RENDER_ASSET = "./plugins/openzoid-legacy/datamosh-render.js";
const MOSHED_FILENAME = "video-moshed.webm";
const CUT_WINDOW_MS = 300;

const OPTION_DESCRIPTION =
  "True datamosh strips I-frames from the rendered file so motion smears across cuts. " +
  "At clip cuts moshing keeps other keyframes; seeking in a moshed file is imprecise.";
const PROGRESS_TITLE = "True datamosh...";
const PROGRESS_DESCRIPTION =
  "The render finished. Applying the true-datamosh pass to the exported file.";

function blobToArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

function isMoshableBlob(blob) {
  return Boolean(blob && Number.isFinite(Number(blob.size)) && Number(blob.size) > 0);
}

function moshModeOf(device) {
  return (device && device.params && Number(device.params.mosh)) || 0;
}

// Runs the pass and always resolves: success carries the moshed blob, failure
// carries the original blob. The caller delivers whichever blob comes back.
async function runTrueMosh(PZ, editor, device, blob, mode) {
  const fallbackName =
    (PZ && PZ.downloadFilename) || "video.webm";
  try {
    const render = PZ.datamoshRender;
    if (!render) throw new Error("the datamosh renderer is not installed");
    const buffer = await blobToArrayBuffer(blob);
    let ranges = null;
    if (mode === 2) {
      const cuts = render.cutTimesMs(editor.sequence);
      ranges = cuts.length ? render.rangesAroundCuts(cuts, CUT_WINDOW_MS) : null;
    }
    const out = render.mosh(buffer, ranges ? { rangesMs: ranges } : {});
    const BlobCtor = typeof Blob === "function" ? Blob : null;
    if (!BlobCtor) throw new Error("downloads are not supported here");
    return {
      blob: new BlobCtor([out.bytes], { type: "video/webm" }),
      filename: MOSHED_FILENAME,
      note: "TRUE MOSH: dropped " + out.stats.dropped + " of " +
        out.stats.keyframes + " keyframes (" + out.stats.videoFrames + " video frames).",
    };
  } catch (error) {
    return {
      blob,
      filename: fallbackName,
      note: "True-mosh pass failed (" + (error && error.message) +
        ") — clean render delivered.",
    };
  }
}

function describe(PZ, html) {
  const legacy = PZ && PZ.ui && PZ.ui.controls && PZ.ui.controls.legacy;
  if (legacy && typeof legacy.generateDescription === "function") {
    return legacy.generateDescription({ content: html });
  }
  const doc = typeof document !== "undefined" ? document : null;
  const el = doc ? doc.createElement("div") : null;
  if (el) el.textContent = String(html).replace(/<[^>]*>/g, "");
  return el;
}

function noteHtml(note) {
  return '<span style="display:block;margin-top:10px;color:#2ee6d6">' + note + "</span>";
}

function installRenderer(context, PZ) {
  if (PZ.datamoshRender) return { owned: false };
  const getAsset = context && typeof context.getAsset === "function"
    ? context.getAsset.bind(context)
    : null;
  const source = getAsset ? getAsset("text", RENDER_ASSET) : undefined;
  if (typeof source !== "string") {
    throw new Error("OpenZoid Legacy is missing its bundled datamosh renderer.");
  }
  const installed = new Function("PZ", source + "\nreturn PZ.datamoshRender;")(PZ);
  if (!installed) {
    throw new Error("OpenZoid Legacy could not install the datamosh renderer.");
  }
  return { owned: true, value: installed };
}

function uninstallRenderer(PZ, install) {
  if (install && install.owned && PZ.datamoshRender === install.value) {
    try {
      delete PZ.datamoshRender;
    } catch (_error) {
      PZ.datamoshRender = undefined;
    }
  }
}

function devicePrototype(PZ) {
  const device = PZ && PZ.ui && PZ.ui.export && PZ.ui.export.device;
  return (device && device.prototype) || null;
}

// Adds the "True datamosh" dropdown to the Device render options page. The
// original builds the page and this.params first; the dropdown is inserted
// before the Start button so it reads like the other render options.
function wrapOptionsPage(PZ, proto) {
  const original = proto.createOptionsPage;
  if (typeof original !== "function" || original.__openzoidTrueMosh) return null;
  function patched() {
    const page = original.apply(this, arguments);
    try {
      const device = this;
      const legacy = PZ.ui.controls.legacy;
      const dropdown = legacy.generateDropdown({
        title: "True datamosh",
        items: "off;full video;at clip cuts",
        get: function () { return moshModeOf(device); },
        set: function (value) { device.params.mosh = value; },
      }, device);
      const hint = describe(PZ, OPTION_DESCRIPTION);
      const start = page.lastElementChild;
      page.insertBefore(dropdown, start);
      page.insertBefore(hint, start);
    } catch (_error) {
      // A missing option never breaks the export page.
    }
    return page;
  }
  patched.__openzoidTrueMosh = true;
  patched.__openzoidTrueMoshOriginal = original;
  proto.createOptionsPage = patched;
  return { proto, name: "createOptionsPage" };
}

// Runs the mosh pass between the render and the finished page. The original
// finished-page builder (including the download capture) runs only after the
// pass has replaced PZ.downloadBlob, so the delivered file is the moshed one.
function wrapFinishedPage(PZ, editor, proto) {
  const original = proto.createFinishedPage;
  if (typeof original !== "function" || original.__openzoidTrueMosh) return null;
  function patched() {
    const device = this;
    const mode = moshModeOf(device);
    const blob = PZ.downloadBlob;
    if (!(mode > 0) || !isMoshableBlob(blob)) {
      return original.apply(this, arguments);
    }
    const progress = device.export.createPage(PROGRESS_TITLE, true, function () {
      device.renderCleanUp();
      return true;
    });
    progress.appendChild(describe(PZ, PROGRESS_DESCRIPTION));
    runTrueMosh(PZ, editor, device, blob, mode).then(function (result) {
      PZ.downloadBlob = result.blob;
      PZ.downloadFilename = result.filename;
      device.moshNote = result.note;
      const page = original.apply(device, []);
      try {
        const note = describe(PZ, "Your render is finished! Click below to download." + noteHtml(result.note));
        page.insertBefore(note, page.lastElementChild);
      } catch (_error) {
        // The download still works without the note.
      }
      device.export.navigate(page);
    });
    return progress;
  }
  patched.__openzoidTrueMosh = true;
  patched.__openzoidTrueMoshOriginal = original;
  proto.createFinishedPage = patched;
  return { proto, name: "createFinishedPage" };
}

function unwrap(wrap) {
  if (!wrap) return;
  const current = wrap.proto[wrap.name];
  if (current && current.__openzoidTrueMoshOriginal && current.__openzoidTrueMosh) {
    if (wrap.proto[wrap.name] === current) {
      wrap.proto[wrap.name] = current.__openzoidTrueMoshOriginal;
    }
    current.__openzoidTrueMosh = false;
  }
}

module.exports = {
  runTrueMosh,
  moshModeOf,
  activate(context) {
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const editor = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!PZ) throw new Error("True datamosh needs the CM3 runtime.");
    if (!editor) throw new Error("True datamosh needs the active editor instance.");
    const proto = devicePrototype(PZ);
    if (!proto) throw new Error("True datamosh needs the export device page.");
    const install = installRenderer(context, PZ);
    const wraps = [];
    try {
      const options = wrapOptionsPage(PZ, proto);
      if (options) wraps.push(options);
      const finished = wrapFinishedPage(PZ, editor, proto);
      if (finished) wraps.push(finished);
    } catch (error) {
      for (const wrap of wraps) unwrap(wrap);
      uninstallRenderer(PZ, install);
      throw error;
    }
    const dispose = function () {
      for (const wrap of wraps) unwrap(wrap);
      uninstallRenderer(PZ, install);
    };
    if (context.lifecycle && typeof context.lifecycle.onDispose === "function") {
      context.lifecycle.onDispose(dispose);
    }
    return dispose;
  },
  deactivate() {},
};
