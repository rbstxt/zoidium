"use strict";
function replace(text, start, end, value, caret = start + value.length) { return { text: text.slice(0, start) + value + text.slice(end), start: caret, end: caret }; }
function toggleComments(text, start, end) {
  const from = start ? text.lastIndexOf("\n", start - 1) + 1 : 0;
  const to = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const finish = text.indexOf("\n", to), until = finish < 0 ? text.length : finish;
  const lines = text.slice(from, until).split("\n"), uncomment = lines.filter(l => l.trim()).every(l => /^\s*\/\//.test(l));
  let first = 0, delta = 0;
  const value = lines.map((line, i) => {
    if (!line.trim()) return line;
    const indent = /^\s*/.exec(line)[0].length, remove = uncomment ? /^\/\/ ?/.exec(line.slice(indent))?.[0].length || 0 : 0;
    const change = uncomment ? -remove : 3; delta += change; if (!i) first = change;
    return line.slice(0, indent) + (uncomment ? line.slice(indent + remove) : "// " + line.slice(indent));
  }).join("\n");
  return { text: text.slice(0, from) + value + text.slice(until), start: Math.max(from, start + first), end: Math.max(from, end + delta) };
}
function bracketEdit(text, start, end, key) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  // Avoid pairing in comments and quoted expression strings.
  const before = text.slice(0, start), line = before.slice(before.lastIndexOf("\n") + 1);
  if (/\/\//.test(line) || (before.match(/\/\*/g)?.length || 0) > (before.match(/\*\//g)?.length || 0)) return null;
  if (pairs[key]) {
    if (start === end && /[\w]/.test(text[end] || "")) return null;
    const edit = replace(text, start, end, key + text.slice(start, end) + pairs[key], start + 1);
    edit.end = end + 1; return edit;
  }
  if (")]}".includes(key) && text[start] === key && start === end) return { text, start: start + 1, end: start + 1 };
  if (key === "Backspace" && start === end && pairs[text[start - 1]] === text[start] && start > 0) return replace(text, start - 1, start + 1, "");
  return null;
}
function enterEdit(text, start, end) {
  const before = text.slice(0, start), indent = /^\s*/.exec(before.slice(before.lastIndexOf("\n") + 1))[0];
  const extra = /[({[]\s*$/.test(before) ? "  " : "";
  const close = extra && /^\s*[)}\]]/.test(text.slice(end));
  return replace(text, start, end, "\n" + indent + extra + (close ? "\n" + indent : ""), start + 1 + indent.length + extra.length);
}
function createUndo(initial) {
  const past = [], future = []; let current = initial;
  return {
    before(selection) { current = { ...current, ...selection }; },
    record(next) { if (next.text === current.text) { current = next; return; } past.push(current); if (past.length > 500) past.shift(); current = next; future.length = 0; },
    undo() { if (!past.length) return null; future.push(current); return current = past.pop(); },
    redo() { if (!future.length) return null; past.push(current); return current = future.pop(); },
    reset(next) { current = next; past.length = 0; future.length = 0; },
  };
}
module.exports = { replace, toggleComments, bracketEdit, enterEdit, createUndo };
