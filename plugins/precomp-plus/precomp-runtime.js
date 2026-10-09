"use strict";

// Precomp+ runtime: the Comps tab, the Compositions window and the
// Pre-compose dialog. The composition model lives in comps.js (PZ.precomp).
// Every user-facing string is English.

const MAIN_KEY = "__main__";
let session = null;

function installEngine(context, PZ) {
  if (PZ.precomp && PZ.precomp.version === 2) return PZ.precomp;
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
      ' into "' + result.name + '". Main now has one clip for it.' +
      (result.audioKept
        ? " " + plural(result.audioKept, "other selected clip stayed", "other selected clips stayed") + " on Main."
        : "");
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
        ? "Moves " + plural(summary.video, "video clip", "video clips") + " into this composition." +
          (summary.other ? " " + plural(summary.other, "other selected clip stays", "other selected clips stay") + " on Main." : "")
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

  function remove(row) {
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
    if (row.isMain) title = row.editing ? "Main is open" : "Back to Main";
    else title = row.editing ? "Back to Main" : "Open";
    const actions = [{
      title: title,
      variant: "primary",
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
        "Select video clips on the timeline and click Pre-compose. They move into a composition, " +
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
      "Undo is cleared when you switch between Main and a composition. Export renders the open timeline, so return to Main first."
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
      { title: "Close", onClick: function () { win.close(); } },
    ],
  });
  return win;
}

// ---------------------------------------------------------------------------
// Comps tab

function buildTabPanel(context, kit) {
  const doc = context.document;
  const panel = doc.createElement("div");
  panel.className = "precomp-plus-panel";
  panel.appendChild(kit.createPageHeader("Compositions"));
  panel.appendChild(kit.controls.note(
    "Pre-compose moves the selected video clips into a composition that Main keeps as one clip. " +
    "Open a composition to edit its clips."
  ).element);
  panel.appendChild(kit.controls.buttonRow([
    { title: "Open Compositions", variant: "primary", onClick: function () { openCompsWindow(); } },
    { title: "Pre-compose selection", onClick: function () { openPrecomposeDialog(); } },
  ]).element);
  return panel;
}

function installTab(context) {
  const kit = kitOf(context);
  if (typeof kit.createMenubarTab !== "function") return null;
  const tab = kit.createMenubarTab({
    title: "Comps",
    icon: "layers",
    panel: buildTabPanel(context, kit),
    tabClass: "precomp-plus-tab",
    position: "afterAbout",
  });
  if (!tab) {
    console.warn("[Precomp+] the sidebar is unavailable; the Compositions window is not reachable.");
    return null;
  }
  return { tab: tab, kit: kit };
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
    const tabInfo = installTab(context);
    if (tabInfo) {
      context.lifecycle.onDispose(function () { tabInfo.kit.removeMenubarTab(tabInfo.tab); });
      context.lifecycle.onDispose(engine.subscribe(function () { updateTabLabel(tabInfo); }));
      updateTabLabel(tabInfo);
    }
  },
  // Disabling is refused while the project holds compositions.
  isInUse() {
    return !!session && session.engine.hasComps(session.editor.project);
  },
};
