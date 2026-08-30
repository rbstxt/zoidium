const { app, BrowserWindow } = require('electron');
const http = require('http');
const { promisify } = require('util');
const compression = require('compression');
const handler = require('serve-handler');

let server;
const compressResponse = promisify(compression());

function createServer() {
  return new Promise((resolve) => {
    server = http.createServer(async (request, response) => {
      try {
        await compressResponse(request, response);
        await handler(request, response, {
          public: __dirname,
          etag: true,
          headers: [
            {
              source: '/plugins/*/bundle.json',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, immutable'
                }
              ]
            },
            {
              source: '/plugins/*/locales/*.json',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, immutable'
                }
              ]
            }
          ]
        });
      } catch (error) {
        console.error('[Zoidium] local server request failed:', error);
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Internal Server Error');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`Zoidium server running at http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

async function createWindow () {
  const port = await createServer();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});
