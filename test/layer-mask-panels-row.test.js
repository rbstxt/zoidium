"use strict";
// P1.7b: the Properties panel mounts the P1.3 mask row and wires every
// control to the real mask model and history.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./fake-dom.js");
const { validateMasks, createMask } = require("../plugins/shape-plus/mask-model.js");
const panels = require("../plugins/shape-plus/mask-panels.js");

const PATH_VALUE_1 = [0, 0, 0, 0, 0, 0];
const PATH_VALUE_2 = [10, 10, 0, 0, 0, 0, 60, 10, 0, 0, 0, 0];

function maskAm(id, name, overrides = {}) {
  const base = createMask(id, name, [20, 30]);
  base.vertexIds = ["a-" + id, "b-" + id];
  base.properties.path = {
    animated: false,
    keyframes: [{ frame: 0, value: PATH_VALUE_2.slice(), tween: 1 }],
  };
  base.properties.closed = 1;
  return { ...base, ...overrides };
}

function legacyMask(id, name) {
  const item = maskAm(id, name);
  delete item.outlineColor;
  delete item.locked;
  delete item.expansion;
  return item;
}

function makeSession(masks, opts = {}) {
  let stored = JSON.parse(JSON.stringify(masks));
  const messages = [];
  let history = 0;
  let n = 0;
  const session = {
    host: {
      contents: () => JSON.parse(JSON.stringify(stored)),
      write: data => {
        validateMasks(data);
        stored = JSON.parse(JSON.stringify(data));
      },
    },
    s: null,
    nativeLayer: { tryGetParentOfType: () => null },
  };
  const s = {
    PZ: { clip: function Clip() {} },
    editor: { playback: { currentFrame: opts.frame ?? 10 } },
    activeId: opts.activeId ?? null,
    treeSelection: new Set(opts.activeId ? [opts.activeId] : []),
    selection: new Set(),
    localFrame() { return this.editor.playback.currentFrame; },
    nextId: () => "fresh-" + (++n),
    message: text => messages.push(String(text)),
    mutate(work) {
      try {
        work();
        history++;
        return true;
      } catch (error) {
        messages.push(error.message);
        return false;
      }
    },
    selectItem(id) {
      this.treeSelection = new Set([id]);
      this.activeId = id;
    },
    keyframe() {
      return this.mutate(() => {
        const item = stored.find(mask => mask.id === this.activeId);
        if (!item || item.kind !== "path") return;
        const path = item.properties.path;
        const at = this.editor.playback.currentFrame;
        const has = path.keyframes.some(key => key.frame === at);
        if (path.animated && has) {
          if (path.keyframes.length > 1) path.keyframes = path.keyframes.filter(key => key.frame !== at);
          else path.animated = false;
        } else {
          path.animated = true;
          if (!has) {
            const value = path.keyframes.length ? path.keyframes[0].value.slice() : PATH_VALUE_1.slice();
            path.keyframes.push({ frame: at, value, tween: 1 });
            path.keyframes.sort((a, b) => a.frame - b.frame);
          }
        }
        validateMasks(stored);
      });
    },
    treeAction(action) {
      return this.mutate(() => {
        if (action === "delete") {
          const ids = [...this.treeSelection];
          stored = stored.filter(mask => !ids.includes(mask.id));
          validateMasks(stored);
        }
      });
    },
    addItem(kind, point) {
      const id = this.nextId();
      const item = createMask(id, "Mask", point);
      stored.push(item);
      validateMasks(stored);
      return { id };
    },
  };
  session.s = s;
  session.__test = {
    stored: () => JSON.parse(JSON.stringify(stored)),
    messages, history: () => history,
  };
  return session;
}

function render(session, layer = {}, hooks) {
  const document = makeDocument();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const calls = { refresh: 0 };
  panels.renderMasksSection(document, container, session, layer, () => {}, () => { calls.refresh++; }, hooks);
  return { document, container, calls };
}

function rows(container) {
  return container.querySelectorAll(".mask-row-view");
}

test("panel mounts one row per mask with names and the active highlight", () => {
  const session = makeSession([maskAm("m1", "Mask 1"), maskAm("m2", "Mask 2")], { activeId: "m2" });
  const { container } = render(session);
  assert.equal(rows(container).length, 2);
  assert.match(rows(container)[0].querySelector(".mask-row-name").textContent, /Mask 1/);
  assert.equal(rows(container)[1].getAttribute("aria-current"), "true");
  assert.ok(rows(container)[1].classList.contains("is-active"));
  assert.equal(rows(container)[0].getAttribute("aria-current"), null);
});

test("rename keeps IDs and records one history step", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const before = session.__test.history();
  const { container } = render(session);
  const input = rows(container)[0].querySelector(".mask-row-name-input");
  input.value = "Hero";
  input.dispatch("change", { target: input });
  const [item] = session.__test.stored();
  assert.equal(item.properties.name, "Hero");
  assert.equal(item.id, "m1");
  assert.equal(session.__test.history(), before + 1);
});

test("mode, invert and enable round-trip through the model", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const { container } = render(session);
  const mode = rows(container)[0].querySelector(".mask-row-mode");
  mode.value = "subtract";
  mode.dispatch("change", { target: mode });
  assert.equal(session.__test.stored()[0].mode, "subtract");
  const invert = rows(container)[0].querySelector(".mask-row-invert");
  invert.click();
  assert.equal(session.__test.stored()[0].invert, 1);
  const enable = rows(container)[0].querySelector(".mask-row-enable");
  enable.click();
  assert.equal(session.__test.stored()[0].properties.enabled, 0);
});

test("feather, opacity percent and outline colour round-trip", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const { container } = render(session);
  const row = rows(container)[0];
  const feather = row.querySelector(".mask-row-feather");
  feather.value = "12";
  feather.dispatch("change", { target: feather });
  assert.equal(session.__test.stored()[0].feather, 12);
  const opacity = row.querySelector(".mask-row-opacity");
  assert.equal(opacity.value, "100");
  opacity.value = "80";
  opacity.dispatch("change", { target: opacity });
  assert.equal(session.__test.stored()[0].opacity, 0.8);
  const color = row.querySelector(".mask-row-color");
  color.value = "#ff0000";
  color.dispatch("change", { target: color });
  assert.equal(session.__test.stored()[0].outlineColor, "#ff0000");
});

test("expansion accepts +-128 and rejects out-of-range without writing", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const { container } = render(session);
  const expansion = rows(container)[0].querySelector(".mask-row-expansion");
  expansion.value = "-128";
  expansion.dispatch("change", { target: expansion });
  assert.equal(session.__test.stored()[0].expansion, -128);
  const history = session.__test.history();
  // The row view restores out-of-range edits itself, so no callback fires.
  expansion.value = "500";
  expansion.dispatch("change", { target: expansion });
  assert.equal(session.__test.stored()[0].expansion, -128);
  assert.equal(session.__test.history(), history);
  // Direct (programmatic) out-of-range writes are rejected visibly.
  panels.rowCallbacks(session, {}, () => {}, () => {}).onExpansionChange("m1", 500);
  assert.equal(session.__test.stored()[0].expansion, -128);
  assert.equal(session.__test.history(), history);
  assert.ok(session.__test.messages.some(text => /expansion/i.test(text)));
});

test("duplicate mints fresh mask and vertex IDs from one namespace", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const { container } = render(session);
  rows(container)[0].querySelector(".mask-row-duplicate").click();
  const stored = session.__test.stored();
  assert.equal(stored.length, 2);
  const copy = stored[1];
  assert.notEqual(copy.id, "m1");
  assert.ok(!stored[0].vertexIds.includes(copy.vertexIds[0]));
  assert.ok(!stored.flatMap(mask => [mask.id, ...mask.vertexIds]).filter((id, i, all) => all.indexOf(id) !== i).length);
  assert.deepEqual(copy.properties.path, stored[0].properties.path);
  assert.notEqual(copy.properties.path, stored[0].properties.path);
  assert.ok(copy.properties.name.includes("copy"));
  assert.equal(session.s.activeId, copy.id);
});

test("delete removes the mask in one history step", () => {
  const session = makeSession([maskAm("m1", "Mask 1"), maskAm("m2", "Mask 2")], { activeId: "m1" });
  const before = session.__test.history();
  const { container } = render(session);
  rows(container)[0].querySelector(".mask-row-delete").click();
  assert.deepEqual(session.__test.stored().map(mask => mask.id), ["m2"]);
  assert.equal(session.__test.history(), before + 1);
});

test("lock blocks properties and delete but allows reorder", () => {
  const session = makeSession([maskAm("m1", "Mask 1", { locked: true }), maskAm("m2", "Mask 2")]);
  const { container } = render(session);
  const history = session.__test.history();
  rows(container)[0].querySelector(".mask-row-delete").click();
  assert.equal(session.__test.stored().length, 2);
  assert.equal(session.__test.history(), history);
  assert.ok(session.__test.messages.some(text => /locked/i.test(text)));
  const feather = rows(container)[0].querySelector(".mask-row-feather");
  feather.value = "9";
  feather.dispatch("change", { target: feather });
  assert.equal(session.__test.stored()[0].feather, 0);
  // Reorder around the locked mask is allowed and records one step.
  rows(container)[0].querySelector(".mask-row-down").click();
  assert.deepEqual(session.__test.stored().map(mask => mask.id), ["m2", "m1"]);
  assert.equal(session.__test.history(), history + 1);
});

test("reorder buttons move combine order up and down", () => {
  const session = makeSession([maskAm("m1", "Mask 1"), maskAm("m2", "Mask 2"), maskAm("m3", "Mask 3")]);
  const { container } = render(session);
  rows(container)[1].querySelector(".mask-row-up").click();
  assert.deepEqual(session.__test.stored().map(mask => mask.id), ["m2", "m1", "m3"]);
});

test("keyframe diamond shows off, armed and keyed states", () => {
  const animated = maskAm("m1", "Mask 1");
  animated.properties.path = { animated: true, keyframes: [{ frame: 4, value: PATH_VALUE_2.slice(), tween: 1 }] };
  const off = makeSession([maskAm("m1", "Mask 1")], { frame: 10 });
  assert.equal(panels.keyframeStateFor(off.__test.stored()[0], 10), "off");
  const armed = makeSession([animated], { frame: 10 });
  assert.equal(panels.keyframeStateFor(armed.__test.stored()[0], 10), "armed");
  const keyed = makeSession([animated], { frame: 4 });
  assert.equal(panels.keyframeStateFor(keyed.__test.stored()[0], 4), "keyed");
  const { container } = render(armed);
  assert.equal(rows(container)[0].querySelector(".mask-row-key").textContent, "◈");
});

test("keyframe toggle adds a logical key in one history step", () => {
  const session = makeSession([maskAm("m1", "Mask 1")], { frame: 10, activeId: "m1" });
  const before = session.__test.history();
  const { container } = render(session);
  rows(container)[0].querySelector(".mask-row-key").click();
  const [item] = session.__test.stored();
  assert.equal(item.properties.path.animated, true);
  assert.ok(item.properties.path.keyframes.some(key => key.frame === 10));
  assert.equal(session.__test.history(), before + 1);
});

test("previous and next jump to the nearest path key", () => {
  const item = maskAm("m1", "Mask 1");
  item.properties.path = {
    animated: true,
    keyframes: [
      { frame: 2, value: PATH_VALUE_2.slice(), tween: 1 },
      { frame: 8, value: PATH_VALUE_2.slice(), tween: 1 },
    ],
  };
  const session = makeSession([item], { frame: 5, activeId: "m1" });
  const { container } = render(session);
  rows(container)[0].querySelector(".mask-row-key-prev").click();
  assert.equal(session.s.editor.playback.currentFrame, 2);
  rows(container)[0].querySelector(".mask-row-key-next").click();
  assert.equal(session.s.editor.playback.currentFrame, 8);
});

test("name click activates by default and honours the injectable hook", () => {
  const session = makeSession([maskAm("m1", "Mask 1")]);
  const { container } = render(session, {}, undefined);
  rows(container)[0].querySelector(".mask-row-name").click();
  assert.equal(session.s.activeId, "m1");

  const seen = [];
  panels.setPanelActivator((sess, layer, id) => { seen.push(id); });
  try {
    const session2 = makeSession([maskAm("m1", "Mask 1")]);
    const { container: c2 } = render(session2);
    c2.querySelectorAll(".mask-row-view")[0].querySelector(".mask-row-name").click();
    assert.deepEqual(seen, ["m1"]);
    assert.equal(session2.s.activeId, null);
  } finally {
    panels.setPanelActivator(null);
  }

  const hooked = [];
  const session3 = makeSession([maskAm("m1", "Mask 1")]);
  const { container: c3 } = render(session3, {}, { onActivate: (sess, layer, id) => hooked.push(id) });
  c3.querySelectorAll(".mask-row-view")[0].querySelector(".mask-row-name").click();
  assert.deepEqual(hooked, ["m1"]);
});

test("rendering and saving without edits leaves legacy data byte-identical", () => {
  const legacy = [legacyMask("m1", "Mask 1"), legacyMask("m2", "Mask 2")];
  const before = JSON.stringify(legacy);
  const session = makeSession(legacy);
  render(session);
  assert.equal(JSON.stringify(session.__test.stored()), before);
  assert.equal(session.__test.history(), 0);
  assert.equal(session.__test.messages.length, 0);
});
