"use strict";
// Display-only display names driven by another property, stored beside
// visibleWhen as zoidiumShader.renameWhen. Each rule carries the same
// condition shape as Visible when; the first matching rule wins.
const { matchesController } = require("./visibility.js");
function conditionOf(rule) {
  if (!rule || typeof rule !== "object") return null;
  const values = Array.isArray(rule.values) ? rule.values : null;
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : null;
  if (!values?.length && !conditions?.length) return null;
  return { ...(values?.length ? { values } : {}), ...(conditions?.length ? { conditions } : {}) };
}
function rulesOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(rule => rule && typeof rule === "object" && typeof rule.property === "string" &&
    rule.property && typeof rule.name === "string" && rule.name.trim() && conditionOf(rule));
}
// A rule whose controller is missing or deleted cannot match, so the next
// rule still gets a chance. Without a rule the property's own name shows.
function renamed(rules, controllerOf, frame, originalName) {
  for (const rule of rulesOf(rules)) {
    const controller = controllerOf(rule.property);
    if (controller && typeof controller.get === "function" && matchesController(conditionOf(rule), controller, controller.get(frame))) return rule.name;
  }
  return originalName;
}
module.exports = { renamed, rulesOf, conditionOf };
