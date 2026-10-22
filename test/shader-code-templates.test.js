"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { templates, instantiate } = require("../plugins/shader-plus/code-templates.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
test("six starting templates declare their required properties and avoid existing names", () => {
  assert.deepEqual(templates.map(t => t.id), ["passthrough", "color", "gradient", "curve", "noise", "text"]);
  for (const template of templates) {
    const effect = { customProperties: template.properties.map(p => ({ properties: { name: { get: () => p.name } } })) };
    const result = instantiate(template, effect);
    for (const p of result.properties) {
      assert.ok(KINDS[p.kind]); assert.equal(p.name, template.properties[0].name + "2");
      assert.ok(result.source.includes(p.name));
    }
  }
});
