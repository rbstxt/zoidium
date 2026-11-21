"use strict";

const LEVELS = [1, 0.5, 0.25, 0.125];
const ENABLED_KEY = "zoidium.player-plus.adaptive";
const LIMIT_KEY = "zoidium.player-plus.adaptive-limit";

function readSettings(storage) {
  try {
    const limit = storage?.getItem(LIMIT_KEY) || "auto";
    return { enabled: storage?.getItem(ENABLED_KEY) === "true", limit: ["auto", "0.5", "0.25", "0.125"].includes(limit) ? limit : "auto" };
  } catch (_error) { return { enabled: false, limit: "auto" }; }
}

function writeSetting(storage, key, value) {
  try { storage?.setItem(key === "enabled" ? ENABLED_KEY : LIMIT_KEY, String(value)); } catch (_error) { /* Session setting remains active. */ }
}

function createController() {
  let effective = 1, samples = [], last = null;
  function reset(chosen) { effective = chosen; samples = []; last = null; return effective; }
  function tick(now, { enabled, playing, chosen, limit, fps }) {
    if (!enabled || !playing) return reset(chosen);
    const ceiling = LEVELS.indexOf(chosen);
    const floor = Math.max(ceiling, LEVELS.indexOf(Number(limit) || 0.125));
    let index = LEVELS.indexOf(effective);
    if (index < ceiling || index > floor) { effective = LEVELS[Math.max(ceiling, Math.min(floor, index))]; samples = []; last = null; }
    if (last !== null && now > last) samples.push(Math.min(now - last, 1000));
    last = now;
    if (samples.length >= 30) {
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const budget = 1000 / (Number(fps) > 0 ? Number(fps) : 30);
      index = LEVELS.indexOf(effective);
      if (average > budget / 0.9 && index < floor) { effective = LEVELS[index + 1]; samples = []; }
      else if (samples.length >= 90) {
        if (average < budget * 0.7 && index > ceiling) effective = LEVELS[index - 1];
        samples = [];
      }
    }
    return effective;
  }
  return { tick, reset };
}

module.exports = { LEVELS, readSettings, writeSetting, createController };
