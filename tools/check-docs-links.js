#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function htmlFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? htmlFiles(child) : entry.name.endsWith(".html") ? [child] : [];
  });
}
function decodeAttribute(value) {
  return value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
function checkDocsLinks(root) {
  const siteRoot = path.resolve(root);
  const docsRoot = path.join(siteRoot, "docs");
  const problems = [], ids = new Map();
  let checked = 0;
  const pages = htmlFiles(docsRoot);
  function targetFile(pathname) {
    const decoded = decodeURIComponent(pathname);
    const resolved = path.resolve(siteRoot, "." + decoded);
    if (resolved !== siteRoot && !resolved.startsWith(siteRoot + path.sep)) return null;
    return [resolved, path.join(resolved, "index.html"), resolved + ".html"]
      .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  }
  function anchors(file) {
    if (!ids.has(file)) {
      const html = fs.readFileSync(file, "utf8");
      ids.set(file, new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => decodeAttribute(m[1]))));
    }
    return ids.get(file);
  }
  for (const page of pages) {
    const relative = path.relative(siteRoot, page).split(path.sep).join("/");
    const base = new URL(relative.replace(/index\.html$/, ""), "https://docs.invalid/");
    for (const match of fs.readFileSync(page, "utf8").matchAll(/\b(?:href|src)=["']([^"']*)["']/g)) {
      const href = decodeAttribute(match[1]);
      const url = new URL(href, base);
      if (url.origin !== base.origin) continue;
      checked++;
      const file = targetFile(url.pathname);
      if (!file) problems.push(`${relative}: missing target ${href}`);
      else if (url.hash && file.endsWith(".html") && !anchors(file).has(decodeURIComponent(url.hash.slice(1)))) {
        problems.push(`${relative}: missing anchor ${href}`);
      }
    }
  }
  return { pages: pages.length, checked, problems };
}

if (require.main === module) {
  try {
    const result = checkDocsLinks(process.argv[2] || path.resolve(__dirname, "../dist/web"));
    for (const problem of result.problems) console.error(problem);
    console.log(`[Zoidium] checked ${result.checked} local links across ${result.pages} documentation pages.`);
    if (result.problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(`[Zoidium] ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { checkDocsLinks };
