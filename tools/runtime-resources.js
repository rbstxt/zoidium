#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const defaultSourcePage =
  process.env.ZOIDIUM_CM3_SOURCE_PAGE ||
  "https://panzoid.com/legacy/gen3/clipmaker.html";
const defaultResourceCacheRoot = path.resolve(
  process.env.ZOIDIUM_RESOURCE_DIR || path.join(projectRoot, ".zoidium-resources")
);
const requestUserAgent = "Zoidium CM3 runtime staging/2.0";
const temporaryPrefix = "zoidium-runtime-";
const cacheTemporaryPrefix = ".zoidium-cache-";
const cacheMetadataName = ".zoidium-cache.json";
const cacheSchemaVersion = 5;
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

const packagedResourceEntries = [
  "index.html",
  "pz.all-35.css",
  "pz.icons29.svg",
  "fonts.png",
  "js",
  "effect",
  "material",
  "worker",
  "assets",
];

// These paths belong to Zoidium or to the stage itself. A CM3 response must
// never be allowed to replace them by writing a same-origin resource with a
// colliding path.
const protectedResourcePrefixes = [
  "index.html",
  cacheMetadataName,
  "404.html",
  "_headers",
  "_redirects",
  "about",
  "fonts",
  "plugins",
  "tools",
  "zoidium",
  "zoidium-welcome-tour.css",
  "zoidium-welcome-tour.js",
  "main.js",
  "package.json",
  "preload.js",
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

function resourceRootFor(sourcePageUrl) {
  const pageUrl = new URL(normalizeSourcePageUrl(sourcePageUrl));
  pageUrl.hash = "";
  pageUrl.search = "";
  pageUrl.pathname = pageUrl.pathname.replace(/[^/]*$/, "");
  return pageUrl.href;
}

function sourcePathFromUrl(value, baseUrl, resourceRoot) {
  let url;
  let root;
  try {
    url = new URL(value, baseUrl);
    root = new URL(resourceRoot);
  } catch (_error) {
    return null;
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== root.origin ||
    !url.pathname.startsWith(root.pathname)
  ) {
    const rootRelativePath = url.pathname.replace(/^\/+/, "");
    if (
      url.origin !== root.origin ||
      !/^(?:assets|effect|material|worker)\//i.test(rootRelativePath) &&
        !/^(?:pz\.icons29\.svg|fonts\.png|favicon\.ico)$/i.test(rootRelativePath)
    ) {
      return null;
    }
    // CM3 historically emits these paths from the site root even though the
    // runtime graph is served below the configured source page directory.
    // Keep the allowlist narrow and remap only known CM3 resource roots.
    url = new URL(rootRelativePath, root);
  }
  const relativePath = url.pathname.slice(root.pathname.length);
  if (!relativePath) return null;
  let sourcePath;
  try {
    sourcePath = normalizeResourcePath(relativePath);
  } catch (_error) {
    return null;
  }
  url.hash = "";
  return {
    sourcePath,
    url,
  };
}

function htmlAttributes(tag) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function addReference(references, value, baseUrl, sourcePageUrl, resourceRoot) {
  const referenceValue = String(value || "").trim();
  if (
    !referenceValue ||
    /^(?:data|blob|javascript|mailto):/i.test(referenceValue) ||
    /\/$/.test(referenceValue.split(/[?#]/, 1)[0])
  ) {
    return;
  }
  const resolved = sourcePathFromUrl(
    referenceValue,
    baseUrl,
    resourceRoot || resourceRootFor(sourcePageUrl)
  );
  if (!resolved) return;
  const { sourcePath, url } = resolved;
  if (isProtectedResourcePath(sourcePath)) {
    throw new Error(`CM3 resource collides with a Zoidium-owned path: ${sourcePath}`);
  }
  references.set(sourcePath, { sourcePath, url: url.href });
}

function discoverHtmlReferences(html, sourcePageUrl, resourceRoot) {
  const references = new Map();
  const baseUrl = normalizeHttpUrl(sourcePageUrl, "CM3 source page");
  for (const match of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    const rel = (attributes.rel || "").toLowerCase().split(/\s+/);
    if (
      rel.includes("stylesheet") ||
      rel.includes("icon") ||
      rel.includes("shortcut") ||
      rel.includes("modulepreload") ||
      (rel.includes("preload") &&
        /^(?:script|style|font|image|fetch)$/.test((attributes.as || "").toLowerCase()))
    ) {
      addReference(references, attributes.href, baseUrl, sourcePageUrl, resourceRoot);
    }
  }
  for (const match of String(html).matchAll(/<script\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    addReference(references, attributes.src, baseUrl, sourcePageUrl, resourceRoot);
  }
  return references;
}

function discoverTextReferences(
  source,
  baseUrl,
  sourcePageUrl,
  resourceRoot,
  { includeCssUrls = false, includeWorkerFiles = false } = {}
) {
  const references = new Map();
  const patterns = [
    /["'`]((?:\.\/|\.\.\/|\/)?(?:assets|effect|material|worker)\/[^"'`?#\s]+)["'`]/g,
    /["'`]((?:\.\/|\.\.\/|\/)?(?:pz\.icons29\.svg|fonts\.png|favicon\.ico))["'`]/g,
  ];
  if (includeCssUrls) {
    patterns.push(/url\(\s*["']?([^"')\s?#]+)["']?\s*\)/gi);
  }
  if (includeWorkerFiles) {
    patterns.push(/(?:importScripts|locateFile)\s*\(\s*["'`]([^"'`?#\s]+)["'`]/gi);
    patterns.push(/["'`]([a-zA-Z0-9_.-]+\.(?:wasm|data|mem))["'`]/gi);
  }
  for (const [marker, directory] of [
    ["PZ.ui.objectTypes.set(PZ.effect,[", "effect"],
    ["PZ.ui.objectTypes.set(PZ.material,[", "material"],
  ]) {
    const start = String(source).indexOf(marker);
    if (start < 0) continue;
    const end = String(source).indexOf("])" , start);
    const table = String(source).slice(start, end < 0 ? String(source).length : end);
    const typePattern = /type\s*:\s*["']([a-zA-Z0-9_-]+)["']/g;
    for (const match of table.matchAll(typePattern)) {
      addReference(
        references,
        `${directory}/${match[1]}.js`,
        baseUrl,
        sourcePageUrl,
        resourceRoot
      );
    }
  }

  for (const match of String(source).matchAll(
    /(?:this\.)?shaderfile\s*=\s*["'`]([^"'`]+)["'`]/g
  )) {
    addReference(
      references,
      `/assets/shaders/fragment/${match[1]}.glsl`,
      baseUrl,
      sourcePageUrl,
      resourceRoot
    );
  }

  for (const match of String(source).matchAll(
    /PZ\.asset\.font\.preset\s*=\s*\[([^\]]+)\]/g
  )) {
    for (const preset of match[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      addReference(
        references,
        `/assets/fonts/2d/${preset[1]}.ttf`,
        baseUrl,
        sourcePageUrl,
        resourceRoot
      );
    }
  }

  for (const match of String(source).matchAll(
    /presetTextures\s*(?:\(\s*\))?\s*\{\s*return\s*\[([^\]]+)\]/g
  )) {
    for (const preset of match[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      addReference(
        references,
        `/assets/textures/particles/${preset[1]}.png`,
        baseUrl,
        sourcePageUrl,
        resourceRoot
      );
    }
  }

  for (const pattern of patterns) {
    for (const match of String(source).matchAll(pattern)) {
      addReference(
        references,
        match[1],
        baseUrl,
        sourcePageUrl,
        resourceRoot
      );
    }
  }
  return references;
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

function getHeader(response, name) {
  return response && response.headers && typeof response.headers.get === "function"
    ? response.headers.get(name) || null
    : null;
}

async function fetchBytes(
  url,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = defaultFetchTimeoutMs,
    allowedOrigin = null,
  } = {}
) {
  const requestUrl = normalizeHttpUrl(url, "CM3 resource");
  const timeout = normalizePositiveInteger(timeoutMs, "fetch timeout");
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime does not provide fetch() for CM3 resources");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(requestUrl, {
      headers: {
        accept: "*/*",
        "user-agent": requestUserAgent,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response || !response.ok) {
      throw new Error(`HTTP ${response ? response.status : "unknown"} for ${requestUrl}`);
    }

    const finalUrl = normalizeHttpUrl(
      response.url || requestUrl,
      "CM3 resource response"
    );
    const finalOrigin = new URL(finalUrl).origin;
    if (allowedOrigin && finalOrigin !== allowedOrigin) {
      throw new Error(
        `CM3 resource redirect crossed origin boundary: ${requestUrl} -> ${finalUrl}`
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: getHeader(response, "content-type"),
      etag: getHeader(response, "etag"),
      finalUrl,
      lastModified: getHeader(response, "last-modified"),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out fetching CM3 resource after ${timeout} ms: ${requestUrl}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function writeStageFile(stageRoot, relativePath, contents) {
  const destination = safeStagePath(stageRoot, relativePath);
  await assertNoSymlinkComponents(stageRoot, destination);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, contents);
}

async function writeResource(stageRoot, sourcePath, bytes) {
  const normalized = assertFetchedResourcePath(sourcePath);
  await writeStageFile(stageRoot, normalized, bytes);
}

function isScriptPath(sourcePath) {
  return /\.m?js$/i.test(sourcePath);
}

function isStylesheetPath(sourcePath) {
  return /\.css$/i.test(sourcePath);
}

function normalizeFetchConcurrency(value) {
  return normalizePositiveInteger(value, "fetch concurrency", {
    maximum: maximumFetchConcurrency,
  });
}

function runConcurrentQueue(items, concurrency, task) {
  const workerCount = normalizeFetchConcurrency(concurrency);
  let cursor = 0;
  let active = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    const pump = () => {
      if (settled) return;
      while (active < workerCount && cursor < items.length) {
        const item = items[cursor++];
        active += 1;
        Promise.resolve()
          .then(() => task(item))
          .then(() => {
            active -= 1;
            if (settled) return;
            if (active === 0 && cursor >= items.length) {
              settled = true;
              resolve();
              return;
            }
            pump();
          })
          .catch((error) => {
            active -= 1;
            if (settled) return;
            settled = true;
            reject(error);
          });
      }
      if (!settled && active === 0 && cursor >= items.length) {
        settled = true;
        resolve();
      }
    };

    pump();
  });
}

async function fetchResourceGraph({
  stageRoot,
  sourcePageUrl,
  sourceBaseUrl = sourcePageUrl,
  sourceHtml,
  fetchImpl = globalThis.fetch,
  fetchTimeoutMs = defaultFetchTimeoutMs,
  concurrency = defaultFetchConcurrency,
}) {
  const normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl);
  const normalizedBaseUrl = normalizeHttpUrl(sourceBaseUrl, "CM3 source page");
  const sourceOrigin = new URL(normalizedSourcePageUrl).origin;
  if (new URL(normalizedBaseUrl).origin !== sourceOrigin) {
    throw new Error("CM3 source page and final response must share an origin");
  }
  const resourceRoot = resourceRootFor(normalizedSourcePageUrl);
  const resolvedStageRoot = await assertStageRootSafe(stageRoot);
  const references = discoverHtmlReferences(
    sourceHtml,
    normalizedBaseUrl,
    resourceRoot
  );
  const pending = Array.from(references.values());
  const fetched = new Map();

  await runConcurrentQueue(pending, concurrency, async (reference) => {
    const sourcePath = assertFetchedResourcePath(reference.sourcePath);
    if (fetched.has(sourcePath)) return;

    let response;
    try {
      response = await fetchBytes(reference.url, {
        allowedOrigin: sourceOrigin,
        fetchImpl,
        timeoutMs: fetchTimeoutMs,
      });
    } catch (error) {
      throw new Error(
        `Failed to fetch CM3 resource ${sourcePath} from ${reference.url}: ${error.message}`,
        { cause: error }
      );
    }

    const finalReference = sourcePathFromUrl(
      response.finalUrl,
      normalizedSourcePageUrl,
      resourceRoot
    );
    if (!finalReference) {
      throw new Error(
        `CM3 resource redirect left the configured source directory: ${reference.url} -> ${response.finalUrl}`
      );
    }

    fetched.set(sourcePath, {
      ...reference,
      ...response,
      sourcePath,
      url: response.finalUrl,
    });
    await writeResource(resolvedStageRoot, sourcePath, response.bytes);

    if (isScriptPath(sourcePath) || isStylesheetPath(sourcePath)) {
      const text = response.bytes.toString("utf8");
      const discovered = discoverTextReferences(
        text,
        response.finalUrl,
        normalizedSourcePageUrl,
        resourceRoot,
        {
          includeCssUrls: isStylesheetPath(sourcePath),
          includeWorkerFiles: sourcePath.startsWith("worker/"),
        }
      );
      for (const candidate of discovered.values()) {
        if (!references.has(candidate.sourcePath)) {
          references.set(candidate.sourcePath, candidate);
          pending.push(candidate);
        }
      }
    }
  });

  return {
    resourceRoot,
    resources: Array.from(fetched.values()).sort((a, b) =>
      a.sourcePath.localeCompare(b.sourcePath, "en")
    ),
  };
}

function insertBeforeFirst(html, pattern, content, label) {
  pattern.lastIndex = 0;
  const match = pattern.exec(html);
  if (!match) throw new Error(`CM3 source page has no ${label} script tag`);
  return `${html.slice(0, match.index)}${content}\n${html.slice(match.index)}`;
}

function patchIndexHtml(sourceHtml) {
  let html = String(sourceHtml);
  const originalHtml = html;

  html = html.replace(
    /<link\b[^>]*href=["']https:\/\/fonts\.googleapis\.com\/[^"']*["'][^>]*>\s*/gi,
    ""
  );
  html = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>Zoidium · CM3 Extension Tools</title>"
  );

  const initCallPattern = /PZ\.ui\.ads\.init\s*\(\s*\)\s*;?|\binitTool\s*\(\s*\)\s*;?/gi;
  initCallPattern.lastIndex = 0;
  if (!initCallPattern.test(html)) {
    throw new Error("CM3 source page has no initTool() call to defer");
  }
  initCallPattern.lastIndex = 0;
  html = html.replace(initCallPattern, "");

  const headBootstrap = [
    "<!-- Zoidium extension bootstrap; CM3 files are staged outside the repository. -->",
    '<script src="./zoidium/runtime-config.js"></script>',
    '<script src="./zoidium/runtime-policy.js"></script>',
  ].join("\n");
  html = insertBeforeFirst(
    html,
    /<script\b[^>]*src=["'][^"']*core-[^"']+\.js[^"']*["'][^>]*>\s*<\/script>/i,
    headBootstrap,
    "core runtime"
  );

  const loaderTag = '<script src="./zoidium/runtime-loader.js"></script>';
  const clipmakerPattern = /<script\b[^>]*src=["'][^"']*clipmaker-[^"']+\.js[^"']*["'][^>]*>\s*<\/script>/i;
  clipmakerPattern.lastIndex = 0;
  const clipmakerMatch = clipmakerPattern.exec(html);
  if (!clipmakerMatch) throw new Error("CM3 source page has no Clipmaker script tag");
  const clipmakerEnd = clipmakerMatch.index + clipmakerMatch[0].length;
  html = `${html.slice(0, clipmakerEnd)}\n${loaderTag}${html.slice(clipmakerEnd)}`;

  if (html === originalHtml) throw new Error("CM3 source page patch made no changes");
  return html;
}

async function copyPath(stageRoot, source, destination, { required = true } = {}) {
  let sourceStat;
  try {
    sourceStat = await fs.promises.lstat(source);
  } catch (error) {
    if (error.code === "ENOENT" && !required) return false;
    throw error;
  }
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Project runtime entry must not be a symbolic link: ${source}`);
  }
  await assertNoSymlinksRecursively(source);
  await assertNoSymlinkComponents(stageRoot, destination);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.cp(source, destination, {
    dereference: false,
    force: true,
    recursive: sourceStat.isDirectory(),
  });
  await assertNoSymlinksRecursively(destination);
  return true;
}

async function copyEntry(stageRoot, relativePath, { required = true } = {}) {
  const normalized = normalizeResourcePath(relativePath);
  const source = path.resolve(projectRoot, ...normalized.split("/"));
  if (!isPathInside(projectRoot, source)) {
    throw new Error(`Project runtime entry escapes the repository: ${relativePath}`);
  }
  const destination = safeStagePath(stageRoot, normalized);
  return copyPath(stageRoot, source, destination, { required });
}

async function readProjectJson(relativePath) {
  const normalized = normalizeResourcePath(relativePath);
  const filePath = path.resolve(projectRoot, ...normalized.split("/"));
  if (!isPathInside(projectRoot, filePath)) {
    throw new Error(`Project JSON path escapes the repository: ${relativePath}`);
  }
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

async function copyPluginRuntime(stageRoot) {
  for (const entry of [
    "plugins/registry.json",
    "plugins/plugin-manager.js",
    "plugins/plugin-manager.css",
    "plugins/core-patches",
  ]) {
    await copyEntry(stageRoot, entry, { required: true });
  }

  const registry = await readProjectJson("plugins/registry.json");
  if (!registry || !Array.isArray(registry.plugins)) {
    throw new Error("plugins/registry.json has no plugins array");
  }
  const copiedBundles = new Set();
  for (const plugin of registry.plugins) {
    if (!plugin || typeof plugin.bundle !== "string") {
      throw new Error("Every registered plugin must declare a bundle path");
    }
    const bundlePath = normalizeResourcePath(plugin.bundle);
    if (!/^plugins\/[^/]+\/bundle\.json$/.test(bundlePath)) {
      throw new Error(`Invalid registered plugin bundle path: ${plugin.bundle}`);
    }
    if (copiedBundles.has(bundlePath)) {
      throw new Error(`Duplicate registered plugin bundle path: ${bundlePath}`);
    }
    copiedBundles.add(bundlePath);
    await copyEntry(stageRoot, bundlePath, { required: true });
  }
}

async function copyProjectFiles(stageRoot, { includeElectronFiles = false } = {}) {
  const resolvedStageRoot = await assertStageRootSafe(stageRoot);
  for (const entry of commonProjectEntries) {
    await copyEntry(resolvedStageRoot, entry, { required: true });
  }
  await copyPluginRuntime(resolvedStageRoot);
  if (!includeElectronFiles) return;
  for (const entry of ["main.js", "package.json", "preload.js"]) {
    await copyEntry(resolvedStageRoot, entry, { required: true });
  }
  await copyEntry(resolvedStageRoot, "tools/runtime-resources.js", { required: true });
}

function cleanupStage(stageRoot) {
  if (!stageRoot) return Promise.resolve();
  return fs.promises.rm(stageRoot, { force: true, recursive: true });
}

function stageResultFromMetadata(metadata, root, cached) {
  return {
    cached: Boolean(cached),
    cleanup: () => Promise.resolve(),
    page: metadata.page,
    resourceRoot: metadata.resourceRoot,
    resources: metadata.resources,
    root,
  };
}

function assertPageResponseWithinRoot(pageUrl, sourcePageUrl) {
  const resourceRoot = resourceRootFor(sourcePageUrl);
  if (!sourcePathFromUrl(pageUrl, sourcePageUrl, resourceRoot)) {
    throw new Error(
      `CM3 source page redirect left the configured source directory: ${sourcePageUrl} -> ${pageUrl}`
    );
  }
}

async function buildResourceStage(
  stageRoot,
  sourcePageUrl,
  { fetchImpl = globalThis.fetch, fetchTimeoutMs = defaultFetchTimeoutMs, concurrency = defaultFetchConcurrency } = {}
) {
  const resolvedStageRoot = await assertStageRootSafe(stageRoot);
  const normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl);
  const sourceOrigin = new URL(normalizedSourcePageUrl).origin;
  await fs.promises.mkdir(resolvedStageRoot, { recursive: true });
  await copyProjectFiles(resolvedStageRoot);

  const pageResponse = await fetchBytes(normalizedSourcePageUrl, {
    allowedOrigin: sourceOrigin,
    fetchImpl,
    timeoutMs: fetchTimeoutMs,
  });
  assertPageResponseWithinRoot(pageResponse.finalUrl, normalizedSourcePageUrl);
  const sourceHtml = pageResponse.bytes.toString("utf8");
  const patchedHtml = patchIndexHtml(sourceHtml);
  const graph = await fetchResourceGraph({
    concurrency,
    fetchImpl,
    fetchTimeoutMs,
    sourceBaseUrl: pageResponse.finalUrl,
    sourceHtml,
    sourcePageUrl: normalizedSourcePageUrl,
    stageRoot: resolvedStageRoot,
  });
  const indexBytes = Buffer.from(patchedHtml, "utf8");
  await writeStageFile(resolvedStageRoot, "index.html", indexBytes);

  const metadata = {
    generatedAt: new Date().toISOString(),
    index: {
      bytes: indexBytes.length,
      sha256: sha256(indexBytes),
    },
    page: {
      bytes: pageResponse.bytes.length,
      sha256: sha256(pageResponse.bytes),
      url: pageResponse.finalUrl,
    },
    resourceRoot: graph.resourceRoot,
    resources: graph.resources.map((resource) => ({
      bytes: resource.bytes.length,
      contentType: resource.contentType,
      etag: resource.etag,
      lastModified: resource.lastModified,
      sha256: sha256(resource.bytes),
      sourcePath: resource.sourcePath,
      url: resource.url,
    })),
    schemaVersion: cacheSchemaVersion,
    sourcePageUrl: normalizedSourcePageUrl,
  };
  await writeStageFile(
    resolvedStageRoot,
    cacheMetadataName,
    `${JSON.stringify(metadata, null, 2)}\n`
  );
  return metadata;
}

function cacheInspection(valid, reason, metadata = null) {
  return { valid, reason, metadata };
}

async function readRegularFile(root, relativePath) {
  const filePath = safeStagePath(root, relativePath);
  let stat;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing cache file: ${relativePath}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Cache entry is not a regular file: ${relativePath}`);
  }
  return { filePath, stat };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

async function inspectResourceCache({
  cacheRoot = defaultResourceCacheRoot,
  sourcePageUrl = defaultSourcePage,
  verifyHashes = true,
} = {}) {
  let resolvedCacheRoot;
  let normalizedSourcePageUrl;
  try {
    resolvedCacheRoot = assertSafeDirectoryTarget(cacheRoot, "CM3 resource cache");
    normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl);
    await assertExistingDirectory(resolvedCacheRoot, "CM3 resource cache");
    await readRegularFile(resolvedCacheRoot, cacheMetadataName);
  } catch (error) {
    if (error.code === "ENOENT") {
      return cacheInspection(false, "CM3 resource cache is missing");
    }
    return cacheInspection(false, error.message);
  }

  try {
    const metadataPath = safeStagePath(resolvedCacheRoot, cacheMetadataName);
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
    const expectedResourceRoot = resourceRootFor(normalizedSourcePageUrl);
    if (metadata.schemaVersion !== cacheSchemaVersion) {
      return cacheInspection(false, "CM3 resource cache schema is outdated");
    }
    if (metadata.sourcePageUrl !== normalizedSourcePageUrl) {
      return cacheInspection(false, "CM3 resource cache source page does not match");
    }
    if (metadata.resourceRoot !== expectedResourceRoot) {
      return cacheInspection(false, "CM3 resource cache root does not match");
    }
    if (
      !metadata.page ||
      !Number.isInteger(metadata.page.bytes) ||
      !isSha256(metadata.page.sha256) ||
      !metadata.index ||
      !Number.isInteger(metadata.index.bytes) ||
      !isSha256(metadata.index.sha256) ||
      !Array.isArray(metadata.resources)
    ) {
      return cacheInspection(false, "CM3 resource cache metadata is incomplete");
    }

    const index = await readRegularFile(resolvedCacheRoot, "index.html");
    if (index.stat.size !== metadata.index.bytes) {
      return cacheInspection(false, "Cached index.html size does not match metadata");
    }
    if (verifyHashes) {
      const indexBytes = await fs.promises.readFile(index.filePath);
      if (sha256(indexBytes) !== metadata.index.sha256) {
        return cacheInspection(false, "Cached index.html hash does not match metadata");
      }
    }

    const paths = new Set();
    const sourceOrigin = new URL(normalizedSourcePageUrl).origin;
    for (const resource of metadata.resources) {
      if (
        !resource ||
        typeof resource.sourcePath !== "string" ||
        resource.sourcePath !== normalizeResourcePath(resource.sourcePath) ||
        !Number.isInteger(resource.bytes) ||
        resource.bytes < 0 ||
        !isSha256(resource.sha256) ||
        typeof resource.url !== "string"
      ) {
        return cacheInspection(false, "CM3 resource cache contains invalid metadata");
      }
      const sourcePath = assertFetchedResourcePath(resource.sourcePath);
      if (paths.has(sourcePath)) {
        return cacheInspection(false, `Duplicate CM3 resource path: ${sourcePath}`);
      }
      paths.add(sourcePath);

      const resourceUrl = normalizeHttpUrl(resource.url, "CM3 resource metadata");
      if (new URL(resourceUrl).origin !== sourceOrigin) {
        return cacheInspection(false, `CM3 resource metadata crossed origin boundary: ${sourcePath}`);
      }
      if (!sourcePathFromUrl(resourceUrl, normalizedSourcePageUrl, expectedResourceRoot)) {
        return cacheInspection(false, `CM3 resource metadata left source directory: ${sourcePath}`);
      }

      const cachedResource = await readRegularFile(resolvedCacheRoot, sourcePath);
      if (cachedResource.stat.size !== resource.bytes) {
        return cacheInspection(false, `Cached resource size does not match metadata: ${sourcePath}`);
      }
      if (verifyHashes) {
        const resourceBytes = await fs.promises.readFile(cachedResource.filePath);
        if (sha256(resourceBytes) !== resource.sha256) {
          return cacheInspection(false, `Cached resource hash does not match metadata: ${sourcePath}`);
        }
      }
    }
    return cacheInspection(true, "CM3 resource cache is valid", metadata);
  } catch (error) {
    return cacheInspection(false, error.message);
  }
}

async function readCacheMetadata(cacheRoot, sourcePageUrl) {
  const inspection = await inspectResourceCache({ cacheRoot, sourcePageUrl });
  return inspection.valid ? inspection.metadata : null;
}

async function removeStageEntry(stageRoot, relativePath) {
  const destination = safeStagePath(stageRoot, relativePath);
  await assertNoSymlinkComponents(stageRoot, destination);
  await fs.promises.rm(destination, { force: true, recursive: true });
}

async function refreshCachedProjectFiles(cacheRoot) {
  for (const entry of commonProjectEntries) {
    await removeStageEntry(cacheRoot, entry);
  }
  await removeStageEntry(cacheRoot, "plugins");
  await copyProjectFiles(cacheRoot);
}

async function copyCachedRuntime(cacheRoot, destinationRoot, metadata) {
  const resolvedCacheRoot = await assertStageRootSafe(cacheRoot);
  const resolvedDestinationRoot = await assertStageRootSafe(destinationRoot);
  await fs.promises.mkdir(resolvedDestinationRoot, { recursive: true });

  const entries = ["index.html", ...metadata.resources.map((resource) => resource.sourcePath)];
  for (const entry of entries) {
    const source = safeStagePath(resolvedCacheRoot, entry);
    const destination = safeStagePath(resolvedDestinationRoot, entry);
    await copyPath(resolvedDestinationRoot, source, destination, { required: true });
  }
}

async function replaceDirectoryAtomically(sourceRoot, destinationRoot) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedDestinationRoot = path.resolve(destinationRoot);
  const parent = path.dirname(resolvedDestinationRoot);
  await fs.promises.mkdir(parent, { recursive: true });
  const backupRoot = path.join(
    parent,
    `.${path.basename(resolvedDestinationRoot)}.backup-${process.pid}-${Date.now()}-${crypto
      .randomBytes(6)
      .toString("hex")}`
  );
  let oldMoved = false;
  let newMoved = false;
  try {
    if (pathExists(resolvedDestinationRoot)) {
      await assertExistingDirectory(resolvedDestinationRoot, "CM3 resource cache");
      await fs.promises.rename(resolvedDestinationRoot, backupRoot);
      oldMoved = true;
    }
    await fs.promises.rename(resolvedSourceRoot, resolvedDestinationRoot);
    newMoved = true;
  } catch (error) {
    if (oldMoved && !newMoved && !pathExists(resolvedDestinationRoot)) {
      await fs.promises.rename(backupRoot, resolvedDestinationRoot).catch(() => {});
    }
    throw error;
  } finally {
    if (oldMoved && newMoved) {
      await fs.promises.rm(backupRoot, { force: true, recursive: true }).catch((error) => {
        console.warn(`[Zoidium] could not remove the previous CM3 cache: ${error.message}`);
      });
    }
  }
}

async function ensureResourceCache({
  cacheRoot = defaultResourceCacheRoot,
  force = false,
  offline = false,
  sourcePageUrl = defaultSourcePage,
  fetchImpl = globalThis.fetch,
  fetchTimeoutMs = defaultFetchTimeoutMs,
  concurrency = defaultFetchConcurrency,
} = {}) {
  if (force && offline) {
    throw new Error("--offline cannot be combined with --setup or --refresh");
  }
  const normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl);
  const resolvedCacheRoot = await assertCacheRootSafe(cacheRoot);
  if (!force) {
    const inspection = await inspectResourceCache({
      cacheRoot: resolvedCacheRoot,
      sourcePageUrl: normalizedSourcePageUrl,
    });
    if (inspection.valid) {
      await refreshCachedProjectFiles(resolvedCacheRoot);
      return stageResultFromMetadata(inspection.metadata, resolvedCacheRoot, true);
    }
    if (offline) {
      throw new Error(`CM3 resource cache is unavailable offline: ${inspection.reason}`);
    }
    console.warn(`[Zoidium] rebuilding CM3 resource cache: ${inspection.reason}`);
  } else if (offline) {
    throw new Error("--offline cannot be combined with --setup or --refresh");
  }

  const cacheParent = path.dirname(resolvedCacheRoot);
  await fs.promises.mkdir(cacheParent, { recursive: true });
  const temporaryStage = await fs.promises.mkdtemp(
    path.join(cacheParent, cacheTemporaryPrefix)
  );
  try {
    const metadata = await buildResourceStage(temporaryStage, normalizedSourcePageUrl, {
      concurrency,
      fetchImpl,
      fetchTimeoutMs,
    });
    await replaceDirectoryAtomically(temporaryStage, resolvedCacheRoot);
    return stageResultFromMetadata(metadata, resolvedCacheRoot, false);
  } finally {
    await cleanupStage(temporaryStage).catch(() => {});
  }
}

async function prepareRuntimeStage({
  cacheRoot = defaultResourceCacheRoot,
  destinationRoot = null,
  includeElectronFiles = false,
  sourcePageUrl = defaultSourcePage,
  offline = false,
  fetchImpl = globalThis.fetch,
  fetchTimeoutMs = defaultFetchTimeoutMs,
  concurrency = defaultFetchConcurrency,
} = {}) {
  const cache = await ensureResourceCache({
    cacheRoot,
    concurrency,
    fetchImpl,
    fetchTimeoutMs,
    offline,
    sourcePageUrl,
  });
  if (destinationRoot == null) return cache;

  const stageRoot = await assertStageRootSafe(destinationRoot);
  if (stageRoot !== cache.root) {
    await copyCachedRuntime(cache.root, stageRoot, cache);
  }
  await copyProjectFiles(stageRoot, { includeElectronFiles });
  return { ...cache, root: stageRoot };
}

async function preparePackagedStage() {
  const stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  try {
    const resolvedStageRoot = await assertStageRootSafe(stageRoot);
    await fs.promises.mkdir(resolvedStageRoot, { recursive: true });
    await copyProjectFiles(resolvedStageRoot);
    for (const entry of packagedResourceEntries) {
      await copyEntry(resolvedStageRoot, entry, { required: false });
    }
    return {
      cleanup: () => cleanupStage(resolvedStageRoot),
      root: resolvedStageRoot,
    };
  } catch (error) {
    await cleanupStage(stageRoot).catch(() => {});
    throw error;
  }
}

function parseCliArgs(argumentsList) {
  const options = {
    electron: false,
    offline: false,
    refresh: false,
    setup: false,
  };
  for (const argument of argumentsList) {
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--electron") options.electron = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument === "--setup") options.setup = true;
    else if (argument.startsWith("--output=")) options.output = argument.slice(9);
    else if (argument.startsWith("--source=")) options.source = argument.slice(9);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.refresh) options.setup = true;
  if (options.setup && options.output) {
    throw new Error("--setup/--refresh cannot be combined with --output");
  }
  if (options.setup && options.electron) {
    throw new Error("--setup/--refresh cannot be combined with --electron");
  }
  if (options.setup && options.offline) {
    throw new Error("--offline cannot be combined with --setup or --refresh");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/runtime-resources.js [options]

Fetches the configured CM3 source page into the Git-ignored runtime cache,
or copies that cache into a disposable runtime/deployment stage.

Options:
  --setup, --refresh    refresh the local CM3 resource cache
  --offline             require a valid existing cache and do not fetch
  --output=<directory>  copy the cache into this runtime stage
  --electron            include Electron entry files in the output stage
  --source=<url>        override ZOIDIUM_CM3_SOURCE_PAGE
  --help                show this help
`);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sourcePageUrl = options.source || defaultSourcePage;
  if (options.setup) {
    const result = await ensureResourceCache({
      force: true,
      sourcePageUrl,
    });
    console.log(
      `[Zoidium] CM3 resource cache ready at ${result.root} (${result.resources.length} resources)`
    );
    return;
  }

  const result = await prepareRuntimeStage({
    destinationRoot: options.output || null,
    includeElectronFiles: options.electron,
    offline: options.offline,
    sourcePageUrl,
  });
  console.log(
    `[Zoidium] CM3 runtime available at ${result.root} (${result.resources.length} resources)`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Zoidium] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  cacheMetadataName,
  cacheSchemaVersion,
  defaultFetchTimeoutMs,
  defaultResourceCacheRoot,
  defaultSourcePage,
  discoverHtmlReferences,
  discoverTextReferences,
  ensureResourceCache,
  fetchResourceGraph,
  inspectResourceCache,
  normalizeResourcePath,
  normalizeSourcePageUrl,
  patchIndexHtml,
  preparePackagedStage,
  prepareRuntimeStage,
  projectRoot,
  resourceRootFor,
  safeStagePath,
};
