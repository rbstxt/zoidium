"use strict";

// Serialized into the Electron main process by the explicit desktop suite.
async function desktopBoundaries(electron, options) {
  const { app, BrowserWindow, session, MessageChannelMain } = electron;
  const require = process.getBuiltinModule("node:module").createRequire(app.getAppPath() + "/package.json");
  const path = require("node:path"), http = require("node:http");
  const { createRunnerHost } = require(path.join(app.getAppPath(), "desktop/community-runner.cjs"));
  const P = require(path.join(app.getAppPath(), "zoidium/community-package.js"));
  const active = BrowserWindow.getAllWindows().find(window => window.webContents.session !== session.defaultSession);
  const contents = active.webContents, initialURL = contents.getURL();
  let navigationDenied = false;
  contents.once("will-navigate", event => { navigationDenied = event.defaultPrevented; });
  await contents.executeJavaScript("location.href=" + JSON.stringify(options.target + "/navigation") + ";true");
  const permissions = await contents.executeJavaScript(`(async () => {
    const result = {};
    for (const name of ['geolocation', 'notifications', 'clipboard-read']) {
      result[name] = (await navigator.permissions.query({ name })).state;
    }
    result.notificationRequest = await Notification.requestPermission();
    result.media = await navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', error => error.name);
    return result;
  })()`);
  let downloadDenied = false;
  active.webContents.session.once("will-download", event => { downloadDenied = event.defaultPrevented; });
  await contents.executeJavaScript(`(() => {
    const anchor = document.createElement('a'); anchor.download = 'blocked.txt';
    anchor.href = URL.createObjectURL(new Blob(['trusted download canary'])); anchor.click();
    URL.revokeObjectURL(anchor.href); return true;
  })()`);
  // Observe cancellation events locally. No remote fixture waits are needed.
  await new Promise(resolve => setTimeout(resolve, 100));
  const child = await contents.executeJavaScript(`(() => {
    const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(options.target + "/child")};
    document.body.append(frame); return true;
  })()`);
  const requests = [];
  let expected;
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, method: request.method });
    response.writeHead(302, { Location: options.target + "/redirect-target" }); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const channel = new MessageChannelMain(); let host;
  try {
    host = createRunnerHost({ electron, origin: "http://127.0.0.1:" + server.address().port,
      config: { binding: { packageId: options.packageId, packageHash: options.hash, runnerGeneration: 100 }, bundle: P.parse(new Uint8Array(options.bytes)) },
      editorPort: channel.port1, authorized: async () => true,
      route: (url, doc) => { if (doc) expected = new URL(url).pathname; },
    });
    await host.ready;
    return { navigationDenied, unchangedURL: contents.getURL() === initialURL, permissions, downloadDenied, child,
      redirect: { requests, expected, runnerDestroyed: host.window.isDestroyed() } };
  } finally {
    host?.close(); channel.port2.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { desktopBoundaries };
