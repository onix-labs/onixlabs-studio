import { BrowserWindow, Display, Event as ElectronEvent, screen, WebContents } from 'electron';
import {
  parseFeatureFlag,
  parseFeatureText,
  parseNamedSize,
  parseRequestedPosition,
  parseRequestedSize,
  restoreWindowRect,
  StoredWindowState,
  WindowRect,
} from './window-state';
import { MODAL_UNPARENTED_FEATURE } from '@shared/api/window-channels';
import { RegisteredWindow, WindowKind, WindowRegistry } from './window-registry';
import { WindowStateStore } from './window-state-store';
import { logger } from './logger';

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
   * Handles the main window STARTING a page (re)load, so the program can retire the state the
   * outgoing renderer owned. It fires before the incoming page's scripts run, which matters: the
   * fresh renderer opens its own windows (the welcome screen) within milliseconds of booting, and
   * cleaning up after that would take them with it.
   */
  readonly onMainDidStartLoad: () => void;
}

/**
 * Owns every application window: creation and loading, the registry that resolves the main window
 * for renderer-push targets, and per-kind bounds persistence. Besides the main window, the registry
 * holds the auxiliary pop-out windows the renderer opens (adopted in {@link adoptAuxiliaryWindow}).
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
   * Holds how long (ms) after the main window is ready to wait for the renderer to show it before
   * showing it regardless, so a renderer that never asks can never leave the app windowless.
   */
  private static readonly MAIN_SHOW_FALLBACK_MS: number = 4000;

  /**
   * Holds the default modal-window width, used when the opener requested no size.
   */
  private static readonly MODAL_DEFAULT_WIDTH: number = 480;

  /**
   * Holds the default modal-window height, used when the opener requested no size.
   */
  private static readonly MODAL_DEFAULT_HEIGHT: number = 320;

  /**
   * Holds the minimum modal-window width. A modal hosts one dialog panel, so it may shrink to the
   * size of a short confirmation.
   */
  private static readonly MODAL_MIN_WIDTH: number = 240;

  /**
   * Holds the minimum modal-window height.
   */
  private static readonly MODAL_MIN_HEIGHT: number = 120;

  /**
   * Holds the registered windows.
   */
  private readonly registry: WindowRegistry<BrowserWindow> = new WindowRegistry<BrowserWindow>();

  /**
   * Holds the application-supplied options.
   */
  private readonly options: WindowManagerOptions;

  /**
   * Holds the pending safety-net timer that shows the main window when the renderer never speaks
   * for it, or null once it has fired or been retired.
   */
  private mainShowFallback: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds a value indicating whether the renderer has spoken for the main window's presence. It is
   * sticky because the renderer routinely speaks BEFORE the window is ready to show — a cold start
   * decides to stay hidden within milliseconds — and the safety net must not arm afterwards.
   */
  private mainPresenceClaimed: boolean = false;

  /**
   * Holds a value indicating whether the main window opens maximized, applied when it is first
   * shown rather than when it is created.
   */
  private mainStartsMaximized: boolean = false;

  /**
   * Holds the window the next modal window adopts as its parent, recorded when its options are
   * built and consumed the moment it is created. Null when the pending modal asked to stand alone,
   * or when none is pending.
   */
  private pendingModalParent: BrowserWindow | null = null;

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
    logger.trace('WindowManager.focusMain', 'focusing main window');
    const window: BrowserWindow | null = this.main();
    if (window === null) {
      logger.debug('WindowManager.focusMain', 'no main window to focus');
      return;
    }
    if (window.isMinimized()) {
      logger.debug('WindowManager.focusMain', 'restoring minimized main window');
      window.restore();
    }
    window.focus();
  }

  /**
   * Retires the safety net that would otherwise show the main window: the renderer has spoken for
   * the window's presence, so its decision — including a decision to stay hidden behind the welcome
   * window — stands.
   */
  public claimMainPresence(): void {
    logger.trace('WindowManager.claimMainPresence', 'renderer claimed main-window presence');
    this.mainPresenceClaimed = true;
    if (this.mainShowFallback !== null) {
      logger.debug('WindowManager.claimMainPresence', 'retiring show safety-net timer');
      clearTimeout(this.mainShowFallback);
      this.mainShowFallback = null;
    }
  }

  /**
   * Shows a window, restoring the maximized state the main window was persisted with the first time
   * it is shown. Hidden windows cannot be maximized without being revealed, so the restore waits
   * for the moment there is something worth revealing.
   * @param window The window to show.
   */
  public showWindow(window: BrowserWindow): void {
    if (window.isDestroyed() || window.isVisible()) {
      logger.trace(
        'WindowManager.showWindow',
        'window already destroyed or visible; nothing to do',
      );
      return;
    }
    if (window === this.main() && this.mainStartsMaximized) {
      logger.debug(
        'WindowManager.showWindow',
        'restoring persisted maximized state for main window',
      );
      this.mainStartsMaximized = false;
      window.maximize();
    }
    logger.info('WindowManager.showWindow', 'showing window');
    window.show();
    window.focus();
  }

  /**
   * Creates the main application window — restoring its persisted bounds when they are still
   * reachable on the current displays — and loads the Angular application into it.
   * @returns Returns the created window.
   */
  public createMainWindow(): BrowserWindow {
    logger.trace('WindowManager.createMainWindow', 'creating main window');
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
      // A click into an application window acts on what it lands on, rather than being spent
      // bringing the window forward. It is what makes one click on a modal's backdrop dismiss the
      // modal: the backdrop covers the whole window while one is open, so the click that reaches
      // past the modal IS the click the backdrop answers.
      acceptFirstMouse: true,
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
    // Maximizing a window that has not been shown SHOWS it on macOS, which would flash an empty
    // IDE window before the shell has decided whether to show it at all. The choice is remembered
    // and applied at the moment the window is shown.
    this.mainStartsMaximized = stored?.maximized === true;
    logger.debug('WindowManager.createMainWindow', 'built main window', {
      restored: restored !== null,
      maximized: this.mainStartsMaximized,
      bounds: window.getBounds(),
    });

    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('main', window);
    // The main window is shown by the renderer, not by readiness: with no tabs open the shell puts
    // the welcome screen in its own window and leaves this one hidden, so showing it here would
    // flash an empty IDE first. The timer is the safety net — a renderer that never speaks for it (a
    // failed boot, a broken bridge) must not leave the application with no window at all — and the
    // first word from the renderer, show or hide, retires it.
    window.once('ready-to-show', (): void => {
      if (this.mainPresenceClaimed) {
        logger.trace(
          'WindowManager.createMainWindow',
          'ready-to-show; presence claimed, no safety net',
        );
        return;
      }
      logger.debug('WindowManager.createMainWindow', 'ready-to-show; arming show safety-net timer');
      this.mainShowFallback = setTimeout((): void => {
        this.mainShowFallback = null;
        if (!window.isDestroyed() && !window.isVisible()) {
          logger.warn(
            'WindowManager.createMainWindow',
            'renderer never spoke for main window; showing via safety net',
          );
          this.showWindow(window);
        }
      }, WindowManager.MAIN_SHOW_FALLBACK_MS);
    });
    // Page zoom is disabled (the application menu omits the zoom roles), but Chromium persists zoom
    // levels per-origin in the session, so a level set before zoom was disabled would silently apply
    // forever. Reset it on every load; content zoom belongs to the editors' own zoom controls.
    window.webContents.on('did-finish-load', (): void => window.webContents.setZoomLevel(0));
    window.webContents.on('did-start-loading', (): void => this.options.onMainDidStartLoad());
    // Bounds are saved on close as well as on the debounced move/resize, so the final arrangement
    // always wins — including on the quit path, where close follows the confirmed quit.
    window.on('close', (event: ElectronEvent): void => {
      logger.trace('WindowManager.createMainWindow', 'main window close event');
      this.saveBounds('main', window);
      this.options.onMainClose(event);
    });
    window.on('closed', (): void => {
      logger.info('WindowManager.createMainWindow', 'main window closed');
      this.registry.remove(entry.id);
    });
    this.trackBounds('main', window);

    this.options.applySecurity(window.webContents);

    if (this.options.startUrl !== undefined) {
      logger.debug('WindowManager.createMainWindow', `loading start URL: ${this.options.startUrl}`);
      void window.loadURL(this.options.startUrl);
    } else {
      logger.debug(
        'WindowManager.createMainWindow',
        `loading index file: ${this.options.indexHtml}`,
      );
      void window.loadFile(this.options.indexHtml);
    }

    logger.info('WindowManager.createMainWindow', 'main window created');
    return window;
  }

  /**
   * Builds the window options an allowed auxiliary panel window opens with: pop-out chrome and the
   * persisted pop-out bounds when they are still reachable. A position requested by the opener (a
   * tear-out drag placing the window at the drop point) wins over the persisted one, clamped
   * against the current displays so a drop near a screen edge never strands the window. The
   * hardened webPreferences are inherited from the opener; adoption (guards, registry, bounds
   * tracking) happens in {@link adoptAuxiliaryWindow} once the window exists.
   * @param features The raw features string of the window-open request.
   * @returns Returns the constructor options for the auxiliary window.
   */
  public auxiliaryWindowOptions(features: string): Electron.BrowserWindowConstructorOptions {
    logger.trace('WindowManager.auxiliaryWindowOptions', 'building pop-out options', features);
    const restored: WindowRect | null = this.restoredRect('popout');
    const width: number = restored?.width ?? WindowManager.POPOUT_DEFAULT_WIDTH;
    const height: number = restored?.height ?? WindowManager.POPOUT_DEFAULT_HEIGHT;
    const requested: { x: number; y: number } | null = parseRequestedPosition(features);
    const placed: WindowRect | null =
      requested === null
        ? null
        : restoreWindowRect(
            { bounds: { x: requested.x, y: requested.y, width, height }, maximized: false },
            screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
            WindowManager.POPOUT_MIN_WIDTH,
            WindowManager.POPOUT_MIN_HEIGHT,
          );
    const rect: WindowRect | null = placed ?? restored;
    logger.debug('WindowManager.auxiliaryWindowOptions', 'resolved pop-out placement', {
      requested: requested !== null,
      placed: placed !== null,
      rect,
    });
    return {
      backgroundColor: '#000000',
      acceptFirstMouse: true,
      width: rect?.width ?? width,
      height: rect?.height ?? height,
      ...(rect !== null ? { x: rect.x, y: rect.y } : {}),
      minWidth: WindowManager.POPOUT_MIN_WIDTH,
      minHeight: WindowManager.POPOUT_MIN_HEIGHT,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    };
  }

  /**
   * Adopts an auxiliary panel window the renderer opened through the allowed window.open path:
   * hardens its web contents, registers it as a pop-out (so bounds persistence and reload cleanup
   * treat it like any other), and resets its zoom. The opener observes the window's closure itself
   * (it holds the DOM window), so no notification is sent.
   * @param window The created auxiliary window.
   */
  public adoptAuxiliaryWindow(window: BrowserWindow): void {
    logger.trace('WindowManager.adoptAuxiliaryWindow', 'adopting auxiliary pop-out window');
    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('popout', window);
    this.options.applySecurity(window.webContents);
    window.webContents.on('did-finish-load', (): void => window.webContents.setZoomLevel(0));
    window.on('close', (): void => this.saveBounds('popout', window));
    window.on('closed', (): void => {
      logger.info('WindowManager.adoptAuxiliaryWindow', 'pop-out window closed');
      this.registry.remove(entry.id);
    });
    this.trackBounds('popout', window);
    logger.info('WindowManager.adoptAuxiliaryWindow', 'pop-out window adopted');
  }

  /**
   * Builds the window options a modal window opens with: the size the opener measured against its
   * content, the position it centred over the raising window, and dialog chrome — no minimize, no
   * fullscreen, resizing only when the modal asked for it, and no close button for a blocking modal
   * (one its content alone may dismiss). Both the size and the position are
   * clamped against the current displays, so a modal raised near a screen edge (or one whose
   * content is taller than the display) still opens fully on-screen. Modal bounds are never
   * persisted: a modal opens sized to what it currently holds, every time.
   * The window that raised the modal is remembered here rather than passed to
   * {@link adoptModalWindow}, because the created-window event carries the resolved options, not
   * the features string the parenting choice rides on. Creation follows this call synchronously, so
   * the pending parent is always the one the next adoption consumes.
   * @param features The raw features string of the window-open request.
   * @param opener The window the modal was raised from, or null when it could not be resolved.
   * @returns Returns the constructor options for the modal window.
   */
  public modalWindowOptions(
    features: string,
    opener: BrowserWindow | null,
  ): Electron.BrowserWindowConstructorOptions {
    logger.trace('WindowManager.modalWindowOptions', 'building modal options', features);
    const resizable: boolean = parseFeatureFlag(features, 'resizable', false);
    this.pendingModalParent = parseFeatureFlag(features, MODAL_UNPARENTED_FEATURE, false)
      ? null
      : opener;
    // A modal may state its own resize bounds; otherwise it may shrink to the size of a short
    // confirmation and has no ceiling but the display.
    const minimum: { width: number; height: number } = parseNamedSize(features, 'min') ?? {
      width: WindowManager.MODAL_MIN_WIDTH,
      height: WindowManager.MODAL_MIN_HEIGHT,
    };
    const maximum: { width: number; height: number } | null = parseNamedSize(features, 'max');
    const requested: { width: number; height: number } = parseRequestedSize(features) ?? {
      width: WindowManager.MODAL_DEFAULT_WIDTH,
      height: WindowManager.MODAL_DEFAULT_HEIGHT,
    };
    const size: { width: number; height: number } = {
      width: Math.max(minimum.width, Math.min(requested.width, maximum?.width ?? Infinity)),
      height: Math.max(minimum.height, Math.min(requested.height, maximum?.height ?? Infinity)),
    };
    const position: { x: number; y: number } | null = parseRequestedPosition(features);
    const rect: WindowRect | null = restoreWindowRect(
      {
        bounds: {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
          width: size.width,
          height: size.height,
        },
        maximized: false,
      },
      screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
      minimum.width,
      minimum.height,
    );
    logger.debug('WindowManager.modalWindowOptions', 'resolved modal geometry', {
      parented: this.pendingModalParent !== null,
      resizable,
      size,
      positioned: position !== null,
      rect,
    });
    return {
      // The modal paints this until its content renders; the opener passes the colour its panel
      // will land on, so a modal window never flashes black on the way in.
      backgroundColor: WindowManager.modalBackground(features),
      acceptFirstMouse: true,
      width: rect?.width ?? size.width,
      height: rect?.height ?? size.height,
      ...(rect !== null && position !== null ? { x: rect.x, y: rect.y } : {}),
      minWidth: minimum.width,
      minHeight: minimum.height,
      ...(maximum === null ? {} : { maxWidth: maximum.width, maxHeight: maximum.height }),
      resizable,
      // A modal that states a ceiling has nothing to maximize to.
      maximizable: resizable && maximum === null,
      closable: parseFeatureFlag(features, 'closable', true),
      minimizable: false,
      fullscreenable: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    };
  }

  /**
   * Reads the background colour a modal window opens with from its features, falling back to black
   * when the opener passed none or passed something that is not a plain `rrggbb` triplet.
   * @param features The raw features string of the window-open request.
   * @returns Returns the CSS colour to paint the window with.
   */
  private static modalBackground(features: string): string {
    const value: string | null = parseFeatureText(features, 'bgcolor');
    return value !== null && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : '#000000';
  }

  /**
   * Adopts a modal window the renderer opened through the allowed window.open path: hardens its web
   * contents, registers it as a modal, resets its zoom, and — unless the opener asked for a
   * free-standing window — parents it to the window that raised it, so it always floats above that
   * window and closes with it. A free-standing modal is the welcome screen's cold start, where the
   * main window is hidden: on macOS a child of a hidden parent is not displayed at all.
   *
   * A HIDDEN opener is treated the same way, whatever the opener asked for. Attaching a child to a
   * hidden window drags that window back on screen on macOS — and returning focus to it as the child
   * closes shows it again — which is exactly what the main window must not do while the welcome
   * screen stands in for it.
   * @param window The created modal window.
   */
  public adoptModalWindow(window: BrowserWindow): void {
    logger.trace('WindowManager.adoptModalWindow', 'adopting modal window');
    const parent: BrowserWindow | null = this.pendingModalParent;
    this.pendingModalParent = null;
    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('modal', window);
    this.options.applySecurity(window.webContents);
    window.webContents.on('did-finish-load', (): void => window.webContents.setZoomLevel(0));
    window.on('closed', (): void => {
      logger.info('WindowManager.adoptModalWindow', 'modal window closed');
      this.registry.remove(entry.id);
    });
    if (parent !== null && !parent.isDestroyed() && parent.isVisible()) {
      logger.debug('WindowManager.adoptModalWindow', 'parenting modal to its opener');
      window.setParentWindow(parent);
    } else {
      logger.debug(
        'WindowManager.adoptModalWindow',
        'modal opens free-standing (no visible parent)',
      );
    }
    logger.info('WindowManager.adoptModalWindow', 'modal window adopted');
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
   * Closes every secondary window — pop-outs and modals alike. Called when the main window reloads:
   * both kinds share the main renderer's JS context, so a reload leaves them dead — they cannot
   * outlive it.
   */
  public closeAllSecondaryWindows(): void {
    logger.info('WindowManager.closeAllSecondaryWindows', 'closing all pop-out and modal windows');
    for (const entry of this.registry.all()) {
      if (entry.kind !== 'main' && !entry.window.isDestroyed()) {
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
      logger.trace('WindowManager.saveBounds', `'${kind}' window destroyed; not persisting bounds`);
      return;
    }
    logger.trace('WindowManager.saveBounds', `persisting bounds for '${kind}'`);
    WindowStateStore.write(kind, {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  }
}
