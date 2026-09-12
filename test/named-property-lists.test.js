"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../plugins/core/named-property-lists.js"),
  "utf8"
);

function loadPatch() {
  class PropertyList {}
  class Edit {}

  Edit.prototype.generateListItem = function () {
    const label = { innerText: "Properties", title: "Properties" };
    return {
      label,
      firstElementChild: {
        querySelector(selector) {
          return selector === "span" ? label : null;
        },
      },
    };
  };

  const context = {
    PZ: {
      propertyList: PropertyList,
      ui: { edit: Edit },
    },
  };
  vm.runInNewContext(source, context);
  return { Edit, PropertyList };
}

test("named property lists replace the fixed Properties heading", () => {
  const { Edit, PropertyList } = loadPatch();
  const properties = new PropertyList();
  Object.defineProperty(properties, "_zoidiumCategoryName", {
    value: "Character",
  });

  const item = new Edit().generateListItem(null, properties, 0);
  assert.equal(item.label.innerText, "Character");
  assert.equal(item.label.title, "Character");
});

test("ordinary property lists keep the native Properties heading", () => {
  const { Edit, PropertyList } = loadPatch();
  const item = new Edit().generateListItem(null, new PropertyList(), 0);
  assert.equal(item.label.innerText, "Properties");
  assert.equal(item.label.title, "Properties");
});
