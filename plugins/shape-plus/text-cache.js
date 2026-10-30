"use strict";
// These caches own only derived data. Keys include font object identity so a
// replaced asset never reuses the old font's outlines or layout.
const identities = new WeakMap(); let nextIdentity = 0;
function fontId(font) { if (!font) return 0; if (!identities.has(font)) identities.set(font, ++nextIdentity); return identities.get(font); }
function createCache(limit) {
  const entries = new Map(); let bytes = 0, hits = 0, misses = 0;
  return {
    get(key) { const entry=entries.get(key); if (!entry) { misses++; return; } hits++; entries.delete(key);entries.set(key,entry);return entry.value; },
    set(key,value,size) {
      if(entries.has(key)){bytes-=entries.get(key).size;entries.delete(key);}
      size += key.length * 2 + 96;
      if(size>limit)return value;
      while(bytes+size>limit){const oldest=entries.keys().next().value;bytes-=entries.get(oldest).size;entries.delete(oldest);}
      entries.set(key,{value,size});bytes+=size;return value;
    },
    clear() { entries.clear(); bytes=0; },
    stats:()=>({entries:entries.size,bytes,limit,hits,misses}),
  };
}
const layoutFields=["sourceText","fontSize","tracking","leading","baselineShift","horizontalScale","verticalScale","caps","position","alignment","textMode","boxSize","firstLineIndent","spaceBefore","spaceAfter"];
function layoutKey(primary,fallback,p) {
  return JSON.stringify([fontId(primary),fontId(fallback),layoutFields.map(key=>p[key]),Object.keys(primary.axes).sort().map(tag=>[tag,p["axis_"+tag]??primary.axes[tag].default])]);
}
module.exports={fontId,createCache,layoutKey};
