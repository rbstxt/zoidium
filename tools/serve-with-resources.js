#!/usr/bin/env node

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const compression = require("compression");
const handler = require("serve-handler");
const { resolveDirectoryIndexUrl } = require("./directory-index");
const { prepareRuntimeStage } = require("./runtime-resources");
const { buildDocs } = require("./build-docs");

const portFallbackAttempts = 20;

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

function parseOptions(argv) {
  const options = { open: false, port: 8123 };
  for (const argument of argv) {
    if (argument === "--open") options.open = true;
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
serves its patched index.html on both local loopback addresses. Restart the
server to stage source changes. The cache remains after the server stops.

Options:
  --port=<number>      preferred listen port (default: 8123); falls forward to
                       the next free port when the preferred one is busy
  --open               open the local URL in the default browser
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
  const listeners = [];
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all(listeners.map(({ server }) => close(server)));
    await runtime.cleanup().catch((error) => {
      console.error("[Zoidium] could not clean up the development runtime stage:", error);
    });
    process.exitCode = exitCode;
  };

  try {
    await buildDocs(runtime.root);
    let boundPort = options.port;
    const compressionMiddleware = compression();
    const handleRequest = (request, response) => {
      if (!isAllowedHost(request.headers && request.headers.host, boundPort)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }
      compressionMiddleware(request, response, async () => {
        try {
          const publicRoot = runtime.root;
          const directoryIndexUrl = await resolveDirectoryIndexUrl(request.url, publicRoot);
          if (directoryIndexUrl) request.url = directoryIndexUrl;

          handler(request, response, {
            cleanUrls: false,
            directoryListing: false,
            etag: true,
            public: publicRoot,
            rewrites: [{ source: "/", destination: "/index.html" }],
          }).catch((error) => {
            console.error("[Zoidium] local server request failed:", error);
            if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("Internal Server Error");
          });
        } catch (error) {
          console.error("[Zoidium] local server request failed:", error);
          if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
          response.end("Internal Server Error");
          return;
        }
      });
    };
    listeners.push(
      { host: "127.0.0.1", server: http.createServer(handleRequest) },
      { host: "::1", server: http.createServer(handleRequest) },
    );

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
  listenOnAvailablePort,
  requestPathname,
};
