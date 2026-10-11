"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { managerSource } = require("./plugin-manager-source");
const hostile = '<img src=x onerror="alert(1)"> & \' "><script>alert(2)</script>';
function panelBuilders() {
  const source = managerSource();
  const begin = source.indexOf("  function compatBadgeHtml");
  const end = source.indexOf("  function createHiddenPluginState", begin);
  const groupBegin = source.indexOf("  function createGroupSection");
  const groupEnd = source.indexOf("  function createPluginGroup", groupBegin);
  const nodes = new Map();
  const sandbox = {
    document: { createElement: () => ({ dataset: {}, querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { addEventListener() {} });
      return nodes.get(selector);
    } }) },
    pluginStates: new Map(), shouldStartEnabled: () => false, normalizePickerLabel: (value) => value,
  };
  return vm.runInNewContext(source.slice(begin, end) + source.slice(groupBegin, groupEnd) +
    "\n({createPluginCard,createGroupSection,pluginSwitchHtml,compatBadgeHtml,escapePluginHtml})", sandbox);
}
test("Plugins panel escapes hostile registry text and switch attributes", () => {
  const api = panelBuilders();
  const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39; &quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  assert.equal(api.escapePluginHtml(hostile), escaped);
  const card = api.createPluginCard({ id: "fixture", name: hostile, tagline: hostile, description: hostile, credits: hostile, warning: hostile, zoidiumOnly: true });
  assert.equal(card.innerHTML.split(escaped).length - 1, 8, "all metadata and derived switch labels are escaped");
  const group = api.createGroupSection({ id: "fixture", name: hostile, description: hostile });
  assert.equal(group.innerHTML.split(escaped).length - 1, 4);
  for (const html of [card.innerHTML, group.innerHTML, api.pluginSwitchHtml({ title: hostile, ariaLabel: hostile, role: hostile }), api.compatBadgeHtml({ zoidiumOnly: true, warning: hostile })]) {
    assert.doesNotMatch(html, /<img|<script|onerror="alert/, "metadata never becomes markup or a new attribute");
    assert.ok(html.includes(escaped));
  }
});
