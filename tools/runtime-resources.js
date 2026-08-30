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
const requestUserAgent = "Zoidium CM3 runtime staging/1.0";
const temporaryPrefix = "zoidium-runtime-";
const cacheMetadataName = ".zoidium-cache.json";
const cacheSchemaVersion = 2;

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

function normalizeResourcePath(value) {
  let normalized;
  try {
    normalized = decodeURIComponent(String(value || ""));
  } catch (_error) {
    throw new Error(`Invalid encoded CM3 resource path: ${value}`);
  }
  normalized = normalized
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  normalized = path.posix.normalize(normalized);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Invalid CM3 resource path: ${value}`);
  }
  return normalized;
}

function safeStagePath(stageRoot, relativePath) {
  const normalized = normalizeResourcePath(relativePath);
  const absolute = path.resolve(stageRoot, normalized);
  if (absolute !== stageRoot && !absolute.startsWith(`${stageRoot}${path.sep}`)) {
    throw new Error(`CM3 resource escapes the runtime stage: ${relativePath}`);
  }
  return absolute;
}

function resourceRootFor(sourcePageUrl) {
  const pageUrl = new URL(sourcePageUrl);
  pageUrl.hash = "";
  pageUrl.search = "";
  pageUrl.pathname = pageUrl.pathname.replace(/[^/]*$/, "");
  return pageUrl.href;
}

function sourcePathFromUrl(value, baseUrl, resourceRoot) {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch (_error) {
    return null;
  }
  const root = new URL(resourceRoot);
  if (url.origin !== root.origin) return null;
  if (url.pathname.startsWith(root.pathname)) {
    return {
      sourcePath: normalizeResourcePath(url.pathname.slice(root.pathname.length)),
      url,
    };
  }

  const rootRelativePath = url.pathname.replace(/^\/+/, "");
  if (
    !/^(?:assets|effect|material|worker)\//i.test(rootRelativePath) &&
    !/^(?:pz\.icons29\.svg|fonts\.png|favicon\.ico)$/i.test(rootRelativePath)
  ) {
    return null;
  }
  const remappedUrl = new URL(rootRelativePath, root);
  return {
    sourcePath: normalizeResourcePath(remappedUrl.pathname.slice(root.pathname.length)),
    url: remappedUrl,
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
  if (!value || /^(?:data|blob|javascript|mailto):/i.test(value)) return;
  if (/\/$/.test(String(value).split(/[?#]/, 1)[0])) return;
  const resolved = sourcePathFromUrl(value, baseUrl, resourceRoot);
  if (!resolved) return;
  const { sourcePath, url } = resolved;
  url.hash = "";
  references.set(sourcePath, { sourcePath, url: url.href });
}

function discoverHtmlReferences(html, sourcePageUrl, resourceRoot) {
  const references = new Map();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    const rel = (attributes.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("stylesheet")) {
      addReference(references, attributes.href, sourcePageUrl, sourcePageUrl, resourceRoot);
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    addReference(references, attributes.src, sourcePageUrl, sourcePageUrl, resourceRoot);
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
    const start = source.indexOf(marker);
    if (start < 0) continue;
    const end = source.indexOf("])", start);
    const table = source.slice(start, end < 0 ? source.length : end);
    const typePattern = /type\s*:\s*["']([a-zA-Z0-9_-]+)["']/g;
    for (const match of table.matchAll(typePattern)) {
      addReference(references, `${directory}/${match[1]}.js`, baseUrl, sourcePageUrl, resourceRoot);
    }
  }

  for (const match of source.matchAll(/(?:this\.)?shaderfile\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    addReference(
      references,
      `/assets/shaders/fragment/${match[1]}.glsl`,
      baseUrl,
      sourcePageUrl,
      resourceRoot
    );
  }

  for (const match of source.matchAll(/PZ\.asset\.font\.preset\s*=\s*\[([^\]]+)\]/g)) {
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

  for (const match of source.matchAll(
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
    for (const match of source.matchAll(pattern)) {
      addReference(references, match[1], baseUrl, sourcePageUrl, resourceRoot);
    }
  }
  return references;
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "user-agent": requestUserAgent,
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || null,
    etag: response.headers.get("etag") || null,
    lastModified: response.headers.get("last-modified") || null,
  };
}

async function writeResource(stageRoot, sourcePath, bytes) {
  const destination = safeStagePath(stageRoot, sourcePath);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, bytes);
}

function isScriptPath(sourcePath) {
  return /\.m?js$/i.test(sourcePath);
}

function isStylesheetPath(sourcePath) {
  return /\.css$/i.test(sourcePath);
}

async function fetchResourceGraph({ stageRoot, sourcePageUrl, sourceHtml }) {
  const resourceRoot = resourceRootFor(sourcePageUrl);
  const references = discoverHtmlReferences(sourceHtml, sourcePageUrl, resourceRoot);
  const pending = Array.from(references.values());
  const fetched = new Map();

  while (pending.length > 0) {
    const batch = pending.splice(0, 8);
    const results = await Promise.all(
      batch.map(async (reference) => ({
        reference,
        response: await fetchBytes(reference.url),
      }))
    );
    for (const { reference, response } of results) {
      if (fetched.has(reference.sourcePath)) continue;
      fetched.set(reference.sourcePath, {
        ...reference,
        ...response,
      });
      await writeResource(stageRoot, reference.sourcePath, response.bytes);

      if (isScriptPath(reference.sourcePath) || isStylesheetPath(reference.sourcePath)) {
        const text = response.bytes.toString("utf8");
        const discovered = discoverTextReferences(
          text,
          reference.url,
          sourcePageUrl,
          resourceRoot,
          {
            includeCssUrls: isStylesheetPath(reference.sourcePath),
            includeWorkerFiles: reference.sourcePath.startsWith("worker/"),
          }
        );
        for (const candidate of discovered.values()) {
          if (!references.has(candidate.sourcePath)) {
            references.set(candidate.sourcePath, candidate);
            pending.push(candidate);
          }
        }
      }
    }
  }

  return {
    resourceRoot,
    resources: Array.from(fetched.values()).sort((a, b) =>
      a.sourcePath.localeCompare(b.sourcePath, "en")
    ),
  };
}

function insertBeforeFirst(html, pattern, content, label) {
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

  const initCallPattern = /PZ\.ui\.ads\.init\s*\(\s*\)\s*;|\binitTool\s*\(\s*\)\s*;?/gi;
  const initCalls = html.match(initCallPattern) || [];
  if (initCalls.length === 0) {
    throw new Error("CM3 source page has no initTool() call to defer");
  }
  html = html.replace(initCallPattern, "");

  const headBootstrap = [
    "<!-- Zoidium extension bootstrap; CM3 files are staged outside the repository. -->",
    '<link rel="stylesheet" href="./fonts/fonts.css">',
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
  const clipmakerMatch = clipmakerPattern.exec(html);
  if (!clipmakerMatch) throw new Error("CM3 source page has no Clipmaker script tag");
  const clipmakerEnd = clipmakerMatch.index + clipmakerMatch[0].length;
  html = `${html.slice(0, clipmakerEnd)}\n${loaderTag}${html.slice(clipmakerEnd)}`;

  if (html === originalHtml) throw new Error("CM3 source page patch made no changes");
  return html;
}

async function copyEntry(stageRoot, relativePath) {
  const source = path.join(projectRoot, relativePath);
  if (!pathExists(source)) return;
  const destination = path.join(stageRoot, relativePath);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.cp(source, destination, {
    dereference: false,
    force: true,
    recursive: true,
  });
}

async function copyPluginRuntime(stageRoot) {
  for (const entry of [
    "plugins/registry.json",
    "plugins/plugin-manager.js",
    "plugins/plugin-manager.css",
    "plugins/core-patches",
  ]) {
    await copyEntry(stageRoot, entry);
  }

  const pluginsRoot = path.join(projectRoot, "plugins");
  if (!pathExists(pluginsRoot)) return;
  const entries = await fs.promises.readdir(pluginsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "core-patches") continue;
    await copyEntry(stageRoot, `plugins/${entry.name}/bundle.json`);
    await copyEntry(stageRoot, `plugins/${entry.name}/locales`);
  }
}

async function copyProjectFiles(stageRoot, { includeElectronFiles = false } = {}) {
  for (const entry of commonProjectEntries) await copyEntry(stageRoot, entry);
  await copyPluginRuntime(stageRoot);
  if (!includeElectronFiles) return;
  for (const entry of ["main.js", "package.json", "package-lock.json", "preload.js"]) {
    await copyEntry(stageRoot, entry);
  }
  await copyEntry(stageRoot, "tools/runtime-resources.js");
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

async function buildResourceStage(stageRoot, sourcePageUrl) {
  await fs.promises.mkdir(stageRoot, { recursive: true });
  await copyProjectFiles(stageRoot);
  const pageResponse = await fetchBytes(sourcePageUrl);
  const sourceHtml = pageResponse.bytes.toString("utf8");
  const graph = await fetchResourceGraph({ stageRoot, sourceHtml, sourcePageUrl });
  const patchedHtml = patchIndexHtml(sourceHtml);
  await fs.promises.writeFile(path.join(stageRoot, "index.html"), patchedHtml, "utf8");

  const metadata = {
    generatedAt: new Date().toISOString(),
    page: {
      bytes: pageResponse.bytes.length,
      sha256: sha256(pageResponse.bytes),
      url: sourcePageUrl,
    },
    resourceRoot: graph.resourceRoot,
    resources: graph.resources.map((resource) => ({
      bytes: resource.bytes.length,
      contentType: resource.contentType,
      sha256: sha256(resource.bytes),
      sourcePath: resource.sourcePath,
      url: resource.url,
    })),
    schemaVersion: cacheSchemaVersion,
    sourcePageUrl,
  };
  await fs.promises.writeFile(
    path.join(stageRoot, cacheMetadataName),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8"
  );
  return metadata;
}

async function readCacheMetadata(cacheRoot, sourcePageUrl) {
  try {
    const metadata = JSON.parse(
      await fs.promises.readFile(path.join(cacheRoot, cacheMetadataName), "utf8")
    );
    if (
      metadata.schemaVersion !== cacheSchemaVersion ||
      metadata.sourcePageUrl !== sourcePageUrl ||
      !Array.isArray(metadata.resources) ||
      !pathExists(path.join(cacheRoot, "index.html"))
    ) {
      return null;
    }
    for (const resource of metadata.resources) {
      if (
        !resource ||
        typeof resource.sourcePath !== "string" ||
        !pathExists(safeStagePath(cacheRoot, resource.sourcePath))
      ) {
        return null;
      }
    }
    return metadata;
  } catch (_error) {
    return null;
  }
}

async function refreshCachedProjectFiles(cacheRoot) {
  for (const entry of commonProjectEntries) {
    await fs.promises.rm(path.join(cacheRoot, entry), {
      force: true,
      recursive: true,
    });
  }
  await fs.promises.rm(path.join(cacheRoot, "plugins"), {
    force: true,
    recursive: true,
  });
  await copyProjectFiles(cacheRoot);
}

async function copyCachedRuntime(cacheRoot, destinationRoot) {
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  const entries = await fs.promises.readdir(cacheRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === cacheMetadataName) continue;
    const source = path.join(cacheRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    await fs.promises.cp(source, destination, {
      dereference: false,
      force: true,
      recursive: true,
    });
  }
}

async function ensureResourceCache({
  cacheRoot = defaultResourceCacheRoot,
  force = false,
  sourcePageUrl = defaultSourcePage,
} = {}) {
  const resolvedCacheRoot = path.resolve(cacheRoot);
  if (resolvedCacheRoot === projectRoot) {
    throw new Error("The CM3 resource cache cannot be the project root");
  }

  if (!force) {
    const metadata = await readCacheMetadata(resolvedCacheRoot, sourcePageUrl);
    if (metadata) {
      await refreshCachedProjectFiles(resolvedCacheRoot);
      return stageResultFromMetadata(metadata, resolvedCacheRoot, true);
    }
  }

  const temporaryStage = await fs.promises.mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  try {
    const metadata = await buildResourceStage(temporaryStage, sourcePageUrl);
    await fs.promises.mkdir(path.dirname(resolvedCacheRoot), { recursive: true });
    await fs.promises.rm(resolvedCacheRoot, { force: true, recursive: true });
    await fs.promises.cp(temporaryStage, resolvedCacheRoot, {
      dereference: false,
      force: true,
      recursive: true,
    });
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
} = {}) {
  const cache = await ensureResourceCache({ cacheRoot, sourcePageUrl });
  if (destinationRoot == null) return cache;

  const stageRoot = path.resolve(destinationRoot);
  if (stageRoot !== cache.root) {
    await copyCachedRuntime(cache.root, stageRoot);
  }
  if (includeElectronFiles) {
    await copyProjectFiles(stageRoot, { includeElectronFiles: true });
  }
  return { ...cache, root: stageRoot };
}

async function preparePackagedStage() {
  const stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  try {
    await fs.promises.mkdir(stageRoot, { recursive: true });
    await copyProjectFiles(stageRoot);
    for (const entry of packagedResourceEntries) await copyEntry(stageRoot, entry);
    return {
      cleanup: () => cleanupStage(stageRoot),
      root: stageRoot,
    };
  } catch (error) {
    await cleanupStage(stageRoot).catch(() => {});
    throw error;
  }
}

async function main() {
  const destination = process.argv.find((argument) => argument.startsWith("--output="));
  const includeElectronFiles = process.argv.includes("--electron");
  const source = process.argv.find((argument) => argument.startsWith("--source="));
  const setup = process.argv.includes("--setup") || process.argv.includes("--refresh");
  const sourcePageUrl = source ? source.slice("--source=".length) : defaultSourcePage;
  if (setup) {
    const result = await ensureResourceCache({ force: true, sourcePageUrl });
    console.log(
      "[Zoidium] CM3 resource cache ready at " +
        result.root +
        " (" +
        result.resources.length +
        " resources)"
    );
    return;
  }
  const result = await prepareRuntimeStage({
    destinationRoot: destination ? destination.slice("--output=".length) : null,
    includeElectronFiles,
    sourcePageUrl,
  });
  console.log(
    "[Zoidium] CM3 runtime available at " +
      result.root +
      " (" +
      result.resources.length +
      " resources)"
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Zoidium] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  defaultSourcePage,
  defaultResourceCacheRoot,
  discoverHtmlReferences,
  discoverTextReferences,
  ensureResourceCache,
  fetchResourceGraph,
  normalizeResourcePath,
  patchIndexHtml,
  preparePackagedStage,
  prepareRuntimeStage,
  projectRoot,
  resourceRootFor,
};
