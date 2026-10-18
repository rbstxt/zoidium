"use strict";
// One synchronous compile shares a work budget across paints and modifiers.
// Budgets count work units (one per check() call at the algorithms' loop
// checkpoints, or an estimated amount for a call whose cost is known up
// front), never wall-clock time: the same contents always take the same
// path, so a slow or busy machine renders and exports exactly what a fast one
// does. Limits are written in milliseconds of typical work and converted at
// UNITS_PER_MS, measured on the reference build machine.
const UNITS_PER_MS = 1000;
let spent = 0, limit = Infinity;
function check(units = 1) {
  spent += units;
  if (spent > limit) throw Error("Shape+ geometry work budget exceeded");
}
function bounded(work, milliseconds = 200) {
  const previous = limit;
  limit = Math.min(previous, spent + milliseconds * UNITS_PER_MS);
  try { return work(); } finally { limit = previous; }
}
module.exports = { check, bounded, UNITS_PER_MS, used: () => spent };
