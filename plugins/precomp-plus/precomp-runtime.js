"use strict";

// Precomp+ runtime: the Comps tab, the Compositions window and the
// Pre-compose dialog. The composition model lives in comps.js (PZ.precomp).
// Every user-facing string is English.

const MAIN_KEY = "__main__";
let session = null;

function installEngine(context, PZ) {
  if (PZ.precomp && PZ.precomp.version === 3) return PZ.precomp;
  const getAsset = context.getAsset;
  if (typeof getAsset !== "function") {
    throw new Error("Precomp+ needs the plugin bundle asset resolver.");
  }
  const source = getAsset("text", "./plugins/precomp-plus/comps.js");
  if (typeof source !== "string") {
    throw new Error("Precomp+ is missing its bundled source: comps.js.");
  }
  new Function("PZ", source)(PZ);
  if (!PZ.precomp) throw new Error("Precomp+ could not define its composition engine.");
  return PZ.precomp;
}

function kitOf(context) {
  const kit = (context.window || globalThis).ZoidiumUI;
  if (!kit || typeof kit.openWindow !== "function") {
    throw new Error("Precomp+ needs the Zoidium UI kit.");
  }
  return kit;
}

function rowKey(row) {
  return row.isMain ? MAIN_KEY : row.id;
}

function plural(count, one, many) {
  return count + " " + (count === 1 ? one : many);
}

function subtitleText() {
  const name = session.engine.activeName(session.editor);
  return name ? "Editing " + name : "Main";
}

function breadcrumbText() {
  const name = session.engine.activeName(session.editor);
  return name ? "Main > " + name : "Main";
}

// ---------------------------------------------------------------------------
// Pre-compose dialog

function openPrecomposeDialog() {
  if (!session) return null;
  const existing = session.context.ui.getWindow("precompose");
  if (existing) {
    existing.focus();
    return existing;
  }
  const kit = session.kit;
  const engine = session.engine;
  const editor = session.editor;
  const summary = engine.selectionSummary(editor);
  let name = engine.nextCompName(editor.project);
  let message = null;
  let win = null;

  function submit() {
    const result = engine.precompose(editor, name);
    if (!result.ok) {
      message.className = "zoidium-note warning";
      message.textContent = result.message;
      return;
    }
    const detail = "Moved " + plural(result.moved, "video clip", "video clips") +
      (result.movedAudio ? " and " + plural(result.movedAudio, "audio clip", "audio clips") : "") +
      ' into "' + result.name + '".' +
      (result.moved
        ? " Main now has one clip for it."
        : " Open it from the Compositions window to edit its clips.");
    kit.notify({ title: "Pre-composed " + result.name, message: detail });
    win.close();
  }

  win = session.context.ui.openWindow({
    id: "precompose",
    title: "Pre-compose",
    subtitle: "New composition",
    width: 330,
    height: 210,
    minHeight: 180,
    resizable: false,
    mount(body) {
      const field = kit.controls.text({
        label: "Name",
        value: name,
        placeholder: "Comp 1",
        onInput: function (value) { name = value; },
      });
      const input = field.element.querySelector("input");
      if (input) {
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") submit();
        });
      }
      body.appendChild(field.element);
      const counts = summary.ready
        ? "Moves " + plural(summary.video, "video clip", "video clips") +
          (summary.audio ? " and " + plural(summary.audio, "audio clip", "audio clips") : "") +
          " into this composition." +
          (summary.video
            ? " Main keeps one clip for it."
            : " Nothing stays on Main; open the composition to edit its clips.")
        : "The timeline is not ready. Try again in a moment.";
      body.appendChild(kit.controls.note(counts).element);
      message = kit.controls.note("").element;
      body.appendChild(message);
      return null;
    },
    footer: [
      { title: "Pre-compose", variant: "primary", onClick: function () { submit(); } },
      { title: "Cancel", onClick: function () { win.close(); } },
    ],
  });
  return win;
}

// ---------------------------------------------------------------------------
// Compositions window

function openCompsWindow() {
  if (!session) return null;
  const existing = session.context.ui.getWindow("compositions");
  if (existing) {
    existing.focus();
    return existing;
  }
  const kit = session.kit;
  const engine = session.engine;
  const editor = session.editor;
  let selectedKey = MAIN_KEY;
  let win = null;
  let body = null;
  let renderQueued = false;

  function report(title, result) {
    if (!result.ok) kit.notify({ title: title, message: result.message });
  }

  function afterChange(result, title) {
    report(title, result);
    render();
  }

  function openRow(row) {
    // The open composition's own button returns to Main.
    const target = row.isMain || row.editing ? null : row.id;
    selectedKey = target === null ? MAIN_KEY : row.id;
    const result = engine.openComp(editor, target);
    if (result.ok && target) {
      kit.notify({
        title: "Editing " + row.name,
        message: "Changes are kept in this composition. Back to Main returns to the main timeline.",
      });
    }
    afterChange(result, "Compositions");
  }

  function duplicate(row) {
    const result = engine.duplicateComp(editor, row.id);
    if (result.ok) selectedKey = result.id;
    afterChange(result, "Duplicate");
  }

  function createEmpty() {
    const created = engine.newEmptyComp(editor);
    if (created.ok) {
      selectedKey = created.id;
      kit.notify({
        title: "Created " + created.name,
        message: "Double-click it to edit its clips.",
      });
    }
    afterChange(created, "New composition");
  }

  function remove(row) {
    // Check usage before asking, so an in-use composition is explained rather
    // than confirmed and then refused. removeComp repeats the check.
    const current = engine.entries(editor).find(function (entry) { return entry.id === row.id; });
    if (!current) {
      report("Delete", { ok: false, message: "That composition no longer exists." });
      render();
      return;
    }
    if (current.uses > 0) {
      // removeComp refuses before it changes anything while a composition is
      // used, and it words the refusal with where the uses are.
      report("Delete", engine.removeComp(editor, row.id));
      return;
    }
    const host = session.context.window || globalThis;
    if (!host.confirm('Delete composition "' + row.name + '"?')) return;
    const result = engine.removeComp(editor, row.id);
    if (result.ok) selectedKey = MAIN_KEY;
    afterChange(result, "Delete");
  }

  function rename(row, value) {
    afterChange(engine.renameComp(editor, row.id, value), "Rename");
  }

  function actionsFor(row) {
    let title;
    if (row.isMain) title = "Back to Main";
    else title = row.editing ? "Back to Main" : "Open";
    const current = row.isMain && row.editing;
    const actions = [{
      title: current ? "Open" : title,
      variant: current ? undefined : "primary",
      disabled: current,
      hint: current ? "Main is already open." : undefined,
      onClick: function () { openRow(row); },
    }];
    if (!row.isMain) {
      actions.push({ title: "Duplicate", onClick: function () { duplicate(row); } });
      actions.push({ title: "Delete", variant: "danger", onClick: function () { remove(row); } });
    }
    return actions;
  }

  function render() {
    if (!body) return;
    if (win && !win.isOpen()) return;
    renderQueued = false;
    body.textContent = "";
    if (win) win.setSubtitle(subtitleText());
    const rows = engine.entries(editor);
    body.appendChild(kit.controls.note("Location: " + breadcrumbText()).element);
    if (rows.length <= 1) {
      body.appendChild(kit.controls.note(
        "Select video or audio clips on the timeline and click Pre-compose. They move into a composition, " +
        "and Main keeps one clip for it. Double-click a composition to edit its clips."
      ).element);
    }
    const items = rows.map(function (row) {
      const title = (row.isMain ? "Main" : row.name) + (row.editing ? "  (editing)" : "");
      const detail = row.isMain
        ? plural(row.length, "frame", "frames")
        : plural(row.length, "frame", "frames") + " · " +
          (row.uses ? "used by " + plural(row.uses, "clip", "clips") : "unused");
      return { id: rowKey(row), title: title, detail: detail };
    });
    const current = rows.find(function (row) { return rowKey(row) === selectedKey; }) ||
      rows.find(function (row) { return row.editing; }) || rows[0];
    selectedKey = rowKey(current);
    body.appendChild(kit.controls.list({
      items: items,
      value: selectedKey,
      emptyText: "No compositions yet.",
      onSelect: function (key) {
        selectedKey = key;
        render();
      },
      onActivate: function (key) {
        const row = rows.find(function (candidate) { return rowKey(candidate) === key; });
        if (row) openRow(row);
      },
    }).element);
    if (!current.isMain) {
      body.appendChild(kit.controls.text({
        label: "Name",
        value: current.name,
        onChange: function (value) { rename(current, value); },
      }).element);
      if (current.uses) {
        body.appendChild(kit.controls.note(
          "Used by " + plural(current.uses, "clip", "clips") +
          ". Remove those clips from the timeline before deleting this composition."
        ).element);
      }
    }
    body.appendChild(kit.controls.buttonRow(actionsFor(current)).element);
    body.appendChild(kit.controls.note(
      "Undo is cleared when you switch between Main and a composition. Return to Main before exporting. Export is blocked while a composition is open."
    ).element);
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(render, 0);
  }

  win = session.context.ui.openWindow({
    id: "compositions",
    title: "Compositions",
    subtitle: subtitleText(),
    persistKey: "compositions",
    width: 340,
    height: 460,
    minWidth: 280,
    minHeight: 260,
    mount(root) {
      body = root;
      const project = editor.project;
      const unsubscribe = engine.subscribe(scheduleRender);
      const projectListener = scheduleRender;
      if (project && project.ui && project.ui.onChanged) project.ui.onChanged.watch(projectListener);
      editor.onProjectChanged.watch(projectListener);
      render();
      return function cleanup() {
        unsubscribe();
        try { editor.onProjectChanged.unwatch(projectListener); } catch (error) { /* project replaced */ }
        try { if (project && project.ui) project.ui.onChanged.unwatch(projectListener); } catch (error) { /* ignore */ }
      };
    },
    footer: [
      { title: "Pre-compose selection", variant: "primary", onClick: function () { openPrecomposeDialog(); } },
      { title: "New composition", onClick: function () { createEmpty(); } },
      { title: "Close", onClick: function () { win.close(); } },
    ],
  });
  return win;
}

// ---------------------------------------------------------------------------
// Timeline clip context menu
//
// The host right-click only renames the clip inline. While Precomp+ is
// enabled the menu below is shown instead (ported from OpenZoid/Davidium):
// Rename layer, Reveal source in Project, Pre-compose selected (opens the
// Pre-compose dialog), Open source composition, Duplicate, Split at
// playhead and Delete. The host method is wrapped reversibly: disabling the
// plugin restores the original handler on the prototype and on every clip
// element it rebound.

const CLIP_LAYER_NAMES = {
  0: "Video", 1: "Adjustment", 2: "Pre-comp", 3: "Image", 4: "Scene",
  5: "Layer", 6: "Shape", 7: "Text", 8: "Preset shape", 9: "Camera",
};

function clipSourceInfo(clip) {
  if (!clip) return "no clip";
  let name = "";
  try {
    name = clip.properties.name.get();
  } catch (error) { /* keep empty */ }
  const layerType = clip.object ? clip.object.type : -1;
  const typeName = CLIP_LAYER_NAMES[layerType] !== undefined ? CLIP_LAYER_NAMES[layerType] : ("type " + layerType);
  let mediaName = "";
  try {
    const media = clip.properties.media ? clip.properties.media.get() : null;
    if (media) mediaName = " • media:" + String(media).slice(0, 8);
  } catch (error) { /* keep empty */ }
  return name + " (" + typeName + ")" + mediaName;
}

// Inline rename, mirroring the host handler this menu replaces: one history
// step through the native property hooks.
function renameClipElement(PZ, editor, doc, clipEl) {
  const t = clipEl || null;
  if (!t || t.classList.contains("pz-listitem-edit")) return;
  const label = t.children[0];
  const prop = t.pz_object.properties.name;
  const previous = prop.get();
  const input = doc.createElement("input");
  t.classList.add("pz-listitem-edit");
  const commit = () => {
    const value = input.value;
    input.remove();
    label.style.display = "";
    t.classList.remove("pz-listitem-edit");
    if (value !== previous) {
      const ops = new PZ.ui.properties(editor);
      editor.history.startOperation();
      ops.setValue({ property: prop.getAddress(), value: value, oldValue: previous });
      editor.history.finishOperation();
    }
  };
  input.onmousedown = input.onclick = input.ontouchstart = function (e) { e.stopPropagation(); };
  input.onkeydown = function (e) {
    if (e.key === "Enter") {
      this.blur();
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.value = previous;
      this.blur();
      e.preventDefault();
    }
    e.stopPropagation();
  };
  input.onblur = function () { commit(); };
  label.style.display = "none";
  input.value = previous;
  t.appendChild(input);
  input.focus();
}

// Highlights the clip's source media in the Project panel. Returns false
// when nothing matches, so the caller can describe the source instead.
function revealClipSource(doc, project, clip) {
  if (!clip || !project) return false;
  let mediaKey = null;
  let clipName = "";
  try {
    clipName = clip.properties.name.get();
  } catch (error) { /* keep empty */ }
  try {
    mediaKey = clip.properties.media ? clip.properties.media.get() : null;
  } catch (error) { /* keep empty */ }
  let best = -1;
  for (let i = 0; i < project.media.length; i++) {
    const media = project.media[i];
    if (!media) continue;
    if (mediaKey) {
      try {
        if (media.assets && media.assets.indexOf(mediaKey) >= 0) {
          best = i;
          break;
        }
      } catch (error) { /* keep looking */ }
      try {
        const keys = media.assets && media.assets.map
          ? media.assets.map(function (asset) { return asset && asset.key !== undefined ? asset.key : asset; })
          : [];
        if (keys.indexOf(mediaKey) >= 0) {
          best = i;
          break;
        }
      } catch (error) { /* keep looking */ }
    }
    try {
      const mediaName = media.properties.name.get();
      if (mediaName && clipName && mediaName === clipName) best = i;
    } catch (error) { /* keep looking */ }
  }
  if (best < 0 && clipName) {
    for (let i = 0; i < project.media.length; i++) {
      try {
        const mediaName = project.media[i].properties.name.get();
        if (mediaName && mediaName.toLowerCase().indexOf(clipName.toLowerCase().slice(0, 4)) >= 0) {
          best = i;
          break;
        }
      } catch (error) { /* keep looking */ }
    }
  }
  if (best < 0) return false;
  const items = doc.querySelectorAll(".media-item");
  for (let i = 0; i < items.length; i++) items[i].classList.remove("selected");
  const target = items[best];
  if (!target) return false;
  target.classList.add("selected");
  try {
    target.scrollIntoView({ block: "nearest" });
  } catch (error) {
    try {
      target.scrollIntoView();
    } catch (ignored) { /* selection still applies */ }
  }
  return true;
}

// Duplicates the selected clips onto their own tracks, in one history step.
function duplicateSelectedClips(editor, tracks) {
  const seq = editor.project.sequence;
  if (!seq) return;
  const els = Array.from(tracks.container.querySelectorAll(".clip.selected"));
  if (!els.length) return;
  editor.history.startOperation();
  try {
    for (let k = 0; k < els.length; k++) {
      const clipObj = els[k].pz_object;
      if (!clipObj) continue;
      let trackIdx = -1;
      let clipIdx = -1;
      let isVideo = true;
      for (let ti = 0; ti < seq.videoTracks.length; ti++) {
        const ci = seq.videoTracks[ti].clips.indexOf(clipObj);
        if (ci >= 0) {
          trackIdx = ti;
          clipIdx = ci;
          isVideo = true;
          break;
        }
      }
      if (trackIdx < 0) {
        for (let ti = 0; ti < seq.audioTracks.length; ti++) {
          const ci = seq.audioTracks[ti].clips.indexOf(clipObj);
          if (ci >= 0) {
            trackIdx = ti;
            clipIdx = ci;
            isVideo = false;
            break;
          }
        }
      }
      if (trackIdx < 0) continue;
      tracks.createClip({
        type: isVideo ? 0 : 1,
        newTrackIdx: trackIdx,
        newIdx: clipIdx + 1,
        data: JSON.parse(JSON.stringify(clipObj)),
        start: clipObj.start + clipObj.length,
        length: clipObj.length,
      });
    }
  } finally {
    editor.history.finishOperation();
  }
  tracks.selectClips();
  tracks.zoom();
}

function installClipMenu(context, engine, editor) {
  const PZ = context.PZ || globalThis.PZ;
  const Tracks = PZ && PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;
  if (!Tracks || !Tracks.prototype || typeof Tracks.prototype.clipContextMenu !== "function") {
    console.warn("[Precomp+] the timeline clip menu is unavailable; right-click keeps the host behavior.");
    return function () { /* nothing to restore */ };
  }
  const doc = context.document || globalThis.document;
  if (!doc || typeof doc.createElement !== "function" || typeof doc.addEventListener !== "function") {
    console.warn("[Precomp+] the timeline clip menu is unavailable; right-click keeps the host behavior.");
    return function () { /* nothing to restore */ };
  }
  const original = Tracks.prototype.clipContextMenu;
  const openMenus = new Set();
  let active = true;

  function closeClipMenu() {
    openMenus.forEach(function (menu) {
      try {
        menu.remove();
      } catch (error) { /* already gone */ }
    });
    openMenus.clear();
  }

  function showClipMenu(tracks, e) {
    const t = e.currentTarget;
    e.preventDefault();
    e.stopPropagation();
    closeClipMenu();
    if (t && !t.classList.contains("selected")) {
      if (!e.ctrlKey && !e.shiftKey) tracks.deselectClips();
      t.classList.add("selected");
      tracks.selectClips();
    }
    const self = tracks;
    const menu = doc.createElement("ul");
    menu.classList.add("pz-dropdown");
    menu.setAttribute("tabindex", "-1");
    menu.style.position = "fixed";
    menu.style.zIndex = "99999";
    menu.style.width = "260px";
    const x = e.clientX !== undefined ? e.clientX : e.pageX;
    const y = e.clientY !== undefined ? e.clientY : e.pageY;
    const width = (globalThis.window && globalThis.window.innerWidth) || 1024;
    const height = (globalThis.window && globalThis.window.innerHeight) || 768;
    menu.style.left = Math.min(x, width - 270) + "px";
    menu.style.top = Math.min(y, height - 320) + "px";
    const clip = t ? t.pz_object : null;
    const addHeader = (text) => {
      const header = doc.createElement("li");
      header.style.cursor = "default";
      header.style.color = "#8ab4ff";
      header.style.fontSize = "12px";
      header.innerText = text;
      header.onmousedown = (ev) => ev.stopPropagation();
      header.onclick = (ev) => ev.stopPropagation();
      menu.appendChild(header);
    };
    const addItem = (label, fn, title) => {
      const item = doc.createElement("li");
      item.innerText = label;
      if (title) item.title = title;
      item.onmousedown = (ev) => ev.stopPropagation();
      item.onclick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        closeClipMenu();
        if (fn) fn();
      };
      item.onmouseenter = function () {
        Array.from(menu.children).forEach((child) => child.classList.remove("pz-active"));
        this.classList.add("pz-active");
      };
      menu.appendChild(item);
      return item;
    };
    addHeader("Source: " + clipSourceInfo(clip));
    addItem("Rename layer", function () {
      renameClipElement(PZ, editor, doc, t);
    }, "Rename the layer");
    addItem("Reveal source in Project", function () {
      const found = revealClipSource(doc, editor.project, clip);
      if (!found && editor.project) {
        session.kit.notify({ title: "Reveal source in Project", message: "Source: " + clipSourceInfo(clip) });
      }
    }, "Highlight the source media in Project media");
    addItem("Pre-compose selected", function () {
      openPrecomposeDialog();
    }, "Move selected clips into a new composition");
    addItem("Open source composition", function () {
      const opened = engine.openSourceOfClip(editor, clip);
      if (!opened.ok) session.kit.notify({ title: "Open source composition", message: opened.message });
    }, "If this clip came from a composition, open it");
    addItem("Duplicate", function () {
      duplicateSelectedClips(editor, self);
    }, "Duplicate selected clips");
    addItem("Split at playhead (C)", function () {
      const selected = self.container.querySelectorAll(".clip.selected");
      editor.history.startOperation();
      try {
        self.splitClips(selected);
      } finally {
        editor.history.finishOperation();
      }
      self.selectClips();
      self.zoom();
    });
    addItem("Delete", function () {
      const selected = self.container.querySelectorAll(".clip.selected");
      editor.history.startOperation();
      try {
        self.deleteClips(selected);
      } finally {
        editor.history.finishOperation();
      }
      self.selectClips();
      self.zoom();
    });
    doc.body.appendChild(menu);
    openMenus.add(menu);
    const cleanup = (ev) => {
      if (ev && menu.contains(ev.target)) return;
      menu.remove();
      openMenus.delete(menu);
      doc.removeEventListener("mousedown", cleanup, true);
      doc.removeEventListener("keydown", keyCleanup, true);
    };
    const keyCleanup = (ev) => {
      if (ev.key === "Escape") {
        menu.remove();
        openMenus.delete(menu);
        doc.removeEventListener("mousedown", cleanup, true);
        doc.removeEventListener("keydown", keyCleanup, true);
        ev.stopPropagation();
      }
    };
    doc.addEventListener("mousedown", cleanup, true);
    doc.addEventListener("keydown", keyCleanup, true);
    try {
      menu.focus();
    } catch (error) { /* focusing is best-effort */ }
  }

  Tracks.prototype.clipContextMenu = function (e) {
    if (!active) return original.apply(this, arguments);
    showClipMenu(this, e);
  };
  const wrapper = Tracks.prototype.clipContextMenu;
  // Clip elements created before activation bound the original handler;
  // rebuilding them picks up the menu. Selection state is left alone.
  try {
    const live = typeof engine.timelineTracks === "function" ? engine.timelineTracks(editor) : null;
    if (live && typeof live.redraw === "function") live.redraw();
  } catch (error) {
    console.warn("[Precomp+] existing timeline clips keep the host menu until the next redraw.");
  }
  return function restoreClipMenu() {
    active = false;
    closeClipMenu();
    // Only restore what this module still owns: another wrapper above stays.
    if (Tracks.prototype.clipContextMenu === wrapper) Tracks.prototype.clipContextMenu = original;
  };
}

// ---------------------------------------------------------------------------
// Comps tab

function fillTabPanel(body, kit) {
  body.appendChild(kit.controls.note(
    "Pre-compose moves the selected video and audio clips into a composition that Main keeps as one clip. " +
    "Open a composition to edit its clips."
  ).element);
  body.appendChild(kit.controls.buttonRow([
    { title: "Open Compositions", variant: "primary", onClick: function () { openCompsWindow(); } },
    { title: "Pre-compose selection", onClick: function () { openPrecomposeDialog(); } },
    { title: "New composition", onClick: function () { newEmptyCompAction(); } },
  ]).element);
}

// Creates an empty composition from the tab. Open windows refresh through
// the engine subscription; the result is reported like any other action.
function newEmptyCompAction() {
  if (!session) return;
  const created = session.engine.newEmptyComp(session.editor);
  session.kit.notify(created.ok
    ? { title: "Created " + created.name, message: "Double-click it in the Compositions window to edit its clips." }
    : { title: "New composition", message: created.message });
}

// The Comps sidebar panel uses the standard side-panel chrome (header,
// background and scrolling shared with every Zoidium panel).
function installTab(context) {
  const kit = kitOf(context);
  const side = context.ui && typeof context.ui.sidePanel === "function"
    ? context.ui.sidePanel({
      title: "Compositions",
      tabTitle: "Comps",
      icon: "layers",
      className: "precomp-plus-panel",
      tabClass: "precomp-plus-tab",
      position: "afterAbout",
    })
    : null;
  if (!side) {
    console.warn("[Precomp+] the sidebar is unavailable; the Compositions window is not reachable.");
    return null;
  }
  fillTabPanel(side.body, kit);
  return { tab: side.tab, side: side, kit: kit };
}

// Keeps the tab label showing the open composition, so editing mode stays
// visible when the Compositions window is closed.
function updateTabLabel(tabInfo) {
  if (!session || !tabInfo || !tabInfo.tab) return;
  const name = session.engine.activeName(session.editor);
  const label = tabInfo.tab.querySelector && tabInfo.tab.querySelector("span");
  if (label) label.textContent = name ? "Comps: " + name : "Comps";
  tabInfo.tab.title = name ? "Editing " + name : "Compositions";
}

module.exports = {
  activate(context) {
    const PZ = context.PZ || (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    if (!PZ || !PZ.ui || !PZ.track || !PZ.layer || !PZ.layer.composite) {
      throw new Error("Precomp+ needs the CM3 runtime.");
    }
    if (!context.editor) throw new Error("Precomp+ needs the open editor.");
    const engine = installEngine(context, PZ);
    context.lifecycle.onDispose(engine.install());
    session = { context: context, PZ: PZ, editor: context.editor, engine: engine, kit: kitOf(context) };
    context.lifecycle.onDispose(function () { session = null; });
    context.lifecycle.onDispose(installClipMenu(context, engine, context.editor));
    const tabInfo = installTab(context);
    if (tabInfo) {
      context.lifecycle.onDispose(engine.subscribe(function () { updateTabLabel(tabInfo); }));
      updateTabLabel(tabInfo);
    }
  },
  // Disabling is refused while the project holds compositions. The reason is
  // shown as the Plugins panel toggle's tooltip and when a disable is refused.
  isInUse() {
    return hasCompsInUse();
  },
  inUseReason() {
    return hasCompsInUse() ? "Delete all compositions before disabling Precomp+." : "";
  },
};

function hasCompsInUse() {
  return !!session && session.engine.hasComps(session.editor.project);
}
