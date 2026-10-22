"use strict";
const { completions, wordAt } = require("./code-assist.js");
const { toggleComments, bracketEdit, enterEdit, createUndo } = require("./code-edit.js");
const { indentCode } = require("./code-model.js");
function installAids({ input, pane, body, toolbar, node, global, entries, changed, expression }) {
  const selection = () => ({ text: input.value, start: input.selectionStart, end: input.selectionEnd });
  const history = createUndo(selection());
  let completing = [], selected = 0, composing = false, fontSize = 13;
  try { fontSize = Math.min(24, Math.max(10, Number(global.localStorage.getItem("zoidium.shader-editor.fontSize")) || 13)); } catch { /* Private storage can be unavailable. */ }
  function setFont() { pane.style.setProperty("--zsp-code-size", fontSize + "px"); pane.style.setProperty("--zsp-code-line", Math.ceil(fontSize * 1.6) + "px"); }
  setFont();
  const popup = node("div", "zsp-code-completions", "", pane); popup.hidden = true; popup.setAttribute("role", "listbox"); popup.setAttribute("aria-label", "Completions");
  const help = node("div", "zsp-code-help"); help.hidden = true; help.setAttribute("role", "status");
  const find = node("div", "zsp-code-find"); find.hidden = true; body.insertBefore(find, toolbar.nextSibling);
  const search = node("input", "pz-inputbox", "", find); search.type = "text"; search.setAttribute("aria-label", "Find text"); search.placeholder = "Find";
  const replacement = node("input", "pz-inputbox", "", find); replacement.type = "text"; replacement.setAttribute("aria-label", "Replace text"); replacement.placeholder = "Replace";
  const count = node("span", "zsp-code-find-count", "", find);
  function button(label, action) { const b = node("button", "proprow propbutton", label, find); b.type = "button"; b.onclick = action; return b; }
  function closeCompletion() { popup.hidden = true; completing = []; input.removeAttribute("aria-activedescendant"); input.setAttribute("aria-expanded", "false"); }
  function showHelp(name, detail = false) {
    const matches = entries().filter(e => e.name === name), unique = [...new Set(matches.map(e => e.signature).filter(Boolean))];
    help.replaceChildren(); help.hidden = !matches.length;
    if (!matches.length) return;
    node("code", "", unique.join("\n") || name, help);
    node("span", "", matches[0].description || matches[0].hint, help);
    if (detail && matches[0].example) node("code", "", "Example: " + matches[0].example, help);
    if (detail) {
      const url = require("./reference.js").docsUrl;
      if (url) { const link = node("a", "", "Documentation", help); link.href = url + "#" + matches[0].id; link.target = "_blank"; link.rel = "noopener"; }
    }
    if (matches[0].include) node("small", "", "// #include <" + matches[0].include + ">", help);
  }
  function caretHelp() {
    const at = input.selectionStart, current = wordAt(input.value, at).word;
    if (entries().some(e => e.name === current)) showHelp(current);
    else { const match = /([A-Za-z_]\w*)\s*\([^()]*$/.exec(input.value.slice(0, at)); showHelp(match?.[1]); }
  }
  function update() { changed(); caretHelp(); }
  function write(edit, record = true) {
    if (!edit) return;
    if (record) history.before(selection());
    input.value = edit.text; input.setSelectionRange(edit.start, edit.end);
    if (record) history.record(selection());
    closeCompletion(); update();
  }
  function accept() {
    const candidate = completing[selected]; if (!candidate) return;
    const range = wordAt(input.value, input.selectionStart);
    write({ text: input.value.slice(0, range.start) + candidate.name + input.value.slice(range.end), start: range.start + candidate.name.length, end: range.start + candidate.name.length });
    input.focus(); showHelp(candidate.name);
  }
  function paintCompletion() {
    popup.replaceChildren(); popup.hidden = !completing.length;
    input.setAttribute("aria-expanded", String(!popup.hidden));
    const line = Math.ceil(fontSize * 1.6), before = input.value.slice(0, input.selectionStart), lines = before.split("\n");
    const left = 56 + lines.at(-1).length * fontSize * .602 - input.scrollLeft;
    const top = 10 + lines.length * line - input.scrollTop;
    popup.style.left = Math.max(48, Math.min(pane.clientWidth - 280, left)) + "px";
    popup.style.top = Math.max(0, Math.min(pane.clientHeight - 190, top)) + "px";
    for (const [i, candidate] of completing.entries()) {
      const b = node("button", i === selected ? "is-selected" : "", "", popup); b.type = "button"; b.id = "zsp-option-" + i;
      b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(i === selected));
      node("code", "", candidate.name, b); node("small", "", candidate.type || candidate.description, b);
      b.onmousedown = e => { e.preventDefault(); selected = i; accept(); };
    }
    const active = popup.children[selected]; if (active) { input.setAttribute("aria-activedescendant", active.id); active.scrollIntoView({ block: "nearest" }); }
  }
  function complete() {
    if (expression || composing || input.selectionStart !== input.selectionEnd) { closeCompletion(); return; }
    completing = completions(input.value, input.selectionStart, entries()); selected = 0; paintCompletion();
  }
  function findNext(backwards = false) {
    if (!search.value) { count.textContent = ""; return; }
    const value = input.value, term = search.value;
    let at = backwards ? value.lastIndexOf(term, input.selectionStart - 1) : value.indexOf(term, input.selectionEnd);
    if (at < 0) at = backwards ? value.lastIndexOf(term) : value.indexOf(term);
    const total = value.split(term).length - 1;
    count.textContent = total ? total + (total === 1 ? " match" : " matches") : "No matches";
    if (at < 0) return;
    input.setSelectionRange(at, at + term.length);
    input.scrollTop = Math.max(0, (value.slice(0, at).split("\n").length - 3) * Math.ceil(fontSize * 1.6));
    input.dispatchEvent(new global.Event("scroll"));
  }
  button("Previous", () => findNext(true)); button("Next", () => findNext());
  button("Replace", () => {
    if (!search.value) return;
    if (input.value.slice(input.selectionStart, input.selectionEnd) !== search.value) { findNext(); return; }
    insert(replacement.value); findNext();
  });
  button("Close find", () => { find.hidden = true; input.focus(); });
  search.oninput = () => { input.setSelectionRange(0, 0); findNext(); };
  find.onkeydown = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); find.hidden = true; input.focus(); } if (e.key === "Enter") { e.preventDefault(); findNext(e.shiftKey); } };
  function insert(text) { const s = input.selectionStart; write({ text: input.value.slice(0, s) + text + input.value.slice(input.selectionEnd), start: s + text.length, end: s + text.length }); input.focus(); }
  input.onbeforeinput = e => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); write(e.inputType === "historyUndo" ? history.undo() : history.redo(), false); }
    else history.before(selection());
  };
  input.oninput = () => { history.record(selection()); update(); complete(); };
  input.oncompositionstart = () => { composing = true; closeCompletion(); };
  input.oncompositionend = () => { composing = false; complete(); };
  input.onclick = () => { closeCompletion(); caretHelp(); };
  input.onkeyup = e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { closeCompletion(); caretHelp(); } };
  input.onmousemove = e => {
    const r = input.getBoundingClientRect(), line = Math.floor((e.clientY - r.top - 10 + input.scrollTop) / Math.ceil(fontSize * 1.6));
    const col = Math.round((e.clientX - r.left - 8 + input.scrollLeft) / (fontSize * .602)), lines = input.value.split("\n");
    if (line >= 0 && line < lines.length) showHelp(wordAt(input.value, lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, Math.min(lines[line].length, col))).word);
  };
  input.addEventListener("blur", closeCompletion);
  return {
    insert, write, showHelp, refresh: update,
    reset() { history.reset(selection()); closeCompletion(); update(); },
    key(event) {
      if (event.isComposing) return false;
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (mod && ["z", "y"].includes(key)) { write(key === "y" || event.shiftKey ? history.redo() : history.undo(), false); return true; }
      if (mod && key === "f") { closeCompletion(); find.hidden = false; search.focus(); search.select(); return true; }
      if (mod && ["+", "=", "-"].includes(key)) {
        fontSize = Math.min(24, Math.max(10, fontSize + (key === "-" ? -1 : 1))); setFont();
        try { global.localStorage.setItem("zoidium.shader-editor.fontSize", String(fontSize)); } catch { /* Storage is optional. */ }
        return true;
      }
      if (!popup.hidden) {
        if (event.key === "Escape") { closeCompletion(); return true; }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { selected = (selected + (event.key === "ArrowDown" ? 1 : completing.length - 1)) % completing.length; paintCompletion(); return true; }
        if (["Tab", "Enter"].includes(event.key) && !mod && !event.shiftKey) { accept(); return true; }
        if (mod) closeCompletion();
      }
      if (mod && event.key === "/") { write(toggleComments(input.value, input.selectionStart, input.selectionEnd)); return true; }
      if (event.key === "Tab") { write(indentCode(input.value, input.selectionStart, input.selectionEnd, event.shiftKey)); return true; }
      if (event.key === "Enter" && !mod) { write(enterEdit(input.value, input.selectionStart, input.selectionEnd)); return true; }
      if (!mod && !event.altKey) { const edit = bracketEdit(input.value, input.selectionStart, input.selectionEnd, event.key); if (edit) { write(edit); return true; } }
      return false;
    },
    dispose() { input.removeEventListener("blur", closeCompletion); },
  };
}
module.exports = { installAids };
