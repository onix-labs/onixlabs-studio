import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptProfileChannel } from '@shared/api/prompt-profile-channels';
import { SkillImportChannel } from '@shared/api/skill-import-channels';
import type { BrowserWindow } from 'electron';
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
  chosen: string[];
  windows: FakeWindow[];
  revealed: string[];
  opened: string[];
  messages: unknown[];
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  chosen: [],
  windows: [],
  revealed: [],
  opened: [],
  messages: [],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  BrowserWindow: {
    fromWebContents: (): null => null,
    getFocusedWindow: (): null => null,
    getAllWindows: (): FakeWindow[] => electron.windows,
  },
  dialog: {
    showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      Promise.resolve({ canceled: electron.chosen.length === 0, filePaths: electron.chosen }),
    showMessageBox: (options: unknown): Promise<{ response: number }> => {
      electron.messages.push(options);
      return Promise.resolve({ response: 0 });
    },
  },
  shell: {
    showItemInFolder: (target: string): void => void electron.revealed.push(target),
    openPath: (target: string): Promise<string> => {
      electron.opened.push(target);
      return Promise.resolve('');
    },
  },
}));

const { LibraryTransferHandlers } = await import('./library-transfer-handlers');

/**
 * Holds a well-formed prompt profile.
 */
const PROFILE: object = { id: 'p', name: 'Terse', instructions: 'Be terse.' };

/**
 * Builds an accepted skill.
 * @param overrides The draft fields to change.
 * @returns Returns the entry.
 */
function acceptedSkill(overrides: Record<string, unknown> = {}): object {
  return { source: '/a.md', draft: { name: 'a', description: 'd', body: 'b', ...overrides } };
}

describe('LibraryTransferHandlers', () => {
  let profiles: Record<string, unknown>;
  let transfer: Record<string, Mock>;
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
    electron.chosen = [];
    electron.revealed = [];
    electron.opened = [];
    electron.messages = [];
    sender = fakeWindow(1);
    other = fakeWindow(2);
    electron.windows = [sender, other];
    profiles = {
      directory: '/profiles',
      list: vi.fn().mockResolvedValue({ profiles: [] }),
      save: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    transfer = {
      scan: vi.fn().mockResolvedValue({ id: 'plan' }),
      scanForProfiles: vi.fn().mockResolvedValue({ id: 'plan' }),
      discard: vi.fn(),
      commit: vi.fn().mockResolvedValue({ skills: 1, profiles: 0, linksRewritten: 0, error: null }),
      export: vi.fn().mockResolvedValue({ folder: '/out/export', error: null }),
    };
    new LibraryTransferHandlers(
      profiles as never,
      transfer as never,
      (): BrowserWindow | null => null,
    ).register();
  });

  describe('profiles', () => {
    it('save_tellsEveryOtherWindow_butNotTheSender', async () => {
      expect(await invoke(PromptProfileChannel.Save, PROFILE)).toBeNull();

      expect(other.webContents.send).toHaveBeenCalledWith(PromptProfileChannel.Changed);
      expect(sender.webContents.send).not.toHaveBeenCalled();
    });

    it('save_thatFails_announcesNothing', async () => {
      Reflect.set(profiles, 'save', vi.fn().mockResolvedValue('Disk full.'));
      new LibraryTransferHandlers(
        profiles as never,
        transfer as never,
        (): BrowserWindow | null => null,
      ).register();

      expect(await invoke(PromptProfileChannel.Save, PROFILE)).toBe('Disk full.');

      expect(other.webContents.send).not.toHaveBeenCalled();
    });

    it.each([[null], ['x'], [{ id: 'p', name: 'n' }], [{ id: 7, name: 'n', instructions: 'i' }]])(
      'save_ofAMalformedProfile_isRefused %#',
      async (value: unknown) => {
        expect(await invoke(PromptProfileChannel.Save, value)).toBe('The profile was malformed.');
      },
    );

    it('announce_skipsADestroyedWindow', async () => {
      other.isDestroyed = (): boolean => true;

      await invoke(PromptProfileChannel.Save, PROFILE);

      expect(other.webContents.send).not.toHaveBeenCalled();
    });

    it('delete_withANonString_deletesNothing', async () => {
      await invoke(PromptProfileChannel.Delete, 7);

      expect(profiles['delete']).not.toHaveBeenCalled();
      expect(other.webContents.send).not.toHaveBeenCalled();
    });

    it('delete_announces', async () => {
      await invoke(PromptProfileChannel.Delete, 'p');

      expect(profiles['delete']).toHaveBeenCalledWith('p');
      expect(other.webContents.send).toHaveBeenCalled();
    });
  });

  describe('choosing', () => {
    it.each([
      [SkillImportChannel.Choose, 'scan'],
      [SkillImportChannel.ChooseProfiles, 'scanForProfiles'],
    ])('%s_whenCancelled_scansNothing', async (channel: string, method: string) => {
      expect(await invoke(channel)).toBeNull();

      expect(transfer[method]).not.toHaveBeenCalled();
    });

    it.each([
      [SkillImportChannel.Choose, 'scan'],
      [SkillImportChannel.ChooseProfiles, 'scanForProfiles'],
    ])('%s_scansEveryChoice', async (channel: string, method: string) => {
      electron.chosen = ['/a', '/b'];

      await invoke(channel);

      expect(transfer[method]).toHaveBeenCalledWith(['/a', '/b']);
    });

    it('discard_takesOnlyAString', async () => {
      await invoke(SkillImportChannel.Discard, 7);
      await invoke(SkillImportChannel.Discard, 'plan');

      expect(transfer['discard']).toHaveBeenCalledTimes(1);
      expect(transfer['discard']).toHaveBeenCalledWith('plan');
    });
  });

  describe('commit', () => {
    const MALFORMED: object = {
      skills: 0,
      profiles: 0,
      linksRewritten: 0,
      error: 'The import was malformed.',
    };

    it.each([
      [undefined],
      [null],
      ['commit'],
      [{ planId: 7, skills: [], profiles: [] }],
      [{ planId: 'p', skills: 'x', profiles: [] }],
      [{ planId: 'p', skills: [], profiles: {} }],
      [{ planId: 'p', skills: [null], profiles: [] }],
      [{ planId: 'p', skills: [{ source: 7, draft: {} }], profiles: [] }],
      [{ planId: 'p', skills: [{ source: '/a', draft: null }], profiles: [] }],
      [{ planId: 'p', skills: [{ source: '/a', draft: { name: 7 } }], profiles: [] }],
      [{ planId: 'p', skills: [], profiles: [null] }],
      [{ planId: 'p', skills: [], profiles: [{ profile: { id: 'p' } }] }],
    ])('commit_ofAMalformedPayload_commitsNothing %#', async (value: unknown) => {
      expect(await invoke(SkillImportChannel.Commit, value)).toEqual(MALFORMED);

      expect(transfer['commit']).not.toHaveBeenCalled();
    });

    it('commit_atTheItemLimit_isAccepted', async () => {
      await invoke(SkillImportChannel.Commit, {
        planId: 'p',
        skills: new Array<unknown>(2000).fill(acceptedSkill()),
        profiles: [],
      });

      expect(transfer['commit']).toHaveBeenCalledOnce();
    });

    it('commit_overTheItemLimit_isRefused', async () => {
      expect(
        await invoke(SkillImportChannel.Commit, {
          planId: 'p',
          skills: new Array<unknown>(2001).fill(acceptedSkill()),
          profiles: [],
        }),
      ).toEqual(MALFORMED);
    });

    it('commit_withABodyOverTheLimit_isRefused', async () => {
      expect(
        await invoke(SkillImportChannel.Commit, {
          planId: 'p',
          skills: [acceptedSkill({ body: 'x'.repeat(256 * 1024 + 1) })],
          profiles: [],
        }),
      ).toEqual(MALFORMED);
    });

    it('commit_normalisesWhatItPasses_andDropsAnythingExtra', async () => {
      await invoke(SkillImportChannel.Commit, {
        planId: 'p',
        skills: [
          {
            source: '/a.md',
            replace: 'yes',
            extra: 'dropped',
            draft: { name: '  MiXeD  ', description: '  d  ', body: 'b', enabled: 'no' },
          },
        ],
        profiles: [{ profile: PROFILE, replace: true }],
      });

      expect(transfer['commit']?.mock.calls[0]?.[0]).toMatchObject({
        planId: 'p',
        skills: [
          {
            source: '/a.md',
            replace: false,
            draft: { name: 'mixed', description: 'd', enabled: true },
          },
        ],
        profiles: [{ replace: true }],
      });
    });

    it('commit_thatChangedProfiles_tellsEveryWindow_senderIncluded', async () => {
      transfer['commit']?.mockResolvedValue({
        skills: 0,
        profiles: 2,
        linksRewritten: 0,
        error: null,
      });

      await invoke(SkillImportChannel.Commit, { planId: 'p', skills: [], profiles: [] });

      expect(sender.webContents.send).toHaveBeenCalledWith(PromptProfileChannel.Changed);
      expect(other.webContents.send).toHaveBeenCalledWith(PromptProfileChannel.Changed);
    });

    it.each([
      [{ skills: 1, profiles: 0, linksRewritten: 0, error: null }],
      [{ skills: 0, profiles: 2, linksRewritten: 0, error: 'Failed part way.' }],
    ])('commit_withoutAChangeToProfiles_announcesNothing %#', async (result: object) => {
      transfer['commit']?.mockResolvedValue(result);

      await invoke(SkillImportChannel.Commit, { planId: 'p', skills: [], profiles: [] });

      expect(other.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('export_whenCancelled_writesNothing', async () => {
      expect(await invoke(SkillImportChannel.Export)).toBeNull();

      expect(transfer['export']).not.toHaveBeenCalled();
    });

    it('export_revealsTheNewFolder', async () => {
      electron.chosen = ['/out'];

      await invoke(SkillImportChannel.Export);

      expect(electron.revealed).toEqual(['/out/export']);
      expect(electron.messages).toEqual([]);
    });

    it('export_thatFails_saysWhy', async () => {
      electron.chosen = ['/out'];
      transfer['export']?.mockResolvedValue({ folder: null, error: 'Disk full.' });

      await invoke(SkillImportChannel.Export);

      expect(electron.revealed).toEqual([]);
      expect(electron.messages).toEqual([expect.objectContaining({ detail: 'Disk full.' })]);
    });
  });

  it('openFolder_opensTheProfilesFolder', async () => {
    Reflect.set(profiles, 'directory', tmpdir());

    await invoke(PromptProfileChannel.OpenFolder);

    expect(electron.opened).toEqual([tmpdir()]);
  });
});
