"use strict";

// Staging: index patching, the three.js bevel patch, project-file copies,
// and the full resource-stage builder.
const fs = require("fs");
const path = require("path");
const approvals = require("./preview-cache-approvals");
const {
  assertNoSymlinkComponents,
  assertNoSymlinksRecursively,
  assertStageRootSafe,
  cacheMetadataName,
  cacheSchemaVersion,
  commonProjectEntries,
  defaultFetchConcurrency,
  defaultFetchTimeoutMs,
  defaultVideoEditorSourcePage,
  isPathInside,
  normalizeResourcePath,
  normalizeSourcePageUrl,
  projectRoot,
  runtimeProfilesName,
  safeStagePath,
  sha256,
} = require("./runtime-resources-paths");
const { discoverEditorEntryScript, resourceRootFor } = require("./runtime-resources-discovery");
const {
  assertPageResponseWithinRoot,
  fetchBytes,
  fetchResourceGraph,
  writeStageFile,
} = require("./runtime-resources-fetch");

function insertBeforeFirst(html, pattern, content, label) {
  pattern.lastIndex = 0;
  const match = pattern.exec(html);
  if (!match) throw new Error(`CM3 source page has no ${label} script tag`);
  return `${html.slice(0, match.index)}${content}\n${html.slice(match.index)}`;
}


const FAVICON_PLACEHOLDER = '<link rel="icon" href="data:,">';

function hasIconLink(html) {
  for (const match of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
    if (!rel) continue;
    const tokens = String(rel[1] ?? rel[2] ?? rel[3] ?? "").toLowerCase().split(/\s+/);
    if (tokens.includes("icon")) return true;
  }
  return false;
}

function insertFaviconPlaceholder(html) {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${FAVICON_PLACEHOLDER}\n</head>`);
  }
  return insertBeforeFirst(html, /<script\b/i, FAVICON_PLACEHOLDER, "head");
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
    `<script src="./${runtimeProfilesName}"></script>`,
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
  const editorPattern = /<script\b[^>]*src=["'][^"']*(?:clipmaker|videoeditor)-[^"']+\.js[^"']*["'][^>]*>\s*<\/script>/i;
  editorPattern.lastIndex = 0;
  if (!editorPattern.test(html)) {
    throw new Error("CM3 source page has no supported editor entry script tag");
  }
  editorPattern.lastIndex = 0;
  html = html.replace(editorPattern, loaderTag);

  if (!hasIconLink(originalHtml)) html = insertFaviconPlaceholder(html);

  if (html === originalHtml) throw new Error("CM3 source page patch made no changes");
  return html;
}

function replaceThreePatchAnchor(
  source,
  search,
  replacement,
  label,
  expectedCount = 1
) {
  const count = source.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `CM3 three.js bevel patch expected ${expectedCount} ${label} anchors, found ${count}`
    );
  }
  return source.split(search).join(replacement);
}

function patchThreeR91Source(source) {
  const original = String(source);
  if (
    original.includes("bevelProfilePow") &&
    original.includes("bevelSizeInner") &&
    original.includes("bevelShift") &&
    original.includes("bevelRound")
  ) {
    return original;
  }

  let patched = original;
  patched = replaceThreePatchAnchor(
    patched,
    "E=void 0!==b.UVGenerator?b.UVGenerator:fb.WorldUVGenerator;",
    "E=void 0!==b.UVGenerator?b.UVGenerator:fb.WorldUVGenerator;var bevelProfile=void 0!==b.bevelProfile?b.bevelProfile:.5,bevelRound=void 0!==b.bevelRound?b.bevelRound:!0,bevelSizeInner=void 0!==b.bevelSizeInner?b.bevelSizeInner:v,bevelShift=void 0!==b.bevelShift?b.bevelShift:0,bevelProfilePow=Math.pow(2,(bevelProfile-.5)*4);",
    "option defaults"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "y||(v=q=x=0);",
    "y||(v=q=x=0,bevelSizeInner=0,bevelShift=0);",
    "disabled-bevel defaults"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "V=Xa.triangulateShape(a,O),X=a;Q=0;for(M=O.length;Q<M;Q++)S=O[Q],a=a.concat(S);",
    "V=Xa.triangulateShape(a,O),X=a;Q=0;for(M=O.length;Q<M;Q++)S=O[Q],a=a.concat(S);var verticesSizes=[];for(var vi=0;vi<X.length;vi++)verticesSizes[vi]=v-bevelShift;for(Q=0;Q<M;Q++){S=O[Q];for(var hi=0,hil=S.length;hi<hil;hi++)verticesSizes.push(bevelSizeInner-bevelShift)}",
    "per-contour bevel sizes"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "for(R=0;R<x;R++){W=R/x;var fa=q*Math.cos(W*Math.PI/2);U=v*Math.sin(W*Math.PI/2);",
    "for(R=0;R<x;R++){W=R/x;W=bevelRound?Math.pow(W,bevelProfilePow):W;var fa=bevelRound?q*Math.cos(W*Math.PI/2):q*(1-W);U=bevelRound?v*Math.sin(W*Math.PI/2)-bevelShift:v*W-bevelShift;var bsInner=bevelRound?bevelSizeInner*Math.sin(W*Math.PI/2)-bevelShift:bevelSizeInner*W-bevelShift;",
    "front bevel profile"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "ha=c(S[J],ca[J],U),f(ha.x,ha.y,-fa)",
    "ha=c(S[J],ca[J],bsInner),f(ha.x,ha.y,-fa)",
    "front inner bevel"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "ha=y?c(a[J],ea[J],U):a[J]",
    "ha=y?c(a[J],ea[J],verticesSizes[J]):a[J]",
    "cap contour bevel size",
    2
  );
  patched = replaceThreePatchAnchor(
    patched,
    "for(R=x-1;0<=R;R--){W=R/x;fa=q*Math.cos(W*Math.PI/2);U=v*Math.sin(W*Math.PI/2);",
    "for(R=x-1;0<=R;R--){W=R/x;W=bevelRound?Math.pow(W,bevelProfilePow):W;var fa=bevelRound?q*Math.cos(W*Math.PI/2):q*(1-W);U=bevelRound?v*Math.sin(W*Math.PI/2)-bevelShift:v*W-bevelShift;var bsInner=bevelRound?bevelSizeInner*Math.sin(W*Math.PI/2)-bevelShift:bevelSizeInner*W-bevelShift;",
    "back bevel profile"
  );
  patched = replaceThreePatchAnchor(
    patched,
    "ha=c(S[J],ca[J],U),A?f(ha.x,ha.y+H[B-1].y,H[B-1].x+fa):f(ha.x,ha.y,m+fa)",
    "ha=c(S[J],ca[J],bsInner),A?f(ha.x,ha.y+H[B-1].y,H[B-1].x+fa):f(ha.x,ha.y,m+fa)",
    "back inner bevel"
  );
  return patched;
}

async function patchThreeRuntimeStage(stageRoot, resources) {
  const candidates = (resources || []).filter((resource) => {
    const sourcePath = String(resource?.sourcePath || "");
    return sourcePath === "three.r91.min.js" || sourcePath.endsWith("/three.r91.min.js");
  });
  if (candidates.length !== 1) {
    throw new Error(
      `CM3 three.js r91 runtime is not uniquely identified in the staged resource graph (${candidates.length} matches)`
    );
  }

  const sourcePath = normalizeResourcePath(candidates[0].sourcePath);
  const filePath = safeStagePath(stageRoot, sourcePath);
  const source = await fs.promises.readFile(filePath, "utf8");
  const patched = patchThreeR91Source(source);
  if (patched !== source) {
    await writeStageFile(stageRoot, sourcePath, Buffer.from(patched, "utf8"));
  }
  return sourcePath;
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
    "plugins/core",
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
    const bundle = await readProjectJson(bundlePath);
    for (const entry of Object.values(bundle.assets?.optional || {})) {
      const optionalPath = normalizeResourcePath(entry.source);
      const directory = bundlePath.slice(0, bundlePath.lastIndexOf("/") + 1);
      if (!optionalPath.startsWith(directory) || !/^[a-z0-9_-]+\.bundle\.json$/.test(optionalPath.slice(directory.length))) throw new Error("Invalid optional bundle path");
      await copyEntry(stageRoot, optionalPath, { required: true });
    }
  }
}

async function copyProjectFiles(stageRoot, { includeDesktopFiles = false } = {}) {
  const resolvedStageRoot = await assertStageRootSafe(stageRoot);
  for (const entry of commonProjectEntries) {
    await copyEntry(resolvedStageRoot, entry, { required: true });
  }
  await copyPluginRuntime(resolvedStageRoot);
  await writeStageFile(resolvedStageRoot, approvals.approvalPath, approvals.stagedSource());
  // Supply fixed Worker bytes as host data. Activation never loads a
  // package-selected URL or fetches interpreter/WASM/module dependencies.
  await writeStageFile(resolvedStageRoot, "zoidium/community-runtime-source.js",
    "\"use strict\";\nglobalThis.ZoidiumCommunityRuntimeSource = " + JSON.stringify(require("./community-runtime-source").runtimeSource()) + ";\n");
  if (!includeDesktopFiles) return;
  for (const entry of ["desktop", "package.json"]) {
    await copyEntry(resolvedStageRoot, entry, { required: true });
  }
}

// Zoidium built-in font presets are stored in the repository as
// fonts/presets/<name>.ttf (listed in fonts/presets.json) and served at the
// path the host fetches: assets/fonts/2d/<name>.ttf, relative to the page.
// Entries with a variable file (fonts/presets-variable/<file>) serve it at
// assets/fonts/2d-variable/<file> for Shape+ text, which keeps the variable
// axes while native text uses the host-safe static preset file.
// Every stage (web build, development server, desktop packaging) is built by
// copyProjectFiles, so one step here covers all of them.
async function copyFontPresets(stageRoot) {
  const listPath = path.join(projectRoot, "fonts", "presets.json");
  const entries = JSON.parse(await fs.promises.readFile(listPath, "utf8"));
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.name !== "string")) {
    throw new Error("fonts/presets.json must be an array of {name, label?} entries.");
  }
  for (const { name, variable } of entries) {
    const source = path.resolve(projectRoot, "fonts", "presets", `${name}.ttf`);
    if (!isPathInside(projectRoot, source)) {
      throw new Error(`Font preset escapes the repository: ${name}`);
    }
    let bytes;
    try {
      const stat = await fs.promises.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Font preset is not a regular file: ${name}`);
      }
      bytes = await fs.promises.readFile(source);
    } catch (error) {
      throw new Error(`Missing font preset file fonts/presets/${name}.ttf: ${error.message}`);
    }
    await writeStageFile(stageRoot, `assets/fonts/2d/${name}.ttf`, bytes);
    if (typeof variable === "string" && variable.length > 0) {
      const variableSource = path.resolve(projectRoot, "fonts", "presets-variable", variable);
      if (!isPathInside(projectRoot, variableSource)) {
        throw new Error(`Font variable file escapes the repository: ${variable}`);
      }
      let variableBytes;
      try {
        const stat = await fs.promises.lstat(variableSource);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error(`Font variable file is not a regular file: ${variable}`);
        }
        variableBytes = await fs.promises.readFile(variableSource);
      } catch (error) {
        throw new Error(`Missing font variable file fonts/presets-variable/${variable}: ${error.message}`);
      }
      await writeStageFile(stageRoot, `assets/fonts/2d-variable/${variable}`, variableBytes);
    }
  }
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
    profiles: metadata.profiles,
    resourceRoot: metadata.resourceRoot,
    resources: metadata.resources,
    root,
  };
}

function runtimeProfilesSource(profiles) {
  return [
    "(function (global) {",
    '  "use strict";',
    `  global.ZOIDIUM_RUNTIME_PROFILES = ${JSON.stringify(profiles, null, 2)};`,
    "})(window);",
    "",
  ].join("\n");
}

function pageMetadata(pageResponse) {
  return {
    bytes: pageResponse.bytes.length,
    sha256: sha256(pageResponse.bytes),
    url: pageResponse.finalUrl,
  };
}

async function buildResourceStage(
  stageRoot,
  sourcePageUrl,
  {
    fetchImpl = globalThis.fetch,
    fetchTimeoutMs = defaultFetchTimeoutMs,
    concurrency = defaultFetchConcurrency,
    videoEditorSourcePageUrl = defaultVideoEditorSourcePage,
    allowInsecureSource = false,
  } = {}
) {
  const resolvedStageRoot = await assertStageRootSafe(stageRoot);
  const normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl, { allowInsecureSource });
  const normalizedVideoEditorSourcePageUrl = normalizeSourcePageUrl(
    videoEditorSourcePageUrl,
    { allowInsecureSource }
  );
  const resourceRoot = resourceRootFor(normalizedSourcePageUrl);
  if (resourceRootFor(normalizedVideoEditorSourcePageUrl) !== resourceRoot) {
    throw new Error("Clipmaker and Video Editor source pages must share a resource directory");
  }
  await fs.promises.mkdir(resolvedStageRoot, { recursive: true });
  await copyProjectFiles(resolvedStageRoot);

  const [clipmakerPageResponse, videoEditorPageResponse] = await Promise.all([
    fetchBytes(normalizedSourcePageUrl, {
      allowedOrigin: new URL(normalizedSourcePageUrl).origin,
      allowInsecureSource,
      fetchImpl,
      timeoutMs: fetchTimeoutMs,
    }),
    fetchBytes(normalizedVideoEditorSourcePageUrl, {
      allowedOrigin: new URL(normalizedVideoEditorSourcePageUrl).origin,
      allowInsecureSource,
      fetchImpl,
      timeoutMs: fetchTimeoutMs,
    }),
  ]);
  assertPageResponseWithinRoot(clipmakerPageResponse.finalUrl, normalizedSourcePageUrl);
  assertPageResponseWithinRoot(
    videoEditorPageResponse.finalUrl,
    normalizedVideoEditorSourcePageUrl
  );

  await writeStageFile(resolvedStageRoot, ".zoidium-source/clipmaker.html", clipmakerPageResponse.bytes);
  await writeStageFile(resolvedStageRoot, ".zoidium-source/videoeditor.html", videoEditorPageResponse.bytes);
  const sourceHtml = clipmakerPageResponse.bytes.toString("utf8");
  const videoEditorHtml = videoEditorPageResponse.bytes.toString("utf8");
  const clipmakerEntry = discoverEditorEntryScript(
    sourceHtml,
    clipmakerPageResponse.finalUrl,
    "clipmaker"
  );
  const videoEditorEntry = discoverEditorEntryScript(
    videoEditorHtml,
    videoEditorPageResponse.finalUrl,
    "videoeditor"
  );
  const patchedHtml = patchIndexHtml(sourceHtml);
  const clipmakerGraph = await fetchResourceGraph({
    allowInsecureSource,
    concurrency,
    fetchImpl,
    fetchTimeoutMs,
    sourceBaseUrl: clipmakerPageResponse.finalUrl,
    sourceHtml,
    sourcePageUrl: normalizedSourcePageUrl,
    stageRoot: resolvedStageRoot,
  });
  const graph = await fetchResourceGraph({
    allowInsecureSource,
    concurrency,
    existingResources: clipmakerGraph.resources,
    fetchImpl,
    fetchTimeoutMs,
    sourceBaseUrl: videoEditorPageResponse.finalUrl,
    sourceHtml: videoEditorHtml,
    sourcePageUrl: normalizedVideoEditorSourcePageUrl,
    stageRoot: resolvedStageRoot,
  });

  const runtimeProfiles = {
    defaultLayout: "clipmaker",
    layouts: {
      clipmaker: {
        editorGlobal: "CM",
        entryScript: `./${clipmakerEntry.sourcePath}`,
        label: "Clipmaker 3",
      },
      videoeditor: {
        editorGlobal: "VE",
        entryScript: `./${videoEditorEntry.sourcePath}`,
        label: "Video Editor 2",
      },
    },
  };
  const runtimeProfilesBytes = Buffer.from(runtimeProfilesSource(runtimeProfiles), "utf8");
  const indexBytes = Buffer.from(patchedHtml, "utf8");
  await writeStageFile(resolvedStageRoot, "index.html", indexBytes);
  await writeStageFile(resolvedStageRoot, runtimeProfilesName, runtimeProfilesBytes);

  const metadata = {
    generatedAt: new Date().toISOString(),
    index: {
      bytes: indexBytes.length,
      sha256: sha256(indexBytes),
    },
    page: pageMetadata(clipmakerPageResponse),
    profiles: {
      clipmaker: {
        entryScript: clipmakerEntry.sourcePath,
        page: pageMetadata(clipmakerPageResponse),
        sourcePageUrl: normalizedSourcePageUrl,
      },
      videoeditor: {
        entryScript: videoEditorEntry.sourcePath,
        page: pageMetadata(videoEditorPageResponse),
        sourcePageUrl: normalizedVideoEditorSourcePageUrl,
      },
    },
    runtimeProfiles: {
      bytes: runtimeProfilesBytes.length,
      path: runtimeProfilesName,
      sha256: sha256(runtimeProfilesBytes),
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

module.exports = {
  assertPageResponseWithinRoot,
  buildResourceStage,
  cleanupStage,
  copyEntry,
  copyFontPresets,
  copyPath,
  copyPluginRuntime,
  copyProjectFiles,
  hasIconLink,
  insertBeforeFirst,
  insertFaviconPlaceholder,
  pageMetadata,
  patchIndexHtml,
  patchThreeR91Source,
  patchThreeRuntimeStage,
  readProjectJson,
  replaceThreePatchAnchor,
  runtimeProfilesSource,
  stageResultFromMetadata,
};
