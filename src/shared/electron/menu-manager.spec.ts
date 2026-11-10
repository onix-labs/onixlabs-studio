import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuChannel } from '@shared/api/menu-channels';
import type { BrowserWindow } from 'electron';

/**
 * Describes a listener as the fake `ipcMain` captures it.
 */
type Listener = (event: unknown, payload: unknown) => void;

/**
 * Describes a built native menu item.
 */
interface NativeItem {
  label?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  submenu?: NativeItem[];
  click?: () => void;
}

/**
 * Holds the fake Electron layer.
 */
const electron: {
  listeners: Map<string, Listener>;
  installed: NativeItem[] | null | undefined;
} = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  installed: undefined,
}));

vi.mock('electron', () => ({
  app: { name: 'ONIXLabs Studio' },
  ipcMain: {
    on: (channel: string, listener: Listener): void =>
      void electron.listeners.set(channel, listener),
  },
  Menu: {
    buildFromTemplate: (template: NativeItem[]): NativeItem[] => template,
    setApplicationMenu: (menu: NativeItem[] | null): void => {
      electron.installed = menu;
    },
  },
}));

const { MenuManager } = await import('./menu-manager');

describe('MenuManager', () => {
  const actualPlatform: NodeJS.Platform = process.platform;
  let calls: string[];
  let sent: unknown[][];
  let maximized: boolean;
  let hasWindow: boolean;

  /**
   * Publishes a menu as the renderer would.
   * @param sections The payload.
   */
  function publish(sections: unknown): void {
    electron.listeners.get(MenuChannel.SetMenu)?.({}, sections);
  }

  /**
   * Asks for a role as the in-window menu would.
   * @param role The role.
   */
  function runRole(role: unknown): void {
    electron.listeners.get(MenuChannel.RunRole)?.({}, role);
  }

  /**
   * Sets the platform the manager sees.
   * @param platform The platform.
   */
  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    electron.listeners.clear();
    electron.installed = undefined;
    calls = [];
    sent = [];
    maximized = false;
    hasWindow = true;
    onPlatform('darwin');
    const record: (name: string) => () => void =
      (name: string): (() => void) =>
      (): void =>
        void calls.push(name);
    const window: unknown = {
      minimize: record('minimize'),
      maximize: record('maximize'),
      unmaximize: record('unmaximize'),
      close: record('close'),
      isMaximized: (): boolean => maximized,
      isFullScreen: (): boolean => false,
      setFullScreen: (value: boolean): void => void calls.push(`fullScreen ${value}`),
      webContents: {
        undo: record('undo'),
        redo: record('redo'),
        cut: record('cut'),
        copy: record('copy'),
        paste: record('paste'),
        selectAll: record('selectAll'),
        toggleDevTools: record('toggleDevTools'),
        reloadIgnoringCache: record('reloadIgnoringCache'),
        send: (...message: unknown[]): void => void sent.push(message),
      },
    };
    new MenuManager((): BrowserWindow | null =>
      hasWindow ? (window as BrowserWindow) : null,
    ).register();
  });

  afterEach(() => {
    onPlatform(actualPlatform);
  });

  it.each([
    ['undo', 'undo'],
    ['redo', 'redo'],
    ['cut', 'cut'],
    ['copy', 'copy'],
    ['paste', 'paste'],
    ['selectAll', 'selectAll'],
    ['toggleDevTools', 'toggleDevTools'],
    ['forceReload', 'reloadIgnoringCache'],
    ['minimize', 'minimize'],
    ['close', 'close'],
    ['togglefullscreen', 'fullScreen true'],
    ['zoom', 'maximize'],
  ])('runRole %s_performsIt', (role: string, expected: string) => {
    runRole(role);

    expect(calls).toEqual([expected]);
  });

  it('runRole_zoomOnAMaximizedWindow_restoresIt', () => {
    maximized = true;

    runRole('zoom');

    expect(calls).toEqual(['unmaximize']);
  });

  it.each([['quit'], ['delete'], ['__proto__'], [''], [7], [null]])(
    'runRole_ofAnythingNotOffered_isIgnored %#',
    (role: unknown) => {
      runRole(role);

      expect(calls).toEqual([]);
    },
  );

  it('runRole_withNoWindow_doesNothing', () => {
    hasWindow = false;

    expect((): void => runRole('close')).not.toThrow();
  });

  it.each([[undefined], [null], ['menu'], [{}], [7]])(
    'setMenu_withSomethingNotAList_installsNothing %#',
    (sections: unknown) => {
      publish(sections);

      expect(electron.installed).toBeUndefined();
    },
  );

  it.each([['win32'], ['linux']])('setMenu_on %s_clearsTheNativeBar', (platform: string) => {
    onPlatform(platform as NodeJS.Platform);

    publish([{ label: 'File', items: [] }]);

    expect(electron.installed).toBeNull();
  });

  it('setMenu_buildsEveryKindOfEntry', () => {
    publish([
      {
        label: 'File',
        items: [
          { kind: 'item', role: 'about', label: 'About' },
          { kind: 'separator' },
          { kind: 'item', role: 'quit' },
          { kind: 'item', label: 'More', items: [{ kind: 'item', id: 'x', label: 'Deep' }] },
          { kind: 'checkbox', id: 'c', label: 'On', checked: true, accelerator: 'Cmd+K' },
          { kind: 'item', id: 'd', label: 'Off', enabled: false },
          { kind: 'item' },
        ],
      },
    ]);

    const items: NativeItem[] = electron.installed?.[1]?.submenu ?? [];
    expect(electron.installed?.[1]?.label).toBe('File');
    expect(items[0]).toEqual({ role: 'about', label: 'About' });
    expect(items[1]).toEqual({ type: 'separator' });
    expect(items[2]).toEqual({ role: 'quit' });
    expect(items[3]?.submenu?.[0]?.label).toBe('Deep');
    expect(items[4]).toMatchObject({ type: 'checkbox', checked: true, accelerator: 'Cmd+K' });
    expect(items[5]).toMatchObject({ enabled: false });
    expect(items[6]).toEqual({ label: '', enabled: true });
  });

  /**
   * Lists an installed menu's entries by role, label or separator, for comparing whole menus.
   * @param items The installed entries.
   * @returns Returns one word per entry.
   */
  function shapeOf(items: readonly NativeItem[] | undefined): string[] {
    return (items ?? []).map(
      (item: NativeItem): string => item.role ?? item.label ?? item.type ?? '?',
    );
  }

  it('setMenu_onMacOS_startsWithTheApplicationMenu', () => {
    // The bug this guards (#1406): the published sections replaced the whole bar, so File became the
    // application menu and ⌘Q, which comes from its Quit item, did nothing.
    publish([
      { id: 'file', label: 'File', items: [{ kind: 'item', id: 'file.open', label: 'Open' }] },
    ]);

    expect(electron.installed?.[0]?.label).toBe('ONIXLabs Studio');
    expect(shapeOf(electron.installed?.[0]?.submenu)).toEqual([
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    expect(electron.installed?.[1]?.label).toBe('File');
  });

  it('setMenu_onMacOS_movesAboutAndSettingsIntoTheApplicationMenu', () => {
    publish([
      {
        id: 'file',
        label: 'File',
        items: [
          { kind: 'item', id: 'file.open', label: 'Open' },
          { kind: 'separator' },
          { kind: 'item', id: 'settings', label: 'Settings', applicationMenu: 'settings' },
          { kind: 'separator' },
          { kind: 'item', id: 'file.close', label: 'Close Tab' },
        ],
      },
      {
        id: 'help',
        label: 'Help',
        items: [
          { kind: 'item', id: 'help.docs', label: 'Documentation' },
          { kind: 'separator' },
          { kind: 'item', id: 'about', label: 'About ONIXLabs Studio', applicationMenu: 'about' },
        ],
      },
    ]);

    // About leads and Settings follows, whatever order their sections were published in.
    expect(shapeOf(electron.installed?.[0]?.submenu)).toEqual([
      'About ONIXLabs Studio',
      'separator',
      'Settings',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    // The sections they left keep no doubled or trailing separator.
    expect(shapeOf(electron.installed?.[1]?.submenu)).toEqual(['Open', 'separator', 'Close Tab']);
    expect(shapeOf(electron.installed?.[2]?.submenu)).toEqual(['Documentation']);
  });

  it('click_onAnEntryMovedToTheApplicationMenu_stillSendsItsCommand', () => {
    publish([
      {
        id: 'help',
        label: 'Help',
        items: [{ kind: 'item', id: 'about', label: 'About', applicationMenu: 'about' }],
      },
    ]);

    electron.installed?.[0]?.submenu?.[0]?.click?.();

    expect(sent).toEqual([[MenuChannel.Command, 'about']]);
  });

  it('setMenu_withAnApplicationMenuGroupItDoesNotHave_leavesTheEntryWhereItIs', () => {
    publish([
      {
        id: 'file',
        label: 'File',
        items: [{ kind: 'item', id: 'odd', label: 'Odd', applicationMenu: 'preferences' }],
      },
    ]);

    expect(shapeOf(electron.installed?.[1]?.submenu)).toEqual(['Odd']);
    expect(shapeOf(electron.installed?.[0]?.submenu)).not.toContain('Odd');
  });

  it('click_sendsTheCommandBackToTheRenderer', () => {
    publish([{ label: 'File', items: [{ kind: 'item', id: 'file.save', label: 'Save' }] }]);

    electron.installed?.[1]?.submenu?.[0]?.click?.();

    expect(sent).toEqual([[MenuChannel.Command, 'file.save']]);
  });

  it('click_afterTheWindowHasGone_doesNotThrow', () => {
    publish([{ label: 'File', items: [{ kind: 'item', id: 'file.save', label: 'Save' }] }]);
    hasWindow = false;

    expect((): void => electron.installed?.[1]?.submenu?.[0]?.click?.()).not.toThrow();
  });

  it.each([
    ['a section without items', [{ label: 'File' }]],
    ['a null section', [null]],
    ['a null item', [{ label: 'File', items: [null] }]],
    ['items that are not a list', [{ label: 'File', items: 'x' }]],
    ['children that are not a list', [{ label: 'F', items: [{ kind: 'item', items: 7 }] }]],
  ])('setMenu_with %s_doesNotThrowInTheMainProcess', (_label: string, sections: unknown) => {
    expect((): void => publish(sections)).not.toThrow();

    expect(electron.installed).toBeUndefined();
  });
});
