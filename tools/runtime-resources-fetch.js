"use strict";

// Network fetch with retries, plus the concurrent resource-graph walker.
// Depends on runtime-resources-paths and runtime-resources-discovery.
const fs = require("fs");
const path = require("path");
const {
  assertAllowedUrlScheme,
  assertFetchedResourcePath,
  assertNoSymlinkComponents,
  assertStageRootSafe,
  cacheMetadataName,
  defaultFetchConcurrency,
  defaultFetchTimeoutMs,
  maximumFetchConcurrency,
  normalizeHttpUrl,
  normalizePositiveInteger,
  normalizeSourcePageUrl,
  requestUserAgent,
  safeStagePath,
  sha256,
} = require("./runtime-resources-paths");
const {
  discoverEditorEntryScript,
  discoverHtmlReferences,
  discoverTextReferences,
  isScriptPath,
  isStylesheetPath,
  resourceRootFor,
  sourcePathFromUrl,
} = require("./runtime-resources-discovery");

function getHeader(response, name) {
  return response && response.headers && typeof response.headers.get === "function"
    ? response.headers.get(name) || null
    : null;
}

function isChallengePage(bytes) {
  return /Just a moment|challenge-platform/i.test(bytes.toString("utf8"));
}

function browserCheckError() {
  return new Error("The CM3 source page is behind a browser check. See docs/cm3-resources.md for --page-html / --video-editor-html or ZOIDIUM_CM3_SNAPSHOT. No challenge bypass is attempted.");
}

async function savedPageFetch({ pageHtml, videoEditorHtml, sourcePageUrl, videoEditorSourcePageUrl, cacheRoot, fetchImpl = globalThis.fetch, allowInsecureSource = false }) {
  if (!pageHtml || !videoEditorHtml) throw new Error("Supply both --page-html and --video-editor-html");
  const pages = new Map();
  let metadata;
  try { metadata = JSON.parse(await fs.promises.readFile(safeStagePath(cacheRoot, cacheMetadataName), "utf8")); } catch (_) {}
  for (const [layout, file, url] of [["clipmaker", pageHtml, sourcePageUrl], ["videoeditor", videoEditorHtml, videoEditorSourcePageUrl]]) {
    const bytes = await fs.promises.readFile(file);
    if (isChallengePage(bytes)) throw browserCheckError();
    try { discoverEditorEntryScript(bytes.toString("utf8"), url, layout); }
    catch (_) { throw new Error(`Saved ${layout} page has no discoverable CM3 entry script. See docs/cm3-resources.md`); }
    if (metadata?.profiles?.[layout]?.page?.sha256 === sha256(bytes)) {
      console.log(`[Zoidium] saved ${layout} page is identical to the cached version`);
    }
    pages.set(normalizeSourcePageUrl(url, { allowInsecureSource }), bytes);
  }
  return (url, options) => pages.has(url) ? Promise.resolve(new Response(pages.get(url), { headers: { "content-type": "text/html" } })) : fetchImpl(url, options);
}

async function fetchBytes(
  url,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = defaultFetchTimeoutMs,
    allowedOrigin = null,
    allowedDirectory = null,
    signal = null,
    allowInsecureSource = false,
  } = {}
) {
  const requestUrl = assertAllowedUrlScheme(
    normalizeHttpUrl(url, "CM3 resource"),
    "CM3 resource",
    allowInsecureSource
  );
  const timeout = normalizePositiveInteger(timeoutMs, "fetch timeout");
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime does not provide fetch() for CM3 resources");
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let attempt = 0; ; attempt += 1) {
      controller.signal.throwIfAborted();
      let response;
      let bytes;
      let retryDelay = 300 * 2 ** attempt;
      try {
        response = await fetchImpl(requestUrl, {
          headers: { accept: "*/*", "user-agent": requestUserAgent },
          redirect: "follow",
          signal: controller.signal,
        });
        const finalUrl = assertAllowedUrlScheme(
          normalizeHttpUrl(response && response.url || requestUrl, "CM3 resource response"),
          "CM3 resource redirect",
          allowInsecureSource
        );
        if (allowedOrigin && new URL(finalUrl).origin !== allowedOrigin) {
          throw new Error(`CM3 resource redirect crossed origin boundary: ${requestUrl} -> ${finalUrl}`);
        }
        if (allowedDirectory && !new URL(finalUrl).pathname.startsWith(new URL(allowedDirectory).pathname)) {
          throw new Error(`CM3 resource redirect left the configured source directory: ${requestUrl} -> ${finalUrl}`);
        }
        if (getHeader(response, "cf-mitigated") === "challenge") {
          if (response.body && typeof response.body.cancel === "function") {
            await response.body.cancel().catch(() => {});
          }
          throw browserCheckError();
        }
        if (response) {
          bytes = Buffer.from(await response.arrayBuffer());
          if (isChallengePage(bytes)) throw browserCheckError();
        }
        if (!response || !response.ok) {
          const error = new Error(`HTTP ${response ? response.status : "unknown"} for ${requestUrl}`);
          error.retryable = Boolean(response && [408, 429, 500, 502, 503, 504].includes(response.status));
          const retryAfter = getHeader(response, "retry-after");
          if (retryAfter != null) {
            const seconds = Number(retryAfter);
            const milliseconds = Number.isFinite(seconds) && seconds >= 0
              ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(milliseconds)) retryDelay = Math.max(retryDelay, milliseconds);
          }
          if (response && response.body && typeof response.body.cancel === "function") {
            await response.body.cancel().catch(() => {});
          }
          throw error;
        }
        bytes = bytes || Buffer.from(await response.arrayBuffer());
        return {
          bytes,
          contentType: getHeader(response, "content-type"),
          etag: getHeader(response, "etag"),
          finalUrl,
          lastModified: getHeader(response, "last-modified"),
        };
      } catch (error) {
        const code = error && (error.code || error.cause && error.cause.code);
        const transient = error && error.retryable ||
          error instanceof TypeError && /fetch failed|network|terminated/i.test(error.message) ||
          ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code);
        if (controller.signal.aborted || error && error.name === "AbortError" || !transient || attempt >= 2) throw error;
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(delayTimer); reject(controller.signal.reason); };
          const delayTimer = setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, Math.min(retryDelay, timeout));
          controller.signal.addEventListener("abort", abort, { once: true });
          if (controller.signal.aborted) abort();
        });
      }
    }
  } catch (error) {
    if (signal && signal.aborted) throw signal.reason || error;
    if (controller.signal.aborted) {
      throw new Error(`Timed out fetching CM3 resource after ${timeout} ms: ${requestUrl}`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
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

function normalizeFetchConcurrency(value) {
  return normalizePositiveInteger(value, "fetch concurrency", {
    maximum: maximumFetchConcurrency,
  });
}

function runConcurrentQueue(items, concurrency, task) {
  const workerCount = normalizeFetchConcurrency(concurrency);
  let cursor = 0;
  let active = 0;
  let failure = null;

  return new Promise((resolve, reject) => {
    const finish = () => {
      if (active > 0) return false;
      if (failure) {
        reject(failure.error);
        return true;
      }
      if (cursor >= items.length) {
        resolve();
        return true;
      }
      return false;
    };
    const pump = () => {
      while (!failure && active < workerCount && cursor < items.length) {
        const item = items[cursor++];
        active += 1;
        Promise.resolve()
          .then(() => task(item))
          .then(
            () => {
              active -= 1;
              if (!finish()) pump();
            },
            (error) => {
              active -= 1;
              if (!failure) failure = { error };
              finish();
            }
          );
      }
      finish();
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
  existingResources = [],
  allowInsecureSource = false,
}) {
  const normalizedSourcePageUrl = normalizeSourcePageUrl(sourcePageUrl, { allowInsecureSource });
  const normalizedBaseUrl = assertAllowedUrlScheme(
    normalizeHttpUrl(sourceBaseUrl, "CM3 source page"),
    "CM3 source page",
    allowInsecureSource
  );
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
  const fetched = new Map(
    Array.from(existingResources || [], (resource) => [resource.sourcePath, resource])
  );

  await runConcurrentQueue(pending, concurrency, async (reference) => {
    const sourcePath = assertFetchedResourcePath(reference.sourcePath);
    if (fetched.has(sourcePath)) return;

    let response;
    try {
      response = await fetchBytes(reference.url, {
        allowedOrigin: sourceOrigin,
        allowedDirectory: resourceRoot,
        allowInsecureSource,
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

function assertPageResponseWithinRoot(pageUrl, sourcePageUrl) {
  const resourceRoot = resourceRootFor(sourcePageUrl);
  if (!sourcePathFromUrl(pageUrl, sourcePageUrl, resourceRoot)) {
    throw new Error(
      `CM3 source page redirect left the configured source directory: ${sourcePageUrl} -> ${pageUrl}`
    );
  }
}

module.exports = {
  assertPageResponseWithinRoot,
  browserCheckError,
  fetchBytes,
  fetchResourceGraph,
  getHeader,
  isChallengePage,
  normalizeFetchConcurrency,
  runConcurrentQueue,
  savedPageFetch,
  writeResource,
  writeStageFile,
};
