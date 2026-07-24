import { BrowserWindow, Display, Event as ElectronEvent, screen, WebContents } from 'electron';
import { WindowChannel } from '@shared/api/window-channels';
import { restoreWindowRect, StoredWindowState, WindowRect } from './window-state';
import { RegisteredWindow, WindowKind, WindowRegistry } from './window-registry';
import { WindowStateStore } from './window-state-store';

/**
 * Describes the application-supplied pieces the window manager needs to build windows: where the
 * shell loads from, the security hardening to apply to every window, and the main window's
 * lifecycle hooks (which stay with the program, since they drive the app-wide quit protocol).
 */
export interface WindowManagerOptions {
  /**
   * Gets the absolute path to the preload script every window loads.
   */
  readonly preloadPath: string;

  /**
   * Gets the development server URL to load, or undefined to load the built application from disk.
   */
  readonly startUrl: string | undefined;

  /**
   * Gets the absolute path to the built Angular entry point, loaded when no start URL is set.
   */
  readonly indexHtml: string;

  /**
   * Hardens a window's web contents (navigation and window-open guards). Applied to every window
   * the manager creates, so no window ever ships unguarded.
   * @param contents The web contents to guard.
   */
  readonly applySecurity: (contents: WebContents) => void;

  /**
   * Handles the main window's close event, so the program can run its quit-confirmation protocol.
   * @param event The close event, which the handler may prevent.
   */
  readonly onMainClose: (event: ElectronEvent) => void;

  /**
   * Handles the main window's page (re)load, so the program can reset per-load renderer state.
   */
  readonly onMainDidFinishLoad: () => void;
}

/**
 * Owns every application window: creation and loading, the registry that resolves the main window
 * for renderer-push targets, and per-kind bounds persistence. The single-window app registers only
 * the main window today; pop-out windows join the same registry in later phases.
 */
export class WindowManager {
  /**
   * Holds the default main-window width, used when no usable bounds are persisted.
   */
  private static readonly DEFAULT_WIDTH: number = 1280;

  /**
   * Holds the default main-window height, used when no usable bounds are persisted.
   */
  private static readonly DEFAULT_HEIGHT: number = 800;

  /**
   * Holds the minimum main-window width.
   */
  private static readonly MIN_WIDTH: number = 800;

  /**
   * Holds the minimum main-window height.
   */
  private static readonly MIN_HEIGHT: number = 600;

  /**
   * Holds how long (ms) to wait after a resize or move before persisting bounds, so continuous
   * drags collapse into a single write.
   */
  private static readonly BOUNDS_SAVE_DEBOUNCE_MS: number = 500;

  /**
   * Holds the default pop-out-window width, used when no usable bounds are persisted.
   */
  private static readonly POPOUT_DEFAULT_WIDTH: number = 960;

  /**
   * Holds the default pop-out-window height, used when no usable bounds are persisted.
   */
  private static readonly POPOUT_DEFAULT_HEIGHT: number = 640;

  /**
   * Holds the minimum pop-out-window width. Pop-outs host a single surface, so they may shrink far
   * below the IDE window's minimum.
   */
  private static readonly POPOUT_MIN_WIDTH: number = 480;

  /**
   * Holds the minimum pop-out-window height.
   */
  private static readonly POPOUT_MIN_HEIGHT: number = 320;

  /**
   * Holds the registered windows.
   */
  private readonly registry: WindowRegistry<BrowserWindow> = new WindowRegistry<BrowserWindow>();

  /**
   * Holds the application-supplied options.
   */
  private readonly options: WindowManagerOptions;

  /**
   * Initializes a new instance of the {@link WindowManager} class.
   * @param options The application-supplied pieces the manager builds windows with.
   */
  public constructor(options: WindowManagerOptions) {
    this.options = options;
  }

  /**
   * Gets the main application window.
   * @returns Returns the main window, or null before it is created or after it is closed.
   */
  public main(): BrowserWindow | null {
    return this.registry.main();
  }

  /**
   * Brings the main window to the front, restoring it first when it is minimized. Does nothing when
   * no main window exists.
   */
  public focusMain(): void {
    const window: BrowserWindow | null = this.main();
    if (window === null) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  /**
   * Creates the main application window — restoring its persisted bounds when they are still
   * reachable on the current displays — and loads the Angular application into it.
   * @returns Returns the created window.
   */
  public createMainWindow(): BrowserWindow {
    const stored: StoredWindowState | null = WindowStateStore.read('main');
    const restored: WindowRect | null =
      stored === null
        ? null
        : restoreWindowRect(
            stored,
            screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
            WindowManager.MIN_WIDTH,
            WindowManager.MIN_HEIGHT,
          );

    const window: BrowserWindow = new BrowserWindow({
      backgroundColor: '#000000',
      width: restored?.width ?? WindowManager.DEFAULT_WIDTH,
      height: restored?.height ?? WindowManager.DEFAULT_HEIGHT,
      ...(restored !== null ? { x: restored.x, y: restored.y } : {}),
      minWidth: WindowManager.MIN_WIDTH,
      minHeight: WindowManager.MIN_HEIGHT,
      show: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (stored?.maximized === true) {
      window.maximize();
    }

    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('main', window);
    window.once('ready-to-show', (): void => window.show());
    // Page zoom is disabled (the application menu omits the zoom roles), but Chromium persists zoom
    // levels per-origin in the session, so a level set before zoom was disabled would silently apply
    // forever. Reset it on every load; content zoom belongs to the editors' own zoom controls.
    window.webContents.on('did-finish-load', (): void => {
      window.webContents.setZoomLevel(0);
      this.options.onMainDidFinishLoad();
    });
    // Bounds are saved on close as well as on the debounced move/resize, so the final arrangement
    // always wins — including on the quit path, where close follows the confirmed quit.
    window.on('close', (event: ElectronEvent): void => {
      this.saveBounds('main', window);
      this.options.onMainClose(event);
    });
    window.on('closed', (): void => this.registry.remove(entry.id));
    this.trackBounds('main', window);

    this.options.applySecurity(window.webContents);

    if (this.options.startUrl !== undefined) void window.loadURL(this.options.startUrl);
    else void window.loadFile(this.options.indexHtml);

    return window;
  }

  /**
   * Creates a pop-out window — a secondary window hosting a single surface (a dock panel) rather
   * than the full IDE — and loads the application shell into it with the given query string, which
   * the renderer entry reads to boot the minimal pop-out root. Pop-outs close plainly: they never
   * gate application lifecycle, so no quit-confirmation hook is attached.
   * @param search The query string to load the shell with, including its leading `?`.
   * @returns Returns the registered entry, whose identifier addresses the window later.
   */
  public createPopoutWindow(search: string): RegisteredWindow<BrowserWindow> {
    const stored: StoredWindowState | null = WindowStateStore.read('popout');
    const restored: WindowRect | null =
      stored === null
        ? null
        : restoreWindowRect(
            stored,
            screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
            WindowManager.POPOUT_MIN_WIDTH,
            WindowManager.POPOUT_MIN_HEIGHT,
          );

    const window: BrowserWindow = new BrowserWindow({
      backgroundColor: '#000000',
      width: restored?.width ?? WindowManager.POPOUT_DEFAULT_WIDTH,
      height: restored?.height ?? WindowManager.POPOUT_DEFAULT_HEIGHT,
      ...(restored !== null ? { x: restored.x, y: restored.y } : {}),
      minWidth: WindowManager.POPOUT_MIN_WIDTH,
      minHeight: WindowManager.POPOUT_MIN_HEIGHT,
      show: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (stored?.maximized === true) {
      window.maximize();
    }

    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('popout', window);
    window.once('ready-to-show', (): void => window.show());
    // Same zoom policy as the main window: page zoom is disabled app-wide, so any persisted
    // per-origin level is reset on every load.
    window.webContents.on('did-finish-load', (): void => window.webContents.setZoomLevel(0));
    window.on('close', (): void => this.saveBounds('popout', window));
    window.on('closed', (): void => {
      this.registry.remove(entry.id);
      // The main window owns every popped-out surface; it is told when a pop-out goes away so it
      // can take the surface back.
      const main: BrowserWindow | null = this.main();
      if (main !== null && !main.isDestroyed()) {
        main.webContents.send(WindowChannel.PopoutClosed, entry.id);
      }
    });
    this.trackBounds('popout', window);

    this.options.applySecurity(window.webContents);

    if (this.options.startUrl !== undefined) void window.loadURL(this.options.startUrl + search);
    else void window.loadFile(this.options.indexHtml, { search });

    return entry;
  }

  /**
   * Closes the pop-out window with the given identifier. Main windows are never closed through
   * this path — their close runs the quit protocol instead.
   * @param id The registered identifier of the pop-out window.
   * @returns Returns true when a pop-out window with that identifier existed and was told to close.
   */
  public closePopout(id: number): boolean {
    const entry: RegisteredWindow<BrowserWindow> | null = this.registry.entry(id);
    if (entry?.kind !== 'popout' || entry.window.isDestroyed()) {
      return false;
    }
    entry.window.close();
    return true;
  }

  /**
   * Brings the pop-out window with the given identifier to the front, restoring it first when it is
   * minimized.
   * @param id The registered identifier of the pop-out window.
   * @returns Returns true when a pop-out window with that identifier existed and was focused.
   */
  public focusPopout(id: number): boolean {
    const entry: RegisteredWindow<BrowserWindow> | null = this.registry.entry(id);
    if (entry?.kind !== 'popout' || entry.window.isDestroyed()) {
      return false;
    }
    if (entry.window.isMinimized()) {
      entry.window.restore();
    }
    entry.window.focus();
    return true;
  }

  /**
   * Builds the window options an allowed auxiliary panel window opens with: pop-out chrome and the
   * persisted pop-out bounds when they are still reachable. The hardened webPreferences are
   * inherited from the opener; adoption (guards, registry, bounds tracking) happens in
   * {@link adoptAuxiliaryWindow} once the window exists.
   * @returns Returns the constructor options for the auxiliary window.
   */
  public auxiliaryWindowOptions(): Electron.BrowserWindowConstructorOptions {
    const restored: WindowRect | null = this.restoredRect('popout');
    return {
      backgroundColor: '#000000',
      width: restored?.width ?? WindowManager.POPOUT_DEFAULT_WIDTH,
      height: restored?.height ?? WindowManager.POPOUT_DEFAULT_HEIGHT,
      ...(restored !== null ? { x: restored.x, y: restored.y } : {}),
      minWidth: WindowManager.POPOUT_MIN_WIDTH,
      minHeight: WindowManager.POPOUT_MIN_HEIGHT,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    };
  }

  /**
   * Adopts an auxiliary panel window the renderer opened through the allowed window.open path:
   * hardens its web contents, registers it as a pop-out (so reveals and bounds persistence treat it
   * like any other), resets its zoom, and reports its closure to the main window.
   * @param window The created auxiliary window.
   */
  public adoptAuxiliaryWindow(window: BrowserWindow): void {
    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('popout', window);
    this.options.applySecurity(window.webContents);
    window.webContents.on('did-finish-load', (): void => window.webContents.setZoomLevel(0));
    window.on('close', (): void => this.saveBounds('popout', window));
    window.on('closed', (): void => {
      this.registry.remove(entry.id);
      const main: BrowserWindow | null = this.main();
      if (main !== null && !main.isDestroyed()) {
        main.webContents.send(WindowChannel.PopoutClosed, entry.id);
      }
    });
    this.trackBounds('popout', window);
  }

  /**
   * Restores the persisted rectangle for a window kind against the current displays.
   * @param kind The window kind to restore.
   * @returns Returns the rectangle, or null when none is usable.
   */
  private restoredRect(kind: WindowKind): WindowRect | null {
    const stored: StoredWindowState | null = WindowStateStore.read(kind);
    return stored === null
      ? null
      : restoreWindowRect(
          stored,
          screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
          kind === 'main' ? WindowManager.MIN_WIDTH : WindowManager.POPOUT_MIN_WIDTH,
          kind === 'main' ? WindowManager.MIN_HEIGHT : WindowManager.POPOUT_MIN_HEIGHT,
        );
  }

  /**
   * Resolves the registered identifier of the window owning the given web contents.
   * @param contents The web contents to resolve.
   * @returns Returns the registered identifier, or null when the contents belong to no registered
   * window.
   */
  public idForWebContents(contents: WebContents): number | null {
    for (const entry of this.registry.all()) {
      if (!entry.window.isDestroyed() && entry.window.webContents === contents) {
        return entry.id;
      }
    }
    return null;
  }

  /**
   * Gets the web contents of the pop-out window with the given identifier.
   * @param id The registered identifier of the pop-out window.
   * @returns Returns the web contents, or null when no live pop-out has that identifier.
   */
  public popoutWebContents(id: number): WebContents | null {
    const entry: RegisteredWindow<BrowserWindow> | null = this.registry.entry(id);
    if (entry?.kind !== 'popout' || entry.window.isDestroyed()) {
      return null;
    }
    return entry.window.webContents;
  }

  /**
   * Closes every pop-out window. Called when the main window reloads: a reloaded renderer has lost
   * the owner-side state its pop-outs mirrored, so they cannot outlive it.
   */
  public closeAllPopouts(): void {
    for (const entry of this.registry.all()) {
      if (entry.kind === 'popout' && !entry.window.isDestroyed()) {
        entry.window.close();
      }
    }
  }

  /**
   * Persists a window's bounds whenever it settles after a move or resize.
   * @param kind The window kind the bounds persist under.
   * @param window The window to track.
   */
  private trackBounds(kind: WindowKind, window: BrowserWindow): void {
    let timer: NodeJS.Timeout | null = null;
    const scheduleSave: () => void = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout((): void => {
        timer = null;
        this.saveBounds(kind, window);
      }, WindowManager.BOUNDS_SAVE_DEBOUNCE_MS);
    };
    window.on('resize', scheduleSave);
    window.on('move', scheduleSave);
    window.on('closed', (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  }

  /**
   * Persists a window's current normal bounds and maximized flag.
   * @param kind The window kind the bounds persist under.
   * @param window The window whose bounds to persist.
   */
  private saveBounds(kind: WindowKind, window: BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }
    WindowStateStore.write(kind, {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  }
}
