"use strict";

const assert = require("node:assert/strict");

// CPU time excludes time spent waiting for the scheduler. The best of three
// attempts also reduces interference from garbage collection and JIT work.
function withinCpuBudget(run, limitMs, label) {
  let best = Infinity;
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = process.cpuUsage();
    result = run();
    const usage = process.cpuUsage(start);
    best = Math.min(best, (usage.user + usage.system) / 1000);
  }
  assert.ok(best < limitMs, `${label} used at least ${best.toFixed(1)} ms CPU (limit ${limitMs} ms)`);
  return result;
}

module.exports = { withinCpuBudget };
