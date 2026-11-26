import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaChannel } from '@shared/api/persona-channels';
import type { Mock } from 'vitest';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Describes a window as far as announcing to it goes.
 */
interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { id: number; send: Mock };
}

/**
 * Holds the fake Electron layer.
 */
const electron: {
  handlers: Map<string, Handler>;
  windows: FakeWindow[];
  opened: string[];
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  windows: [],
  opened: [],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  BrowserWindow: {
    getAllWindows: (): FakeWindow[] => electron.windows,
  },
  shell: {
    openPath: (target: string): Promise<string> => {
      electron.opened.push(target);
      return Promise.resolve('');
    },
  },
}));

const { PersonaHandlers } = await import('./persona-handlers');

/**
 * Holds a well-formed entry.
 */
const ENTRY: object = { id: 'p', name: 'Terse', text: 'Be terse.' };

describe('PersonaHandlers', () => {
  let library: Record<string, unknown>;
  let sender: FakeWindow;
  let other: FakeWindow;

  /**
   * Invokes a captured IPC handler from the sending window.
   * @param channel The channel.
   * @param arg The renderer-supplied argument.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, arg?: unknown): Promise<T> {
    const handler: Handler | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({ sender: { id: sender.webContents.id } }, arg)) as T;
  }

  /**
   * Builds a window.
   * @param id Its web-contents id.
   * @returns Returns the window.
   */
  function fakeWindow(id: number): FakeWindow {
    return { isDestroyed: (): boolean => false, webContents: { id, send: vi.fn() } };
  }

  beforeEach(() => {
    electron.handlers.clear();
    electron.opened = [];
    sender = fakeWindow(1);
    other = fakeWindow(2);
    electron.windows = [sender, other];
    library = {
      directory: '/persona',
      entriesDirectory: '/persona/entries',
      list: vi.fn().mockResolvedValue({ entries: [], convertedProfiles: 0, existed: true }),
      save: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    new PersonaHandlers(library as never).register();
  });

  it('save_tellsEveryOtherWindow_butNotTheSender', async () => {
    expect(await invoke(PersonaChannel.Save, ENTRY)).toBeNull();

    expect(other.webContents.send).toHaveBeenCalledWith(PersonaChannel.Changed);
    expect(sender.webContents.send).not.toHaveBeenCalled();
  });

  it('save_thatFails_announcesNothing', async () => {
    Reflect.set(library, 'save', vi.fn().mockResolvedValue('Disk full.'));
    new PersonaHandlers(library as never).register();

    expect(await invoke(PersonaChannel.Save, ENTRY)).toBe('Disk full.');

    expect(other.webContents.send).not.toHaveBeenCalled();
  });

  it.each([[null], ['x'], [{ id: 'p', name: 'n' }], [{ id: 7, name: 'n', text: 'i' }]])(
    'save_ofAMalformedEntry_isRefused %#',
    async (value: unknown) => {
      expect(await invoke(PersonaChannel.Save, value)).toBe('The entry was malformed.');
    },
  );

  it('announce_skipsADestroyedWindow', async () => {
    other.isDestroyed = (): boolean => true;

    await invoke(PersonaChannel.Save, ENTRY);

    expect(other.webContents.send).not.toHaveBeenCalled();
  });

  it('delete_withANonString_deletesNothing', async () => {
    await invoke(PersonaChannel.Delete, 7);

    expect(library['delete']).not.toHaveBeenCalled();
    expect(other.webContents.send).not.toHaveBeenCalled();
  });

  it('delete_announces', async () => {
    await invoke(PersonaChannel.Delete, 'p');

    expect(library['delete']).toHaveBeenCalledWith('p');
    expect(other.webContents.send).toHaveBeenCalled();
  });

  it('openFolder_opensTheEntriesFolder', async () => {
    Reflect.set(library, 'entriesDirectory', tmpdir());

    await invoke(PersonaChannel.OpenFolder);

    expect(electron.opened).toEqual([tmpdir()]);
  });
});
