#!/usr/bin/env node

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const compression = require("compression");
const handler = require("serve-handler");
const { resolveDirectoryIndexUrl } = require("./directory-index");
const { prepareRuntimeStage, projectRoot } = require("./runtime-resources");
const { buildDocs } = require("./build-docs");
const devLive = require("./dev-live");

const liveProjectEntries = [
  "404.html",
  "_headers",
  "_redirects",
  "about",
  "fonts",
  "plugins/core",
  "plugins/plugin-manager.css",
  "plugins/plugin-manager.js",
  "plugins/registry.json",
  "zoidium",
  "zoidium-welcome-tour.css",
  "zoidium-welcome-tour.js",
];
const liveProjectBundlePattern = /^plugins\/[^/]+\/bundle\.json$/;
// Optional per-group payloads (plugins/<id>/<group>.bundle.json) and the
// authoring manifests are generated siblings of the main bundle. Serving them
// from the repository keeps added and removed files visible without a restart.
const liveProjectOptionalBundlePattern = /^plugins\/[^/]+\/[A-Za-z0-9_-]+\.bundle\.json$/;
const liveProjectManifestPattern = /^plugins\/[^/]+\/manifest\.json$/;
const portFallbackAttempts = 20;
const liveProjectHeaders = [
  {
    source: "**",
    headers: [{ key: "Cache-Control", value: "no-cache" }],
  },
];

function requestPathname(requestUrl) {
  let parsed;
  try {
    parsed = new URL(requestUrl, "http://zoidium.invalid");
  } catch (_error) {
    // Unparseable request targets serve no file.
    return null;
  }
  if (parsed.origin !== "http://zoidium.invalid") return null;

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (_error) {
    // An undecodable path serves no file.
    return null;
  }
  if (pathname.includes("\u0000") || pathname.includes("\\")) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function isLiveProjectPath(relativePath) {
  if (!relativePath) return false;
  // The fixed interpreter and Worker bytes exist only in the generated stage.
  if (relativePath === "zoidium/community-runtime-source.js") return false;
  if (liveProjectBundlePattern.test(relativePath)) return true;
  if (liveProjectManifestPattern.test(relativePath)) return true;
  if (liveProjectOptionalBundlePattern.test(relativePath)) return true;
  return liveProjectEntries.some(
    (entry) => relativePath === entry || relativePath.startsWith(`${entry}/`)
  );
}

// DNS-rebinding hardening for the development server: only loopback Host
// values on the port this server bound are served. Anything else (an
// attacker domain resolving to 127.0.0.1, a foreign port, a missing header)
// gets a 403 before any file is read.
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1"]);

function isAllowedHost(hostHeader, expectedPort) {
  if (typeof hostHeader !== "string") return false;
  const raw = hostHeader.trim();
  if (!raw || /[\s@/\\?]/.test(raw)) return false;
  let hostname = raw;
  let port = null;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    if (end < 0) return false;
    port = hostname.slice(end + 1);
    hostname = hostname.slice(1, end);
    if (port) {
      if (!port.startsWith(":")) return false;
      port = port.slice(1);
    } else {
      port = null;
    }
  } else if (hostname.includes(":")) {
    const parts = hostname.split(":");
    if (parts.length !== 2) return false;
    [hostname, port] = parts;
  }
  if (!loopbackHostnames.has(hostname.toLowerCase())) return false;
  if (port !== null && port !== "") {
    if (!/^\d+$/.test(port) || Number(port) !== Number(expectedPort)) return false;
  }
  return true;
}

function shouldServeFromProject(requestUrl) {
  const relativePath = requestPathname(requestUrl);
  return relativePath != null && isLiveProjectPath(relativePath);
}

// Browsers request /favicon.ico unconditionally. The staged page carries an
// empty data: icon instead, so the development server answers with empty
// success rather than a 404.
function isFaviconRequest(requestUrl) {
  return requestPathname(requestUrl) === "favicon.ico";
}

function sendFaviconSilence(response) {
  response.writeHead(204, { "Content-Length": "0" });
  response.end();
}

function parseOptions(argv) {
  const options = { open: false, port: 8123, watch: true };
  for (const argument of argv) {
    if (argument === "--open") options.open = true;
    else if (argument === "--no-watch") options.watch = false;
    else if (argument.startsWith("--port=")) options.port = Number(argument.slice(7));
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/serve-with-resources.js [options]

Ensures the CM3 resource graph is available in the Git-ignored cache, then
serves its patched index.html on both local loopback addresses. Zoidium-owned
runtime files are served directly from the repository so a browser reload sees
source changes without restarting this server. Plugin bundles and the
registry are rebuilt in memory from their sources, staged font presets and
the community runtime source are re-read from the repository, and the docs
are served from a fresh documentation build when one exists. The cache
remains after the server stops.

Options:
  --port=<number>      preferred listen port (default: 8123); falls forward to
                       the next free port when the preferred one is busy
  --open               open the local URL in the default browser
  --no-watch           disable the file watcher (requests still rebuild from
                       source, but nothing is refreshed proactively)
`);
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    console.warn(`[Zoidium] could not open the browser: ${error.message}`);
  });
  child.unref();
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address().port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function listenOnPort(listeners, port) {
  const bound = [];
  let assignedPort = port;
  try {
    for (const { server, host } of listeners) {
      try {
        assignedPort = await listen(server, assignedPort, host);
        bound.push(server);
      } catch (error) {
        if (host === "::1" && error && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error.code)) {
          console.warn(`[Zoidium] IPv6 loopback unavailable (${error.code}); serving on 127.0.0.1 only`);
          continue;
        }
        throw error;
      }
    }
    if (!bound.length) throw new Error("No local loopback address is available");
    return assignedPort;
  } catch (error) {
    await Promise.all(bound.map((server) => close(server)));
    throw error;
  }
}

async function listenOnAvailablePort(listeners, preferredPort, attempts = portFallbackAttempts) {
  for (let attempt = 0; ; attempt += 1) {
    const port = preferredPort === 0 ? 0 : preferredPort + attempt;
    try {
      return await listenOnPort(listeners, port);
    } catch (error) {
      if (!error || error.code !== "EADDRINUSE" || attempt >= attempts || port >= 65535) throw error;
    }
  }
}

function waitForClose(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.once("close", resolve);
  });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const runtime = await prepareRuntimeStage();
  let shuttingDown = false;
  let liveWatcher = null;
  const listeners = [];
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (liveWatcher) {
      try {
        liveWatcher.close();
      } catch (_ignored) {
        // Watcher close is best effort.
      }
      liveWatcher = null;
    }
    await Promise.all(listeners.map(({ server }) => close(server)));
    await runtime.cleanup().catch((error) => {
      console.error("[Zoidium] could not clean up the development runtime stage:", error);
    });
    process.exitCode = exitCode;
  };

  // Generated or staged bytes that are re-read from the repository per
  // request (or warmed by the watcher below), so edits, additions, and
  // removals show on the next page reload without restarting this server.
  const liveLog = (message) => console.log(`[Zoidium] ${message}`);
  const liveBundles = devLive.createLiveBundles({ onLog: liveLog });
  const livePresets = devLive.createLivePresets({ onLog: liveLog });
  const liveCommunity = devLive.createLiveCommunitySource({ onLog: liveLog });
  const liveApprovals = devLive.createApprovalsCache({ bundles: liveBundles, onLog: liveLog });
  const gate = devLive.createRequestGate({ maxConcurrent: 64 });
  const siteDistRoot = path.join(projectRoot, "site", "dist");
  let docsCheckAt = 0;
  let docsLive = false;
  const liveDocsRoot = () => {
    const now = Date.now();
    if (now - docsCheckAt > 5000) {
      docsCheckAt = now;
      try {
        docsLive = fs.statSync(path.join(siteDistRoot, "index.html")).isFile();
      } catch (_error) {
        docsLive = false;
      }
    }
    return docsLive ? siteDistRoot : null;
  };
  const fontPresetPattern = /^assets\/fonts\/2d\/(.+)\.ttf$/;

  const serveGenerated = async (request, response) => {
    const relativePath = requestPathname(request.url);
    if (!relativePath) return false;
    if (relativePath === "plugins/core/output-frame-approvals.js") {
      // Live receipt without a child process per request.
      const source = await liveApprovals.get();
      return devLive.sendBytes(request, response, { contentType: "text/javascript; charset=utf-8", bytes: source });
    }
    if (relativePath === "plugins/registry.json") {
      const registry = await liveBundles.getRegistry();
      if (registry == null) return false;
      return devLive.sendBytes(request, response, { contentType: "application/json; charset=utf-8", bytes: registry });
    }
    if (
      liveProjectBundlePattern.test(relativePath) ||
      liveProjectManifestPattern.test(relativePath) ||
      liveProjectOptionalBundlePattern.test(relativePath)
    ) {
      const content = await liveBundles.getFile(relativePath);
      if (content == null) return false;
      return devLive.sendBytes(request, response, { contentType: "application/json; charset=utf-8", bytes: content });
    }
    if (relativePath === "zoidium/community-runtime-source.js") {
      try {
        const source = await liveCommunity.get();
        return devLive.sendBytes(request, response, { contentType: "text/javascript; charset=utf-8", bytes: source });
      } catch (error) {
        console.error("[Zoidium] live community runtime source unavailable:", error && error.message ? error.message : error);
        return false;
      }
    }
    const preset = fontPresetPattern.exec(relativePath);
    if (preset) {
      const bytes = await livePresets.getPresetBytes(preset[1]);
      if (bytes == null) return false;
      return devLive.sendBytes(request, response, { contentType: "font/ttf", bytes });
    }
    return false;
  };

  // serve-handler opens one file per request. Under a page-load burst that
  // fan-out can exhaust file handles; retry EMFILE/ENFILE with backoff and
  // report 503 instead of crashing. Reads are re-entrant for GET requests.
  const serveFromRoot = async (request, response, publicRoot, headers) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await handler(request, response, {
          cleanUrls: false,
          directoryListing: false,
          etag: true,
          headers,
          public: publicRoot,
          rewrites: [{ source: "/", destination: "/index.html" }],
        });
        return;
      } catch (error) {
        const retryable = error && (error.code === "EMFILE" || error.code === "ENFILE");
        if (!retryable || attempt >= 3 || (response && response.headersSent)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
  };

  const failRequest = (response, error) => {
    console.error("[Zoidium] local server request failed:", error);
    try {
      const pressured = error && (error.code === "EMFILE" || error.code === "ENFILE");
      if (!response.headersSent) {
        response.writeHead(pressured ? 503 : 500, { "Content-Type": "text/plain" });
      }
      response.end(pressured ? "Server Busy" : "Internal Server Error");
    } catch (_ignored) {
      // The client is gone; nothing left to report to.
    }
  };

  try {
    await buildDocs(runtime.root);
    await liveBundles.rebuild();
    if (options.watch) {
      const refreshLive = async (changed) => {
        try {
          await liveBundles.rebuild();
          liveApprovals.invalidate();
          if (changed && changed.length) liveLog(`live reload: refreshed after ${changed.length} change(s)`);
        } catch (error) {
          console.error("[Zoidium] live reload failed:", error && error.message ? error.message : error);
        }
      };
      try {
        // One recursive watcher per root: bounded handles no matter how many
        // files change underneath.
        liveWatcher = devLive.createRecursiveWatcher(
          [
            path.join(projectRoot, "plugins"),
            path.join(projectRoot, "zoidium"),
            path.join(projectRoot, "fonts"),
            path.join(projectRoot, "tools", "community-runtime-source.js"),
          ],
          (changed) => {
            refreshLive(changed);
          },
          {
            onError: (error) => console.error("[Zoidium] live watcher error:", error && error.message ? error.message : error),
          }
        );
      } catch (error) {
        console.error("[Zoidium] live watcher unavailable, requests still rebuild from source:", error && error.message ? error.message : error);
      }
    }
    let boundPort = options.port;
    const compressionMiddleware = compression();
    const handleRequest = (request, response) => {
      gate.run(async () => {
        if (!isAllowedHost(request.headers && request.headers.host, boundPort)) {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        if (isFaviconRequest(request.url)) {
          sendFaviconSilence(response);
          return;
        }
        compressionMiddleware(request, response, async () => {
          try {
            if (await serveGenerated(request, response)) return;
            const relativePath = requestPathname(request.url);
            let publicRoot = runtime.root;
            let headers;
            if (shouldServeFromProject(request.url)) {
              publicRoot = projectRoot;
              headers = liveProjectHeaders;
            } else if (relativePath === "docs" || (relativePath && relativePath.startsWith("docs/"))) {
              // A fresh documentation build is picked up without a restart.
              const docsRoot = liveDocsRoot();
              if (docsRoot) {
                publicRoot = docsRoot;
                headers = liveProjectHeaders;
              }
            }
            const directoryIndexUrl = await resolveDirectoryIndexUrl(request.url, publicRoot);
            if (directoryIndexUrl) request.url = directoryIndexUrl;
            await serveFromRoot(request, response, publicRoot, headers);
          } catch (error) {
            failRequest(response, error);
          }
        });
      }).catch((error) => {
        failRequest(response, error);
      });
    };
    listeners.push(
      { host: "127.0.0.1", server: http.createServer(handleRequest) },
      { host: "::1", server: http.createServer(handleRequest) },
    );
    for (const { server } of listeners) {
      // Aborted connections destroy their socket; that must never crash us.
      server.on("clientError", (_error, socket) => {
        try {
          socket.destroy();
        } catch (_ignored) {
          // Destroy is best effort.
        }
      });
    }

    process.once("SIGINT", () => shutdown(0).then(() => process.exit()));
    process.once("SIGTERM", () => shutdown(0).then(() => process.exit()));

    const port = await listenOnAvailablePort(listeners, options.port);
    boundPort = port;
    if (options.port !== 0 && port !== options.port) {
      console.log(`[Zoidium] port ${options.port} is already in use; using ${port}`);
    }
    const url = `http://127.0.0.1:${port}`;
    console.log(`[Zoidium] CM3 resource cache: ${runtime.root}`);
    console.log(`[Zoidium] local server: ${url}`);
    console.log(`[Zoidium] localhost alias: http://localhost:${port}`);
    if (options.open) openBrowser(url);
    await Promise.all(listeners.map(({ server }) => waitForClose(server)));
  } catch (error) {
    await shutdown(1);
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Zoidium] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  isAllowedHost,
  isFaviconRequest,
  isLiveProjectPath,
  listenOnAvailablePort,
  requestPathname,
  sendFaviconSilence,
  shouldServeFromProject,
};
