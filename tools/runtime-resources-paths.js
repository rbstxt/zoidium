"use strict";

// Safety primitives for CM3 resource paths, URLs, and stage directories.
// No dependencies inside the runtime-resources family.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const defaultSourcePage =
  process.env.ZOIDIUM_CM3_SOURCE_PAGE ||
  "https://panzoid.com/legacy/gen3/clipmaker.html";
const defaultVideoEditorSourcePage =
  process.env.ZOIDIUM_VIDEO_EDITOR_SOURCE_PAGE ||
  "https://panzoid.com/legacy/gen3/videoeditor.html";
const defaultResourceCacheRoot = path.resolve(
  process.env.ZOIDIUM_RESOURCE_DIR || path.join(projectRoot, ".zoidium-resources")
);
const requestUserAgent = "Zoidium CM3 runtime staging/2.0";
const temporaryPrefix = "zoidium-runtime-";
const cacheTemporaryPrefix = ".zoidium-cache-";
const cacheMetadataName = ".zoidium-cache.json";
const runtimeProfilesName = "zoidium-runtime-profiles.js";
const cacheSchemaVersion = 6;
const defaultFetchTimeoutMs = 30_000;
const defaultFetchConcurrency = 8;
const maximumFetchConcurrency = 32;

const commonProjectEntries = [
  "404.html",
  "_headers",
  "_redirects",
  "about",
  "fonts",
  "zoidium",
  "zoidium-welcome-tour.css",
  "zoidium-welcome-tour.js",
];

// These paths belong to Zoidium or to the stage itself. A CM3 response must
// never be allowed to replace them by writing a same-origin resource with a
// colliding path.
const protectedResourcePrefixes = [
  "index.html",
  ".zoidium-source",
  cacheMetadataName,
  runtimeProfilesName,
  "404.html",
  "_headers",
  "_redirects",
  "about",
  "fonts",
  "plugins",
  "tools",
  "zoidium",
  "desktop",
  "zoidium-welcome-tour.css",
  "zoidium-welcome-tour.js",
  "package.json",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizePositiveInteger(value, label, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > maximum) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return number;
}

function normalizeSourcePageUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (_error) {
    throw new Error(`Invalid CM3 source page URL: ${value}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`CM3 source page must use HTTP(S): ${value}`);
  }
  if (url.username || url.password) {
    throw new Error("CM3 source page URLs must not contain credentials");
  }
  url.hash = "";
  return url.href;
}

function normalizeHttpUrl(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch (_error) {
    throw new Error(`Invalid ${label || "HTTP"} URL: ${value}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`${label || "HTTP"} URL must use HTTP(S): ${value}`);
  }
  if (url.username || url.password) {
    throw new Error(`${label || "HTTP"} URLs must not contain credentials`);
  }
  url.hash = "";
  return url.href;
}

function normalizeResourcePath(value) {
  const rawValue = String(value || "").split(/[?#]/, 1)[0];
  let normalized;
  try {
    normalized = decodeURIComponent(rawValue);
  } catch (_error) {
    throw new Error(`Invalid encoded CM3 resource path: ${value}`);
  }
  normalized = normalized
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  normalized = path.posix.normalize(normalized);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Invalid CM3 resource path: ${value}`);
  }
  return normalized;
}

function safeStagePath(stageRoot, relativePath) {
  const resolvedRoot = path.resolve(stageRoot);
  const normalized = normalizeResourcePath(relativePath);
  const absolute = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relative = path.relative(resolvedRoot, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`CM3 resource escapes the runtime stage: ${relativePath}`);
  }
  return absolute;
}

function isPathInside(parent, candidate) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertSafeDirectoryTarget(directory, label) {
  const resolved = path.resolve(directory);
  const filesystemRoot = path.parse(resolved).root;
  const homeRoot = path.resolve(os.homedir());
  if (
    resolved === filesystemRoot ||
    resolved === homeRoot ||
    resolved === projectRoot
  ) {
    throw new Error(`${label} is too broad: ${resolved}`);
  }

  // The project itself must never be inside a directory that this helper may
  // replace or populate wholesale. Children of the project, such as
  // .zoidium-resources and dist/web, remain valid targets.
  const projectRelative = path.relative(resolved, projectRoot);
  if (
    projectRelative !== "" &&
    projectRelative !== ".." &&
    !projectRelative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(projectRelative)
  ) {
    throw new Error(`${label} cannot contain the project root: ${resolved}`);
  }
  return resolved;
}

async function assertExistingDirectory(target, label) {
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not be a symbolic link: ${target}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must be a directory: ${target}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}

async function assertCacheRootSafe(cacheRoot) {
  const resolved = assertSafeDirectoryTarget(cacheRoot, "CM3 resource cache");
  try {
    const stat = await fs.promises.lstat(resolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`CM3 resource cache must not be a symbolic link: ${resolved}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`CM3 resource cache must be a directory: ${resolved}`);
    }

    const entries = await fs.promises.readdir(resolved);
    if (entries.length > 0) {
      const metadataPath = path.join(resolved, cacheMetadataName);
      let metadataStat;
      try {
        metadataStat = await fs.promises.lstat(metadataPath);
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(
            `Refusing to replace a non-cache directory: ${resolved}`
          );
        }
        throw error;
      }
      if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) {
        throw new Error(
          `CM3 resource cache metadata must be a regular file: ${metadataPath}`
        );
      }
    }
  } catch (error) {
    if (error.code === "ENOENT") return resolved;
    throw error;
  }
  return resolved;
}

async function assertStageRootSafe(stageRoot) {
  const resolved = assertSafeDirectoryTarget(stageRoot, "Runtime stage");
  await assertExistingDirectory(resolved, "Runtime stage");
  return resolved;
}

async function assertNoSymlinkComponents(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes the runtime stage: ${target}`);
  }

  let current = resolvedRoot;
  const parts = relative ? relative.split(path.sep) : [];
  for (const part of ["", ...parts]) {
    if (part) current = path.join(current, part);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Runtime stage path must not contain a symbolic link: ${current}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertNoSymlinksRecursively(target) {
  let stat;
  try {
    stat = await fs.promises.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Runtime stage entry must not be a symbolic link: ${target}`);
  }
  if (!stat.isDirectory()) return;
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Runtime stage entry must not be a symbolic link: ${child}`);
    }
    if (entry.isDirectory()) await assertNoSymlinksRecursively(child);
  }
}

function isProtectedResourcePath(sourcePath) {
  let normalized;
  try {
    normalized = normalizeResourcePath(sourcePath);
  } catch (_error) {
    return true;
  }
  return protectedResourcePrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function assertFetchedResourcePath(sourcePath) {
  const normalized = normalizeResourcePath(sourcePath);
  if (isProtectedResourcePath(normalized)) {
    throw new Error(`CM3 resource collides with a Zoidium-owned path: ${sourcePath}`);
  }
  return normalized;
}

module.exports = {
  assertCacheRootSafe,
  assertExistingDirectory,
  assertFetchedResourcePath,
  assertSafeDirectoryTarget,
  assertNoSymlinkComponents,
  assertNoSymlinksRecursively,
  assertStageRootSafe,
  cacheMetadataName,
  cacheSchemaVersion,
  cacheTemporaryPrefix,
  commonProjectEntries,
  defaultFetchConcurrency,
  defaultFetchTimeoutMs,
  defaultResourceCacheRoot,
  defaultSourcePage,
  defaultVideoEditorSourcePage,
  isPathInside,
  isProtectedResourcePath,
  maximumFetchConcurrency,
  normalizeHttpUrl,
  normalizePositiveInteger,
  normalizeResourcePath,
  normalizeSourcePageUrl,
  pathExists,
  projectRoot,
  protectedResourcePrefixes,
  requestUserAgent,
  runtimeProfilesName,
  safeStagePath,
  sha256,
  temporaryPrefix,
};
