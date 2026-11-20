"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const create = require("../plugins/layer-input/layer-input-render.js");
test("selected rendering skips bypassed children and groups", () => {
  class Group { constructor(objects) { this.objects = objects; this.enabled = true; } }
  const PZ = { effect: { group: Group }, zoidium: { effectBypass: { bypassed: e => e.zoidiumBypassed } } };
  const render = create({ PZ }, {}); let draws = 0;
  const effect = off => ({ zoidiumBypassed: off, pass: { enabled: true, render() { draws++; } } });
  render.renderSelectedEffects({}, [new Group([effect(true), effect(false)]), Object.assign(new Group([effect(false)]), { zoidiumBypassed: true })], 1, 1, "effects");
  assert.equal(draws, 1);
});
