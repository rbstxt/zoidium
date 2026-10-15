"use strict";

// Resolve Fonts (After Effects: File > Dependencies > Resolve Fonts): one
// window lists every missing or failed font the project uses and replaces
// each with a built-in font or a font file through the registry's replace().

const model = require("./assets-model.js");

const KEEP = "";

// A failed built-in font is reloaded, not replaced by itself.
function candidates(item, builtIns) {
  return builtIns.filter((font) => font.key !== item.key && font.id !== item.id);
}

function suggestion(item, builtIns) {
  builtIns = candidates(item, builtIns);
  const name = String(item.name || "").replace(/\.[^.]+$/, "").toLowerCase();
  const match = builtIns.find((font) => String(font.name).toLowerCase() === name);
  return match ? match.id : KEEP;
}

// `session` = { context, kit, document, registry(), notify, actions }.
function createResolveFonts(session) {
  const doc = session.document;
  const WINDOW_ID = "resolve-fonts";

  function problemFonts() {
    const api = session.registry();
    const snapshot = api ? api.snapshot() : null;
    // Only fonts something uses can be replaced; an unused missing font is
    // cleaned up with Remove Unused Items instead.
    return (snapshot ? snapshot.items : []).filter((item) => item.kind === "font" && model.isProblem(item) &&
      model.usageCount(item) > 0);
  }

  function open() {
    const existing = session.context.ui.getWindow(WINDOW_ID);
    if (existing) {
      existing.reveal();
      return existing;
    }
    const api = session.registry();
    const builtIns = api && api.builtInFonts ? api.builtInFonts() : [];
    const choices = new Map();
    let rows = [];
    let body = null;
    let win = null;

    function render() {
      if (!body) return;
      body.textContent = "";
      rows = problemFonts();
      const c = session.kit.controls;
      if (!rows.length) {
        body.appendChild(c.note("Every font in the project is available.").element);
        return;
      }
      body.appendChild(c.note(
        "Choose a replacement for each font. Each replacement applies to every use and can be undone."
      ).element);
      for (const item of rows) {
        if (!choices.has(item.id)) choices.set(item.id, { builtIn: suggestion(item, builtIns), file: null });
        const choice = choices.get(item.id);
        const section = c.section(item.name);
        section.body.appendChild(c.note(
          model.statusLabel(item.status) + " · " + model.usageText(item) + (item.error ? " · " + item.error : ""),
          "warning"
        ).element);
        const select = c.select({
          label: "Replace with",
          value: choice.file ? "file" : choice.builtIn,
          options: [{ value: KEEP, label: "Keep as is" }]
            .concat(choice.file ? [{ value: "file", label: choice.file.name }] : [])
            .concat(candidates(item, builtIns).map((font) => ({ value: font.id, label: font.name }))),
          onChange: (value) => {
            if (value !== "file") {
              choice.file = null;
              choice.builtIn = value;
            }
          },
        });
        section.body.appendChild(select.element);
        section.body.appendChild(c.button({
          title: "Font file…",
          hint: "Use a font file from this computer",
          onClick: () => session.actions.pickFile(item).then((file) => {
            if (!file) return;
            choice.file = file;
            render();
          }),
        }).element);
        body.appendChild(section.element);
      }
    }

    async function apply() {
      let replaced = 0;
      for (const item of rows) {
        const choice = choices.get(item.id);
        if (!choice || (!choice.file && choice.builtIn === KEEP)) continue;
        const target = choice.file ? { file: choice.file } : { itemId: choice.builtIn };
        await session.actions.replace(item, target);
        choices.delete(item.id);
        replaced += 1;
      }
      if (!replaced) {
        session.notify({ title: "Resolve Fonts", message: "Choose a replacement for at least one font." });
        return;
      }
      if (!problemFonts().length) win.close();
      else render();
    }

    win = session.context.ui.openWindow({
      id: WINDOW_ID,
      title: "Resolve Fonts",
      persistKey: "resolve-fonts",
      placement: "center",
      width: 420,
      height: 460,
      minWidth: 340,
      minHeight: 260,
      mount(root) {
        body = root;
        render();
        return () => {
          body = null;
        };
      },
      footer: [
        { title: "Replace", variant: "primary", onClick: () => { apply(); } },
        { title: "Cancel", onClick: () => win.close() },
      ],
    });
    return win;
  }

  return { open };
}

module.exports = { createResolveFonts, suggestion };
