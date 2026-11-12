"use strict";
// Snap values to a grid, separate from Step. Step stays the drag multiplier;
// Snap rounds committed row edits to multiples of Snap. Blank or 0 is off and
// leaves the definition without a snap field, which keeps current behaviour
// bit-for-bit. Only Slider, Seed, Angle and Time sample rows opt in.
const SNAP_KINDS = ["slider", "seed", "angle", "timeSample"];

function snapKind(definition) {
  const kind = definition?.zoidiumShader?.kind;
  return SNAP_KINDS.includes(kind) ? kind : null;
}

function isSnapActive(definition) {
  return !!snapKind(definition) && Number.isFinite(definition?.snap) && definition.snap > 0;
}

// Value order: clamp to min/max, round to the nearest multiple of snap
// (offset from min when min is set, else from 0; an exact half-way value
// rounds away from zero), then clamp again. Native decimals rounding still
// applies after this, inside PZ.ui.input.set.
function snapValue(value, definition) {
  const snap = definition?.snap;
  if (!snapKind(definition) || !Number.isFinite(snap) || snap <= 0 || !Number.isFinite(value)) return value;
  const max = Number.isFinite(definition.max) ? definition.max : Infinity;
  const min = Number.isFinite(definition.min) ? definition.min : -Infinity;
  let result = Math.min(max, Math.max(min, value));
  if (!Number.isFinite(result)) return result;
  const base = Number.isFinite(definition.min) ? definition.min : 0;
  const quotient = (result - base) / snap, low = Math.floor(quotient), fraction = quotient - low;
  // Exact ties are compared by value distance from zero so -2.5 on a
  // min-offset grid lands on -3, not -2. The epsilon absorbs float noise.
  const EPSILON = 1e-9;
  let steps;
  if (fraction < 0.5 - EPSILON) steps = low;
  else if (fraction > 0.5 + EPSILON) steps = low + 1;
  else steps = Math.abs(base + (low + 1) * snap) > Math.abs(base + low * snap) ? low + 1 : low;
  result = base + steps * snap;
  return Math.min(max, Math.max(min, result));
}

// Own-property override of one native input instance. Drag, arrow keys and
// typed values all flow through set (via setValue), so every new row edit
// lands on the grid. Saved keyframes and loaded values never pass through
// here, so existing data is untouched. Never patches the shared prototype.
function wrapInputInstance(input, definition) {
  if (!input || input.__zoidiumSnapWrapped) return input;
  const original = input.set;
  input.set = function snappedSet(value) {
    return original.call(this, snapValue(value, definition));
  };
  input.__zoidiumSnapWrapped = true;
  return input;
}

// Runs create() with PZ.ui.input temporarily subclassed so every input the
// native row factory constructs during this synchronous call carries the
// snap override on the instance only. The prototype and every other row are
// unaffected, and PZ.ui.input is always restored, including on throw.
function createWithSnap(PZ, property, create) {
  if (!isSnapActive(property?.definition)) return create();
  const Original = PZ.ui.input, definition = property.definition;
  function SnappedInput(options) {
    const instance = new Original(options);
    return wrapInputInstance(instance, definition);
  }
  SnappedInput.prototype = Original.prototype;
  PZ.ui.input = SnappedInput;
  try {
    return create();
  } finally {
    PZ.ui.input = Original;
  }
}

module.exports = { SNAP_KINDS, snapKind, isSnapActive, snapValue, wrapInputInstance, createWithSnap };
