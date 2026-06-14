import {
  app,
  BrowserWindow,
  Event as ElectronEvent,
  HandlerDetails,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  shell,
  WebContents,
  WindowOpenHandlerResponse,
} from 'electron';
import * as path from 'node:path';
import { IpcChannel } from '../shared/ipc-channels';
import { AiManager } from './ai/ai-manager';
import { CodeRunner } from './code-runner';
import { FileManager } from './file-manager';
import { FileWatcher } from './file-watcher';
import { SecurityManager } from './security-manager';
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
   * Holds the URL schemes permitted to open in the operating system's default handler. Everything
   * else (file:, javascript:, etc.) is rejected.
   */
  private static readonly EXTERNAL_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:'];

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
   * Watches open documents on disk and notifies the renderer when they change.
   */
  private readonly fileWatcher: FileWatcher = new FileWatcher(
    (): BrowserWindow | null => this.window,
  );

  /**
   * Owns the AI agent subsystem: authentication, provider runtime, and event streaming.
   */
  private readonly aiManager: AiManager = new AiManager(
    (): BrowserWindow | null => this.window,
  );

  /**
   * Owns the runtime security policy: the Content-Security-Policy header and the image-source policy.
   */
  private readonly securityManager: SecurityManager = new SecurityManager();

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

    this.applyWebContentsSecurity(window.webContents);

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
      (_event: IpcMainInvokeEvent, target: unknown): Promise<string> =>
        typeof target === 'string' && target.length > 0
          ? shell.openPath(target)
          : Promise.resolve('Invalid path'),
    );

    ipcMain.handle(
      IpcChannel.ShellOpenExternal,
      (_event: IpcMainInvokeEvent, url: unknown): Promise<void> => this.openExternalUrl(url),
    );

    this.securityManager.register();
    this.terminalManager.register();
    this.fileManager.register();
    this.codeRunner.register();
    this.workspaceManager.register();
    this.fileWatcher.register();
    this.aiManager.register();
  }

  /**
   * Hardens a window's web contents: navigation away from the app shell is blocked (external URLs are
   * routed to the system browser instead), and the renderer is never allowed to open new windows.
   * @param contents The web contents to guard.
   */
  private applyWebContentsSecurity(contents: WebContents): void {
    contents.on('will-navigate', (event: ElectronEvent, url: string): void => {
      if (this.isInternalNavigation(url)) {
        return;
      }
      event.preventDefault();
      void this.openExternalUrl(url);
    });

    contents.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
      void this.openExternalUrl(details.url);
      return { action: 'deny' };
    });
  }

  /**
   * Determines whether a navigation target is the app shell itself (its dev server origin, or the
   * packaged file). Any other target is treated as off-shell navigation and blocked.
   * @param target The navigation target URL.
   * @returns Returns true when the target is the app shell.
   */
  private isInternalNavigation(target: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return false;
    }
    if (Program.START_URL !== undefined) {
      return parsed.origin === new URL(Program.START_URL).origin;
    }
    return parsed.protocol === 'file:';
  }

  /**
   * Returns the URL when it is a safe external URL to hand to the operating system, or null when it is
   * not a string, not a valid URL, or uses a disallowed scheme.
   * @param url The candidate URL.
   * @returns Returns the URL when safe to open externally; otherwise, null.
   */
  private safeExternalUrl(url: unknown): string | null {
    if (typeof url !== 'string') {
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    return Program.EXTERNAL_PROTOCOLS.includes(parsed.protocol) ? url : null;
  }

  /**
   * Opens a URL in the operating system's default browser when it is a safe external URL; otherwise
   * does nothing.
   * @param url The candidate URL.
   * @returns Returns a promise that resolves once the URL has been opened (or rejected).
   */
  private async openExternalUrl(url: unknown): Promise<void> {
    const safe: string | null = this.safeExternalUrl(url);
    if (safe !== null) {
      await shell.openExternal(safe);
    }
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
      this.fileWatcher.disposeAll();
      this.aiManager.disposeAll();
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
