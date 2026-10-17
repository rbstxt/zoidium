"use strict";
// One synchronous compile shares a deadline across paints and modifiers.
let deadline = Infinity;
function check() {
  if (performance.now() > deadline) throw Error("Shape+ geometry time budget exceeded");
}
function bounded(work, milliseconds = 200) {
  const previous = deadline;
  deadline = Math.min(previous, performance.now() + milliseconds);
  try { return work(); } finally { deadline = previous; }
}
module.exports = { check, bounded };
