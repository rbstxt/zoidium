#!/usr/bin/env node
"use strict";

// Browser oracle entry point. Keep it outside Node's automatic test discovery.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const handler = require("serve-handler");
const { chromium } = require("playwright");
const { prepareRuntimeStage } = require("./runtime-resources");
const approvals = require("./preview-cache-approvals");
const { fixtures, compareFixture } = require("./preview-cache-oracle-fixtures");

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
    options.onStage?.(runtime.root);
    server = http.createServer((request, response) => handler(request, response, {
      public: runtime.root, cleanUrls: false, directoryListing: false, rewrites: [{ source: "/", destination: "/index.html" }],
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launchPersistentContext(options.profile, {
      headless: true, viewport: { width: 1000, height: 720 },
    });
    if (options.candidates) await browser.route("**/plugins/core/output-frame-approvals.js*", route => route.fulfill({
      contentType: "text/javascript", body: approvals.source({ plugins: options.candidates }),
    }));
    const stop = () => { browser?.close().catch(() => {}); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    browser.once("close", () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); });
    const page = browser.pages()[0];
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => console.error(error.message));
    page.on("console", message => { if (message.type() === "error") console.error(message.text().slice(0, 400)); });
    await page.addInitScript(ids => {
      localStorage.setItem("zoidium.player-plus.quality", "0.125");
      for (const id of ids) localStorage.setItem("zoidium.plugin.enabled." + id, "true");
    }, Object.keys(options.candidates || {}));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => globalThis.CM?.mainViewport && globalThis.ZoidiumFrameCache);
    const skip = page.getByRole("button", { name: "Skip", exact: true });
    if (await skip.isVisible()) await skip.click();
    await page.locator('[title="Pause drawing"]').click();
    await page.locator('[aria-label="Preview quality"]').selectOption("0.125");
    return await test(page);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (runtime) await runtime.cleanup();
    if (locked) fs.rmSync(lock, { recursive: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.find(arg => arg.startsWith(name + "="))?.slice(name.length + 1);
  const profile = option("--profile"), reportPath = option("--report");
  if (!profile || !reportPath) throw new Error("Use --profile=<directory> --report=<file> [--write] [--filter=<text>]");
  const filter = option("--filter");
  if (args.includes("--write") && filter) throw new Error("Filtered runs cannot write approvals");
  execFileSync(process.execPath, [path.join(approvals.root, "tools/build-plugin-bundles.js"), "--check"], { stdio: "inherit" });
  const current = approvals.versions();
  const candidates = Object.fromEntries(Object.entries(current).map(([id, version]) => [id, { version }]));
  const report = { schemaVersion: 1, fingerprint: approvals.fingerprint(), plugins: {}, excluded: {}, cases: [], failures: [] };
  const all = fixtures();
  let matrix = all.filter(fixture => !filter || (fixture.plugin + "/" + fixture.name).includes(filter));
  // Brief full-quality checks cover one content fixture per candidate pack.
  if (!filter) for (const id of approvals.candidates) {
    const sample = all.find(fixture => fixture.plugin === id && !fixture.liveOnly);
    matrix.push({ ...sample, name: sample.name + "-full", full: true });
  }
  try {
    await run({ profile: path.resolve(profile), candidates, onStage: stage => { report.stage = stage; } }, async page => {
      await page.waitForFunction(ids => ids.every(id => globalThis.PZ.zoidium.getDebugPlugins()
        .some(plugin => plugin.id === id && plugin.enabled && plugin.phase === "enabled")), approvals.candidates);
      report.environment = await page.evaluate(() => {
        globalThis.ZoidiumFrameCache.debug.prefetchDisabled = true;
        const gl = globalThis.CM.mainViewport.renderer.context;
        return { core: typeof PZVERSION === "undefined" ? null : PZVERSION,
          ui: Array.from(document.scripts, script => script.src.split("/").pop()).find(name => /^ui-\d/.test(name)),
          webgl: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER), userAgent: navigator.userAgent };
      });
      for (const fixture of matrix) {
        await page.locator('[aria-label="Preview quality"]').selectOption(fixture.full ? "1" : "0.125");
        const begin = Date.now();
        const entry = { plugin: fixture.plugin, name: fixture.name, full: !!fixture.full };
        try {
          let timer;
          try {
            entry.result = await Promise.race([
              page.evaluate(compareFixture, fixture),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture timed out")), 90000); }),
            ]);
          } finally { clearTimeout(timer); }
          entry.passed = true;
        } catch (error) {
          entry.error = String(error.message).split("\n").slice(0, 3).join(" ");
          entry.passed = false;
          if (entry.error.includes("Fixture timed out")) throw error;
          report.failures.push({ plugin: fixture.plugin, name: fixture.name, error: entry.error });
        }
        entry.elapsedMs = Date.now() - begin;
        report.cases.push(entry);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        console.log((entry.passed ? "PASS " : "FAIL ") + entry.plugin + "/" + entry.name + " " + entry.elapsedMs + "ms" + (entry.error ? " " + entry.error : ""));
      }
    });
    for (const id of approvals.candidates) {
      const cases = report.cases.filter(entry => entry.plugin === id);
      const record = { version: current[id], cases: cases.map(entry => entry.name) };
      if (cases.length && cases.every(entry => entry.passed)) report.plugins[id] = record;
      else report.excluded[id] = { ...record, failed: cases.filter(entry => !entry.passed).map(entry => entry.name) };
    }
    if (report.fingerprint !== approvals.fingerprint()) throw new Error("Render sources changed during the oracle run");
    if (args.includes("--write")) fs.writeFileSync(path.join(approvals.root, approvals.approvalPath), approvals.source({
      schemaVersion: 1, fingerprint: report.fingerprint, plugins: report.plugins, excluded: report.excluded,
    }));
    if (report.failures.length) process.exitCode = 1;
  } finally { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
