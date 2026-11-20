"use strict";

// ExpressText+ Letters scope save/load migration: new containers default to
// Per text, while projects saved before the setting load as Across texts so
// they render identically. Uses the shared CM3 host fixture.

const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture } = require("./helpers/expresstext-host.cjs");

function freshContainer(h) {
  const Cls = h.T.createExpressObjectClass(h.PZ, h.T.getExpressDefinitions()[0]);
  const container = new Cls();
  h.project.objects.push(container);
  return container;
}

test("new containers default to per text", () => {
  const h = fixture();
  try {
    const container = freshContainer(h);
    container.load({ objects: [], properties: {}, expressProperties: {} });
    assert.equal(container.expressProperties.lettersMode.get(0), 0, "per text by default");
    assert.equal(container.expressProperties.lettersVersion.get(0), 1, "marker stamped");
    assert.equal(h.T.lettersScopeOf(container, 0), 0, "renders per text");
  } finally { h.close(); }
});

test("projects saved before the scope load as across texts", () => {
  const h = fixture();
  try {
    const container = freshContainer(h);
    // Old save shape: static rows serialize as bare values, and pre-scope
    // saves carry no letters keys.
    container.load({ objects: [], properties: {}, expressProperties: { rotationOrder: "XZY" } });
    assert.equal(container.expressProperties.rotationOrder.get(0), "XZY", "saved rows untouched");
    assert.equal(container.expressProperties.lettersMode.get(0), 1, "old projects stay across texts");
    assert.equal(container.expressProperties.lettersVersion.get(0), 1, "marker stamped for later saves");
    assert.equal(h.T.lettersScopeOf(container, 0), 1, "renders across texts");
  } finally { h.close(); }
});

test("saved scope choices survive reopen", () => {
  const h = fixture();
  try {
    const perText = freshContainer(h);
    perText.load({
      objects: [],
      properties: {},
      expressProperties: { rotationOrder: "XYZ", lettersMode: 0, lettersVersion: 1 },
    });
    assert.equal(perText.expressProperties.lettersMode.get(0), 0, "per text kept");
    const across = freshContainer(h);
    across.load({
      objects: [],
      properties: {},
      expressProperties: { rotationOrder: "XYZ", lettersMode: 1, lettersVersion: 1 },
    });
    assert.equal(across.expressProperties.lettersMode.get(0), 1, "across texts kept");
  } finally { h.close(); }
});

test("effectors never carry the scope rows", () => {
  const h = fixture();
  try {
    const defs = h.T.getExpressDefinitions();
    const Shake = h.T.createExpressObjectClass(h.PZ, defs.find((d) => d.kind === "shake"));
    const shake = new Shake();
    assert.ok(!shake.expressProperties.lettersMode, "no scope row on effectors");
    assert.ok(!shake.expressProperties.lettersVersion, "no marker row on effectors");
  } finally { h.close(); }
});

test("marker-less saves with saved children migrate to across", () => {
  const h = fixture();
  try {
    // The motivating old project shape: container defaults untouched (the
    // saver omits clean defaults), two text children and an effector.
    // The host fixture cannot revive saved text children through a raw
    // stockLoad (typeless child entries need the editor's typed create
    // path), so the decision half of the migration is pinned headlessly
    // here against the exact saved shape; the render half is pinned
    // through live sections in the next test.
    const src = freshContainer(h);
    src.load({ objects: [], properties: {}, expressProperties: {} });
    h.text(src, "AB");
    h.text(src, "CD");
    h.section("Random", { randomSeed: 7 });
    const srcJson = JSON.parse(JSON.stringify(src));
    const fxJson = JSON.parse(JSON.stringify(h.container));
    const oldSave = {
      objects: srcJson.objects,
      properties: {},
      expressProperties: {},
      customProperties: fxJson.customProperties,
    };
    // Paste-flavoured: through a JSON string into a new object.
    const pasted = JSON.parse(JSON.stringify(oldSave));
    assert.equal(pasted.objects.length, 2, "old save carries texts");
    assert.ok(pasted.customProperties.length > 0, "old save carries the effector");
    const freshRows = () => {
      const applied = {};
      return {
        rows: {
          lettersMode: { set: (value) => { applied.mode = value; } },
          lettersVersion: { set: (value) => { applied.version = value; } },
        },
        applied,
      };
    };
    {
      const { rows, applied } = freshRows();
      h.T.migrateLettersScope({ expressProperties: rows }, pasted);
      assert.equal(applied.mode, 1, "old projects with content move to across texts");
      assert.equal(applied.version, 1, "marker stamps for later saves");
    }
    // Effector-only old saves: sections without children.
    {
      const { rows, applied } = freshRows();
      h.T.migrateLettersScope({ expressProperties: rows }, {
        objects: [],
        properties: {},
        expressProperties: {},
        customProperties: pasted.customProperties,
      });
      assert.equal(applied.mode, 1, "effector-only old saves move to across texts");
    }
    // Live children arriving with marker-less data move to across too.
    {
      const { rows, applied } = freshRows();
      h.T.migrateLettersScope(
        { expressProperties: rows, objects: [{}, {}], customProperties: [] },
        { objects: [], properties: {}, expressProperties: {} }
      );
      assert.equal(applied.mode, 1, "live children move marker-less loads to across texts");
    }
    // Content-free saves keep the per-text default.
    {
      const { rows, applied } = freshRows();
      h.T.migrateLettersScope({ expressProperties: rows }, {
        objects: [],
        properties: {},
        expressProperties: {},
      });
      assert.equal(applied.mode, undefined, "content-free saves keep per text");
      assert.equal(applied.version, 1, "marker still stamps");
    }
    // Marked saves are respected, with or without content.
    {
      const { rows, applied } = freshRows();
      h.T.migrateLettersScope({ expressProperties: rows }, {
        objects: pasted.objects,
        properties: {},
        expressProperties: { lettersMode: 0, lettersVersion: 1 },
        customProperties: pasted.customProperties,
      });
      assert.equal(applied.mode, undefined, "saved per text survives content");
    }
    // Flat marker scan: bare rows never count, arrays never count.
    assert.equal(h.T.rawCarriesLettersVersion({ rotationOrder: "XYZ" }), false, "bare rows carry no marker");
    assert.equal(h.T.rawCarriesLettersVersion({ lettersMode: 0, lettersVersion: 1 }), true, "marker keys found");
    assert.equal(h.T.rawLooksPreScope({}), false, "empty settings are not pre-scope");
    assert.equal(h.T.rawLooksPreScope([]), false, "arrays never count as pre-scope");
  } finally { h.close(); }
});

test("migrated effector stack renders with continuous numbering", () => {
  const h = fixture();
  try {
    // Live old-shaped project: two texts under one Random effector.
    const src = freshContainer(h);
    src.load({ objects: [], properties: {}, expressProperties: {} });
    h.text(src, "AB");
    h.text(src, "CD");
    const def = h.T.effectorEntryDefs(h.PZ).find((entry) => entry.name === "Random");
    const randomSection = h.PZ.property.create(def.type);
    src.customProperties.push(randomSection);
    randomSection.load();
    for (const [key, value] of Object.entries({
      randomEnable: 1,
      randomSeed: 7,
      randomIndexed: 1,
      randomPositionMin: [-5, -5, -5],
      randomPositionMax: [5, 5, 5],
    })) {
      randomSection.objects.find((row) => row.definition.effectorKey === key).set(value, 0);
    }
    // Dev behaviour: continuous numbering across both texts.
    const devStack = h.T.customSections(src);
    const devList = { order: [0, 1, 2, 3], total: 4 };
    const devProps = h.T.staticProps({ rotationOrder: "XYZ" });
    const devAt = (globalIndex, base) =>
      h.T.evaluateStack(devStack, devProps, 0, globalIndex, devList, base);
    // Saved the way dev wrote it; children ride along in the decision
    // test above (the fixture cannot revive them here).
    const oldSave = JSON.parse(JSON.stringify(src));
    oldSave.expressProperties = {};
    const loaded = freshContainer(h);
    loaded.load({
      objects: [],
      properties: {},
      expressProperties: oldSave.expressProperties,
      customProperties: oldSave.customProperties,
    });
    assert.equal(loaded.expressProperties.lettersMode.get(0), 1, "old projects stay across texts");
    assert.equal(h.T.lettersScopeOf(loaded, 0), 1, "renders across texts");
    // Same sections, same continuous numbering: same transforms.
    const stack = h.T.customSections(loaded);
    assert.equal(stack.length, devStack.length, "effector sections revive");
    const viaLoaded = (globalIndex, base) =>
      h.T.evaluateStack(stack, devProps, 0, globalIndex, devList, base);
    assert.deepEqual(viaLoaded(2, [20, 0, 0]), devAt(2, [20, 0, 0]), "second-text transforms match dev");
    assert.deepEqual(viaLoaded(0, [0, 0, 0]), devAt(0, [0, 0, 0]), "first-text transforms match dev");
    // Sensitivity: per-text numbering would draw differently here.
    const perTextDraw = h.T.evaluateStack(stack, devProps, 0, 0, { order: [0, 1], total: 2 }, [20, 0, 0]);
    assert.notDeepEqual(viaLoaded(2, [20, 0, 0]), perTextDraw, "continuous numbering changes the draw");
  } finally { h.close(); }
});

test("old save with only effector rows loads across", () => {
  const h = fixture();
  try {
    h.section("Random", { randomSeed: 7 });
    const saved = JSON.parse(JSON.stringify(h.container));
    const oldSave = {
      objects: [],
      properties: {},
      expressProperties: {},
      customProperties: saved.customProperties,
    };
    const loaded = freshContainer(h);
    loaded.load(oldSave);
    assert.equal(loaded.expressProperties.lettersMode.get(0), 1, "effector-only old saves stay across texts");
    assert.equal(h.T.lettersScopeOf(loaded, 0), 1, "renders across texts");
  } finally { h.close(); }
});

test("new container saves round-trip their scope", () => {
  const h = fixture();
  try {
    const perText = freshContainer(h);
    perText.load({ objects: [], properties: {}, expressProperties: {} });
    const perTextSave = JSON.parse(JSON.stringify(perText));
    assert.ok(h.T.rawCarriesLettersVersion(perTextSave.expressProperties), "new saves carry the marker");
    const perTextReopened = freshContainer(h);
    perTextReopened.load(JSON.parse(JSON.stringify(perTextSave)));
    assert.equal(perTextReopened.expressProperties.lettersMode.get(0), 0, "per text survives reopen");
    assert.equal(h.T.lettersScopeOf(perTextReopened, 0), 0, "renders per text");

    const across = freshContainer(h);
    across.load({ objects: [], properties: {}, expressProperties: {} });
    across.expressProperties.lettersMode.set(1, 0);
    const acrossSave = JSON.parse(JSON.stringify(across));
    const acrossReopened = freshContainer(h);
    acrossReopened.load(JSON.parse(JSON.stringify(acrossSave)));
    assert.equal(acrossReopened.expressProperties.lettersMode.get(0), 1, "across texts survives reopen");
    assert.equal(h.T.lettersScopeOf(acrossReopened, 0), 1, "renders across texts");
  } finally { h.close(); }
});

test("constructed containers serialize with the marker without load", () => {
  const h = fixture();
  try {
    const Cls = h.T.createExpressObjectClass(h.PZ, h.T.getExpressDefinitions()[0]);
    const bare = new Cls();
    const saved = JSON.parse(JSON.stringify(bare));
    assert.ok(h.T.rawCarriesLettersVersion(saved.expressProperties), "marker present without load");
  } finally { h.close(); }
});
