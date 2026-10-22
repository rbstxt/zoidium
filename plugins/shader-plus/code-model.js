"use strict";

// Return a text edit rather than touching the DOM, so selection and indentation
// rules are the same for Shader and Expression editors.
function indentCode(text, start, end, unindent = false) {
  if (start === end && !unindent) return { text: text.slice(0, start) + "  " + text.slice(end), start: start + 2, end: start + 2 };
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const to = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const lines = text.slice(from, to).split("\n");
  let delta = 0, first = 0;
  const replacement = lines.map((line, i) => {
    const removed = unindent ? (/^(?:  |\t| )/.exec(line)?.[0].length || 0) : 0;
    const change = unindent ? -removed : 2;
    if (!i) first = change;
    delta += change;
    return unindent ? line.slice(removed) : "  " + line;
  }).join("\n");
  return { text: text.slice(0, from) + replacement + text.slice(to), start: Math.max(from, start + first), end: Math.max(from, end + delta) };
}

const { symbols: shaderSymbols } = require("./code-assist.js");
module.exports = { indentCode, shaderSymbols };
