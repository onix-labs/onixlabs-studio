import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowChannel } from '@shared/api/window-channels';
import type { BrowserWindow, WebContents } from 'electron';
import type { WindowManagerOptions } from './window-manager';

/**
 * Describes an event listener a fake window holds.
 */
type Listener = (...args: unknown[]) => void;

/**
 * A minimal event target standing in for a window or its web contents.
 */
class FakeEmitter {
  private readonly listeners: Map<string, Listener[]> = new Map<string, Listener[]>();

  public on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  public once(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  public emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

/**
 * Stands in for a window's web contents.
 */
class FakeContents extends FakeEmitter {
  public zoom: number | undefined;
  public readonly sent: unknown[][] = [];

  public setZoomLevel(level: number): void {
    this.zoom = level;
  }

  public send(...message: unknown[]): void {
    this.sent.push(message);
  }
}

/**
 * Stands in for a `BrowserWindow`, recording what was asked of it.
 */
class FakeWindow extends FakeEmitter {
  public static created: FakeWindow[] = [];
  public readonly webContents: FakeContents = new FakeContents();
  public readonly calls: string[] = [];
  public visible: boolean = false;
  public destroyed: boolean = false;
  public minimized: boolean = false;
  public maximized: boolean = false;
  public fullScreen: boolean = false;
  public minimumSize: [number, number] = [800, 600];
  public size: [number, number] = [1000, 800];
  public contentSize: [number, number] = [1000, 760];
  public parent: unknown = null;
  public overlay: unknown = null;
  public loaded: string | undefined;

  public constructor(public readonly options: Record<string, unknown> = {}) {
    super();
    FakeWindow.created.push(this);
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public isMinimized(): boolean {
    return this.minimized;
  }

  public isMaximized(): boolean {
    return this.maximized;
  }

  public isFullScreen(): boolean {
    return this.fullScreen;
  }

  public getBounds(): object {
    return { x: 0, y: 0, width: 1000, height: 800 };
  }

  public getNormalBounds(): object {
    return { x: 10, y: 20, width: 900, height: 700 };
  }

  public getMinimumSize(): [number, number] {
    return this.minimumSize;
  }

  public getSize(): [number, number] {
    return this.size;
  }

  public getContentSize(): [number, number] {
    return this.contentSize;
  }

  public setMinimumSize(width: number, height: number): void {
    this.minimumSize = [width, height];
    this.calls.push(`setMinimumSize ${width}x${height}`);
  }

  public show(): void {
    this.visible = true;
    this.calls.push('show');
  }

  public showInactive(): void {
    this.visible = true;
    this.calls.push('showInactive');
  }

  public focus(): void {
    this.calls.push('focus');
  }

  public restore(): void {
    this.minimized = false;
    this.calls.push('restore');
  }

  public maximize(): void {
    this.calls.push('maximize');
  }

  public setFullScreen(value: boolean): void {
    this.calls.push(`setFullScreen ${value}`);
  }

  public close(): void {
    this.calls.push('close');
  }

  public setParentWindow(parent: unknown): void {
    this.parent = parent;
    this.calls.push('setParentWindow');
  }

  public setTitleBarOverlay(overlay: unknown): void {
    this.overlay = overlay;
  }

  public loadURL(url: string): Promise<void> {
    this.loaded = url;
    return Promise.resolve();
  }

  public loadFile(file: string): Promise<void> {
    this.loaded = file;
    return Promise.resolve();
  }
}

/**
 * Holds the fake Electron layer.
 */
const electron: {
  appListeners: Map<string, () => void>;
  userData: string;
  ownerOf: unknown;
} = vi.hoisted(() => ({
  appListeners: new Map<string, () => void>(),
  userData: '',
  ownerOf: null,
}));

vi.mock('electron', () => ({
  app: {
    getPath: (): string => electron.userData,
    on: (event: string, listener: () => void): void =>
      void electron.appListeners.set(event, listener),
  },
  screen: {
    getAllDisplays: (): object[] => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getDisplayMatching: (): object => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
  // A getter, because the class is declared after this factory is hoisted.
  get BrowserWindow(): object {
    return Object.assign(
      function (options: Record<string, unknown>): FakeWindow {
        return new FakeWindow(options);
      },
      { fromWebContents: (): unknown => electron.ownerOf },
    );
  },
}));

const { WindowManager } = await import('./window-manager');
const { WindowStateStore } = await import('./window-state-store');

/**
 * Holds a well-formed child-window name.
 */
const CHILD_NAME: string = 'studio-window-00000000-0000-0000-0000-000000000001';

/**
 * Treats a fake as the real window the manager is typed against.
 * @param window The fake.
 * @returns Returns the same object.
 */
function real(window: FakeWindow): BrowserWindow {
  return window as unknown as BrowserWindow;
}

describe('WindowManager', () => {
  const actualPlatform: NodeJS.Platform = process.platform;
  let manager: InstanceType<typeof WindowManager>;
  let closed: number;
  let loads: number;
  let secured: unknown[];
  let windowSizeOnLaunch: string;
  let restoreFullScreen: boolean;

  /**
   * Builds a manager.
   * @param overrides The options to change.
   * @returns Returns the manager.
   */
  function build(
    overrides: Partial<WindowManagerOptions> = {},
  ): InstanceType<typeof WindowManager> {
    return new WindowManager({
      preloadPath: '/preload.js',
      startUrl: undefined,
      indexHtml: '/index.html',
      applySecurity: (contents: WebContents): void => void secured.push(contents),
      onMainClose: (): void => {
        closed += 1;
      },
      onMainDidStartLoad: (): void => {
        loads += 1;
      },
      startupSettings: (): never => ({ windowSizeOnLaunch, restoreFullScreen }) as never,
      ...overrides,
    });
  }

  /**
   * Creates the main window.
   * @returns Returns its fake.
   */
  function createMain(): FakeWindow {
    return manager.createMainWindow() as unknown as FakeWindow;
  }

  /**
   * Sets the platform the manager sees.
   * @param platform The platform.
   */
  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    electron.userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'window-manager-')));
    electron.appListeners.clear();
    electron.ownerOf = null;
    FakeWindow.created = [];
    closed = 0;
    loads = 0;
    secured = [];
    windowSizeOnLaunch = 'remember';
    restoreFullScreen = true;
    onPlatform('darwin');
    manager = build();
  });

  afterEach(() => {
    onPlatform(actualPlatform);
    vi.useRealTimers();
    fs.rmSync(electron.userData, { recursive: true, force: true });
  });

  describe('main window', () => {
    it('create_hardensTheWindow', () => {
      const window: FakeWindow = createMain();

      expect(window.options['show']).toBe(false);
      expect(window.options['webPreferences']).toEqual({
        preload: '/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      });
      expect(secured).toEqual([window.webContents]);
    });

    it('create_loadsTheStartUrlWhenThereIsOne', () => {
      manager = build({ startUrl: 'http://localhost:4200' });

      expect(createMain().loaded).toBe('http://localhost:4200');
    });

    it('create_loadsTheBuiltAppOtherwise', () => {
      expect(createMain().loaded).toBe('/index.html');
    });

    it('create_withNothingPersisted_opensAtTheDefaultSize', () => {
      expect(createMain().options).toMatchObject({ width: 1280, height: 800 });
    });

    it('create_restoresPersistedBounds_underRememberLast', () => {
      WindowStateStore.write('main', {
        bounds: { x: 100, y: 100, width: 1000, height: 700 },
        maximized: false,
        fullScreen: false,
      });

      expect(createMain().options).toMatchObject({ x: 100, y: 100, width: 1000, height: 700 });
    });

    it('create_ignoresPersistedBounds_underAnyOtherSetting', () => {
      windowSizeOnLaunch = 'default';
      WindowStateStore.write('main', {
        bounds: { x: 100, y: 100, width: 1000, height: 700 },
        maximized: true,
        fullScreen: false,
      });

      const window: FakeWindow = createMain();
      manager.showWindow(real(window));

      expect(window.options).not.toHaveProperty('x');
      expect(window.calls).toEqual(['show']);
    });

    it('create_withBoundsOnADisplayNowGone_staysReachable', () => {
      WindowStateStore.write('main', {
        bounds: { x: 9000, y: 9000, width: 1000, height: 700 },
        maximized: false,
        fullScreen: false,
      });

      const x: unknown = createMain().options['x'];

      expect(x === undefined || (typeof x === 'number' && x < 1920)).toBe(true);
    });

    it('maximized_isAppliedOnFirstShow_notAtCreation', () => {
      WindowStateStore.write('main', {
        bounds: { x: 0, y: 0, width: 1000, height: 700 },
        maximized: true,
        fullScreen: false,
      });
      const window: FakeWindow = createMain();

      expect(window.calls).toEqual([]);

      manager.showWindow(real(window));

      expect(window.calls).toEqual(['maximize', 'show']);
    });

    it('maximized_isAppliedOnlyOnce', () => {
      windowSizeOnLaunch = 'maximised';
      const window: FakeWindow = createMain();
      manager.showWindow(real(window));
      window.visible = false;
      window.calls.length = 0;

      manager.showWindow(real(window));

      expect(window.calls).toEqual(['show']);
    });

    it('fullScreen_isRestored_onlyWhenTheSettingAllows', () => {
      WindowStateStore.write('main', {
        bounds: { x: 0, y: 0, width: 1000, height: 700 },
        maximized: false,
        fullScreen: true,
      });

      const allowed: FakeWindow = createMain();
      manager.showWindow(real(allowed));
      expect(allowed.calls).toContain('setFullScreen true');

      restoreFullScreen = false;
      const refused: FakeWindow = build().createMainWindow() as unknown as FakeWindow;
      expect(refused.calls).toEqual([]);
    });

    it('safetyNet_showsTheWindow_whenTheRendererNeverSpeaks', () => {
      const window: FakeWindow = createMain();
      window.emit('ready-to-show');

      vi.advanceTimersByTime(3999);
      expect(window.visible).toBe(false);

      vi.advanceTimersByTime(1);
      expect(window.visible).toBe(true);
    });

    it('safetyNet_isRetired_whenTheRendererSpeaksFirst', () => {
      const window: FakeWindow = createMain();
      window.emit('ready-to-show');

      manager.claimMainPresence();
      vi.advanceTimersByTime(10_000);

      expect(window.visible).toBe(false);
    });

    it('safetyNet_neverArms_whenTheRendererSpokeBeforeReady', () => {
      const window: FakeWindow = createMain();
      manager.claimMainPresence();

      window.emit('ready-to-show');
      vi.advanceTimersByTime(10_000);

      expect(window.visible).toBe(false);
    });

    it('safetyNet_leavesADestroyedWindowAlone', () => {
      const window: FakeWindow = createMain();
      window.emit('ready-to-show');
      window.destroyed = true;

      expect((): void => void vi.advanceTimersByTime(10_000)).not.toThrow();

      expect(window.calls).toEqual([]);
    });

    it('close_savesBounds_thenRunsTheQuitProtocol', () => {
      const window: FakeWindow = createMain();

      window.emit('close', {});

      expect(WindowStateStore.read('main')?.bounds).toEqual(window.getNormalBounds());
      expect(closed).toBe(1);
    });

    it('closed_forgetsTheWindow', () => {
      const window: FakeWindow = createMain();

      window.emit('closed');

      expect(manager.main()).toBeNull();
    });

    it('move_savesBoundsOnce_afterTheDragSettles', () => {
      const window: FakeWindow = createMain();

      window.emit('move');
      vi.advanceTimersByTime(400);
      window.emit('resize');
      vi.advanceTimersByTime(499);

      expect(WindowStateStore.read('main')).toBeNull();

      vi.advanceTimersByTime(1);

      expect(WindowStateStore.read('main')).not.toBeNull();
    });

    it('move_thenClosed_savesNothingLate', () => {
      const window: FakeWindow = createMain();
      window.emit('move');

      window.destroyed = true;
      window.emit('closed');
      vi.advanceTimersByTime(1000);

      expect(WindowStateStore.read('main')).toBeNull();
    });

    it('load_resetsZoom_andReportsFullScreen', () => {
      const window: FakeWindow = createMain();
      window.fullScreen = true;

      window.webContents.emit('did-finish-load');

      expect(window.webContents.zoom).toBe(0);
      expect(window.webContents.sent).toEqual([[WindowChannel.FullScreenChanged, true]]);
    });

    it('fullScreenChange_ofADestroyedWindow_sendsNothing', () => {
      const window: FakeWindow = createMain();
      window.destroyed = true;

      window.emit('enter-full-screen');

      expect(window.webContents.sent).toEqual([]);
    });

    it('reload_tellsTheProgramBeforeTheNewPageRuns', () => {
      createMain().webContents.emit('did-start-loading');

      expect(loads).toBe(1);
    });
  });

  describe('showing and focus', () => {
    it('show_whileTheUserIsElsewhere_neverActivatesTheApplication', () => {
      const window: FakeWindow = createMain();

      electron.appListeners.get('did-resign-active')?.();
      manager.showWindow(real(window));

      expect(window.calls).toEqual(['showInactive']);
    });

    it('show_afterTheUserCameBack_activates', () => {
      const window: FakeWindow = createMain();
      electron.appListeners.get('did-resign-active')?.();
      electron.appListeners.get('did-become-active')?.();

      manager.showWindow(real(window));

      expect(window.calls).toEqual(['show']);
    });

    it.each([
      ['visible', true, false],
      ['destroyed', false, true],
    ])(
      'show_ofAWindowAlready %s_doesNothing',
      (_label: string, visible: boolean, destroyed: boolean) => {
        const window: FakeWindow = createMain();
        window.visible = visible;
        window.destroyed = destroyed;

        manager.showWindow(real(window));

        expect(window.calls).toEqual([]);
      },
    );

    it('focusMain_withNoWindow_doesNothing', () => {
      expect((): void => manager.focusMain()).not.toThrow();
    });

    it('focusMain_restoresAMinimizedWindowFirst', () => {
      const window: FakeWindow = createMain();
      window.minimized = true;

      manager.focusMain();

      expect(window.calls).toEqual(['restore', 'focus']);
    });
  });

  describe('modal windows', () => {
    it('options_createHidden_soTheyCannotStealFocus', () => {
      expect(manager.modalWindowOptions('', null)).toMatchObject({
        show: false,
        width: 480,
        height: 320,
        minimizable: false,
        fullscreenable: false,
        resizable: false,
      });
    });

    it('options_clampTheRequestedSizeToTheStatedBounds', () => {
      const options: Electron.BrowserWindowConstructorOptions = manager.modalWindowOptions(
        'width=5000,height=50,minWidth=300,minHeight=200,maxWidth=600,maxHeight=400,resizable=yes',
        null,
      );

      expect(options).toMatchObject({ width: 600, height: 200, maximizable: false });
    });

    it('options_keepAModalOnScreen', () => {
      const options: Electron.BrowserWindowConstructorOptions = manager.modalWindowOptions(
        'width=400,height=300,left=99999,top=99999',
        null,
      );

      expect((options.x ?? 0) + (options.width ?? 0)).toBeLessThanOrEqual(1920);
      expect((options.y ?? 0) + (options.height ?? 0)).toBeLessThanOrEqual(1080);
    });

    it.each([
      ['bgcolor=1a2b3c', '#1a2b3c'],
      ['bgcolor=nothex', '#000000'],
      ['bgcolor=1a2b3c);evil', '#000000'],
      ['', '#000000'],
    ])('options_readTheBackgroundFrom %s', (features: string, expected: string) => {
      expect(manager.modalWindowOptions(features, null).backgroundColor).toBe(expected);
    });

    it('adopt_parentsToAVisibleOpener_beforeShowing', () => {
      const opener: FakeWindow = new FakeWindow();
      opener.visible = true;
      const modal: FakeWindow = new FakeWindow();
      manager.modalWindowOptions('', real(opener));

      manager.adoptModalWindow(real(modal), 'modal-1');

      expect(modal.parent).toBe(opener);
      expect(modal.calls).toEqual(['setParentWindow', 'show']);
    });

    it('adopt_neverParentsToAHiddenOpener', () => {
      const opener: FakeWindow = new FakeWindow();
      const modal: FakeWindow = new FakeWindow();
      manager.modalWindowOptions('', real(opener));

      manager.adoptModalWindow(real(modal), 'modal-1');

      expect(modal.parent).toBeNull();
    });

    it('adopt_neverParentsToAnOpenerDestroyedInBetween', () => {
      const opener: FakeWindow = new FakeWindow();
      opener.visible = true;
      const modal: FakeWindow = new FakeWindow();
      manager.modalWindowOptions('', real(opener));
      opener.destroyed = true;

      manager.adoptModalWindow(real(modal), 'modal-1');

      expect(modal.parent).toBeNull();
    });

    it('adopt_consumesThePendingParent_soTheNextModalIsNotGivenIt', () => {
      const opener: FakeWindow = new FakeWindow();
      opener.visible = true;
      manager.modalWindowOptions('', real(opener));
      manager.adoptModalWindow(real(new FakeWindow()), 'modal-1');

      const second: FakeWindow = new FakeWindow();
      manager.adoptModalWindow(real(second), 'modal-2');

      expect(second.parent).toBeNull();
    });

    it('adopt_hardensTheWindow', () => {
      const modal: FakeWindow = new FakeWindow();

      manager.adoptModalWindow(real(modal), 'modal-1');

      expect(secured).toEqual([modal.webContents]);
    });
  });

  describe('pop-out windows', () => {
    it('options_useTheDefaults_withNothingPersisted', () => {
      expect(manager.auxiliaryWindowOptions('')).toMatchObject({ width: 960, height: 640 });
    });

    it('options_preferARequestedPositionOverThePersistedOne', () => {
      WindowStateStore.write('popout', {
        bounds: { x: 300, y: 300, width: 700, height: 500 },
        maximized: false,
        fullScreen: false,
      });

      expect(manager.auxiliaryWindowOptions('left=50,top=60')).toMatchObject({
        x: 50,
        y: 60,
        width: 700,
        height: 500,
      });
    });

    it('adopt_savesItsBoundsUnderItsOwnKind', () => {
      const window: FakeWindow = new FakeWindow();
      manager.adoptAuxiliaryWindow(real(window), 'popout-1');

      window.emit('close');

      expect(WindowStateStore.read('popout')).not.toBeNull();
      expect(WindowStateStore.read('main')).toBeNull();
    });

    it('closeAllSecondaryWindows_leavesTheMainWindow', () => {
      const main: FakeWindow = createMain();
      const popout: FakeWindow = new FakeWindow();
      const modal: FakeWindow = new FakeWindow();
      const gone: FakeWindow = new FakeWindow();
      manager.adoptAuxiliaryWindow(real(popout), 'popout-1');
      manager.adoptModalWindow(real(modal), 'modal-1');
      manager.adoptAuxiliaryWindow(real(gone), 'popout-2');
      gone.destroyed = true;

      manager.closeAllSecondaryWindows();

      expect(main.calls).not.toContain('close');
      expect(popout.calls).toContain('close');
      expect(modal.calls).toContain('close');
      expect(gone.calls).not.toContain('close');
    });
  });

  describe('targetWindow', () => {
    it('target_withNoName_isTheSendersOwnWindow', () => {
      const own: FakeWindow = new FakeWindow();
      electron.ownerOf = own;

      expect(manager.targetWindow({} as WebContents, undefined)).toBe(own);
      expect(manager.targetWindow({} as WebContents, null)).toBe(own);
    });

    it('target_byName_findsAnOpenChild', () => {
      electron.ownerOf = new FakeWindow();
      const child: FakeWindow = new FakeWindow();
      manager.adoptModalWindow(real(child), CHILD_NAME);

      expect(manager.targetWindow({} as WebContents, CHILD_NAME)).toBe(child);
    });

    it('target_fromASenderThatIsNotOurs_isRefused', () => {
      manager.adoptModalWindow(real(new FakeWindow()), CHILD_NAME);

      expect(manager.targetWindow({} as WebContents, CHILD_NAME)).toBeNull();
    });

    it.each([[7], [{}], [''], ['../main'], ['studio-window-00000000-0000-0000-0000-000000000009']])(
      'target_withABadName_isRefused %#',
      (name: unknown) => {
        electron.ownerOf = new FakeWindow();

        expect(manager.targetWindow({} as WebContents, name)).toBeNull();
      },
    );

    it('target_ofAChildThatClosed_isGone', () => {
      electron.ownerOf = new FakeWindow();
      const child: FakeWindow = new FakeWindow();
      manager.adoptModalWindow(real(child), CHILD_NAME);

      child.emit('closed');

      expect(manager.targetWindow({} as WebContents, CHILD_NAME)).toBeNull();
    });

    it('target_ofANameReused_survivesTheOldWindowClosingLate', () => {
      electron.ownerOf = new FakeWindow();
      const old: FakeWindow = new FakeWindow();
      const successor: FakeWindow = new FakeWindow();
      manager.adoptModalWindow(real(old), CHILD_NAME);
      manager.adoptModalWindow(real(successor), CHILD_NAME);

      old.emit('closed');

      expect(manager.targetWindow({} as WebContents, CHILD_NAME)).toBe(successor);
    });
  });

  describe('layout minimum', () => {
    it('minimum_addsTheFrameToTheContent', () => {
      const window: FakeWindow = new FakeWindow();

      manager.setLayoutMinimumSize(real(window), 900, 700);

      expect(window.minimumSize).toEqual([900, 740]);
    });

    it('minimum_neverDropsBelowTheWindowsOwnFloor', () => {
      const window: FakeWindow = new FakeWindow();

      manager.setLayoutMinimumSize(real(window), 10, 10);

      expect(window.calls).toEqual([]);
    });

    it('minimum_handsBackTheFloor_whenALayoutNeedsLess', () => {
      const window: FakeWindow = new FakeWindow();
      manager.setLayoutMinimumSize(real(window), 1500, 900);

      manager.setLayoutMinimumSize(real(window), 10, 10);

      expect(window.minimumSize).toEqual([800, 600]);
    });

    it('minimum_neverExceedsTheDisplay', () => {
      const window: FakeWindow = new FakeWindow();

      manager.setLayoutMinimumSize(real(window), 9000, 9000);

      expect(window.minimumSize).toEqual([1920, 1080]);
    });

    it('minimum_ofADestroyedWindow_doesNothing', () => {
      const window: FakeWindow = new FakeWindow();
      window.destroyed = true;

      manager.setLayoutMinimumSize(real(window), 1500, 900);

      expect(window.calls).toEqual([]);
    });
  });

  describe('chrome', () => {
    it.each([
      ['darwin', { titleBarStyle: 'hiddenInset' }],
      ['win32', { titleBarStyle: 'hidden' }],
      ['linux', { frame: false }],
    ])('chrome_on %s', (platform: string, expected: object) => {
      onPlatform(platform as NodeJS.Platform);

      expect(createMain().options).toMatchObject(expected);
    });

    it('overlayColour_recoloursOpenWindows_onWindowsOnly', () => {
      const window: FakeWindow = createMain();

      manager.setOverlaySymbolColor('#123456');
      expect(window.overlay).toBeNull();

      onPlatform('win32');
      manager.setOverlaySymbolColor('#123456');
      expect(window.overlay).toMatchObject({ symbolColor: '#123456' });
    });
  });
});
