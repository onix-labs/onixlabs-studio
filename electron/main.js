// Electron main process — creates the application window and loads the Angular app.
// In development it loads the Angular dev server (ELECTRON_START_URL); in production
// it loads the built Angular files from dist/.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const startUrl = process.env.ELECTRON_START_URL;
const isDev = !!startUrl;

// Path to the built Angular app (Angular's `application` builder emits to dist/<project>/browser).
const indexHtml = path.join(__dirname, '..', 'dist', 'onixlabs-studio', 'browser', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(startUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(indexHtml);
  }
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create a window when the dock icon is clicked and no windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
