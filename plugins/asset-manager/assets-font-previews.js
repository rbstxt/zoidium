"use strict";

function createFontPreviews(doc, FontFace, changed) {
  const entries = new Map();
  let alive = true, nextFamily = 0;
  function release(id, entry) {
    entries.delete(id);
    if (entry.face) doc.fonts.delete(entry.face);
  }
  return {
    family(item) {
      if (!alive || !item.url || !/\.(ttf|otf|woff2?)$/i.test(item.name || "") || typeof FontFace !== "function") return "";
      let entry = entries.get(item.id);
      if (entry?.url !== item.url && entry) { release(item.id, entry); entry = null; }
      if (entry) return entry.family;
      const family = "zam-preview-" + nextFamily++;
      const face = new FontFace(family, "url(" + JSON.stringify(item.url) + ")");
      entry = { family, face, url: item.url };
      entries.set(item.id, entry);
      face.load().then(() => {
        if (!alive || entries.get(item.id) !== entry) return;
        doc.fonts.add(face);
        changed(item);
      }, () => {
        if (!alive || entries.get(item.id) !== entry) return;
        entry.family = ""; entry.face = null;
      });
      return "";
    },
    prune(items) {
      const urls = new Map(items.map(item => [item.id, item.url]));
      for (const [id, entry] of entries) if (urls.get(id) !== entry.url) release(id, entry);
    },
    dispose() {
      alive = false;
      for (const [id, entry] of entries) release(id, entry);
    },
  };
}
module.exports = { createFontPreviews };
