"use strict";
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
function clusters(text) { return Array.from(segmenter.segment(text), part => ({ text: part.segment, index: part.index })); }
function script(text) {
  for (const [name, pattern] of [["Latn", /\p{Script=Latin}/u], ["Hani", /\p{Script=Han}/u], ["Hira", /\p{Script=Hiragana}/u],
    ["Kana", /\p{Script=Katakana}/u], ["Arab", /\p{Script=Arabic}/u], ["Hebr", /\p{Script=Hebrew}/u], ["Deva", /\p{Script=Devanagari}/u]])
    if (pattern.test(text)) return name;
  return null;
}
function shapeRuns(primary, fallback, text, coordinates = {}) {
  const runs = [], coverage = new Map();
  for (const cluster of clusters(text)) {
    let font = primary;
    if (fallback) {
      if (!coverage.has(cluster.text)) coverage.set(cluster.text, primary.shape(cluster.text, coordinates).every(g => g.g !== 0));
      if (!coverage.get(cluster.text)) font = fallback;
    }
    const previous = runs.at(-1), kind = script(cluster.text) || previous?.script || "Latn";
    if (previous?.font === font && previous.script === kind) previous.text += cluster.text;
    else runs.push({ font, text: cluster.text, index: cluster.index, script: kind });
  }
  return runs.flatMap(run => run.font.shape(run.text, coordinates, { script: run.script }).map(g => ({
    ...g, cl: run.index + g.cl, font: run.font, character: String.fromCodePoint(text.codePointAt(run.index + g.cl)),
  })));
}
module.exports = { clusters, shapeRuns };
