"use strict";
const { WAV, M4A, isAudio } = require("./audio-only.js");

function addAudioOptions(page, select, owner) {
  const options = [[WAV, ".wav (16-bit PCM)"], [M4A, ".m4a (AAC)"]].map(([format, label]) => {
    const option = document.createElement("option");
    option.text = label; option.value = String(select.options.length); select.appendChild(option);
    return { format, option };
  });
  const hidden = new Map();
  function restore() { for (const [row, display] of hidden) row.style.display = display; hidden.clear(); }
  function update() {
    restore();
    if (!isAudio(owner.params)) return;
    for (const row of page.querySelectorAll(".proprow")) {
      const label = (row.querySelector("span")?.textContent || "").trim();
      if (/^(Resolution|Output size \(px\)|Aspect ratio|Aspect ratio mode|Frame rate|Bitrate|Quality|True datamosh)$/i.test(label)) {
        hidden.set(row, row.style.display); row.style.display = "none";
      }
    }
  }
  return {
    select() {
      const match = options.find(entry => select.options[select.selectedIndex] === entry.option);
      if (!match) return false;
      owner.params.format = match.format; update(); return true;
    },
    update,
    dispose() { restore(); options.forEach(entry => entry.option.remove()); },
  };
}
module.exports = { addAudioOptions };
