"use strict";
const { lint, declareUniform, checkShader } = require("./code-check.js");
function installDiagnostics({ input, pane, body, node, global, context, effect, entries, aids, redraw, valid, status }) {
  let timer, issues = [], hints = [], disposed = false;
  const panel = node("div", "zsp-code-diagnostics"); panel.hidden = true; panel.setAttribute("aria-label", "Shader checks");
  const overlay = node("pre", "zsp-code-errors", "", pane); overlay.setAttribute("aria-hidden", "true");
  function jump(line) {
    const before = input.value.split("\n").slice(0, line - 1).join("\n"), start = line === 1 ? 0 : before.length + 1;
    input.focus(); input.setSelectionRange(start, input.value.indexOf("\n", start) < 0 ? input.value.length : input.value.indexOf("\n", start));
    input.scrollTop = Math.max(0, (line - 3) * parseFloat(global.getComputedStyle(input).lineHeight)); sync();
  }
  function sync() { overlay.scrollTop = input.scrollTop; overlay.scrollLeft = input.scrollLeft; }
  function paint() {
    overlay.replaceChildren();
    const bad = new Set(issues.filter(i => i.severity !== "warning").map(i => i.line));
    input.value.split("\n").forEach((text, index) => {
      const row = node("span", bad.has(index + 1) ? "is-error" : "", text || " ", overlay); row.dataset.line = index + 1;
    }); sync();
    panel.replaceChildren(); panel.hidden = !issues.length && !hints.length;
    if (issues.length) node("div", "zsp-check-title", "Shader check", panel);
    for (const issue of issues) {
      const b = node("button", "zsp-code-issue" + (issue.severity === "warning" ? " is-hint" : ""), "Line " + issue.line + ": " + issue.message, panel); b.type = "button"; b.onclick = () => jump(issue.line);
    }
    if (hints.length) node("div", "zsp-check-title", "Hints", panel);
    for (const hint of hints) {
      const row = node("div", "zsp-code-hint", "", panel);
      const b = node("button", "zsp-code-issue is-hint", "Line " + hint.line + ": " + hint.message, row); b.type = "button"; b.onclick = () => jump(hint.line);
      if (hint.declare) {
        const declare = node("button", "proprow propbutton", "Declare", row); declare.type = "button"; declare.title = hint.declare;
        declare.onclick = () => { const text = declareUniform(input.value, hint.declare); aids.write({ text, start: 0, end: 0 }); };
      }
    }
    input.setAttribute("aria-invalid", String(bad.size > 0)); redraw(bad);
  }
  function check() {
    if (disposed || !valid()) return;
    timer = null;
    hints = lint(input.value, effect, entries());
    try {
      const prepared = context.apis.shaderPipeline.preview(effect, input.value);
      issues = checkShader(context.editor.mainViewport.renderer.getContext(), prepared);
      if (!issues.length) {
        status.textContent = "Check passed" + (input.value === effect.properties.fragShader.get() ? "" : " · Unapplied changes");
        status.classList.remove("is-error"); status.title = "";
      }
    } catch (e) { issues = [{ line: 1, message: e.message, severity: "error" }]; }
    paint();
  }
  input.addEventListener("scroll", sync);
  return {
    schedule() {
      global.clearTimeout(timer); issues = []; hints = []; paint(); timer = global.setTimeout(check, 400);
    },
    check,
    lines: () => new Set(issues.filter(i => i.severity !== "warning").map(i => i.line)),
    dispose() { disposed = true; global.clearTimeout(timer); input.removeEventListener("scroll", sync); panel.remove(); overlay.remove(); },
  };
}
module.exports = { installDiagnostics };
