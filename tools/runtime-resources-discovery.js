"use strict";

// Discovery of the CM3 resource graph: HTML references, text references,
// and entry scripts. Depends only on runtime-resources-paths.
const path = require("path");
const {
  isProtectedResourcePath,
  normalizeHttpUrl,
  normalizeResourcePath,
  normalizeSourcePageUrl,
} = require("./runtime-resources-paths");

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

function discoverEditorEntryScript(html, sourcePageUrl, layout) {
  const resourceRoot = resourceRootFor(sourcePageUrl);
  const references = discoverHtmlReferences(html, sourcePageUrl, resourceRoot);
  const prefix = layout === "videoeditor" ? "videoeditor-" : "clipmaker-";
  const matches = Array.from(references.values()).filter((reference) => {
    const basename = path.posix.basename(reference.sourcePath).toLowerCase();
    return basename.startsWith(prefix) && basename.endsWith(".js");
  });
  if (matches.length !== 1) {
    throw new Error(
      `CM3 ${layout} source page must expose exactly one ${prefix}*.js entry script`
    );
  }
  return matches[0];
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

function isScriptPath(sourcePath) {
  return /\.m?js$/i.test(sourcePath);
}

function isStylesheetPath(sourcePath) {
  return /\.css$/i.test(sourcePath);
}

module.exports = {
  addReference,
  discoverEditorEntryScript,
  discoverHtmlReferences,
  discoverTextReferences,
  htmlAttributes,
  isScriptPath,
  isStylesheetPath,
  resourceRootFor,
  sourcePathFromUrl,
};
