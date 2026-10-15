"use strict";

// Assets: an After Effects style Project panel for everything the project
// uses or holds (footage, fonts, images, models, LUTs, compositions and
// plugin files). This module adds the Assets sidebar tab and opens the Assets
// window; the item data comes from the core registry, ZoidiumAssets.

const STYLE_ID = "zoidium-asset-manager-style";
const STYLE_URL = "./plugins/asset-manager/assets.css";
const PROBLEM_PREVIEW = 5;

function kitOf(context) {
  const kit = (context.window || globalThis).ZoidiumUI;
  if (!kit || typeof kit.openWindow !== "function") {
    throw new Error("Assets needs the Zoidium UI kit.");
  }
  return kit;
}

function installStyle(context, doc) {
  if (doc.getElementById(STYLE_ID)) return () => {};
  const css = context.getAsset("text", STYLE_URL);
  if (typeof css !== "string") throw new Error("Assets could not load its stylesheet.");
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  doc.head.appendChild(style);
  return () => style.remove();
}

// The sidebar page summarizes the project and lists the first problems, so a
// missing font or file is visible without opening the window.
function installSidePanel(context, session, assetsWindow, model) {
  const side = context.ui.sidePanel({
    title: "Assets",
    tabTitle: "Assets",
    icon: "templates",
    className: "zam-side",
    tabClass: "zam-side-tab",
  });
  const doc = session.document;
  const summary = doc.createElement("div");
  summary.className = "zam-side-summary";
  const problems = doc.createElement("div");
  problems.className = "zam-side-problems";
  side.body.appendChild(summary);
  side.body.appendChild(context.ui.controls.buttonRow([
    { title: "Open Assets", variant: "primary", onClick: () => assetsWindow.open() },
  ]).element);
  side.body.appendChild(problems);

  function render(snapshot) {
    const items = snapshot ? snapshot.items : [];
    summary.textContent = snapshot ? model.summaryText(items) : "The asset registry is not available.";
    problems.textContent = "";
    const list = items.filter(model.isProblem);
    side.tab.classList.toggle("zam-has-problems", list.length > 0);
    side.tab.title = list.length ? "Assets: " + model.plural(list.length, "problem", "problems") : "Assets";
    if (!list.length) return;
    const title = doc.createElement("div");
    title.className = "zam-side-title";
    title.textContent = model.plural(list.length, "problem", "problems");
    problems.appendChild(title);
    for (const item of list.slice(0, PROBLEM_PREVIEW)) {
      const entry = doc.createElement("button");
      entry.type = "button";
      entry.className = "zam-side-problem";
      entry.textContent = item.name + " — " + model.statusLabel(item.status);
      entry.title = item.error || "Show in Assets";
      entry.addEventListener("click", () => assetsWindow.open({ filter: "problems", select: item.id }));
      problems.appendChild(entry);
    }
    if (list.length > PROBLEM_PREVIEW) {
      const more = doc.createElement("button");
      more.type = "button";
      more.className = "zam-side-problem zam-muted";
      more.textContent = "Show all problems";
      more.addEventListener("click", () => assetsWindow.open({ filter: "problems" }));
      problems.appendChild(more);
    }
  }

  const api = session.registry();
  const unsubscribe = api ? api.subscribe(render) : () => {};
  render(api ? api.snapshot() : null);
  return () => {
    unsubscribe();
    side.remove();
  };
}

module.exports = {
  activate(context) {
    const host = context.window || globalThis;
    const doc = host.document;
    const kit = kitOf(context);
    const apis = context.apis || host.ZoidiumPluginApis;
    const require = apis.modules.createRequire(context.getAsset, { root: "./plugins/asset-manager/" });
    const model = require("./assets-model.js");
    const { createAssetsWindow } = require("./assets-window.js");
    const notices = require("./assets-notices.js");
    const PZ = context.PZ || host.PZ;
    const session = {
      context,
      window: host,
      editor: context.editor || host.CM,
      kit,
      document: doc,
      registry: () => host.ZoidiumAssets || null,
      icon: (name) => (PZ && PZ.ui && typeof PZ.ui.generateIcon === "function" ? PZ.ui.generateIcon(name) : null),
      notify: (detail) => kit.notify(detail),
    };
    context.lifecycle.onDispose(installStyle(context, doc));
    const assetsWindow = createAssetsWindow(session);
    context.lifecycle.onDispose(installSidePanel(context, session, assetsWindow, model));
    session.openWindow = (options) => assetsWindow.open(options);
    context.lifecycle.onDispose(notices.installToolbarBadge(session));
    context.lifecycle.onDispose(notices.installNotices(session));
    // Notices and other plugins can open the window on an item:
    // ZoidiumAssetsPanel.open({ select: assetKey, filter: "problems" }).
    host.ZoidiumAssetsPanel = { open: (options) => assetsWindow.open(options) };
    context.lifecycle.onDispose(() => {
      if (host.ZoidiumAssetsPanel && host.ZoidiumAssetsPanel.open) delete host.ZoidiumAssetsPanel;
    });
  },
};
