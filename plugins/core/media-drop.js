"use strict";

// Files dropped on the editor or pasted from the clipboard enter the project
// the same way the Media panel's Import button does. CM3 handles drops only on
// the project media grid (so empty panel space does nothing) and its timeline
// drop handler dereferences a drag context that a file drag never creates.
// This module routes file drags from one document-level capture listener, so
// internal drags (media tiles, clips, layer rows) keep their native handlers.
//
// Placement reuses CM3's own timeline primitives: createClip() places the
// media fragment the importer built and linkAfterCreation() links a video with
// its audio, exactly like dropping a media tile on the timeline. A drop lands
// on the track under the pointer, or on a new top track when that track is
// occupied or the pointer is outside the tracks.

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"]);
const IMAGE_MIME_EXTENSIONS = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/bmp": "bmp", "image/avif": "avif",
};
const HIGHLIGHT_CLASS = "zoidium-media-drop-target";
const IMPORT_FAILURE = "The files could not be imported.";
const IMPORT_TIMEOUT_MS = 60000;

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}

// Answers the kind of a dropped or pasted file from its MIME type first and
// its name second, because Finder and some Windows paths report an empty type.
function classifyFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  const extension = extensionOf(file?.name);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("font/") || mime === "application/font-woff") return "font";
  if (extension === "ttf" || extension === "otf" || extension === "woff" || extension === "woff2") return "font";
  if (extension === "pz") return "archive";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

// A file drag carries "Files". Internal drags (a media tile, a clip, a layer
// row) never do, and CM3 marks its own media drags with editor.draggingData.
function isFileDrag(dataTransfer, editor) {
  const types = Array.from(dataTransfer?.types || []);
  if (!types.some(type => String(type).toLowerCase() === "files")) return false;
  return !editor || !editor.draggingData;
}

function resolveDropZone(zones, target) {
  if (!target) return null;
  for (const zone of zones || []) {
    if (zone && zone.el && typeof zone.el.contains === "function" && zone.el.contains(target)) return zone;
  }
  return null;
}

function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable === true) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const attribute = typeof target.getAttribute === "function" ? target.getAttribute("contenteditable") : null;
  return attribute !== null && attribute !== "false";
}

// Drops over a field that edits text keep the browser's native behaviour, the
// same rule the paste handler follows. Only a file drag over a canvas-like
// zone is claimed.
function shouldHandleDrag(event, editor) {
  if (!event || isEditableTarget(event.target)) return false;
  return isFileDrag(event.dataTransfer, editor);
}

function pasteSupported(file) {
  const kind = classifyFile(file);
  return kind === "image" || kind === "video" || kind === "audio";
}

function pastedFilename(index, mime) {
  const extension = IMAGE_MIME_EXTENSIONS[String(mime || "").toLowerCase()] || "png";
  return "Pasted image " + index + "." + extension;
}

// A nameless pasted video or audio file still needs a usable name.
function pastedMediaFilename(index, file) {
  const mime = String(file?.type || "");
  const fromType = /^[a-z]+\/([a-z0-9]{1,8})$/i.exec(mime)?.[1] || "";
  const extension = extensionOf(file?.name) || fromType.toLowerCase() || "bin";
  return "Pasted media " + index + "." + extension;
}

function nextPasteIndex(names) {
  let highest = 0;
  for (const name of names || []) {
    const match = /^Pasted (?:image|media) (\d+)\.[a-z0-9]+$/i.exec(String(name || ""));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

// Clipboard bitmaps usually arrive as "image.png" with no user-chosen name.
function needsPastedName(file) {
  const name = String(file?.name || "").trim();
  if (!name) return true;
  if (/^image\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name)) return true;
  return !/\.[a-z0-9]{1,8}$/i.test(name);
}

function clipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = Array.from(clipboardData.files || []);
  if (files.length) return files;
  const result = [];
  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind !== "file") continue;
    const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
    if (file) result.push(file);
  }
  return result;
}

function insertIndexFor(clips, start) {
  const list = clips || [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].start > start) return index;
  }
  return list.length;
}

function trackFits(track, start, length) {
  if (!track) return false;
  const end = start + Math.max(1, length);
  return !track.clips.some(clip => start < clip.start + clip.length && clip.start < end);
}

function unsupportedErrors(files) {
  const errors = [];
  for (const file of files || []) {
    if (classifyFile(file)) continue;
    errors.push({ name: String(file?.name || "This file"), message: IMPORT_FAILURE });
  }
  return errors;
}

// Builds the media for an import result so each entry can be placed once.
// Files already in the project reuse their existing media item.
function mediaForAssets(project, keys, knownMedia) {
  const found = new Map();
  const known = knownMedia || new Set();
  const matches = (media, key) => (media.assets || []).some(asset =>
    (typeof asset === "string" ? asset : asset?.key) === key);
  for (const key of keys || []) {
    let match = (project.media || []).find(media => !known.has(media) && matches(media, key));
    if (!match) match = (project.media || []).find(media => matches(media, key));
    if (match) found.set(key, match);
  }
  return found;
}

function pasteableNames(project) {
  const names = [];
  for (const asset of Object.values(project?.assets?.list || {})) {
    if (asset?.filename) names.push(asset.filename);
  }
  for (const media of project?.media || []) {
    const name = media?.properties?.name?.get?.();
    if (name) names.push(name);
  }
  return names;
}

function trackList(tracks, type) {
  const sequence = tracks?.timeline?.editor?.project?.sequence;
  if (!sequence) return null;
  return type === 1 ? sequence.audioTracks : sequence.videoTracks;
}

function frameAt(tracks, clientX) {
  const timeline = tracks?.timeline;
  const rect = tracks?.container?.getBoundingClientRect?.();
  if (!timeline || !rect || typeof timeline.pxToFrame !== "function") return 0;
  const scroll = timeline.scrollBar?.scrollLeft || 0;
  return Math.max(0, Math.round(timeline.pxToFrame(Math.max(0, clientX - rect.left) + scroll)));
}

function trackAt(tracks, clientY) {
  for (const [type, container] of [[0, tracks?.videoContainer], [1, tracks?.audioContainer]]) {
    const bounds = container?.getBoundingClientRect?.();
    if (!bounds || clientY < bounds.top || clientY > bounds.bottom) continue;
    const children = Array.from(container.children || []);
    for (let index = 0; index < children.length; index += 1) {
      const rect = children[index].getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return { type, index };
    }
    return { type, index: null };
  }
  return null;
}

function revealTrack(tracks, type, index) {
  const container = type === 1 ? tracks.audioContainer : tracks.videoContainer;
  const element = container?.children?.[index];
  if (!element || !container) return;
  const top = parseFloat(element.style.top) || 0;
  const height = parseFloat(element.style.height) || 0;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (top + height > container.scrollTop + container.clientHeight) {
    container.scrollTop = Math.max(0, top + height - container.clientHeight);
  }
}

function chooseTrack(tracks, type, start, length, target, chosen, created) {
  const list = trackList(tracks, type);
  if (!list) return 0;
  const remembered = chosen.get(type);
  if (remembered !== undefined && trackFits(list[remembered], start, length)) return remembered;
  const preferred = target && target.type === type && target.index !== null ? target.index : null;
  if (preferred !== null && trackFits(list[preferred], start, length)) {
    chosen.set(type, preferred);
    return preferred;
  }
  // A new top track: DOM index 0 is the lowest track, so appending is above.
  const index = list.length;
  tracks.createTrack({ type, newTrackIdx: index, data: null });
  chosen.set(type, index);
  created.push({ type, index });
  return index;
}

// Places one clip per media fragment (video and audio stay linked) and advances
// the cursor by the file length, so several files keep their order. Tracks come
// from CM3's own createTrack/createClip/linkAfterCreation primitives.
function placeEntries(tracks, entries, start, target) {
  if (!tracks) return 0;
  let placed = 0;
  let cursor = Math.max(0, Math.round(start) || 0);
  const chosen = new Map();
  const created = [];
  const links = new Map();
  for (const entry of entries) {
    const media = entry && entry.media;
    const fragments = Array.isArray(media?.data) ? media.data.filter(fragment =>
      fragment && Array.isArray(fragment.clips) && fragment.clips.length) : [];
    if (!fragments.length) continue;
    let span = 1;
    const positions = [];
    for (const fragment of fragments) {
      const type = fragment.type === 1 ? 1 : 0;
      const clip = fragment.clips[0];
      const length = Math.max(1, Math.round(clip.length || 0));
      span = Math.max(span, length);
      positions.push({ type, clip, length, start: cursor,
        index: chooseTrack(tracks, type, cursor, length, target, chosen, created) });
    }
    for (const position of positions) {
      const list = trackList(tracks, position.type);
      const track = list && list[position.index];
      if (!track) continue;
      const params = {
        type: position.type,
        newTrackIdx: position.index,
        newIdx: insertIndexFor(track.clips, position.start),
        start: position.start,
        length: position.length,
        data: position.clip,
      };
      tracks.createClip(params);
      tracks.linkAfterCreation(params, links);
    }
    placed += 1;
    cursor += span;
  }
  for (const entry of created) revealTrack(tracks, entry.type, entry.index);
  return placed;
}

// One history operation for the import and its placement. The asset registry
// opens its own operation only when none is open, so it joins this one.
function operationScope(editorInstance) {
  const history = editorInstance.history;
  const project = editorInstance.project;
  const owned = !history.operation;
  if (owned) history.startOperation();
  const operation = history.operation;
  return () => {
    // A project change resets the native history. Never finish the old
    // operation then, or later edits would merge into it.
    if (owned && editorInstance.project === project && history.operation === operation && operation) {
      history.finishOperation();
    }
  };
}

// The Media panel's Import button runs PZ.ui.media.list.project.importFiles,
// which calls the panel's importFile() and createMedia(). Use the same two
// methods so a .pz drop imports one media item and never replaces the project.
async function importArchive(editorInstance, file, panel, signal) {
  if (!panel || typeof panel.importFile !== "function" || typeof panel.createMedia !== "function") {
    throw new Error(IMPORT_FAILURE);
  }
  const project = editorInstance.project;
  const data = await panel.importFile(file);
  if (signal.aborted) return null;
  if (editorInstance.project !== project) throw new Error("The project changed while importing files.");
  if (!data) throw new Error(IMPORT_FAILURE);
  const index = editorInstance.project.media.length;
  panel.createMedia({ address: [1, index], data });
  const media = editorInstance.project.media[index];
  if (media?.loading) await media.loading;
  return media;
}

// The underlying importer checks the signal before any late history edits.
function importWithTimeout(work, timeoutMs, timers = globalThis) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = timers.setTimeout(() => {
      controller.abort();
      reject(new Error("The file import timed out."));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout])
    .finally(() => timers.clearTimeout(timer));
}

// Keep each asynchronous drop or paste inside its own history operation.
function createImportQueue() {
  let pending = Promise.resolve();
  return task => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
}

function activate(context) {
  const host = context.window;
  const document = context.document || host?.document;
  if (!host || !document || typeof document.addEventListener !== "function") return;

  const PZ = context.PZ;
  const editor = () => host.CM || context.editor;
  const assets = () => context.apis?.assets || host.ZoidiumAssets || null;
  const highlighted = new Set();
  let style = null;
  const enqueueImport = createImportQueue();

  function notifyImport(message) {
    const text = message || IMPORT_FAILURE;
    try {
      if (host.ZoidiumUI?.notify) host.ZoidiumUI.notify({ title: "Import", message: text });
      else host.console?.warn?.("[Zoidium] Import: " + text);
    } catch (_error) { /* A notice must not break the drop. */ }
  }

  function ensureStyle() {
    if (style || !document.head) return;
    style = document.createElement("style");
    style.dataset.zoidiumMediaDrop = "true";
    style.textContent = "." + HIGHLIGHT_CLASS + "{outline:2px dashed var(--zui-accent,#6b9bd1);outline-offset:-2px;}";
    document.head.appendChild(style);
  }

  function highlight(element) {
    if (!element) return;
    ensureStyle();
    element.classList.add(HIGHLIGHT_CLASS);
    highlighted.add(element);
  }

  function unhighlight(element) {
    if (!element) return;
    element.classList.remove(HIGHLIGHT_CLASS);
    highlighted.delete(element);
  }

  function unhighlightAll() {
    for (const element of Array.from(highlighted)) unhighlight(element);
  }

  function panelOf(target) {
    if (!target || typeof target.closest !== "function") return null;
    const element = target.closest(".editorpanel");
    return element && element.pz_panel ? element.pz_panel : null;
  }

  function zoneFor(target) {
    const panel = panelOf(target);
    if (!panel) return null;
    if (PZ?.ui?.media && panel instanceof PZ.ui.media) return { kind: "media", el: panel.el, panel };
    if (PZ?.ui?.timeline && panel instanceof PZ.ui.timeline) {
      return { kind: "timeline", el: panel.el, panel, tracks: panel.tracks, timeline: panel };
    }
    if (PZ?.ui?.viewport && panel instanceof PZ.ui.viewport && editor()?.mainViewport === panel) {
      return { kind: "viewport", el: panel.el, panel, viewport: panel };
    }
    return null;
  }

  function tracksForViewport() {
    const current = editor();
    if (!PZ?.ui?.timeline) return null;
    for (const element of Array.from(document.querySelectorAll(".editorpanel"))) {
      const panel = element.pz_panel;
      if (panel instanceof PZ.ui.timeline && panel.editor === current) return panel.tracks;
    }
    return null;
  }

  function mediaPanelFor() {
    const current = editor();
    for (const element of Array.from(document.querySelectorAll(".editorpanel"))) {
      const panel = element.pz_panel;
      if (PZ?.ui?.media && panel instanceof PZ.ui.media && panel.editor === current) return panel;
    }
    return null;
  }

  async function importFiles(editorInstance, files, errors) {
    const api = assets();
    const project = editorInstance.project;
    const before = new Set(project.media || []);
    const entries = [];
    for (const file of files) {
      try {
        const entry = await importWithTimeout(async signal => {
          if (classifyFile(file) === "archive") {
            return { file, media: await importArchive(editorInstance, file, mediaPanelFor(), signal) };
          }
          if (!api?.import) throw new Error(IMPORT_FAILURE);
          const result = await api.import([file], { signal });
          if (signal.aborted) return null;
          for (const error of result?.errors || []) errors.push(error);
          const item = result?.items?.[0];
          return item ? { file, media: mediaForAssets(project, [item.id], before).get(item.id) || null } : null;
        }, IMPORT_TIMEOUT_MS, host.setTimeout && host.clearTimeout ? host : globalThis);
        if (entry) entries.push(entry);
      } catch (error) {
        errors.push({ name: file?.name, message: error?.message || String(error) });
      }
      if (editorInstance.project !== project) break;
    }
    return { entries, project };
  }

  async function handleFiles(zone, files, point, options) {
    const current = editor();
    if (!current?.project || !current.history) {
      notifyImport("There is no project to import into.");
      return;
    }
    const errors = unsupportedErrors(files);
    const supported = files.filter(file => classifyFile(file));
    if (!supported.length) {
      notifyImport(importFailure(errors));
      return;
    }
    const finish = operationScope(current);
    try {
      const project = current.project;
      const { entries } = await importFiles(current, supported, errors);
      let tracks = null;
      let start = 0;
      let target = null;
      if (options?.placeAtPlayhead) {
        tracks = zone?.kind === "timeline" ? zone.tracks : tracksForViewport();
        start = Math.max(0, Math.round(current.playback?.currentFrame || 0));
      } else if (zone?.kind === "timeline" && zone.tracks?.timeline?.editor?.project === project) {
        tracks = zone.tracks;
        start = frameAt(tracks, point?.x ?? 0);
        target = trackAt(tracks, point?.y ?? 0);
      }
      if (tracks && entries.length && project === current.project) {
        try { placeEntries(tracks, entries, start, target); }
        catch (error) { errors.push({ message: error?.message || String(error) }); }
      }
    } finally {
      finish();
    }
    if (errors.length) notifyImport(importFailure(errors));
  }

  function importFailure(errors) {
    const messages = [];
    for (const error of errors) {
      const message = error?.message || String(error);
      if (message && !messages.includes(message)) messages.push(message);
    }
    return messages.join(" ") || IMPORT_FAILURE;
  }

  function scheduleFiles(zone, files, point, options) {
    const current = editor();
    const project = current?.project;
    void enqueueImport(() => {
      if (editor() !== current || current?.project !== project) {
        notifyImport("The project changed before the files could be imported.");
        return;
      }
      const prepared = typeof files === "function" ? files() : files;
      return handleFiles(zone, prepared, point, options);
    }).catch(error => notifyImport(error?.message || String(error)));
  }

  function onDragOver(event) {
    if (isEditableTarget(event?.target)) return unhighlightAll();
    if (!shouldHandleDrag(event, editor())) return;
    const zone = zoneFor(event.target);
    if (!zone) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    highlight(zone.el);
  }

  function onDragLeave(event) {
    if (isEditableTarget(event?.target)) return unhighlightAll();
    if (!shouldHandleDrag(event, editor())) return;
    const zone = zoneFor(event.target);
    if (!zone) return unhighlightAll();
    if (event.relatedTarget && zone.el.contains(event.relatedTarget)) return;
    unhighlight(zone.el);
  }

  function onDrop(event) {
    if (isEditableTarget(event?.target)) return unhighlightAll();
    if (!shouldHandleDrag(event, editor())) return;
    const zone = zoneFor(event.target);
    if (!zone) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    unhighlightAll();
    const point = { x: event.clientX, y: event.clientY };
    scheduleFiles(zone, files, point, { placeAtPlayhead: zone.kind === "viewport" });
  }

  function pasteFiles(event) {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const files = clipboardFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const current = editor();
    if (!current?.project) return;
    const pasted = files.filter(file => pasteSupported(file));
    if (!pasted.length) {
      notifyImport(IMPORT_FAILURE);
      return;
    }
    const timeline = zoneFor(document.activeElement);
    const focusedTimeline = timeline?.kind === "timeline" ? timeline : null;
    scheduleFiles(focusedTimeline || { kind: "paste", el: null }, () => {
      let index = nextPasteIndex(pasteableNames(current.project));
      return pasted.map(file => {
        if (!needsPastedName(file)) return file;
        const image = classifyFile(file) === "image";
        const name = image ? pastedFilename(index++, file.type) : pastedMediaFilename(index++, file);
        try {
          return new host.File([file], name, { type: file.type || "image/png", lastModified: Date.now() });
        } catch (_error) { return file; }
      });
    }, null, { placeAtPlayhead: !!focusedTimeline });
  }

  document.addEventListener("dragenter", onDragOver, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("dragleave", onDragLeave, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("paste", pasteFiles, true);
  host.addEventListener("blur", unhighlightAll);

  function dispose() {
    document.removeEventListener("dragenter", onDragOver, true);
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("dragleave", onDragLeave, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("paste", pasteFiles, true);
    host.removeEventListener("blur", unhighlightAll);
    unhighlightAll();
    style?.remove();
    style = null;
  }

  context.lifecycle?.onDispose?.(dispose);
  return { dispose };
}

module.exports = {
  activate,
  HIGHLIGHT_CLASS,
  IMPORT_FAILURE,
  IMPORT_TIMEOUT_MS,
  importWithTimeout,
  classifyFile,
  isFileDrag,
  shouldHandleDrag,
  resolveDropZone,
  isEditableTarget,
  pasteSupported,
  pastedFilename,
  pastedMediaFilename,
  nextPasteIndex,
  needsPastedName,
  clipboardFiles,
  insertIndexFor,
  trackFits,
  unsupportedErrors,
  mediaForAssets,
  frameAt,
  trackAt,
  chooseTrack,
  placeEntries,
  operationScope,
  createImportQueue,
};
