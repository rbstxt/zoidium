"use strict";
// Observe structural lists, not animated property values. Re-scan only after
// a contents mutation, including additions/removals inside nested groups.
function trackContents(root) {
  const watched = new Map();
  let dirty = true, text = false, scans = 0;
  const invalidate = () => { dirty = true; };
  function read() {
    if (!dirty) return text;
    for (const [list, listener] of watched) list.onListChanged?.unwatch(listener);
    watched.clear(); text = false; scans++;
    function visit(list) {
      if (list.onListChanged) { list.onListChanged.watch(invalidate); watched.set(list, invalidate); }
      for (const item of list) {
        if (item.kind === "text") text = true;
        if (item.contents) visit(item.contents);
      }
    }
    visit(root); dirty = false;
    return text;
  }
  return { read, invalidate, get scans() { return scans; }, dispose() {
    for (const [list, listener] of watched) list.onListChanged?.unwatch(listener);
    watched.clear(); dirty = true;
  } };
}
module.exports = { trackContents };
