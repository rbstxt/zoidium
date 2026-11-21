"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  alphaFormat, installAlphaOption, installAlphaImageEncoder,
} = require("../plugins/core/alpha-export-options");
const { constructWithAlpha, withPremultipliedInput } = require("../plugins/core/alpha-export-render");
const { installAlphaVideo } = require("../plugins/mp4-export/alpha-video");

function element(text) {
  return Object.assign(new EventTarget(), {
    textContent: text, style: {}, children: [],
    setAttribute() {},
    append(...children) { this.children.push(...children); },
  });
}

function optionsFixture(format, video, webp = true) {
  const document = { createElement: () => element() };
  const owner = { params: { format } };
  const page = element(), select = element(), row = element(), parent = element();
  page.querySelectorAll = () => [select];
  row.parentElement = parent;
  parent.insertBefore = child => parent.append(child);
  select.closest = () => row;
  select.options = [".png", ".jpg", ".webp", ".mp4 (H.264)", ".mkv (vp8/opus)", ".webm (vp8/opus)", ".wav"]
    .map(text => ({ text }));
  installAlphaOption(page, owner, { document, webp: () => webp, video: () => video });
  const [label, hint] = parent.children;
  const [input] = label.children;
  function change(value) {
    owner.params.format = value;
    select.dispatchEvent(new Event("change"));
  }
  return { owner, input, label, hint, change };
}

test("only PNG, encodable WebP and supported VP8 containers offer the checkbox", async () => {
  const formats = [
    ["png", true], ["webp", true], ["jpg", false], ["mp4_h264", false],
    ["mkv_vp8_opus", true], ["webm_vp8_opus", true], ["wav", false],
  ];
  for (const [format, expected] of formats) {
    const fixture = optionsFixture(format, { status: true });
    assert.equal(!fixture.input.disabled, expected, format);
    assert.equal(fixture.label.style.display !== "none", expected, format);
    assert.equal(fixture.owner.params.transparentBackground, undefined);
    if (!expected) assert.ok(fixture.hint.textContent, format);
  }
  assert.equal(optionsFixture("webp", null, false).input.disabled, true);
  assert.equal(optionsFixture("webm_vp8_opus", { status: false }).input.disabled, true);
  assert.equal(alphaFormat({ transparentBackground: true, format: "mp4_h264" }), null);
});

test("an async video probe only updates the selected format and unsupported formats clear the option", async () => {
  let complete;
  const video = { probe: () => new Promise(resolve => { complete = resolve; }) };
  const fixture = optionsFixture("webm_vp8_opus", video);
  assert.equal(fixture.input.disabled, true);
  fixture.change("mp4_h264");
  video.status = true;
  complete();
  await Promise.resolve();
  assert.equal(fixture.input.disabled, true);
  fixture.change("webm_vp8_opus");
  assert.equal(fixture.input.disabled, false);
  fixture.input.checked = true;
  fixture.input.dispatchEvent(new Event("change"));
  assert.equal(fixture.owner.params.transparentBackground, true);
  fixture.change("mkv_vp8_opus");
  assert.equal(fixture.input.checked, true);
  fixture.change("mp4_h264");
  assert.equal(fixture.owner.params.transparentBackground, undefined);
  assert.equal(fixture.input.checked, false);
});

test("only an opted-in export creates a premultiplied RGBA renderer", () => {
  function Renderer(options) { this.options = options; }
  const three = { WebGLRenderer: Renderer };
  const originalOptions = { preserveDrawingBuffer: true };
  const make = () => new three.WebGLRenderer(originalOptions);
  assert.equal(constructWithAlpha(three, false, make).options, originalOptions);
  assert.deepEqual(constructWithAlpha(three, true, make).options, {
    preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true,
  });
  assert.equal(three.WebGLRenderer, Renderer);
  assert.throws(() => constructWithAlpha(three, true, () => { throw Error("setup"); }), /setup/);
  assert.equal(three.WebGLRenderer, Renderer);
});

test("premultiplied adjustment and CanvasTexture inputs copy before the effects without another blend", () => {
  const reads = [];
  const material = { blending: 1 };
  const screen = { texture: {} }, readBuffer = {};
  const compositor = { screenBuffers: [screen], readBuffer, copyPass: {
    material, uniforms: { tDiffuse: { value: null } },
    render(_renderer, target, input) { reads.push([target, input, material.blending]); },
  } };
  const { copyPass } = compositor;
  withPremultipliedInput(compositor, 0, 0, () => {
    copyPass.render(null, readBuffer, screen);
    copyPass.uniforms.tDiffuse.value = { premultiplyAlpha: true };
    copyPass.render(null, readBuffer, null);
    copyPass.render(null, {}, null);
  });
  assert.deepEqual(reads.map(entry => entry[2]), [0, 0, 1]);
  assert.equal(material.blending, 1);
});

test("image export passes the original encoder inputs through when off or unsupported", async () => {
  const calls = [];
  const image = { encode(...args) { calls.push(args); return "native bytes"; } };
  installAlphaImageEncoder(image);
  const exporter = {};
  for (const params of [{ format: "png" }, { format: "jpg", transparentBackground: true }]) {
    assert.equal(await image.encode(exporter, params), "native bytes");
    assert.deepEqual(calls.at(-1), [exporter, params]);
  }
});

test("transparent image export uses the alpha canvas and verifies the encoded MIME", async () => {
  const calls = [], canvas = {};
  const exporter = {
    renderer: { domElement: canvas },
    async getVideoFrame(...args) { calls.push(args); return 1; },
    checkExportContext() {},
  };
  const image = { encode() { assert.fail("native encoder called"); },
    async canvasToBlob(...args) { calls.push(args); return { type: "image/webp" }; },
  };
  installAlphaImageEncoder(image);
  const params = { format: "webp", transparentBackground: true, quality: 0.8 };
  assert.equal((await image.encode(exporter, params)).type, "image/webp");
  assert.deepEqual(calls, [[], [canvas, "webp", 0.8]]);
  image.canvasToBlob = async () => ({ type: "image/png" });
  await assert.rejects(image.encode(exporter, params), /WebP/i);
});

test("device export dispatches unchecked video and unrelated formats to the original renderer", async () => {
  const disposers = [], calls = [];
  const prototype = { render(...args) { calls.push([this, ...args]); return "native bytes"; } };
  const PZ = { zoidium: {}, ui: { export: { device: { prototype } } } };
  installAlphaVideo(PZ, () => assert.fail("the vendor must stay unloaded"), callback => disposers.push(callback));
  for (const params of [{ format: "webm_vp8_opus" }, { format: "mkv_vp8_opus", transparentBackground: false },
    { format: "mp4_h264", transparentBackground: true }]) {
    const owner = { params }, exporter = {};
    assert.equal(await prototype.render.call(owner, exporter), "native bytes");
    assert.deepEqual(calls.at(-1), [owner, exporter]);
  }
  for (const dispose of disposers) dispose();
  assert.equal(PZ.zoidium.alphaVideo, undefined);
});
