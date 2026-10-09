"use strict";

// Precomp+ — composition tabs engine runtime.
//
// Evaluates the bundled comps subsystem (PZ.ui.comps + compsPanel), hooks
// save/backup, exposes precomposeSelection, appends the timeline clip-menu
// items (Pre-compose, Open source composition, Back to Main), and docks a
// Comps tab when the host UI allows it.

let installedPZ = null;
let installedMenu = null;
let installedTab = null;

function installSources(context, PZ) {
  const getAsset = context && typeof context.getAsset === "function"
    ? context.getAsset.bind(context)
    : null;
  if (!getAsset) {
    throw new Error("Precomp+ needs the plugin bundle asset resolver.");
  }
  const source = getAsset("text", "./plugins/precomp-plus/comps.js");
  if (typeof source !== "string") {
    throw new Error("Precomp+ is missing its bundled source: comps.js.");
  }
  new Function("PZ", source)(PZ);
}

function hookEditor(CM, PZ) {
  if (!CM || !CM.project) return;
  try {
    PZ.ui.comps.attachSaveHook(CM);
  } catch (_error) { /* best effort */ }
  if (typeof CM.precomposeSelection !== "function") {
    try {
      CM.precomposeSelection = function () {
        return PZ.ui.comps.precomposeFromSelection(CM);
      };
    } catch (_error) { /* best effort */ }
  }
}

function findMenuOwners(PZ) {
  const tracks = PZ && PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;
  const candidates = [];
  if (tracks && tracks.prototype &&
      typeof tracks.prototype.clipContextMenu === "function") {
    candidates.push(tracks.prototype);
  }
  // Fallback: bounded scan for any other owner (mirrors designer-gear.js).
  const ui = PZ && PZ.ui;
  if (ui) {
    const seen = new Set();
    const queue = [{ obj: ui, depth: 0 }];
    let budget = 800;
    while (queue.length && budget-- > 0) {
      const { obj, depth } = queue.shift();
      if (!obj || seen.has(obj)) continue;
      seen.add(obj);
      let owns = false;
      try {
        owns = Object.prototype.hasOwnProperty.call(obj, "clipContextMenu") &&
          typeof obj.clipContextMenu === "function";
      } catch (_error) { /* unreadable node */ }
      if (owns && !candidates.includes(obj)) candidates.push(obj);
      if (depth >= 4) continue;
      let proto = null;
      try { proto = Object.getPrototypeOf(obj); } catch (_error) { /* none */ }
      if (proto && proto !== Object.prototype && proto !== Function.prototype) {
        queue.push({ obj: proto, depth: depth + 1 });
      }
      if (typeof obj === "function" && obj.prototype && typeof obj.prototype === "object") {
        queue.push({ obj: obj.prototype, depth: depth + 1 });
      }
      if (depth >= 3) continue;
      let keys = [];
      try { keys = Object.keys(obj); } catch (_error) { /* none */ }
      for (const key of keys.slice(0, 60)) {
        let value = null;
        try { value = obj[key]; } catch (_error) { continue; }
        if (value && (typeof value === "object" || typeof value === "function") && !value.nodeType) {
          queue.push({ obj: value, depth: depth + 1 });
        }
      }
    }
  }
  return candidates;
}

function buildMenuItem(label, fn, title) {
  const li = document.createElement("li");
  li.innerText = label;
  if (title) li.title = title;
  li.onmousedown = (ev) => ev.stopPropagation();
  li.onclick = (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    try {
      const ul = ev.currentTarget && ev.currentTarget.closest
        ? ev.currentTarget.closest("ul.pz-dropdown")
        : null;
      if (ul) ul.remove();
    } catch (_error) { /* ignore */ }
    if (fn) fn();
  };
  li.onmouseenter = function () {
    try {
      Array.from(this.parentElement.children).forEach((c) => c.classList.remove("pz-active"));
      this.classList.add("pz-active");
    } catch (_error) { /* ignore */ }
  };
  return li;
}

function installMenu(PZ) {
  const owners = findMenuOwners(PZ);
  if (!owners.length) {
    throw new Error("Precomp+ needs the timeline clip menu from the CM3 runtime.");
  }
  for (const owner of owners) {
    if (owner.clipContextMenu.__precompPlus) continue;
    const original = owner.clipContextMenu;
    const patched = function (e) {
      const out = original.call(this, e);
      try {
        if (patched.__precompPlusDead) return out;
        const menu = this._clipMenu;
        if (!menu || typeof menu.appendChild !== "function") return out;
        if (menu.querySelector && menu.querySelector("li[data-precomp-plus]")) return out;
        const self = this;
        const editor = self && self.timeline && self.timeline.editor;
        const target = e && e.currentTarget;
        const clip = target ? target.pz_object : null;
        const mark = (li) => {
          try { li.setAttribute("data-precomp-plus", "1"); } catch (_err) { /* ignore */ }
          return li;
        };
        const hasComps = !!(PZ.ui && PZ.ui.comps && PZ.ui.comps.precomposeFromSelection);
        if (hasComps) {
          menu.appendChild(mark(buildMenuItem("Pre-compose selected", () => {
            try {
              if (editor && editor.precomposeSelection) editor.precomposeSelection();
              else if (PZ.ui.comps) PZ.ui.comps.precomposeFromSelection(editor);
            } catch (_err) { /* ignore */ }
          }, "Move selected clips into a new composition")));
          menu.appendChild(mark(buildMenuItem("Open source composition", () => {
            try {
              if (PZ.ui.comps && PZ.ui.comps.openSourceOfClip) {
                PZ.ui.comps.openSourceOfClip(editor, clip);
              }
            } catch (_err) { /* ignore */ }
          }, "If this clip came from a composition, open it")));
          try {
            if (editor && editor.activeComp) {
              menu.appendChild(mark(buildMenuItem("Back to Main composition", () => {
                try {
                  PZ.ui.comps.switchTo(editor, null);
                } catch (_err) { /* ignore */ }
              }, "Return to the main composition")));
            }
          } catch (_err) { /* ignore */ }
        }
      } catch (_err) { /* never break the clip menu */ }
      return out;
    };
    patched.__precompPlus = true;
    owner.clipContextMenu = patched;
    if (!installedMenu) installedMenu = [];
    installedMenu.push({ owner, original, patched });
  }
}

function uninstallMenu() {
  for (const { owner, original, patched } of installedMenu || []) {
    try {
      patched.__precompPlusDead = true;
      if (owner.clipContextMenu === patched) {
        owner.clipContextMenu = original;
      }
    } catch (_error) { /* best effort */ }
  }
  installedMenu = null;
}

function installTab(CM, PZ) {
  try {
    const kit = globalThis.ZoidiumUI;
    if (!kit || typeof kit.createMenubarTab !== "function") return;
    if (typeof PZ.ui.compsPanel !== "function") return;
    if (document.querySelector(".precomp-plus-tab")) return;
    const panel = new PZ.ui.compsPanel(CM);
    const ok = kit.createMenubarTab({
      title: "Comps",
      icon: "layers",
      panel: panel,
      tabClass: "precomp-plus-tab",
      position: "afterAbout",
    });
    if (ok) installedTab = panel;
  } catch (_error) { /* menu-driven flow still works */ }
}

module.exports = {
  activate(context) {
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    if (!PZ || !PZ.ui) {
      throw new Error("Precomp+ needs the CM3 runtime.");
    }
    if (PZ.ui.comps && PZ.ui.comps.precomposeFromSelection && PZ.ui.compsPanel) {
      // Already installed (for example by a second enable); refresh hooks.
    } else {
      installSources(context, PZ);
    }
    if (!PZ.ui.comps || !PZ.ui.comps.precomposeFromSelection) {
      throw new Error("Precomp+ could not define its composition engine.");
    }
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (CM) hookEditor(CM, PZ);
    installMenu(PZ);
    if (CM) installTab(CM, PZ);
    installedPZ = PZ;
  },
  deactivate() {
    try {
      uninstallMenu();
      if (installedTab) {
        try {
          if (installedTab.el && installedTab.el.remove) installedTab.el.remove();
        } catch (_error) { /* best effort */ }
        installedTab = null;
      }
    } finally {
      installedPZ = null;
    }
  },
};
