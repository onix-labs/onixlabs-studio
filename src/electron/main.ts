import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

/**
 * Specifies the development server URL to load. When undefined, the built Angular
 * application is loaded from disk instead (production behaviour).
 */
const startUrl: string | undefined = process.env['ELECTRON_START_URL'];

/**
 * Specifies the absolute path to the built Angular entry point. The Angular
 * `application` builder emits to `dist/<project>/browser`. The compiled main
 * process lives at `dist-electron/electron/`, so the workspace root is two levels up.
 */
const indexHtml: string = path.join(
  __dirname,
  '..',
  '..',
  'dist',
  'onixlabs-studio',
  'browser',
  'index.html',
);

/**
 * Creates the main application window and loads the Angular application into it.
 */
function createWindow(): void {
  const window: BrowserWindow = new BrowserWindow({
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

  window.once('ready-to-show', (): void => window.show());

  if (startUrl !== undefined) {
    void window.loadURL(startUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(indexHtml);
  }
}

void app.whenReady().then((): void => {
  createWindow();

  // macOS: re-create a window when the dock icon is clicked and no windows are open.
  app.on('activate', (): void => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', (): void => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
