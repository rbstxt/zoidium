"use strict";

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

// `session` = { document, registry(), notify, reveal(item) }.
function createActions(session) {
  const doc = session.document;
  const busy = new Set();

  function pickFile(item) {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      if (ACCEPT[item.kind]) input.accept = ACCEPT[item.kind];
      input.addEventListener("change", () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
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
    ];
  }

  return { list };
}

module.exports = { createActions };
