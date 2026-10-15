(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts = global.ZoidiumAssetRegistryParts || {};
  function panelsOf(editor) {
    const queue = Array.from(editor.windows || [], window => window.panel), seen = new Set(), edits = [];
    let tracks = null;
    const skip = new Set(["project", "sequence", "history", "recovery", "playback", "defaultProject", "parent", "parentObject", "editor", "window", "document"]);
    for (let index = 0; index < queue.length && index < 5000; index++) {
      const node = queue[index];
      if (!node || typeof node !== "object" || node.nodeType || seen.has(node) || node === global) continue;
      seen.add(node);
      if (global.PZ.ui?.timeline?.tracks && node instanceof global.PZ.ui.timeline.tracks) tracks = node;
      if (global.PZ.ui?.edit && node instanceof global.PZ.ui.edit) edits.push(node);
      for (const key of Object.keys(node)) if (!skip.has(key)) {
        const value = node[key];
        if (value && typeof value === "object") queue.push(value);
      }
    }
    return { tracks, edits };
  }
  function ancestors(node) {
    const result = [], seen = new Set();
    for (; node && !seen.has(node); node = node.parent) { result.push(node); seen.add(node); }
    return result;
  }
  function reveal(record, editor) {
    if (!record || record.composition || !record.revealable || !editor?.project) return false;
    const doc = global.document;
    if (!doc) return false;
    let property;
    try { property = record.address && editor.project.addressLookup(record.address); } catch (_error) { return false; }
    // A stale snapshot must never reveal an unrelated object now at the address.
    if (record.property && property !== record.property) return false;
    const chain = ancestors(property || record.owner);
    if (!chain.includes(editor.project) && !chain.includes(editor.project.sequence)) return false;
    const clip = record.clip || chain.find(node => global.PZ.clip && node instanceof global.PZ.clip);
    const clipEl = Array.from(doc.querySelectorAll(".clip")).find(el => el.pz_object === clip);
    if (clip && !clipEl) return false;
    const panels = panelsOf(editor);
    if (clipEl) {
      if (!panels.tracks) return false;
      panels.tracks.deselectClips();
      clipEl.classList.add("selected");
      // Native selection observables update both panels. Entering the drag
      // handler would also move a clip, so reveal only runs selection methods.
      panels.tracks.selectClips();
    }
    const effect = chain.some(node => global.PZ.effect && node instanceof global.PZ.effect);
    const tab = Array.from(doc.querySelectorAll(".elevatortabs a")).find(el => el.title === (effect ? "Effects" : "Objects"));
    tab?.click();
    function rows() { return Array.from(doc.querySelectorAll(".elevatorcontrols li")); }
    function select(row) {
      const panel = panels.edits.find(panel => panel.list?.contains(row));
      if (!panel || !panel.options.selectionFilter(row.pz_object)) return false;
      panel.deselectItems(); row.classList.add("selected"); panel.selectItems();
      return true;
    }
    function expand(row) {
      let parent = row?.parentElement;
      while (parent) {
        if (parent.tagName === "UL" && parent.style.display === "none") {
          const toggle = parent.previousElementSibling?.querySelector("button.collapse.collapsed");
          toggle?.click();
        }
        parent = parent.parentElement;
      }
    }
    // Select the deepest live owner in the upper list. That native click builds
    // its property panel, including material/effect and plugin child categories.
    let selected = false;
    for (const owner of chain) {
      if (owner === property) continue;
      if (Array.isArray(owner) || (global.PZ.propertyList && owner instanceof global.PZ.propertyList)) continue;
      const row = rows().find(el => el.pz_object === owner && !el.classList.contains("toplevel"));
      if (row) { expand(row); selected = select(row); if (selected) break; }
    }
    if (!selected && record.owner) {
      const row = rows().find(el => el.pz_object === record.owner);
      if (row) { expand(row); selected = select(row); }
    }
    const row = rows().find(el => el.pz_object === property);
    if (row) { expand(row); row.scrollIntoView?.({ block: "nearest" }); return true; }
    return selected || !!clipEl;
  }
  parts.panelsOf = panelsOf;
  parts.reveal = reveal;
})(globalThis);
