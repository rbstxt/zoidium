"use strict";

const model = require("./assets-model.js");

// Item commands of the Assets window, shared by its icon bar and the row
// context menu (After Effects: Reveal in Composition, Reload Footage,
// Replace/Locate Footage, Reveal in Explorer). Each command reports whether
// it applies to an item and runs through the core registry; a command the
// registry does not offer yet is simply unavailable.

const ACCEPT = {
  font: ".ttf,.otf,.json",
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  geometry: ".obj,.json",
  lut: ".cube",
  ies: ".ies",
};

function capabilitiesOf(api, item) {
  if (!api || !item || typeof api.capabilities !== "function") return {};
  try {
    return api.capabilities(item) || {};
  } catch (error) {
    console.warn("[Assets] capabilities failed:", error);
    return {};
  }
}

// `session` = { document, registry(), notify, confirm, reveal(item), select(id),
// resolveFonts() }.
function createActions(session) {
  const doc = session.document;
  const busy = new Set();

  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.multiple = !!multiple;
      if (accept) input.accept = accept;
      input.addEventListener("change", () => resolve(Array.from(input.files || [])), { once: true });
      input.addEventListener("cancel", () => resolve([]), { once: true });
      input.click();
    });
  }

  function pickFile(item) {
    return pickFiles(ACCEPT[item.kind], false).then((files) => files[0] || null);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Runs an async command once per item at a time and reports failures.
  function guarded(item, title, run) {
    const key = title + ":" + item.id;
    if (busy.has(key)) return Promise.resolve();
    busy.add(key);
    return Promise.resolve()
      .then(run)
      .catch((error) => {
        session.notify({ title, message: (error && error.message) || "The command failed." });
      })
      .finally(() => busy.delete(key));
  }

  async function reload(item) {
    const result = await session.registry().reload(item.id);
    if (result && result.ok) {
      session.notify({ title: "Reloaded", message: item.name });
    } else {
      session.notify({
        title: "Could not reload " + item.name,
        message: (result && result.error) || "The file is still unavailable. Try again later.",
      });
    }
  }

  async function locate(item, file) {
    if (!file) return;
    const result = await session.registry().locate(item.id, file);
    if (result && result.ok) {
      session.notify({ title: "Found " + item.name, message: file.name + " is attached again." });
      return;
    }
    const reason = result && result.reason;
    // AE relinks a different file through Replace Footage; offer that here.
    if (reason === "different" && session.registry().replace) {
      const approved = await session.confirm({
        title: "Replace " + item.name,
        message: file.name + " is a different file. Use it in place of " + item.name + " everywhere it is used?",
        confirmLabel: "Replace",
        cancelLabel: "Cancel",
      });
      if (approved) await replace(item, { file });
      return;
    }
    session.notify({
      title: "Locate " + item.name,
      message: reason === "different"
        ? file.name + " is a different file. Choose the original " + item.name + "."
        : reason === "not-missing"
          ? item.name + " is no longer missing."
          : (result && result.error) || "The file could not be attached.",
    });
  }

  // AE Replace Footage: every use switches to the new file in one undo step.
  async function replace(item, target) {
    const result = await session.registry().replace(item.id, target);
    if (!result || !result.ok) {
      session.notify({
        title: "Replace " + item.name,
        message: result && result.reason === "kind"
          ? "Choose a file of the same type (" + model.kindLabel(item.kind).toLowerCase() + ")."
          : (result && result.error) || "The item could not be replaced.",
      });
      return;
    }
    const skipped = result.skipped || [];
    if (result.newId) session.select(result.newId);
    session.notify({
      title: "Replaced " + model.plural(result.replaced || 0, "use", "uses"),
      message: skipped.length
        ? model.plural(skipped.length, "use stays", "uses stay") + " in closed compositions: " +
          skipped.slice(0, 3).map(model.usagePath).join("; ") + ". Open them to replace those uses."
        : "Undo restores " + item.name + ".",
    });
  }

  async function exportFile(item) {
    const result = await session.registry().exportFile(item.id);
    if (!result || !result.blob) {
      session.notify({ title: "Save File", message: "The bytes of " + item.name + " are not available." });
      return;
    }
    download(result.blob, result.filename || item.name);
  }

  // AE File > Import: footage also lands in the Media tab, other files are
  // kept as project items. The newest item is selected afterwards.
  async function importFiles(files) {
    if (!files || !files.length) return;
    const result = await session.registry().import(files);
    const imported = (result && result.items) || [];
    const created = imported.filter((entry) => entry.created);
    const errors = (result && result.errors) || [];
    if (imported.length) session.select(imported[imported.length - 1].id);
    if (errors.length) {
      session.notify({ title: "Import", message: errors.map((entry) => entry.message || String(entry)).join(" ") });
    } else if (imported.length && !created.length) {
      session.notify({ title: "Import", message: "Those files are already in the project." });
    }
  }

  function importCommand() {
    const api = session.registry();
    return {
      id: "import",
      label: "Import…",
      icon: "addmedia",
      hint: "Add files to the project; they stay here until you remove them",
      enabled: !!(api && api.import),
      run: () => {
        const picked = pickFiles("", true);
        return guarded({ id: "project" }, "Import", () => picked.then(importFiles));
      },
    };
  }

  function removeUnusedCommand(snapshot) {
    const api = session.registry();
    const unused = model.unusedFiles(snapshot ? snapshot.items : []);
    const size = model.formatSize(model.totalSize(unused));
    return {
      id: "remove-unused",
      label: "Remove Unused Items" + (unused.length ? " (" + unused.length + (size ? ", " + size : "") + ")" : ""),
      icon: "delete",
      hint: "Remove every imported file that nothing in the project uses",
      enabled: !!(api && api.removeUnused) && unused.length > 0,
      run: () => guarded({ id: "project" }, "Remove Unused Items", async () => {
        const result = await session.registry().removeUnused();
        const removed = (result && result.removed) || [];
        // AE reports the count afterwards instead of asking first; undo
        // brings the files back.
        session.notify({
          title: "Removed " + model.plural(removed.length, "unused item", "unused items"),
          message: (result && result.freed ? model.formatSize(result.freed) + " freed. " : "") + "Undo restores them.",
        });
      }),
    };
  }

  // AE File > Dependencies > Collect Files: one archive with every file in
  // its Assets folder, plus a report of files the project lacks.
  function collectCommand(snapshot) {
    const api = session.registry();
    const files = (snapshot ? snapshot.items : []).filter((item) => item.source === "file" || item.source === "embedded");
    return {
      id: "collect-files",
      label: "Collect Files…",
      icon: "export",
      hint: "Download a .zip with every file of the project in its Assets folder",
      enabled: !!(api && api.collectFiles) && files.length > 0,
      run: () => guarded({ id: "project" }, "Collect Files", async () => {
        const result = await session.registry().collectFiles();
        if (!result || !result.ok) {
          session.notify({ title: "Collect Files", message: (result && result.error) || "The files could not be collected." });
          return;
        }
        download(result.blob, result.filename);
        const missing = result.missing || [];
        session.notify({
          title: "Collected " + model.plural(result.collected.length, "file", "files"),
          message: missing.length
            ? model.plural(missing.length, "missing item is", "missing items are") + " listed in the report inside the archive."
            : "No files are missing.",
        });
      }),
    };
  }

  // AE File > Dependencies > Consolidate All Footage: items with identical
  // bytes become one item in one undo step.
  function consolidateCommand() {
    const api = session.registry();
    return {
      id: "consolidate",
      label: "Consolidate All Footage",
      icon: "duplicate",
      hint: "Merge items whose files are identical into one item",
      enabled: !!(api && api.consolidate),
      run: () => guarded({ id: "project" }, "Consolidate All Footage", async () => {
        const result = await session.registry().consolidate();
        if (!result || !result.ok) {
          session.notify({ title: "Consolidate All Footage", message: (result && result.error) || "The items could not be consolidated." });
          return;
        }
        const count = result.consolidated || 0;
        const skipped = result.skipped || [];
        session.notify({
          title: model.plural(count, "duplicate", "duplicates") + " consolidated",
          message: count
            ? (result.groups || []).slice(0, 3).map((group) => group.merged.map((entry) => entry.name).join(", ") +
                " → " + group.keep.name).join("; ") + ". Undo restores them." +
              (skipped.length ? " " + model.plural(skipped.length, "use stays", "uses stay") + " in closed compositions." : "")
            : "No items share the same file.",
        });
      }),
    };
  }

  async function remove(item) {
    const api = session.registry();
    const count = model.usageCount(item);
    if (!count) {
      const result = await api.removeUnused([item.id]);
      const removed = (result && result.removed) || [];
      if (!removed.length) session.notify({ title: "Delete", message: item.name + " is still used in the project." });
      return;
    }
    // AE asks before deleting an item that compositions still use.
    const approved = count > 0 && await session.confirm({
      title: "Delete " + item.name,
      message: item.name + " is " + model.usageText(item).toLowerCase() +
        ". Deleting it also deletes clips that show it and clears the properties that use it. You can undo this.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (count && !approved) return;
    const result = await api.removeItems([item.id]);
    if (result && result.ok) return;
    session.notify({
      title: "Delete " + item.name,
      message: result && result.reason === "in-closed-composition"
        ? "It is also used inside a closed composition. Open that composition and remove the use there first."
        : (result && result.error) || "The item could not be deleted.",
    });
  }

  // Commands for one item, in menu order. `enabled` is computed now so the
  // menu and icon bar render without async work.
  function list(item) {
    const api = session.registry();
    const caps = capabilitiesOf(api, item);
    const revealable = !!item && (item.usages || []).some((usage) => usage.revealable);
    return [
      {
        id: "reveal",
        label: "Reveal in Timeline",
        icon: "search",
        hint: "Select the first use of this item in the editor",
        enabled: revealable,
        run: () => session.reveal(item),
      },
      {
        id: "reload",
        label: "Reload",
        icon: "reset",
        hint: "Load this item again, for example after a network error",
        enabled: !!(api && api.reload && caps.reload),
        run: () => guarded(item, "Reload", () => reload(item)),
      },
      {
        id: "locate",
        label: "Locate…",
        icon: "link",
        hint: "Choose the missing file on this computer",
        enabled: !!(api && api.locate && caps.locate),
        // The picker opens synchronously so the click's user activation
        // still applies; the registry call follows the choice.
        run: () => {
          const picked = pickFile(item);
          return guarded(item, "Locate", () => picked.then((file) => locate(item, file)));
        },
      },
      {
        id: "replace",
        label: "Replace…",
        icon: "change",
        hint: "Use another file everywhere this item is used",
        enabled: !!(api && api.replace) && !!item && item.kind !== "composition" && model.usageCount(item) > 0,
        run: () => {
          const picked = pickFile(item);
          return guarded(item, "Replace", () => picked.then((file) => file && replace(item, { file })));
        },
      },
      {
        id: "export",
        label: "Download",
        icon: "download",
        hint: "Download this item as a separate file",
        enabled: !!(api && api.exportFile && caps.exportFile),
        run: () => guarded(item, "Download", () => exportFile(item)),
      },
      {
        id: "delete",
        label: "Delete",
        icon: "remove",
        hint: model.usageCount(item) ? "Delete this item and its uses" : "Remove this unused item from the project",
        enabled: !!item && item.source === "file" &&
          !!(api && (model.usageCount(item) ? api.removeItems : api.removeUnused)),
        run: () => guarded(item, "Delete", () => remove(item)),
      },
    ];
  }

  function resolveFontsCommand(snapshot) {
    const api = session.registry();
    const fonts = (snapshot ? snapshot.items : []).filter((item) => item.kind === "font" && model.isProblem(item) &&
      model.usageCount(item) > 0);
    return {
      id: "resolve-fonts",
      label: "Resolve Fonts…" + (fonts.length ? " (" + fonts.length + ")" : ""),
      icon: "text",
      hint: "Replace missing or failed fonts with built-in fonts or font files",
      enabled: !!(api && api.replace && api.builtInFonts) && fonts.length > 0,
      run: () => session.resolveFonts(),
    };
  }

  return { list, importCommand, removeUnusedCommand, resolveFontsCommand, collectCommand, consolidateCommand,
    importFiles, replace, pickFile };
}

module.exports = { createActions };
