"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { install } = require("../plugins/core/shader-program-cache");

function setup(limit = 32) {
  const programs = [];
  let destroyed = 0;
  const renderer = { info: { programs }, render() {}, compile() {} };
  const cache = install(renderer, 91, limit);
  function acquire(key) {
    let program = programs.find(item => item.key === key);
    if (program) program.usedTimes += 1;
    else {
      program = { key, usedTimes: 1, destroy() { destroyed += 1; } };
      programs.push(program);
    }
    return program;
  }
  function release(program) {
    program.usedTimes -= 1;
    if (!program.usedTimes) { programs.splice(programs.indexOf(program), 1); program.destroy(); }
  }
  return { renderer, cache, programs, acquire, release, destroyed: () => destroyed };
}

test("light-key undo reuses the original program after the last material leaves it", () => {
  const s = setup();
  const first = s.acquire("8 lights");
  s.renderer.render();
  s.release(first);
  const second = s.acquire("9 lights");
  s.renderer.render();
  s.release(second);
  assert.equal(s.acquire("8 lights"), first);
  assert.equal(s.destroyed(), 0);
  s.cache.clear();
  assert.equal(s.destroyed(), 1);
  s.release(first);
  assert.equal(s.destroyed(), 2);
  assert.equal(s.programs.length, 0);
});

test("eviction bounds retained variants and preserves the native live reference", () => {
  const s = setup(2);
  const first = s.acquire("first");
  s.renderer.render();
  s.release(first);
  const second = s.acquire("second");
  s.renderer.render();
  s.release(second);
  const third = s.acquire("third");
  s.renderer.render();
  assert.deepEqual(s.programs.map(p => p.key).sort(), ["second", "third"]);
  assert.equal(s.destroyed(), 1);
  s.cache.dispose();
  assert.equal(third.usedTimes, 1);
  assert.equal(s.destroyed(), 2);
  s.release(third);
  assert.equal(s.destroyed(), 3);
});

test("render errors propagate and dispose restores both renderer methods", () => {
  const renderer = { info: { programs: [] }, render() { throw new Error("shader failed"); }, compile() {} };
  const render = renderer.render, compile = renderer.compile;
  const cache = install(renderer, 91);
  assert.throws(() => renderer.render(), /shader failed/);
  cache.dispose();
  assert.equal(renderer.render, render);
  assert.equal(renderer.compile, compile);
  assert.equal(install(renderer, 92), null);
});


test("programs with diagnostics keep native disposal and repeated error reporting", () => {
  const s = setup();
  const failed = s.acquire("invalid shader");
  failed.diagnostics = { runnable: false, material: { map: {} } };
  s.renderer.compile();
  assert.equal(failed.usedTimes, 1);
  s.release(failed);
  assert.equal(s.programs.length, 0);
  assert.notEqual(s.acquire("invalid shader"), failed);
});

test("a restored WebGL context drops retained programs without destroying them", () => {
  const s = setup();
  const lost = s.acquire("8 lights");
  s.renderer.render();
  s.renderer.info.programs = [];
  s.renderer.render();
  s.cache.clear();
  assert.equal(s.destroyed(), 0);
  assert.equal(lost.usedTimes, 2);
});
