#!/usr/bin/env node
"use strict";

// Browser oracle entry point. Keep it outside Node's automatic test discovery.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const handler = require("serve-handler");
const { chromium } = require("playwright");
const { prepareRuntimeStage } = require("./runtime-resources");

async function acquire(lock) {
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), process.pid + " preview-cache-oracle\n");
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log("Waiting for shared browser lock");
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

async function run(options, test) {
  const lock = process.env.ZOIDIUM_BROWSER_LOCK;
  let runtime, server, browser, locked = false;
  try {
    if (lock) { await acquire(lock); locked = true; }
    runtime = await prepareRuntimeStage();
    server = http.createServer((request, response) => handler(request, response, {
      public: runtime.root, cleanUrls: false, directoryListing: false,
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launchPersistentContext(options.profile, {
      headless: true, viewport: { width: 1000, height: 720 },
    });
    const page = browser.pages()[0];
    await page.addInitScript(() => {
      localStorage.setItem("zoidium.player-plus.quality", "0.125");
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => globalThis.CM?.mainViewport && globalThis.ZoidiumFrameCache);
    await page.locator('[title="Pause drawing"]').click();
    return await test(page);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (runtime) await runtime.cleanup();
    if (locked) fs.rmSync(lock, { recursive: true });
  }
}

module.exports = { run };
