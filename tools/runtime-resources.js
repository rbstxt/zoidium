#!/usr/bin/env node

"use strict";

// Facade over the runtime-resources family. New code should require the
// focused module directly; this entry keeps the CLI and the historical
// require("./runtime-resources") API stable.
const paths = require("./runtime-resources-paths");
const discovery = require("./runtime-resources-discovery");
const fetch = require("./runtime-resources-fetch");
const stage = require("./runtime-resources-stage");
const cache = require("./runtime-resources-cache");

const { defaultSourcePage, defaultVideoEditorSourcePage } = paths;
const { ensureResourceCache, prepareRuntimeStage } = cache;

function parseCliArgs(argumentsList) {
  const options = {
    desktop: false,
    offline: false,
    refresh: false,
    setup: false,
  };
  for (const argument of argumentsList) {
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--desktop") options.desktop = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument === "--setup") options.setup = true;
    else if (argument.startsWith("--from-snapshot=")) options.snapshot = argument.slice(16);
    else if (argument.startsWith("--page-html=")) options.pageHtml = argument.slice(12);
    else if (argument.startsWith("--video-editor-html=")) options.videoEditorHtml = argument.slice(20);
    else if (argument.startsWith("--output=")) options.output = argument.slice(9);
    else if (argument.startsWith("--source=")) options.source = argument.slice(9);
    else if (argument.startsWith("--video-editor-source=")) {
      options.videoEditorSource = argument.slice(22);
    }
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.snapshot && (options.pageHtml || options.videoEditorHtml || options.refresh)) throw new Error("Snapshot restore cannot be combined with saved pages or --refresh");
  if ((options.pageHtml || options.videoEditorHtml || options.snapshot) && !options.setup) throw new Error("Saved pages and --from-snapshot require --setup");
  if (options.refresh) options.setup = true;
  if (Boolean(options.pageHtml) !== Boolean(options.videoEditorHtml)) {
    throw new Error("Supply both --page-html and --video-editor-html");
  }
  if (options.setup && options.output) {
    throw new Error("--setup/--refresh cannot be combined with --output");
  }
  if (options.setup && options.desktop) {
    throw new Error("--setup/--refresh cannot be combined with --desktop");
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
  --desktop             include desktop entry files in the output stage
  --source=<url>        override ZOIDIUM_CM3_SOURCE_PAGE
  --video-editor-source=<url>
                        override ZOIDIUM_VIDEO_EDITOR_SOURCE_PAGE
  --from-snapshot=<source> restore a local file, r2://bucket/key, or HTTPS snapshot
  --page-html=<file>     import a browser-saved Clipmaker page with --setup
  --video-editor-html=<file> import the saved Video Editor page as well
  ZOIDIUM_CM3_SNAPSHOT   restore this snapshot when the cache is unavailable
                        Explicit --setup/--refresh still fetches source pages.
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
  const videoEditorSourcePageUrl =
    options.videoEditorSource || defaultVideoEditorSourcePage;
  if (options.setup) {
    const result = options.snapshot
      ? await require("./cm3-snapshot").restoreSnapshot({ from: options.snapshot, sourcePageUrl, videoEditorSourcePageUrl })
      : await ensureResourceCache({
          force: true,
          pageHtml: options.pageHtml,
          videoEditorHtml: options.videoEditorHtml,
          sourcePageUrl,
          videoEditorSourcePageUrl,
        });
    console.log(
      `[Zoidium] CM3 resource cache ready at ${result.root} (${result.resources.length} resources)`
    );
    return;
  }

  const result = await prepareRuntimeStage({
    destinationRoot: options.output || null,
    includeDesktopFiles: options.desktop,
    offline: options.offline,
    sourcePageUrl,
    videoEditorSourcePageUrl,
  });
  try {
    console.log(
      `[Zoidium] CM3 runtime available at ${result.root} (${result.resources.length} resources)`
    );
  } finally {
    await result.cleanup();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Zoidium] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}
module.exports = {
  assertCacheRootSafe: paths.assertCacheRootSafe,
  assertFetchedResourcePath: paths.assertFetchedResourcePath,
  buildResourceStage: stage.buildResourceStage,
  copyProjectFiles: stage.copyProjectFiles,
  readRegularFile: cache.readRegularFile,
  replaceDirectoryAtomically: cache.replaceDirectoryAtomically,
  stageResultFromMetadata: stage.stageResultFromMetadata,
  savedPageFetch: fetch.savedPageFetch,
  parseCliArgs,
  cacheMetadataName: paths.cacheMetadataName,
  cacheSchemaVersion: paths.cacheSchemaVersion,
  defaultFetchTimeoutMs: paths.defaultFetchTimeoutMs,
  defaultResourceCacheRoot: paths.defaultResourceCacheRoot,
  defaultSourcePage: paths.defaultSourcePage,
  defaultVideoEditorSourcePage: paths.defaultVideoEditorSourcePage,
  discoverEditorEntryScript: discovery.discoverEditorEntryScript,
  discoverHtmlReferences: discovery.discoverHtmlReferences,
  discoverTextReferences: discovery.discoverTextReferences,
  ensureResourceCache: cache.ensureResourceCache,
  fetchResourceGraph: fetch.fetchResourceGraph,
  fetchBytes: fetch.fetchBytes,
  inspectResourceCache: cache.inspectResourceCache,
  normalizeResourcePath: paths.normalizeResourcePath,
  normalizeSourcePageUrl: paths.normalizeSourcePageUrl,
  patchIndexHtml: stage.patchIndexHtml,
  patchThreeR91Source: stage.patchThreeR91Source,
  patchThreeRuntimeStage: stage.patchThreeRuntimeStage,
  prepareRuntimeStage: cache.prepareRuntimeStage,
  projectRoot: paths.projectRoot,
  resourceRootFor: discovery.resourceRootFor,
  safeStagePath: paths.safeStagePath,
};
