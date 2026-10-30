"use strict";
const { createCache, fontId } = require("./text-cache.js");
const coverageCache = createCache(512 * 1024);
const runsCache = createCache(2 * 1024 * 1024);
const scripts = [["Latn", /\p{Script=Latin}/u], ["Hani", /\p{Script=Han}/u], ["Hira", /\p{Script=Hiragana}/u], ["Kana", /\p{Script=Katakana}/u], ["Arab", /\p{Script=Arabic}/u], ["Hebr", /\p{Script=Hebrew}/u], ["Deva", /\p{Script=Devanagari}/u]];
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
function clusters(text) { return Array.from(segmenter.segment(text), part => ({ text: part.segment, index: part.index })); }
function script(text) {
  for (const [name, pattern] of scripts)
    if (pattern.test(text)) return name;
  return null;
}
function shapeRuns(primary, fallback, text, coordinates = {}) {
  const key = JSON.stringify([fontId(primary),fontId(fallback),text,coordinates]);
  const cached = runsCache.get(key);
  if (cached) return cached.map(({fontSlot,...g})=>({...g,font:fontSlot?fallback:primary}));
  const runs = [], coveragePrefix = JSON.stringify([fontId(primary),coordinates]);
  for (const cluster of clusters(text)) {
    let font = primary;
    if (fallback) {
      const key = coveragePrefix + cluster.text;
      let covered = coverageCache.get(key);
      if (covered === undefined) { covered = primary.shape(cluster.text, coordinates).every(g => g.g !== 0); coverageCache.set(key,covered,32); }
      if (!covered) font = fallback;
    }
    const previous = runs.at(-1), kind = script(cluster.text) || previous?.script || "Latn";
    if (previous?.font === font && previous.script === kind) previous.text += cluster.text;
    else runs.push({ font, text: cluster.text, index: cluster.index, script: kind });
  }
  const result = runs.flatMap(run => run.font.shape(run.text, coordinates, { script: run.script }).map(g => ({
    ...g, cl: run.index + g.cl, font: run.font, character: String.fromCodePoint(text.codePointAt(run.index + g.cl)),
  })));
  runsCache.set(key,result.map(({font,...g})=>({...g,fontSlot:font===primary?0:1})),128+text.length*2+result.length*192);
  return result;
}
module.exports = { clusters, shapeRuns, coverageStats: () => ({coverage:coverageCache.stats(),runs:runsCache.stats()}) };
