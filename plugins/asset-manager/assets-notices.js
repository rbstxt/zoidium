"use strict";

// Problem reporting outside the Assets window: a toolbar badge while items
// are missing or failed, a notice when a project opens with missing items
// (After Effects reports missing footage on open), and a notice after a save
// that still contains them. Every notice offers "Show in Assets".

const model = require("./assets-model.js");

// Fonts and images finish loading shortly after a project opens; report
// what is still missing or failed after this delay.
const OPEN_SETTLE_MS = 2500;

function problemsOf(snapshot) {
  return snapshot ? snapshot.items.filter(model.isProblem) : [];
}

function describe(problems) {
  const names = problems.slice(0, 3).map((item) => item.name + " (" + model.statusLabel(item.status).toLowerCase() + ")");
  const rest = problems.length - names.length;
  return names.join(", ") + (rest > 0 ? " and " + rest + " more" : "") + ".";
}

// `session` = { document, editor, registry(), notify, openWindow(options) }.
function installToolbarBadge(session) {
  const doc = session.document;
  const toolbar = doc.querySelector("#controls .zoidium-project-actions") ||
    doc.querySelector(".zoidium-project-actions");
  if (!toolbar) return () => {};
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "actionbutton zam-toolbar-badge";
  button.hidden = true;
  const icon = session.icon("error");
  if (icon) button.appendChild(icon);
  const count = doc.createElement("span");
  count.className = "zam-toolbar-count";
  button.appendChild(count);
  button.addEventListener("click", () => session.openWindow({ filter: "problems" }));
  toolbar.appendChild(button);

  function render(snapshot) {
    const problems = problemsOf(snapshot);
    button.hidden = problems.length === 0;
    count.textContent = String(problems.length);
    button.title = problems.length
      ? model.plural(problems.length, "asset problem", "asset problems") + ": " + describe(problems) + " Click to show them in Assets."
      : "";
  }

  const api = session.registry();
  const unsubscribe = api ? api.subscribe(render) : () => {};
  render(api ? api.snapshot() : null);
  return () => {
    unsubscribe();
    button.remove();
  };
}

function installNotices(session) {
  const host = session.window;
  const api = session.registry();
  if (!api) return () => {};
  let project = null;
  let timer = null;

  function show(title, problems, prefix) {
    session.notify({
      title,
      message: (prefix || "") + describe(problems),
      action: { label: "Show in Assets", run: () => session.openWindow({ filter: "problems" }) },
    });
  }

  function checkOpened() {
    timer = null;
    const problems = problemsOf(api.snapshot());
    if (!problems.length) return;
    show(model.plural(problems.length, "asset is", "assets are") + " missing or failed", problems);
  }

  // A different project object means New, Open or a restore point: report
  // its problems once, after loading settles.
  function onSnapshot() {
    const current = session.editor.project;
    if (current === project) return;
    project = current;
    if (timer) host.clearTimeout(timer);
    timer = host.setTimeout(checkOpened, OPEN_SETTLE_MS);
  }

  // The save itself is never blocked; the notice follows the "Saved." toast.
  function onSaved(event) {
    const detail = (event && event.detail) || {};
    if (detail.editor && detail.editor !== session.editor) return;
    host.setTimeout(() => {
      const problems = problemsOf(api.snapshot());
      if (!problems.length) return;
      show("Saved with " + model.plural(problems.length, "asset problem", "asset problems"), problems,
        (detail.filename ? detail.filename + " was saved. " : "") + "Still missing or failed: ");
    }, 0);
  }

  project = session.editor.project;
  const unsubscribe = api.subscribe(onSnapshot);
  host.addEventListener("zoidium:project-saved", onSaved);
  return () => {
    unsubscribe();
    if (timer) host.clearTimeout(timer);
    host.removeEventListener("zoidium:project-saved", onSaved);
  };
}

module.exports = { installToolbarBadge, installNotices, describe };
