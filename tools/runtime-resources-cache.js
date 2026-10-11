"use strict";

// Cache validation, refresh, snapshot restore entry points, and the
// disposable-stage preparation used by servers and builders.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  assertCacheRootSafe,
  assertExistingDirectory,
  assertFetchedResourcePath,
  assertSafeDirectoryTarget,
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
  normalizeHttpUrl,
  normalizeResourcePath,
  normalizeSourcePageUrl,
  pathExists,
  resourceRootFor,
  runtimeProfilesName,
  safeStagePath,
  sha256,
  temporaryPrefix,
} = require("./runtime-resources-paths");
const {
  buildResourceStage,
  cleanupStage,
  copyPath,
  copyProjectFiles,
  patchIndexHtml,
  stageResultFromMetadata,
} = require("./runtime-resources-stage");

function cacheInspection(valid, reason, metadata = null) {
  return { valid, reason, metadata };
}

async function readRegularFile(root, relativePath) {
  const filePath = safeStagePath(root, relativePath);
  await assertNoSymlinkComponents(root, filePath);
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
  videoEditorSourcePageUrl = defaultVideoEditorSourcePage,
  verifyHashes = true,
} = {}) {
  let resolvedCacheRoot;
  let normalizedSourcePageUrl;
  let normalizedVideoEditorSourcePageUrl;
  try {
    resolvedCacheRoot = assertSafeDirectoryTarget(cacheRoot, "CM3 resource cache");
    normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl);
    normalizedVideoEditorSourcePageUrl = normalizeSourcePageUrl(
      videoEditorSourcePageUrl
    );
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
    if (resourceRootFor(normalizedVideoEditorSourcePageUrl) !== expectedResourceRoot) {
      return cacheInspection(false, "CM3 layout source pages do not share a resource root");
    }
    if (
      !metadata.page ||
      !Number.isInteger(metadata.page.bytes) ||
      !isSha256(metadata.page.sha256) ||
      !metadata.index ||
      !Number.isInteger(metadata.index.bytes) ||
      !isSha256(metadata.index.sha256) ||
      !metadata.runtimeProfiles ||
      metadata.runtimeProfiles.path !== runtimeProfilesName ||
      !Number.isInteger(metadata.runtimeProfiles.bytes) ||
      !isSha256(metadata.runtimeProfiles.sha256) ||
      !metadata.profiles ||
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

    const runtimeProfiles = await readRegularFile(
      resolvedCacheRoot,
      runtimeProfilesName
    );
    if (runtimeProfiles.stat.size !== metadata.runtimeProfiles.bytes) {
      return cacheInspection(false, "Cached runtime profile manifest size does not match metadata");
    }
    if (verifyHashes) {
      const runtimeProfilesBytes = await fs.promises.readFile(runtimeProfiles.filePath);
      if (sha256(runtimeProfilesBytes) !== metadata.runtimeProfiles.sha256) {
        return cacheInspection(false, "Cached runtime profile manifest hash does not match metadata");
      }
    }

    const expectedProfiles = {
      clipmaker: normalizedSourcePageUrl,
      videoeditor: normalizedVideoEditorSourcePageUrl,
    };
    for (const [layout, expectedSourcePageUrl] of Object.entries(expectedProfiles)) {
      const profile = metadata.profiles[layout];
      if (
        !profile ||
        profile.sourcePageUrl !== expectedSourcePageUrl ||
        typeof profile.entryScript !== "string" ||
        profile.entryScript !== normalizeResourcePath(profile.entryScript) ||
        !profile.page ||
        !Number.isInteger(profile.page.bytes) ||
        !isSha256(profile.page.sha256) ||
        typeof profile.page.url !== "string"
      ) {
        return cacheInspection(false, `CM3 ${layout} cache metadata is invalid`);
      }
    }

    for (const layout of Object.keys(expectedProfiles)) {
      const rawPath = `.zoidium-source/${layout}.html`;
      if (pathExists(safeStagePath(resolvedCacheRoot, rawPath))) {
        const raw = await readRegularFile(resolvedCacheRoot, rawPath);
        const bytes = await fs.promises.readFile(raw.filePath);
        if (bytes.length !== metadata.profiles[layout].page.bytes || sha256(bytes) !== metadata.profiles[layout].page.sha256) {
          return cacheInspection(false, `Cached raw ${layout} page does not match metadata`);
        }
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
    for (const [layout, profile] of Object.entries(metadata.profiles)) {
      if (!paths.has(profile.entryScript)) {
        return cacheInspection(false, `CM3 ${layout} entry script is missing from the cache`);
      }
    }
    return cacheInspection(true, "CM3 resource cache is valid", metadata);
  } catch (error) {
    return cacheInspection(false, error.message);
  }
}

async function readCacheMetadata(cacheRoot, sourcePageUrl, videoEditorSourcePageUrl) {
  const inspection = await inspectResourceCache({
    cacheRoot,
    sourcePageUrl,
    videoEditorSourcePageUrl,
  });
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

async function copyCachedRuntime(
  cacheRoot,
  destinationRoot,
  metadata,
  { includeMetadata = false } = {}
) {
  const resolvedCacheRoot = await assertStageRootSafe(cacheRoot);
  const resolvedDestinationRoot = await assertStageRootSafe(destinationRoot);
  await fs.promises.mkdir(resolvedDestinationRoot, { recursive: true });

  const entries = [
    "index.html",
    runtimeProfilesName,
    ...metadata.resources.map((resource) => resource.sourcePath),
  ];
  if (includeMetadata) entries.push(cacheMetadataName);
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
  snapshotSource = process.env.ZOIDIUM_CM3_SNAPSHOT,
  pageHtml = null,
  videoEditorHtml = null,
  offline = false,
  sourcePageUrl = defaultSourcePage,
  videoEditorSourcePageUrl = defaultVideoEditorSourcePage,
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
      videoEditorSourcePageUrl,
    });
    if (inspection.valid) {
      await refreshCachedProjectFiles(resolvedCacheRoot);
      return stageResultFromMetadata(inspection.metadata, resolvedCacheRoot, true);
    }
    if (snapshotSource) {
      console.log(`[Zoidium] restoring the CM3 resource cache from the configured snapshot (${inspection.reason})`);
      return require("./cm3-snapshot").restoreSnapshot({ from: snapshotSource, cacheRoot: resolvedCacheRoot, sourcePageUrl: normalizedSourcePageUrl, videoEditorSourcePageUrl, fetchImpl });
    }
    if (offline) {
      throw new Error(`CM3 resource cache is unavailable offline: ${inspection.reason}`);
    }
    console.warn(`[Zoidium] rebuilding CM3 resource cache: ${inspection.reason}`);
  } else if (offline) {
    throw new Error("--offline cannot be combined with --setup or --refresh");
  }

  if (pageHtml || videoEditorHtml) {
    fetchImpl = await savedPageFetch({ pageHtml, videoEditorHtml, sourcePageUrl: normalizedSourcePageUrl, videoEditorSourcePageUrl, cacheRoot: resolvedCacheRoot, fetchImpl });
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
      videoEditorSourcePageUrl,
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
  includeDesktopFiles = false,
  sourcePageUrl = defaultSourcePage,
  videoEditorSourcePageUrl = defaultVideoEditorSourcePage,
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
    videoEditorSourcePageUrl,
  });
  const ownsStage = destinationRoot == null;
  const stageRoot = await assertStageRootSafe(
    ownsStage
      ? await fs.promises.mkdtemp(path.join(os.tmpdir(), temporaryPrefix))
      : destinationRoot
  );
  try {
    if (stageRoot !== cache.root) {
      await copyCachedRuntime(cache.root, stageRoot, cache, {
        includeMetadata: false,
      });
    }
    await copyProjectFiles(stageRoot, { includeDesktopFiles });
    await patchThreeRuntimeStage(stageRoot, cache.resources);
    return {
      ...cache,
      cleanup: ownsStage ? () => cleanupStage(stageRoot) : cache.cleanup,
      root: stageRoot,
    };
  } catch (error) {
    if (ownsStage) await cleanupStage(stageRoot).catch(() => {});
    throw error;
  }
}

module.exports = {
  cacheInspection,
  cleanupStage,
  copyCachedRuntime,
  ensureResourceCache,
  inspectResourceCache,
  isSha256,
  prepareRuntimeStage,
  readCacheMetadata,
  readRegularFile,
  refreshCachedProjectFiles,
  removeStageEntry,
  replaceDirectoryAtomically,
};
