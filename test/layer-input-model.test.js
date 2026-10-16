"use strict";

// Characterization of the Layer Input source model: pinned track/source
// behavior for the file split. Verified against the original
// plugins/layer-input/layer-input.js before the split.

const assert = require("node:assert/strict");
const test = require("node:test");

const LayerInput = require("../plugins/layer-input/layer-input");

function createProject() {
  class VideoTrack {}
  const trackA = { clips: [] };
  const trackB = { clips: [] };
  const project = {
    sequence: { videoTracks: [trackA, trackB] },
  };
  const context = {
    editor: { project },
    PZ: {
      track: { video: VideoTrack },
      property: { type: { LIST: 10 } },
      ui: { objectTypes: { get: () => [] } },
    },
    document: {
      activeElement: null,
      createElement: () => ({ id: "", textContent: "", remove() {} }),
      getElementById: () => null,
      head: { appendChild() {} },
    },
    window: { clearTimeout, setTimeout },
  };
  Object.setPrototypeOf(trackA, VideoTrack.prototype);
  Object.setPrototypeOf(trackB, VideoTrack.prototype);
  trackA.parentProject = project;
  trackB.parentProject = project;
  return { project, context, trackA, trackB };
}

function makeSourceProperty() {
  let stored = "";
  return {
    definition: { _zoidiumLayerSource: true },
    get: () => stored,
    set: (value) => {
      stored = String(value);
    },
  };
}

function makeConsumer(project, ownerTrack) {
  const property = makeSourceProperty();
  const consumer = {
    type: 1,
    parentProject: project,
    parentObject: ownerTrack,
    customProperties: [property],
  };
  return { consumer, property };
}

test("the capture mode catalogue keeps its three entries", () => {
  const { context } = createProject();
  const api = LayerInput.activate(context);
  try {
    assert.deepEqual(api.getSourceModeOptions(), [
      { value: "source", label: "Source" },
      { value: "masks", label: "Masks" },
      { value: "effects-masks", label: "Effects & Masks" },
    ]);
  } finally {
    LayerInput.deactivate();
  }
});

test("source options list every track and disable the owning track", () => {
  const { project, context, trackA, trackB } = createProject();
  const api = LayerInput.activate(context);
  try {
    const { consumer } = makeConsumer(project, trackA);
    api.registerConsumer(consumer);
    const options = api.getSourceOptions(consumer);
    assert.equal(options[0].value, "");
    assert.equal(options[0].label, "(No source)");
    assert.equal(options.length, 3);
    assert.equal(options[1].label, "Track 1");
    assert.equal(options[1].disabled, true);
    assert.equal(options[2].label, "Track 2");
    assert.equal(options[2].disabled, false);
    const tokenB = options[2].value;
    assert.ok(tokenB.startsWith("track:id:"));
    assert.equal(api.setSource(consumer, tokenB), true);
    assert.equal(api.getSourceStatus(consumer), "");
    assert.equal(api.getSourceToken(consumer), tokenB);
    assert.equal(api.getSourceOptions(consumer)[2].value, tokenB);
  } finally {
    LayerInput.deactivate();
  }
});

test("a two-way source reference is rejected as a cycle", () => {
  const { project, context, trackA, trackB } = createProject();
  const api = LayerInput.activate(context);
  try {
    const first = makeConsumer(project, trackA);
    const second = makeConsumer(project, trackB);
    api.registerConsumer(first.consumer);
    api.registerConsumer(second.consumer);
    const tokenA = api.getSourceOptions(second.consumer)[1].value;
    const tokenB = api.getSourceOptions(first.consumer)[2].value;
    assert.equal(api.setSource(second.consumer, tokenA), true);
    assert.equal(api.setSource(first.consumer, tokenB), false);
    assert.equal(api.getSourceStatus(first.consumer), "Circular source reference");
    assert.equal(api.getSourceToken(first.consumer), "");
  } finally {
    LayerInput.deactivate();
  }
});

test("an unknown source token reports a missing track", () => {
  const { project, context, trackA } = createProject();
  const api = LayerInput.activate(context);
  try {
    const { consumer } = makeConsumer(project, trackA);
    api.registerConsumer(consumer);
    assert.equal(api.setSource(consumer, "track:id:no-such-track"), false);
    assert.equal(api.getSourceStatus(consumer), "Source track is missing");
  } finally {
    LayerInput.deactivate();
  }
});

test("clearing the source token leaves no status", () => {
  const { project, context, trackA } = createProject();
  const api = LayerInput.activate(context);
  try {
    const { consumer } = makeConsumer(project, trackA);
    api.registerConsumer(consumer);
    const tokenB = api.getSourceOptions(consumer)[2].value;
    assert.equal(api.setSource(consumer, tokenB), true);
    assert.equal(api.setSource(consumer, ""), true);
    assert.equal(api.getSourceStatus(consumer), "");
  } finally {
    LayerInput.deactivate();
  }
});

test("serializeConsumer records the resolved source token", () => {
  const { project, context, trackA } = createProject();
  const api = LayerInput.activate(context);
  try {
    const { consumer } = makeConsumer(project, trackA);
    consumer.properties = { source: "" };
    api.registerConsumer(consumer);
    const tokenB = api.getSourceOptions(consumer)[2].value;
    assert.equal(api.setSource(consumer, tokenB), true);
    const serialized = api.serializeConsumer(consumer);
    assert.equal(serialized.type, 1);
    assert.equal(serialized.properties.source, tokenB);
  } finally {
    LayerInput.deactivate();
  }
});


test("image sources preserve the empty label, clear track state, and serialize without missing errors", () => {
  const { project, context, trackA } = createProject();
  const api = LayerInput.activate(context);
  try {
    const source = makeSourceProperty();
    source.definition.items = [{ name: "The Layer Itself", value: "" }];
    source.toJSON = () => source.get();
    const consumer = { type: "timedisplacement", parentProject: project, parentObject: trackA,
      properties: { source, sourceImage: { get: () => null } } };
    api.registerConsumer(consumer);
    const options = api.getSourceOptions(consumer);
    assert.deepEqual(options.slice(0, 2), [
      { value: "", label: "The Layer Itself", disabled: false },
      { value: "image", label: "Image", disabled: false },
    ]);
    assert.equal(options.some((option) => option.value === "other-layer"), false);
    source.set(options[3].value);
    assert.equal(api.setSource(consumer, source.get()), true);
    source.set("image");
    assert.equal(api.setSource(consumer, "image", { fromUser: true }), true);
    assert.equal(api.getSourceToken(consumer), "image");
    assert.equal(api.getSourceStatus(consumer), "");
    assert.equal(consumer._zoidiumSourceTrack, null);
    assert.equal(api.resolveEffect(consumer), null, "an unset image resolves as an empty source");
    assert.equal(api.resolveMaterial(consumer), null);
    assert.equal(api.serializeConsumer(consumer).properties.source, "image");
  } finally {
    LayerInput.deactivate();
  }
});
