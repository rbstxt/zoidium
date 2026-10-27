"use strict";

// ExpressText+ Per-letter evaluation helpers: property readers and contexts.

const { fieldWeight, numberValue, resolveSelection, strengthWeight, vector3 } = require("./expresstext-select.js");
const { staticReaders } = require("./expresstext-delay-cache.js");
const { delayRank } = require("./expresstext-random.js");

/* ------------------------------------------------------- per-letter evaluation */

function readProp(props, key, frame, fallback) {
  if (!props) return fallback;
  const property = typeof props.get === "function" ? props.get(key) : props[key];
  if (property && typeof property.get === "function") {
    // Fresh rows can carry empty keyframe tracks until the host edit flow
    // initializes them; fall back to the definition value, then the
    // default. Live rows report value: null while unseeded, which must
    // fall through too — returning null would zero every default.
    try {
      const value = property.get(frame);
      if (value !== undefined && value !== null) return value;
    } catch (_get) {}
    try {
      if (property.value !== undefined && property.value !== null) {
        return property.value;
      }
    } catch (_value) {}
    try {
      if (property.definition && property.definition.value !== undefined) {
        return property.definition.value;
      }
    } catch (_def) {}
    return fallback;
  }
  const value = property;
  return value === undefined || value === null ? fallback : value;
}

function readVector(props, key, frame, fallback) {
  return vector3(readProp(props, key, frame, fallback), fallback);
}

function staticProps(values) {
  const store = {};
  for (const key of Object.keys(values || {})) {
    store[key] = { get: () => values[key] };
  }
  const reader = {
    get(key) {
      return store[key];
    },
  };
  staticReaders.set(reader, { readerGet: reader.get, values, store,
    getters: Object.fromEntries(Object.entries(store).map(([key, row]) => [key, row.get])) });
  return reader;
}

// Effector envelope shared inputs for one letter. plainLists carries the
// literal Letters strings of the stack's Plain layers (in order) so
// "plain-N" tokens resolve; slots counts the selected letters for
// normalized (0..1) stagger shapes.
function letterContext(props, prefix, frame, index, list, plainLists) {
  const selected = resolveSelection(
    readProp(props, `${prefix}Letters`, frame, ""),
    list.total,
    plainLists || []
  );
  const order = selected === null ? list.order : selectedListOrder(selected, list);
  const slots = Math.max(1, order.length);
  const rank = delayRank(
    readProp(props, `${prefix}DelayOrder`, frame, 0),
    order.indexOf(index),
    slots,
    readProp(props, `${prefix}Seed`, frame, 1)
  );
  const delay = rank * numberValue(readProp(props, `${prefix}Delay`, frame, 0), 0);
  const strength = strengthWeight(readProp(props, `${prefix}Strength`, frame, 100));
  return { selected, rank, slots, delay, strength };
}

function selectedListOrder(selected, list) {
  if (selected === null) return list.order;
  return list.order.filter((index) => selected.has(index));
}

function applyFieldWeight(weight, props, prefix, frame, base) {
  if (weight <= 0) return 0;
  const kind = Math.round(numberValue(readProp(props, `${prefix}Field`, frame, 0), 0));
  if (kind === 0) return weight;
  return (
    weight *
    fieldWeight(
      kind,
      base,
      readVector(props, `${prefix}FieldPosition`, frame, [0, 0, 0]),
      readVector(props, `${prefix}FieldScale`, frame, [100, 100, 100])
    )
  );
}

function blankControls() {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

function addScaled(target, vector, amount) {
  target[0] += vector[0] * amount;
  target[1] += vector[1] * amount;
  target[2] += vector[2] * amount;
}

function mulScale(target, vector, amount) {
  target[0] *= 1 + (vector[0] - 1) * amount;
  target[1] *= 1 + (vector[1] - 1) * amount;
  target[2] *= 1 + (vector[2] - 1) * amount;
}


module.exports = { addScaled, applyFieldWeight, blankControls, letterContext, mulScale, readProp, readVector, selectedListOrder, staticProps };
