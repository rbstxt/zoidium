"use strict";

// Pure helpers for the Assets window: labels, filtering, sorting and the
// summary line. They read registry snapshots (ZoidiumAssets.snapshot()) and
// never touch the project, so they are shared by the window, the sidebar
// panel and the tests.

const KINDS = {
  composition: { label: "Composition", icon: "layers" },
  video: { label: "Video", icon: "sequence" },
  audio: { label: "Audio", icon: "music" },
  image: { label: "Image", icon: "image" },
  font: { label: "Font", icon: "text" },
  geometry: { label: "3D Model", icon: "shape" },
  lut: { label: "LUT", icon: "filter" },
  shader: { label: "Shader", icon: "code" },
  ies: { label: "IES Profile", icon: "fragment" },
  file: { label: "File", icon: "unknown" },
};

const STATUSES = {
  ready: { label: "Ready", rank: 3 },
  unknown: { label: "Ready", rank: 3 },
  loading: { label: "Loading", rank: 2 },
  failed: { label: "Failed", rank: 0 },
  missing: { label: "Missing", rank: 1 },
};

const SOURCES = {
  file: "Project file",
  preset: "Built-in",
  plugin: "Plugin",
  composition: "Composition",
  embedded: "Embedded",
};

// The filters of the window's view menu, in display order.
const FILTERS = [
  { id: "all", label: "All" },
  { id: "used", label: "Used" },
  { id: "unused", label: "Unused" },
  { id: "problems", label: "Problems" },
];

// Sortable columns. `value` returns the sort key; ties fall back to name.
const COLUMNS = [
  { id: "name", label: "Name", value: (item) => String(item.name || "").toLowerCase() },
  { id: "kind", label: "Type", value: (item) => kindLabel(item.kind) },
  { id: "status", label: "Status", value: (item) => statusRank(item.status) },
  { id: "uses", label: "Uses", value: (item) => usageCount(item) },
  { id: "size", label: "Size", value: (item) => (Number.isFinite(item.size) ? item.size : -1) },
  { id: "details", label: "Details", value: (item) => detailText(item) },
];

function kindInfo(kind) {
  return KINDS[kind] || KINDS.file;
}

function kindLabel(kind) {
  return kindInfo(kind).label;
}

function statusLabel(status) {
  return (STATUSES[status] || STATUSES.unknown).label;
}

function statusRank(status) {
  return (STATUSES[status] || STATUSES.unknown).rank;
}

function sourceLabel(source) {
  return SOURCES[source] || "Project file";
}

function usageCount(item) {
  return Array.isArray(item && item.usages) ? item.usages.length : 0;
}

function isProblem(item) {
  if (!item) return false;
  // Matches the registry's problem count: a failed item matters while it is
  // used; a missing file is listed even when unused, since saving needs it.
  if (item.status === "failed") return usageCount(item) > 0;
  return item.status === "missing";
}

function plural(count, one, many) {
  return count + " " + (count === 1 ? one : many);
}

// AE shows "Used N times" beside the selected item's name.
function usageText(item) {
  const count = usageCount(item);
  if (!count) return "Unused";
  return count === 1 ? "Used once" : "Used " + count + " times";
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (value >= 100 ? Math.round(value) : value.toFixed(1)) + " " + units[unit];
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.round(seconds * 100) / 100;
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  const secondsText = rest.toFixed(2).padStart(5, "0");
  return minutes + ":" + secondsText;
}

// One short line for the Details column: resolution, length, font family,
// frame count; whatever the registry knew cheaply.
function detailText(item) {
  const info = (item && item.info) || {};
  const parts = [];
  if (info.width > 0 && info.height > 0) parts.push(info.width + " × " + info.height);
  const duration = formatDuration(info.duration);
  if (duration) parts.push(duration);
  if (info.frames > 1) parts.push(plural(info.frames, "frame", "frames"));
  if (info.fontFamily && info.fontFamily !== item.name) parts.push(info.fontFamily);
  return parts.join(" · ");
}

function matchesQuery(item, query) {
  if (!query) return true;
  const haystack = [
    item.name,
    kindLabel(item.kind),
    statusLabel(item.status),
    sourceLabel(item.source),
    detailText(item),
  ].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function filterItems(items, options) {
  const filter = (options && options.filter) || "all";
  const kind = (options && options.kind) || "all";
  const query = String((options && options.query) || "").trim();
  return (items || []).filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (filter === "used" && !usageCount(item)) return false;
    if (filter === "unused" && usageCount(item)) return false;
    if (filter === "problems" && !isProblem(item)) return false;
    return matchesQuery(item, query);
  });
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function sortItems(items, sort) {
  const column = COLUMNS.find((entry) => entry.id === (sort && sort.column)) || COLUMNS[0];
  const direction = sort && sort.direction === "desc" ? -1 : 1;
  const nameOf = COLUMNS[0].value;
  return (items || []).slice().sort((left, right) => {
    const primary = compareValues(column.value(left), column.value(right)) * direction;
    if (primary) return primary;
    const byName = compareValues(nameOf(left), nameOf(right));
    return byName || compareValues(left.id, right.id);
  });
}

// Kinds present in the snapshot, in the order of KINDS, for the type menu.
function presentKinds(items) {
  const present = new Set((items || []).map((item) => item.kind));
  return Object.keys(KINDS).filter((kind) => present.has(kind));
}

function unusedFiles(items) {
  return (items || []).filter((item) => item.source === "file" && !usageCount(item));
}

function totalSize(items) {
  return (items || []).reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0);
}

// The status bar under the list: "14 items · 3 unused (4.2 MB) · 1 problem".
function summaryText(items, shown) {
  const all = items || [];
  const parts = [plural(all.length, "item", "items")];
  if (shown !== undefined && shown !== all.length) parts[0] = shown + " of " + parts[0];
  const unused = unusedFiles(all);
  if (unused.length) {
    const size = formatSize(totalSize(unused));
    parts.push(unused.length + " unused" + (size ? " (" + size + ")" : ""));
  }
  const problems = all.filter(isProblem).length;
  if (problems) parts.push(plural(problems, "problem", "problems"));
  return parts.join(" · ");
}

function usagePath(usage) {
  const path = Array.isArray(usage && usage.path) ? usage.path.filter(Boolean) : [];
  let text = path.join(" › ");
  if (usage && usage.kind === "keyframe" && Number.isFinite(usage.frame)) {
    text += " (keyframe at frame " + usage.frame + ")";
  }
  return text || "Unnamed use";
}

module.exports = {
  KINDS,
  FILTERS,
  COLUMNS,
  kindInfo,
  kindLabel,
  statusLabel,
  sourceLabel,
  usageCount,
  usageText,
  isProblem,
  plural,
  formatSize,
  formatDuration,
  detailText,
  filterItems,
  sortItems,
  presentKinds,
  unusedFiles,
  totalSize,
  summaryText,
  usagePath,
};
