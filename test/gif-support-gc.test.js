"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("GIF bookkeeping does not retain abandoned decoded records or texture consumers", () => {
  const result = spawnSync(process.execPath, ["--expose-gc", "-e", `
    const assert = require("node:assert/strict");
    const { loadGifSupport, makeFakeCanvas, makeFakeHost, makeAssetRecord, gifArrayBuffer } =
      require("./test/gif-support-fixture.js");
    (async () => {
      const { GifSupport } = loadGifSupport({ fetch: async () => ({ ok: true, arrayBuffer: async () => gifArrayBuffer() }) });
      const { PZ } = makeFakeHost();
      await GifSupport.activate({ PZ, window: {}, document: { createElement: () => makeFakeCanvas() },
        lifecycle: { onDispose() {} } });
      async function abandon() {
        const asset = makeAssetRecord("abandoned.gif", "/abandoned.gif");
        const wrapper = new PZ.asset.image(asset);
        wrapper.decodeBrowser(); await asset.data.loading;
        const texture = wrapper.getTexture();
        // No dispose event: removal must not depend on a cooperative consumer.
        return [asset.data.gif, wrapper, texture].map(value => new WeakRef(value));
      }
      try {
        const refs = await abandon();
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(setImmediate);
          global.gc();
          if (refs.every(ref => ref.deref() === undefined)) return;
        }
        assert.equal(refs.filter(ref => ref.deref() !== undefined).length, 0,
          "abandoned decoded records and consumers must be collectible while GIF support stays active");
      } finally { GifSupport.deactivate(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 120000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
