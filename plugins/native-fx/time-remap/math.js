"use strict";

// Time Remap math. Pure functions, shared by the browser bundle and the Node
// tests. Nothing here reads PZ state: a property is any object with get(frame)
// and optional keyframes/expression fields.

const IDENTITY_SPEED = 100;
const SUBSTEPS = 4;
const EPSILON = 1e-9;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function speedPercent(property, frame) {
  try {
    return finiteNumber(property?.get?.(frame), IDENTITY_SPEED);
  } catch (_error) {
    // An unreadable row keeps the output clock instead of freezing content.
    return IDENTITY_SPEED;
  }
}

function controlPoint(points, index) {
  const point = points?.[index];
  return Array.isArray(point) ? finiteNumber(point[0], 0) + "," + finiteNumber(point[1], 0) : "";
}

// Stable identity of the authored curve. Any keyframe edit, tween change or
// expression edit changes the string, which resets a cached prefix integral.
function propertySignature(property) {
  const expression = typeof property?.expression === "string" ? property.expression : "";
  const keys = Array.isArray(property?.keyframes) ? property.keyframes : null;
  if (!keys) return "value:" + speedPercent(property, 0) + "|" + expression;
  return "keys:" + keys.map(key =>
    finiteNumber(key?.frame, 0) + ":" + String(key?.value) + ":" + finiteNumber(key?.tween, 0) +
    ":" + controlPoint(key?.controlPoints, 0) + ":" + controlPoint(key?.controlPoints, 1)).join("|") +
    "|" + expression;
}

function hasExpression(property) {
  return typeof property?.expression === "string" && property.expression.length > 0;
}

// A keyframed row is constant only when every key holds the same value and
// every Bezier handle keeps its vertical offset at zero. A handle with a
// nonzero offset bows the curve away from its endpoints even when the values
// are equal.
function constantSpeed(property) {
  if (hasExpression(property)) return null;
  const keys = Array.isArray(property?.keyframes) ? property.keyframes : null;
  if (!keys) return speedPercent(property, 0);
  if (keys.length === 0) return IDENTITY_SPEED;
  const value = Number(keys[0]?.value);
  if (!Number.isFinite(value)) return null;
  for (const key of keys) {
    if (Number(key?.value) !== value) return null;
    for (const point of Array.isArray(key?.controlPoints) ? key.controlPoints : []) {
      if (finiteNumber(point?.[1], 0) !== 0) return null;
    }
  }
  return value;
}

// One frame of speed is a percentage; the integral is in local frames. The
// trapezoid steps match between prefix frames and a fractional tail, so the
// value is continuous at integer frames.
function segment(speedAt, from, to, steps) {
  const total = Math.max(1, Math.round(steps));
  const step = (to - from) / total;
  let area = 0;
  let previous = speedAt(from) / 100;
  for (let index = 1; index <= total; index += 1) {
    const next = speedAt(from + step * index) / 100;
    area += (previous + next) * 0.5 * step;
    previous = next;
  }
  return area;
}

function ensurePrefix(speedAt, whole, cache, signature) {
  if (!cache) {
    const prefix = [0];
    for (let frame = 0; frame < whole; frame += 1) {
      prefix.push(prefix[frame] + segment(speedAt, frame, frame + 1, SUBSTEPS));
    }
    return prefix;
  }
  if (cache.signature !== signature) {
    cache.signature = signature;
    cache.prefix = [0];
  }
  const prefix = cache.prefix;
  while (prefix.length <= whole) {
    const start = prefix.length - 1;
    prefix.push(prefix[start] + segment(speedAt, start, start + 1, SUBSTEPS));
  }
  return prefix;
}

// Integral of speed from the clip-local start (0) to `frame`.
function integrateSpeed(speedAt, frame, cache, signature) {
  const value = Math.max(0, finiteNumber(frame, 0));
  if (!(value > 0)) return 0;
  const whole = Math.floor(value);
  const fraction = value - whole;
  const prefix = ensurePrefix(speedAt, whole, cache, signature);
  let area = prefix[whole];
  if (fraction > EPSILON) {
    area += segment(speedAt, whole, value, Math.max(1, Math.ceil(SUBSTEPS * fraction)));
  }
  return area;
}

// Expressions can read live project values, so a prefix table from an earlier
// evaluation is not reusable. Such a curve shares a table only inside the
// caller's current evaluation token (one host evaluation range), which resets
// when the token changes.
function tokenCache(memo, token) {
  if (!memo || token === undefined || token === null) return null;
  if (memo.token !== token) {
    memo.token = token;
    memo.signature = null;
    memo.prefix = [0];
  }
  return memo;
}

// map(frame, anchor) returns the source frame for an input frame. `anchor` is
// the frame offset of the clock being mapped: 0 for clip-local frames and the
// clip start when an adjustment layer's operator is applied to project time.
// The host clamps the result to the clip range like every other operator.
function speedMap(property, options) {
  const signature = propertySignature(property);
  const constant = constantSpeed(property);
  if (constant !== null) {
    return {
      signature,
      constant,
      map(frame, anchor) {
        const base = finiteNumber(anchor, 0);
        return base + (constant * finiteNumber(finiteNumber(frame, 0) - base, 0)) / 100;
      },
    };
  }
  const cache = hasExpression(property)
    ? tokenCache(options?.memo, options?.token)
    : options?.cache || null;
  const speedAt = frame => speedPercent(property, frame);
  return {
    signature,
    constant: null,
    map(frame, anchor) {
      const base = finiteNumber(anchor, 0);
      return base + integrateSpeed(speedAt, finiteNumber(frame, 0) - base, cache, signature);
    },
  };
}

// Seconds read at the output frame; null when the row is unreadable.
function remapSeconds(property, frame) {
  try {
    const value = Number(property?.get?.(frame));
    return Number.isFinite(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

// The two source frames around a fractional source clock.
function blendTaps(frame) {
  const value = finiteNumber(frame, 0);
  const lower = Math.floor(value + 1e-7);
  const fraction = Math.min(1, Math.max(0, value - lower));
  return { lower, upper: lower + 1, fraction };
}

module.exports = {
  EPSILON,
  IDENTITY_SPEED,
  SUBSTEPS,
  blendTaps,
  constantSpeed,
  finiteNumber,
  hasExpression,
  integrateSpeed,
  propertySignature,
  remapSeconds,
  speedMap,
  speedPercent,
};
