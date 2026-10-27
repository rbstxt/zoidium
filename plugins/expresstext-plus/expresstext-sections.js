"use strict";

// ExpressText+ Custom-property section readers and the effector tables.

const { sectionReaders } = require("./expresstext-delay-cache.js");
const { EFFECTOR_ORDER } = require("./expresstext-properties.js");
const { expressStackOf } = require("./expresstext-layout.js");


// Custom-properties readers: sections are stock dynamic groups found by
// display name; rows inside them by stamped effectorKey. Both survive
// creation (verified live) because definitions round-trip through save.
function customsChildren(container) {
  const list = container && container.customProperties;
  const out = [];
  if (!list) return out;
  try {
    const count = list.length || 0;
    for (let i = 0; i < count; i += 1) {
      if (list[i] !== undefined) out.push(list[i]);
    }
  } catch (_error) {}
  return out;
}

function sectionGroupOf(container, displayName) {
  for (const child of customsChildren(container)) {
    try {
      if (child && child.definition && child.definition.name === displayName) {
        return child;
      }
    } catch (_error) {}
  }
  return null;
}

function groupReader(group) {
  const reader = {
    get(key) {
      if (!group) return undefined;
      try {
        const kids = group.objects || [];
        for (let i = 0; i < kids.length; i += 1) {
          const child = kids[i];
          if (child && child.definition && child.definition.effectorKey === key) {
            return child;
          }
        }
      } catch (_error) {}
      return undefined;
    },
  };
  sectionReaders.set(reader, reader.get);
  return reader;
}

// Full stack for one letter: inline customs sections first (fixed panel
// order), then legacy object effectors (container children, then stacked
// ancestors) so older scenes keep rendering while they transition.
// Saved lists serialize as objects with numeric keys ({"0":…, length: N}),
// not arrays: normalize before iterating, or stock revive output is
// silently skipped.
function rawArray(rawList) {
  if (!rawList || typeof rawList !== "object") return [];
  if (Array.isArray(rawList)) return rawList;
  const out = [];
  const count = rawList.length || 0;
  for (let i = 0; i < count; i += 1) out.push(rawList[i]);
  return out;
}

// Stock revive rebuilds customs children without their definitions
// (observed live: definition.name comes back null while the raw saved
// data still carries the full defs). Reattach identity from raw so
// sections and rows stay readable after reload. Never throws.
function reattachCustomDefinitions(liveList, rawList) {
  try {
    const raw = rawArray(rawList);
    const count = (liveList && liveList.length) || 0;
    for (let i = 0; i < count && i < raw.length; i += 1) {
      const liveChild = liveList[i];
      const rawChild = raw[i] || {};
      if (liveChild && (!liveChild.definition || !liveChild.definition.name) && rawChild.type) {
        liveChild.definition = rawChild.type;
      }
      const liveRows = (liveChild && liveChild.objects) || [];
      const defRows = (rawChild.type && rawChild.type.objects) || [];
      for (let j = 0; j < liveRows.length && j < defRows.length; j += 1) {
        if (
          liveRows[j] &&
          (!liveRows[j].definition || !liveRows[j].definition.effectorKey) &&
          defRows[j]
        ) {
          liveRows[j].definition = defRows[j];
        }
      }
    }
  } catch (_error) {}
}

// Kind from a stamped row key ("shakeEnable" -> "shake"). Display names
// change on duplicate ("Shake 2") but stamped keys never do, so copies
// keep working and stack.
function kindOfKey(key) {
  if (typeof key !== "string" || !key) return null;
  for (const kind of EFFECTOR_ORDER) {
    if (key === kind) return kind;
    if (key.indexOf(kind) === 0 && key.length > kind.length) {
      const next = key[kind.length];
      if (next >= "A" && next <= "Z") return kind;
    }
  }
  return null;
}

function kindOfGroup(group) {
  try {
    const kids = (group && group.objects) || [];
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      const kind =
        child && child.definition ? kindOfKey(child.definition.effectorKey) : null;
      if (kind) return kind;
    }
  } catch (_error) {}
  return null;
}

// Every customs section in panel order, duplicates included: each copy
// evaluates with its own values.
function customSections(container) {
  const out = [];
  for (const child of customsChildren(container)) {
    try {
      const kind = kindOfGroup(child);
      if (kind) out.push({ kind, props: groupReader(child), source: child });
    } catch (_error) {}
  }
  return out;
}

function stackLayersFor(container, layers) {
  const out = customSections(container);
  for (const layer of expressStackOf(layers)) out.push(layer);
  return out;
}

const EFFECTOR_PIVOT_KEYS = {
  shake: "shakePivot",
  plain: "plainPivot",
  random: "randomPivot",
};

module.exports = { EFFECTOR_PIVOT_KEYS, customSections, customsChildren, groupReader, kindOfGroup, kindOfKey, rawArray, reattachCustomDefinitions, sectionGroupOf, stackLayersFor };
