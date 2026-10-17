"use strict";
// Which item a click on a drawn shape selects. Like AE's Selection tool, the
// first click picks the outermost group; once inside a group, clicks pick
// siblings at that depth; a selected item that contains the hit keeps it.
const { find } = require("./editor-tree-data.js");
function pickTarget(contents, leafId, selected = new Set()) {
  const entry = find(contents, leafId);
  if (!entry) return null;
  const chain = [...entry.ancestors.map(item => item.id), leafId];
  for (let i = chain.length - 1; i >= 0; i--) if (selected.has(chain[i])) return chain[i];
  let best = null;
  for (const id of selected) {
    const other = find(contents, id);
    const depth = other?.ancestors.length || 0;
    if (!depth || depth >= chain.length || other.ancestors.at(-1).id !== chain[depth - 1]) continue;
    if (best === null || depth > best) best = depth;
  }
  return chain[best ?? 0];
}
// The containing group, for Escape / double-click on empty space.
function parentOf(contents, id) {
  return find(contents, id)?.ancestors.at(-1)?.id || null;
}
module.exports = { pickTarget, parentOf };
