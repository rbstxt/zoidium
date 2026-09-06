#!/usr/bin/env node

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const compression = require("compression");
const handler = require("serve-handler");
const { resolveDirectoryIndexUrl } = require("./directory-index");
const { prepareRuntimeStage } = require("./runtime-resources");

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
serves its patched index.html on both local loopback addresses. The cache
remains after the server stops.

Options:
  --port=<number>      listen port (default: 8123)
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
  const compressionMiddleware = compression();
  const handleRequest = (request, response) => {
    compressionMiddleware(request, response, async () => {
      try {
        const directoryIndexUrl = await resolveDirectoryIndexUrl(request.url, runtime.root);
        if (directoryIndexUrl) request.url = directoryIndexUrl;
      } catch (error) {
        console.error("[Zoidium] local server request failed:", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("Internal Server Error");
        return;
      }
      handler(request, response, {
        cleanUrls: false,
        directoryListing: false,
        etag: true,
        public: runtime.root,
        rewrites: [{ source: "/", destination: "/index.html" }],
      }).catch((error) => {
        console.error("[Zoidium] local server request failed:", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("Internal Server Error");
      });
    });
  };
  const listeners = [
    { host: "127.0.0.1", server: http.createServer(handleRequest) },
    { host: "::1", server: http.createServer(handleRequest) },
  ];

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all(listeners.map(({ server }) => close(server)));
    process.exitCode = exitCode;
  };
  process.once("SIGINT", () => shutdown(0).then(() => process.exit()));
  process.once("SIGTERM", () => shutdown(0).then(() => process.exit()));

  try {
    const port = await listen(listeners[0].server, options.port, listeners[0].host);
    await listen(listeners[1].server, port, listeners[1].host);
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

main().catch((error) => {
  console.error(`[Zoidium] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
