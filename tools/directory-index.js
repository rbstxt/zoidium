#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

// Static hosts such as Cloudflare Pages resolve directory-style URLs to the
// index.html inside them. serve-handler only performs that resolution when
// cleanUrls is enabled, which the local servers cannot always enable because
// it rewrites requests for CM3 .html assets. This helper performs the same
// resolution for both local servers so navigation matches production.
async function resolveDirectoryIndexUrl(requestUrl, stageRoot) {
  if (typeof requestUrl !== "string" || requestUrl.length === 0) return null;

  let parsed;
  try {
    parsed = new URL(requestUrl, "http://zoidium.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://zoidium.invalid") return null;

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (decodedPathname.includes("\u0000")) return null;

  const stageRootResolved = path.resolve(stageRoot);
  const trimmed = decodedPathname.replace(/\/+$/, "");
  const candidate = path.resolve(stageRootResolved, "." + trimmed + "/index.html");
  if (!candidate.startsWith(stageRootResolved + path.sep)) return null;

  try {
    const stats = await fs.promises.stat(candidate);
    if (!stats.isFile()) return null;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }

  const rawTrimmed = parsed.pathname.replace(/\/+$/, "");
  return rawTrimmed + "/index.html" + (parsed.search || "");
}

module.exports = { resolveDirectoryIndexUrl };

