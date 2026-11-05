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
          { kind: 'separator' },
          { kind: 'item', role: 'about', label: 'About' },
          { kind: 'item', role: 'quit' },
          { kind: 'item', label: 'More', items: [{ kind: 'item', id: 'x', label: 'Deep' }] },
          { kind: 'checkbox', id: 'c', label: 'On', checked: true, accelerator: 'Cmd+K' },
          { kind: 'item', id: 'd', label: 'Off', enabled: false },
          { kind: 'item' },
        ],
      },
    ]);

    const items: NativeItem[] = electron.installed?.[0]?.submenu ?? [];
    expect(electron.installed?.[0]?.label).toBe('File');
    expect(items[0]).toEqual({ type: 'separator' });
    expect(items[1]).toEqual({ role: 'about', label: 'About' });
    expect(items[2]).toEqual({ role: 'quit' });
    expect(items[3]?.submenu?.[0]?.label).toBe('Deep');
    expect(items[4]).toMatchObject({ type: 'checkbox', checked: true, accelerator: 'Cmd+K' });
    expect(items[5]).toMatchObject({ enabled: false });
    expect(items[6]).toEqual({ label: '', enabled: true });
  });

  it('click_sendsTheCommandBackToTheRenderer', () => {
    publish([{ label: 'File', items: [{ kind: 'item', id: 'file.save', label: 'Save' }] }]);

    electron.installed?.[0]?.submenu?.[0]?.click?.();

    expect(sent).toEqual([[MenuChannel.Command, 'file.save']]);
  });

  it('click_afterTheWindowHasGone_doesNotThrow', () => {
    publish([{ label: 'File', items: [{ kind: 'item', id: 'file.save', label: 'Save' }] }]);
    hasWindow = false;

    expect((): void => electron.installed?.[0]?.submenu?.[0]?.click?.()).not.toThrow();
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
