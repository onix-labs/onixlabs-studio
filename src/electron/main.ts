import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

class Program {
  /**
   * Specifies the development server URL to load. When undefined, the built Angular
   * application is loaded from disk instead (production behavior).
   */
  private static readonly START_URL: string | undefined = process.env['ELECTRON_START_URL'];

  /**
   * Specifies the absolute path to the built Angular entry point. The Angular
   * `application` builder emits to `dist/<project>/browser`. The compiled main
   * process lives at `dist-electron/electron/`, so the workspace root is two levels up.
   */
  private static readonly INDEX_HTML: string = path.join(
    __dirname,
    '..',
    '..',
    'dist',
    'onixlabs-studio',
    'browser',
    'index.html',
  );

  /**
   * Initializes a new instance of the Program class.
   */
  private constructor() {
    this.initialize();
  }

  /**
   * Initializes the current Program instance.
   */
  private initialize(): void {
    void app.whenReady().then(this.onReady.bind(this));
  }

  /**
   * Creates the main application window and loads the Angular application into it.
   */
  private createWindow(): void {
    const window: BrowserWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window.once('ready-to-show', (): void => window.show());

    if (Program.START_URL !== undefined) void window.loadURL(Program.START_URL);
    else void window.loadFile(Program.INDEX_HTML);
  }

  /**
   * Handles the app whenReady event.
   */
  private onReady(): void {
    this.createWindow();
    app.on('activate', this.onActivate.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
  }

  /**
   * Handles the app onActivate event.
   */
  private onActivate(): void {
    if (BrowserWindow.getAllWindows().length === 0) this.createWindow();
  }

  /**
   * Handles the app onWindowAllClosed event.
   */
  private onWindowAllClosed(): void {
    if (process.platform !== 'darwin') app.quit();
  }

  /**
   * Runs the program.
   */
  public static run(): void {
    new Program();
  }
}

Program.run();
