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

// `session` = { document, registry(), notify, confirm, reveal(item), select(id) }.
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
    session.notify({
      title: "Locate " + item.name,
      message: reason === "different"
        ? file.name + " is a different file. Choose the original " + item.name + "."
        : reason === "not-missing"
          ? item.name + " is no longer missing."
          : (result && result.error) || "The file could not be attached.",
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
        id: "export",
        label: "Save File…",
        icon: "download",
        hint: "Download this item as a separate file",
        enabled: !!(api && api.exportFile && caps.exportFile),
        run: () => guarded(item, "Save File", () => exportFile(item)),
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

  return { list, importCommand, removeUnusedCommand, importFiles };
}

module.exports = { createActions };
