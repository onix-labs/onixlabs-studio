import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, shell } from 'electron';
import * as path from 'node:path';
import { IpcChannel } from '../shared/ipc-channels';
import { CodeRunner } from './code-runner';
import { FileManager } from './file-manager';
import { TerminalManager } from './terminal-manager';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceManager } from './workspace-manager';

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
   * Holds the main application window, or null before it is created or after it is closed.
   */
  private window: BrowserWindow | null = null;

  /**
   * Manages pseudo-terminal sessions on behalf of the renderer.
   */
  private readonly terminalManager: TerminalManager = new TerminalManager(
    (): BrowserWindow | null => this.window,
  );

  /**
   * Handles file-system operations and dialogs on behalf of the renderer.
   */
  private readonly fileManager: FileManager = new FileManager(
    (): BrowserWindow | null => this.window,
  );

  /**
   * Writes editor content to temporary files so the renderer can execute it.
   */
  private readonly codeRunner: CodeRunner = new CodeRunner();

  /**
   * Tracks the open workspace root and confines filesystem operations to it.
   */
  private readonly workspaceContext: WorkspaceContext = new WorkspaceContext();

  /**
   * Handles workspace (open folder) and directory operations on behalf of the renderer.
   */
  private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(
    (): BrowserWindow | null => this.window,
    this.workspaceContext,
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
      trafficLightPosition: { x: 14, y: 14 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window.once('ready-to-show', (): void => window.show());
    window.on('closed', (): void => {
      this.window = null;
    });

    this.window = window;

    if (Program.START_URL !== undefined) void window.loadURL(Program.START_URL);
    else void window.loadFile(Program.INDEX_HTML);
  }

  /**
   * Registers the IPC handlers for renderer-initiated window control requests. Each handler
   * resolves the window from the request sender so it always acts on the requesting window.
   */
  private registerIpcHandlers(): void {
    ipcMain.on(IpcChannel.WindowMinimize, (event: IpcMainEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });

    ipcMain.on(IpcChannel.WindowToggleMaximize, (event: IpcMainEvent): void => {
      const targetWindow: BrowserWindow | null = BrowserWindow.fromWebContents(event.sender);
      if (targetWindow === null) {
        return;
      }

      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
    });

    ipcMain.on(IpcChannel.WindowClose, (event: IpcMainEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    });

    ipcMain.on(IpcChannel.WindowSetMovable, (event: IpcMainEvent, movable: unknown): void => {
      if (typeof movable !== 'boolean') {
        return;
      }

      BrowserWindow.fromWebContents(event.sender)?.setMovable(movable);
    });

    ipcMain.handle(
      IpcChannel.ShellOpenPath,
      (_event: IpcMainInvokeEvent, target: string): Promise<string> => shell.openPath(target),
    );

    this.terminalManager.register();
    this.fileManager.register();
    this.codeRunner.register();
    this.workspaceManager.register();
  }

  /**
   * Handles the app whenReady event.
   */
  private onReady(): void {
    this.registerIpcHandlers();
    this.createWindow();
    app.on('activate', this.onActivate.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
    app.on('before-quit', (): void => {
      this.terminalManager.disposeAll();
      this.codeRunner.dispose();
    });
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
