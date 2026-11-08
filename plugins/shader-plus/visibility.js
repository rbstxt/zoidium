"use strict";
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const comparison = new RegExp("^(>=|<=|!=|>|<|=)\\s*(" + NUMBER + ")$");
const range = new RegExp("^(" + NUMBER + ")\\s*\\.\\.\\s*(" + NUMBER + ")$");
function parseConditions(text) {
  const values = [], conditions = [];
  for (const token of String(text).split(/[;\n]/).map(s => s.trim()).filter(Boolean)) {
    const match = comparison.exec(token), bounds = range.exec(token);
    if (match && Number.isFinite(Number(match[2]))) conditions.push({ op: match[1], value: Number(match[2]) });
    else if (bounds && Number.isFinite(Number(bounds[1])) && Number.isFinite(Number(bounds[2])) && Number(bounds[1]) <= Number(bounds[2])) {
      conditions.push({ op: "range", min: Number(bounds[1]), max: Number(bounds[2]) });
    } else if (/^[<>=!]|\.\./.test(token)) throw new Error("Use a number after >, >=, <, <=, !=, or =, or an ordered range such as 1..5");
    else values.push(Number.isFinite(Number(token)) ? Number(token) : token);
  }
  if (!values.length && !conditions.length) throw new Error("Enter the values that show this property");
  return { values, ...(conditions.length ? { conditions } : {}) };
}
function formatConditions(when) {
  return [...(when?.values || []), ...(when?.conditions || []).map(c => c.op === "range" ? c.min + ".." + c.max : c.op + " " + c.value)].join("; ");
}
function matches(when, value) {
  if (when.values?.includes(value)) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return (when.conditions || []).some(c => {
    switch (c.op) {
      case ">": return value > c.value;
      case ">=": return value >= c.value;
      case "<": return value < c.value;
      case "<=": return value <= c.value;
      case "!=": return value !== c.value;
      case "=": return value === c.value;
      case "range": return value >= c.min && value <= c.max;
      default: return false;
    }
  });
}
module.exports = { parseConditions, formatConditions, matches };
