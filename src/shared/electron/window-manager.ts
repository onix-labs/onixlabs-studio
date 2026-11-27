import { app, BrowserWindow, Display, Event as ElectronEvent, screen, WebContents } from 'electron';
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
import {
  CHILD_WINDOW_NAME_PATTERN,
  MODAL_FRAMELESS_FEATURE,
  MODAL_UNPARENTED_FEATURE,
  WindowChannel,
} from '@shared/api/window-channels';
import { RegisteredWindow, WindowKind, WindowRegistry } from './window-registry';
import { WindowStateStore } from './window-state-store';
import { logger } from './logger';
import type { StartupSettings } from '@shared/api/startup-settings';
import { zoomFactorOf } from '@shared/api/interface-zoom';
import { overlayHeightAt, trafficLightPositionAt } from './zoomed-chrome';
import type { ModalSizing, PixelSize } from './modal-sizing';

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

  /**
   * Reads the startup settings in force (window size on launch, full-screen restore, Interface Zoom),
   * as the renderer last mirrored them.
   * @returns Returns the startup settings.
   */
  readonly startupSettings: () => StartupSettings;
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
   * Holds the colour of the Windows caption-button glyphs, which follows the application's theme.
   * Starts with the dark theme's, which is the default.
   */
  private overlaySymbolColor: string = '#adb5bd';

  /**
   * Holds the registered windows.
   */
  private readonly registry: WindowRegistry<BrowserWindow> = new WindowRegistry<BrowserWindow>();

  /**
   * Holds the open pop-out and modal windows by the name each was opened with.
   */
  private readonly childWindows: Map<string, BrowserWindow> = new Map<string, BrowserWindow>();

  /**
   * Holds the application-supplied options.
   */
  private readonly options: WindowManagerOptions;

  /**
   * Holds whether the application is the one the user is currently working in.
   *
   * 🔥 Starts true, and that is the whole safety of it. Seeding it false would mean a window shown
   * before anything had reported activation — the first one, on an ordinary launch — came up unfocused,
   * and a window you have to click before you can type in it is a worse bug than the one being fixed.
   * Starting true means activation is only ever suppressed once the user has demonstrably gone
   * somewhere else.
   */
  private applicationActive: boolean = true;

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
   * Holds a value indicating whether the main window opens in full screen, applied when it is first
   * shown for the same reason as {@link mainStartsMaximized}.
   */
  private mainStartsFullScreen: boolean = false;

  /**
   * Holds the window the next modal window adopts as its parent, recorded when its options are
   * built and consumed the moment it is created. Null when the pending modal asked to stand alone,
   * or when none is pending.
   */
  private pendingModalParent: BrowserWindow | null = null;

  /**
   * Holds the size the next modal window means to be, in CSS pixels, recorded with its parent when
   * its options are built and consumed the moment it is adopted.
   */
  private pendingModalSizing: ModalSizing | null = null;

  /**
   * Initializes a new instance of the {@link WindowManager} class.
   * @param options The application-supplied pieces the manager builds windows with.
   */
  public constructor(options: WindowManagerOptions) {
    this.options = options;
    // ⚠️ Both events are macOS-only, so nothing maintains this elsewhere — which is why it starts
    // true. Everywhere without them keeps the behaviour it had, and on macOS the flag only ever goes
    // false on positive evidence that the user moved to another application.
    app.on('did-become-active', (): void => {
      this.applicationActive = true;
    });
    app.on('did-resign-active', (): void => {
      logger.debug('WindowManager', 'application resigned active; windows will show unfocused');
      this.applicationActive = false;
    });
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
    if (window === this.main() && this.mainStartsFullScreen) {
      logger.debug('WindowManager.showWindow', 'restoring persisted full screen for main window');
      this.mainStartsFullScreen = false;
      window.setFullScreen(true);
    }
    // 🔥 `show()` activates the application on macOS; dropping the `focus()` that used to follow it
    // was not enough. Studio takes a while to boot, and a user who switched to something else while it
    // did had the window — and the application with it — yanked in front of them at the moment it
    // finished. So a window is only shown *active* when the user is already here; when they are not,
    // it takes its place behind whatever they moved on to and waits to be asked for.
    //
    // Deliberate focus requests are unaffected: a second instance launching and the dock icon both go
    // through `focusMain`, which focuses explicitly.
    if (this.applicationActive) {
      logger.info('WindowManager.showWindow', 'showing window');
      window.show();
      return;
    }
    logger.info('WindowManager.showWindow', 'showing window unfocused; the user is elsewhere');
    window.showInactive();
  }

  /**
   * Creates the main application window — restoring its persisted bounds when they are still
   * reachable on the current displays — and loads the Angular application into it.
   * @returns Returns the created window.
   */
  public createMainWindow(): BrowserWindow {
    logger.trace('WindowManager.createMainWindow', 'creating main window');
    const settings: StartupSettings = this.options.startupSettings();
    const stored: StoredWindowState | null = WindowStateStore.read('main');
    // Only Remember Last restores the persisted bounds; the default size opens centred, which is
    // what a window built without a position does.
    const restored: WindowRect | null =
      stored === null || settings.windowSizeOnLaunch !== 'remember'
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
      ...this.chrome(),
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Drawn at the Interface Zoom from the first paint, rather than at 100% until the page loads.
        zoomFactor: this.zoomFactor(),
      },
    });
    // Maximizing a window that has not been shown SHOWS it on macOS, which would flash an empty
    // IDE window before the shell has decided whether to show it at all. The choice is remembered
    // and applied at the moment the window is shown.
    this.mainStartsMaximized =
      settings.windowSizeOnLaunch === 'maximised' ||
      (settings.windowSizeOnLaunch === 'remember' && stored?.maximized === true);
    this.mainStartsFullScreen = settings.restoreFullScreen && stored?.fullScreen === true;
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
    // The window is drawn at the Interface Zoom and nothing else. The application menu has no zoom
    // roles, but Chromium remembers a zoom per origin in the session, so a level set some other way
    // would otherwise come back on every load. Content zoom belongs to the editors' own controls.
    window.webContents.on('did-finish-load', (): void => this.applyZoom(window));
    window.webContents.on('did-start-loading', (): void => this.options.onMainDidStartLoad());
    // The renderer is told whether the window is in full screen, where macOS draws no traffic lights
    // over the title strip: on every change, and after each load for the state it starts in.
    const reportFullScreen: () => void = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send(WindowChannel.FullScreenChanged, window.isFullScreen());
      }
    };
    window.on('enter-full-screen', reportFullScreen);
    window.on('leave-full-screen', reportFullScreen);
    window.webContents.on('did-finish-load', reportFullScreen);
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
            {
              bounds: { x: requested.x, y: requested.y, width, height },
              maximized: false,
              fullScreen: false,
            },
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
      ...this.chrome(),
    };
  }

  /**
   * Adopts an auxiliary panel window the renderer opened through the allowed window.open path:
   * hardens its web contents, registers it as a pop-out (so bounds persistence and reload cleanup
   * treat it like any other), and draws it at the Interface Zoom. The opener observes the window's
   * closure itself (it holds the DOM window), so no notification is sent.
   * @param window The created auxiliary window.
   * @param name The name the window was opened with.
   */
  public adoptAuxiliaryWindow(window: BrowserWindow, name: string): void {
    logger.trace('WindowManager.adoptAuxiliaryWindow', 'adopting auxiliary pop-out window');
    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('popout', window);
    this.recordChildName(window, name);
    this.options.applySecurity(window.webContents);
    this.applyZoom(window);
    window.webContents.on('did-finish-load', (): void => this.applyZoom(window));
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
    const unparented: boolean = parseFeatureFlag(features, MODAL_UNPARENTED_FEATURE, false);
    // Raised from a window that is hidden — the main window, while the welcome screen stands in for it
    // — the modal belongs to the modal window the user is looking at instead: centred over it and
    // moving with it, rather than placed over a window they cannot see.
    const standIn: BrowserWindow | null = unparented ? null : this.visibleStandIn(opener);
    this.pendingModalParent = unparented ? null : (standIn ?? opener);
    // A modal may state its own resize bounds; otherwise it may shrink to the size of a short
    // confirmation and has no ceiling but the display.
    const stated: { width: number; height: number } = parseNamedSize(features, 'min') ?? {
      width: WindowManager.MODAL_MIN_WIDTH,
      height: WindowManager.MODAL_MIN_HEIGHT,
    };
    const maximum: { width: number; height: number } | null = parseNamedSize(features, 'max');
    const requested: { width: number; height: number } = parseRequestedSize(features) ?? {
      width: WindowManager.MODAL_DEFAULT_WIDTH,
      height: WindowManager.MODAL_DEFAULT_HEIGHT,
    };
    // A stated minimum is held to the display it opens on. At a large Interface Zoom a modal's
    // minimum (the welcome screen's, at 200%) can outgrow a small display, and a window larger than
    // the screen has controls no one can reach; its content scrolls or clips instead.
    const opening: { x: number; y: number } | null = parseRequestedPosition(features);
    const area: Electron.Rectangle = screen.getDisplayMatching({
      x: opening?.x ?? 0,
      y: opening?.y ?? 0,
      width: requested.width,
      height: requested.height,
    }).workArea;
    const minimum: { width: number; height: number } = {
      width: Math.min(stated.width, area.width),
      height: Math.min(stated.height, area.height),
    };
    const size: { width: number; height: number } = {
      width: Math.max(minimum.width, Math.min(requested.width, maximum?.width ?? Infinity)),
      height: Math.max(minimum.height, Math.min(requested.height, maximum?.height ?? Infinity)),
    };
    // What the modal asked for before the display held it, in CSS pixels, so a later zoom change can
    // give it back what the display took (see ModalSizing).
    const zoom: number = this.zoomFactor();
    this.pendingModalSizing = {
      size: {
        width: Math.max(stated.width, Math.min(requested.width, maximum?.width ?? Infinity)) / zoom,
        height:
          Math.max(stated.height, Math.min(requested.height, maximum?.height ?? Infinity)) / zoom,
      },
      minimum: { width: stated.width / zoom, height: stated.height / zoom },
      maximum:
        maximum === null ? null : { width: maximum.width / zoom, height: maximum.height / zoom },
      zoom,
      applied: { width: 0, height: 0 },
    };
    const position: { x: number; y: number } | null =
      standIn === null ? parseRequestedPosition(features) : centredOver(standIn.getBounds(), size);
    const rect: WindowRect | null = restoreWindowRect(
      {
        bounds: {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
          width: size.width,
          height: size.height,
        },
        maximized: false,
        fullScreen: false,
      },
      screen.getAllDisplays().map((display: Display): WindowRect => display.workArea),
      minimum.width,
      minimum.height,
    );
    // Restoring only keeps a window's title strip grabbable; a modal is held wholly on its display.
    const placed: { x: number; y: number } | null =
      rect === null || position === null
        ? null
        : heldWithin(rect, rect, screen.getDisplayMatching(rect).workArea);
    logger.debug('WindowManager.modalWindowOptions', 'resolved modal geometry', {
      parented: this.pendingModalParent !== null,
      resizable,
      size,
      positioned: position !== null,
      rect,
      placed,
    });
    return {
      // 🔥 Created hidden, and shown by {@link adoptModalWindow} a moment later through the same
      // activation-aware path every other window uses. Electron's default is `show: true`, which
      // means the window shows itself the instant it is constructed — and on macOS that activates the
      // application. The welcome screen is a modal opened this way during boot, so the one window
      // that appears on a cold start was the one window nothing could stop from stealing focus.
      show: false,
      // The modal paints this until its content renders; the opener passes the colour its panel
      // will land on, so a modal window never flashes black on the way in.
      backgroundColor: WindowManager.modalBackground(features),
      acceptFirstMouse: true,
      width: rect?.width ?? size.width,
      height: rect?.height ?? size.height,
      ...(placed ?? {}),
      minWidth: minimum.width,
      minHeight: minimum.height,
      ...(maximum === null ? {} : { maxWidth: maximum.width, maxHeight: maximum.height }),
      resizable,
      // A modal that states a ceiling has nothing to maximize to.
      maximizable: resizable && maximum === null,
      closable: parseFeatureFlag(features, 'closable', true),
      minimizable: false,
      fullscreenable: false,
      ...(parseFeatureFlag(features, MODAL_FRAMELESS_FEATURE, false)
        ? { frame: false }
        : this.chrome()),
    };
  }

  /**
   * Finds the window a modal raised from a hidden window is shown over: the newest modal window still
   * on screen, which is the one in front of the user.
   * @param opener The window the modal was raised from.
   * @returns Returns that window, or null when the opener is on screen itself (or there is none).
   */
  private visibleStandIn(opener: BrowserWindow | null): BrowserWindow | null {
    if (opener === null || opener.isDestroyed() || opener.isVisible()) {
      return null;
    }
    const modals: BrowserWindow[] = this.registry
      .all()
      .filter((entry: RegisteredWindow<BrowserWindow>): boolean => entry.kind === 'modal')
      .map((entry: RegisteredWindow<BrowserWindow>): BrowserWindow => entry.window)
      .filter((window: BrowserWindow): boolean => !window.isDestroyed() && window.isVisible());
    return modals.at(-1) ?? null;
  }

  /**
   * Builds the title-bar options every window shares, which differ by platform.
   *
   * - macOS hides the title bar and insets the traffic lights over the content, which leaves room for
   *   them at the leading end of each window's strip.
   * - Windows hides the title bar too, but keeps the system's own caption buttons, drawn over the
   *   trailing end of the content (the window controls overlay). They behave as caption buttons do
   *   everywhere else on Windows — snap layouts on the maximize button included. The overlay is
   *   transparent, so each window's own strip shows through it whatever colour that strip is.
   * - Linux drops the frame altogether, and the renderer draws the window's controls itself at the
   *   trailing end of each window's strip (`app-window-controls`), acting on the window through
   *   {@link targetWindow}.
   * - Anywhere else keeps the native frame.
   * @returns Returns the title-bar constructor options for the current platform.
   */
  private chrome(): Electron.BrowserWindowConstructorOptions {
    switch (process.platform) {
      case 'darwin':
        return {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: trafficLightPositionAt(this.zoomFactor()),
        };
      case 'win32':
        return { titleBarStyle: 'hidden', titleBarOverlay: this.overlay() };
      case 'linux':
        return { frame: false };
      default:
        return {};
    }
  }

  /**
   * Resolves the window a window-control request acts on: the named pop-out or modal window when the
   * request names one, and otherwise the window that sent it. A child window's requests arrive from
   * the window that opened it (it is a same-renderer child the opener scripts directly), so the name
   * it was opened with is how it is told apart.
   * @param sender The web contents the request came from.
   * @param name The name of the child window meant, or undefined for the sender's own window.
   * @returns Returns the window, or null when none matches or the sender is not one of ours.
   */
  public targetWindow(sender: WebContents, name: unknown): BrowserWindow | null {
    const own: BrowserWindow | null = BrowserWindow.fromWebContents(sender);
    if (name === undefined || name === null) {
      return own;
    }
    // Only an application window may address another, and only by a well-formed child name.
    if (own === null || typeof name !== 'string' || !CHILD_WINDOW_NAME_PATTERN.test(name)) {
      return null;
    }
    const target: BrowserWindow | undefined = this.childWindows.get(name);
    return target === undefined || target.isDestroyed() ? null : target;
  }

  /**
   * Records a pop-out or modal window under the name it was opened with, for as long as it lives, so
   * window-control requests can address it (see {@link targetWindow}).
   * @param window The child window.
   * @param name The name it was opened with; one that is not a child-window name is not recorded.
   */
  private recordChildName(window: BrowserWindow, name: string): void {
    if (!CHILD_WINDOW_NAME_PATTERN.test(name)) {
      return;
    }
    this.childWindows.set(name, window);
    window.on('closed', (): void => {
      // The name may have gone to a new window by now; only its own entry is this window's to remove.
      if (this.childWindows.get(name) === window) {
        this.childWindows.delete(name);
      }
    });
  }

  /**
   * Builds the Windows caption-button overlay in the current theme's colours.
   * @returns Returns the overlay options.
   */
  private overlay(): Electron.TitleBarOverlay {
    return {
      color: '#00000000',
      symbolColor: this.overlaySymbolColor,
      height: overlayHeightAt(this.zoomFactor()),
    };
  }

  /**
   * Holds each window's own minimum size as it was before any dock layout raised it, so a layout that
   * needs less hands the window back its floor rather than leaving it raised.
   */
  private readonly baseMinimums: WeakMap<BrowserWindow, readonly [number, number]> = new WeakMap<
    BrowserWindow,
    readonly [number, number]
  >();

  /**
   * Holds the least content size each window's dock layout last asked for, in CSS pixels, so a change
   * of Interface Zoom can work the window's minimum out again: the layout needs the same CSS pixels at
   * any zoom, but more or fewer of the screen's.
   */
  private readonly layoutMinimums: WeakMap<BrowserWindow, readonly [number, number]> = new WeakMap<
    BrowserWindow,
    readonly [number, number]
  >();

  /**
   * Sets a window's minimum size to what its dock layout needs (#1064): the layout's combined
   * minimum, as content, plus the window's frame. Never below the window's own floor, so the shell
   * keeps room for its chrome; never above the work area of the display it is on, so a crowded
   * layout can still be opened there.
   * @param window The window.
   * @param contentWidth The least content width the layout needs, in CSS pixels.
   * @param contentHeight The least content height the layout needs, in CSS pixels.
   */
  public setLayoutMinimumSize(
    window: BrowserWindow,
    contentWidth: number,
    contentHeight: number,
  ): void {
    if (window.isDestroyed()) {
      return;
    }
    this.layoutMinimums.set(window, [contentWidth, contentHeight]);
    // The renderer measures in CSS pixels; the window is sized in the screen's, which the Interface
    // Zoom stretches or shrinks them to.
    const factor: number = this.zoomFactor();
    let base: readonly [number, number] | undefined = this.baseMinimums.get(window);
    if (base === undefined) {
      const [width, height]: number[] = window.getMinimumSize();
      base = [width, height];
      this.baseMinimums.set(window, base);
    }
    const [outerWidth, outerHeight]: number[] = window.getSize();
    const [innerWidth, innerHeight]: number[] = window.getContentSize();
    const display: Display = screen.getDisplayMatching(window.getBounds());
    const width: number = Math.min(
      display.workAreaSize.width,
      Math.max(base[0], Math.ceil(contentWidth * factor + (outerWidth - innerWidth))),
    );
    const height: number = Math.min(
      display.workAreaSize.height,
      Math.max(base[1], Math.ceil(contentHeight * factor + (outerHeight - innerHeight))),
    );
    const [currentWidth, currentHeight]: number[] = window.getMinimumSize();
    if (currentWidth !== width || currentHeight !== height) {
      window.setMinimumSize(width, height);
    }
  }

  /**
   * Draws every open window at the Interface Zoom in force, after the setting changes: their web
   * contents, the room their title strips leave for the window controls, and the minimum size their
   * dock layouts need.
   */
  public applyInterfaceZoom(): void {
    logger.debug('WindowManager.applyInterfaceZoom', `interface zoom now ${this.zoomFactor()}`);
    for (const entry of this.registry.all()) {
      this.applyZoom(entry.window);
    }
  }

  /**
   * Holds the size each modal window means to be, so a change of Interface Zoom can work it out again.
   */
  private readonly modalSizings: WeakMap<BrowserWindow, ModalSizing> = new WeakMap<
    BrowserWindow,
    ModalSizing
  >();

  /**
   * Gets the zoom factor windows are drawn at, from the Interface Zoom setting.
   * @returns Returns the zoom factor (1 for 100%).
   */
  private zoomFactor(): number {
    return zoomFactorOf(this.options.startupSettings().interfaceZoom);
  }

  /**
   * Draws one window at the Interface Zoom. Its web contents take the zoom factor; the window controls
   * drawn over its title strip follow the strip as it grows or shrinks, the macOS traffic lights
   * staying centred in it and the Windows caption buttons filling it; and its minimum size is worked
   * out again for what its dock layout last asked for.
   * @param window The window.
   */
  private applyZoom(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }
    const factor: number = this.zoomFactor();
    const sizing: ModalSizing | undefined = this.modalSizings.get(window);
    if (sizing !== undefined && sizing.zoom !== factor) {
      this.rescaleModal(window, sizing, factor);
    }
    window.webContents.setZoomFactor(factor);
    if (process.platform === 'darwin') {
      window.setWindowButtonPosition(trafficLightPositionAt(factor));
    } else if (process.platform === 'win32') {
      try {
        window.setTitleBarOverlay(this.overlay());
      } catch (error: unknown) {
        // A frameless modal has no caption-button overlay to resize, and Electron throws for one.
        logger.trace('WindowManager.applyZoom', 'window has no caption-button overlay', error);
      }
    }
    const minimum: readonly [number, number] | undefined = this.layoutMinimums.get(window);
    if (minimum !== undefined) {
      this.setLayoutMinimumSize(window, minimum[0], minimum[1]);
    }
  }

  /**
   * Rescales a modal window for a change of Interface Zoom. Its opener sized it, and set its limits,
   * from CSS pixels, which the zoom draws larger or smaller on screen: so the size and limits it
   * means to have (see {@link ModalSizing}) are worked out again at the new zoom, about the window's
   * centre. The renderer cannot do this itself, because its window may not be resized past limits
   * only the main process can change, and the limits must move first.
   *
   * Nothing is allowed past the display's work area: a modal that filled most of the screen at 100%
   * would otherwise open off it at 200%. Its content scrolls instead. Because the size is worked out
   * from what the modal means to be rather than from what it was held to, going back to a smaller
   * zoom gives it its own size again.
   * @param window The modal window.
   * @param sizing The size it means to be.
   * @param factor The zoom factor now in force.
   */
  private rescaleModal(window: BrowserWindow, sizing: ModalSizing, factor: number): void {
    const area: Electron.Rectangle = screen.getDisplayMatching(window.getBounds()).workArea;
    const width: number = Math.min(area.width, Math.round(sizing.size.width * factor));
    const height: number = Math.min(area.height, Math.round(sizing.size.height * factor));
    // Limits first, so the new size is not held to the old ones. Zero means no maximum.
    window.setMinimumSize(
      Math.min(width, Math.round(sizing.minimum.width * factor)),
      Math.min(height, Math.round(sizing.minimum.height * factor)),
    );
    if (sizing.maximum !== null) {
      window.setMaximumSize(
        Math.max(width, Math.round(sizing.maximum.width * factor)),
        Math.max(height, Math.round(sizing.maximum.height * factor)),
      );
    }
    this.modalSizings.set(window, { ...sizing, zoom: factor, applied: { width, height } });
    const bounds: Electron.Rectangle = window.getBounds();
    const centred: { x: number; y: number } = {
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + (bounds.height - height) / 2),
    };
    window.setBounds({ ...heldWithin(centred, { width, height }, area), width, height });
    logger.debug('WindowManager.rescaleModal', 'rescaled modal for interface zoom', {
      factor,
      width,
      height,
    });
  }

  /**
   * Records a modal window's own resize as the size it now means to be, unless the window manager
   * made it. The opener fits a dialog to its content, and the user may resize one that allows it;
   * either is what the window should come back to after a zoom change.
   * @param window The modal window.
   */
  private recordModalResize(window: BrowserWindow): void {
    const sizing: ModalSizing | undefined = this.modalSizings.get(window);
    if (sizing === undefined || window.isDestroyed()) {
      return;
    }
    const [width, height]: number[] = window.getSize();
    if (width === sizing.applied.width && height === sizing.applied.height) {
      return;
    }
    const size: PixelSize = { width: width / sizing.zoom, height: height / sizing.zoom };
    this.modalSizings.set(window, { ...sizing, size, applied: { width, height } });
  }

  /**
   * Recolours the Windows caption buttons of every window, and of every window opened after, to suit
   * the application's theme. Does nothing on other platforms, which draw no overlay.
   * @param symbolColor The CSS colour of the button glyphs.
   */
  public setOverlaySymbolColor(symbolColor: string): void {
    if (process.platform !== 'win32' || symbolColor === this.overlaySymbolColor) {
      return;
    }
    logger.debug('WindowManager.setOverlaySymbolColor', `caption glyphs now ${symbolColor}`);
    this.overlaySymbolColor = symbolColor;
    for (const entry of this.registry.all()) {
      if (!entry.window.isDestroyed()) {
        entry.window.setTitleBarOverlay(this.overlay());
      }
    }
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
   * contents, registers it as a modal, draws it at the Interface Zoom, and — unless the opener asked for a
   * free-standing window — parents it to the window that raised it, so it always floats above that
   * window and closes with it. A free-standing modal is the welcome screen's cold start, where the
   * main window is hidden: on macOS a child of a hidden parent is not displayed at all.
   *
   * A HIDDEN opener is treated the same way, whatever the opener asked for. Attaching a child to a
   * hidden window drags that window back on screen on macOS — and returning focus to it as the child
   * closes shows it again — which is exactly what the main window must not do while the welcome
   * screen stands in for it.
   * @param window The created modal window.
   * @param name The name the window was opened with.
   */
  public adoptModalWindow(window: BrowserWindow, name: string): void {
    logger.trace('WindowManager.adoptModalWindow', 'adopting modal window');
    const parent: BrowserWindow | null = this.pendingModalParent;
    this.pendingModalParent = null;
    const entry: RegisteredWindow<BrowserWindow> = this.registry.add('modal', window);
    this.recordChildName(window, name);
    this.options.applySecurity(window.webContents);
    // The opener sized the modal for the zoom in force now; a later change rescales it from what it
    // asked for, not from what the display held it to.
    const sizing: ModalSizing | null = this.pendingModalSizing;
    this.pendingModalSizing = null;
    if (sizing !== null) {
      const [width, height]: number[] = window.getSize();
      this.modalSizings.set(window, { ...sizing, applied: { width, height } });
      window.on('resize', (): void => this.recordModalResize(window));
    }
    this.applyZoom(window);
    window.webContents.on('did-finish-load', (): void => this.applyZoom(window));
    window.on('closed', (): void => {
      logger.info('WindowManager.adoptModalWindow', 'modal window closed');
      this.registry.remove(entry.id);
    });
    if (parent !== null && !parent.isDestroyed() && parent.isVisible()) {
      logger.debug('WindowManager.adoptModalWindow', 'parenting modal to its opener');
      window.setParentWindow(parent);
      this.followParent(window, parent);
    } else {
      logger.debug(
        'WindowManager.adoptModalWindow',
        'modal opens free-standing (no visible parent)',
      );
    }
    // Parented first, then shown: a window that is already on screen when it is given a parent is
    // re-ordered in front of the user, which is the jump this whole path exists to avoid.
    this.showWindow(window);
    logger.info('WindowManager.adoptModalWindow', 'modal window adopted');
  }

  /**
   * Keeps a modal window centred over its parent for as long as both live. The parent still takes
   * input through its title strip and its edges while the modal is up, so it can be moved, resized,
   * maximized or taken full screen beneath it. macOS carries a child window along when its parent
   * moves, but nothing else; Windows and Linux do not even do that. Whatever the change, the modal is
   * put back in the middle of its parent, held on the display that holds most of the parent (so a
   * parent straddling two displays has its modal wholly on one of them, not split across both).
   * A minimized parent is left alone: Windows parks it far off screen, and the modal follows it back
   * when it is restored.
   * @param window The modal window.
   * @param parent The window it is centred over.
   */
  private followParent(window: BrowserWindow, parent: BrowserWindow): void {
    const recentre: () => void = (): void => {
      if (window.isDestroyed() || parent.isDestroyed() || parent.isMinimized()) {
        return;
      }
      const bounds: Electron.Rectangle = parent.getBounds();
      const current: Electron.Rectangle = window.getBounds();
      const size: { width: number; height: number } = {
        width: current.width,
        height: current.height,
      };
      const { x, y }: { x: number; y: number } = heldWithin(
        centredOver(bounds, size),
        size,
        screen.getDisplayMatching(bounds).workArea,
      );
      if (x !== current.x || y !== current.y) {
        window.setPosition(x, y);
      }
    };
    parent.on('move', recentre);
    parent.on('resize', recentre);
    parent.on('enter-full-screen', recentre);
    parent.on('leave-full-screen', recentre);
    parent.on('restore', recentre);
    window.once('closed', (): void => {
      if (parent.isDestroyed()) {
        return;
      }
      parent.off('move', recentre);
      parent.off('resize', recentre);
      parent.off('enter-full-screen', recentre);
      parent.off('leave-full-screen', recentre);
      parent.off('restore', recentre);
    });
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
   * Persists a window's current normal bounds and its maximized and full-screen flags.
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
      fullScreen: window.isFullScreen(),
    });
  }
}

/**
 * Computes where a window of a given size sits centred over another, both ways, as the renderer
 * centres a modal over the window that raised it.
 * @param bounds The window to centre over.
 * @param size The size of the window being placed.
 * @returns Returns the position of its top-left corner.
 */
function centredOver(
  bounds: Electron.Rectangle,
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + (bounds.width - size.width) / 2),
    y: Math.round(bounds.y + (bounds.height - size.height) / 2),
  };
}

/**
 * Holds a position within a display's work area, so a window placed there is fully on screen when it
 * fits, and pinned to the top-left of the area when it does not.
 * @param position The position wanted for the window's top-left corner.
 * @param size The window's size.
 * @param area The work area to stay within.
 * @returns Returns the held position.
 */
function heldWithin(
  position: { x: number; y: number },
  size: { width: number; height: number },
  area: Electron.Rectangle,
): { x: number; y: number } {
  return {
    x: Math.max(area.x, Math.min(position.x, area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(position.y, area.y + area.height - size.height)),
  };
}
