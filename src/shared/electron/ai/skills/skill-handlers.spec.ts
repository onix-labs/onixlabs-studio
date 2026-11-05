import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillChannel, SKILL_FILE } from '@shared/api/skill-channels';
import type { Skill, SkillSaveResult } from '@shared/api/skill-channels';
import type { BrowserWindow } from 'electron';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the fake Electron layer.
 */
const electron: {
  handlers: Map<string, Handler>;
  chosen: string[];
  revealed: string[];
  opened: string[];
  openFailure: string;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  chosen: [],
  revealed: [],
  opened: [],
  openFailure: '',
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: (): null => null, getFocusedWindow: (): null => null },
  dialog: {
    showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      Promise.resolve({ canceled: electron.chosen.length === 0, filePaths: electron.chosen }),
  },
  shell: {
    showItemInFolder: (target: string): void => void electron.revealed.push(target),
    openPath: (target: string): Promise<string> => {
      electron.opened.push(target);
      return Promise.resolve(electron.openFailure);
    },
  },
}));

const { SkillHandlers } = await import('./skill-handlers');
const { SkillLibrary } = await import('./skill-library');

describe('SkillHandlers', () => {
  let sandbox: string;
  let library: string;

  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param arg The renderer-supplied argument.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, arg?: unknown): Promise<T> {
    const handler: Handler | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({ sender: {} }, arg)) as T;
  }

  /**
   * Builds a well-formed draft.
   * @param overrides The fields to change.
   * @returns Returns the draft.
   */
  function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { name: 'testing', description: 'How to test.', body: 'Write tests.', ...overrides };
  }

  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-handlers-')));
    library = path.join(sandbox, 'skills');
    electron.handlers.clear();
    electron.chosen = [];
    electron.revealed = [];
    electron.opened = [];
    electron.openFailure = '';
    new SkillHandlers(new SkillLibrary(library), (): BrowserWindow | null => null).register();
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('save_thenList_roundTrips', async () => {
    const saved: SkillSaveResult = await invoke(SkillChannel.Save, draft());

    expect(saved.error ?? null).toBeNull();
    const listed: readonly Skill[] = await invoke(SkillChannel.List);
    expect(listed.map((skill: Skill): string => skill.name)).toEqual(['testing']);
  });

  it.each([
    [undefined],
    [null],
    ['skill'],
    [{ name: 7, description: 'd', body: 'b' }],
    [{ name: 'n', description: 7, body: 'b' }],
    [{ name: 'n', description: 'd', body: 7 }],
    [{ name: 'n', description: 'd' }],
  ])('save_ofAMalformedDraft_isRefused %#', async (value: unknown) => {
    expect(await invoke(SkillChannel.Save, value)).toEqual({
      skill: null,
      error: 'The skill was malformed.',
    });

    expect(fs.existsSync(library)).toBe(false);
  });

  it('save_atExactlyTheBodyLimit_isAccepted', async () => {
    const saved: SkillSaveResult = await invoke(
      SkillChannel.Save,
      draft({ body: 'x'.repeat(256 * 1024) }),
    );

    expect(saved.skill).not.toBeNull();
  });

  it('save_oneOverTheBodyLimit_isRefused', async () => {
    expect(
      await invoke(SkillChannel.Save, draft({ body: 'x'.repeat(256 * 1024 + 1) })),
    ).toMatchObject({ skill: null, error: 'The skill was malformed.' });
  });

  it.each([['../escaped'], ['a/b'], ['..'], ['/abs']])(
    'save_namedToEscapeTheLibrary_writesNothingOutsideIt %s',
    async (name: string) => {
      const saved: SkillSaveResult = await invoke(SkillChannel.Save, draft({ name }));

      expect(saved.skill).toBeNull();
      expect(
        fs.readdirSync(sandbox).filter((entry: string): boolean => entry !== 'skills'),
      ).toEqual([]);
    },
  );

  it('save_treatsAnEnabledThatIsNotFalseAsEnabled', async () => {
    const saved: SkillSaveResult = await invoke(SkillChannel.Save, draft({ enabled: 'no' }));

    expect(saved.skill?.enabled).toBe(true);
  });

  it('save_ofADisabledSkill_staysDisabled', async () => {
    const saved: SkillSaveResult = await invoke(SkillChannel.Save, draft({ enabled: false }));

    expect(saved.skill?.enabled).toBe(false);
  });

  it('delete_removesTheSkill', async () => {
    await invoke(SkillChannel.Save, draft());

    await invoke(SkillChannel.Delete, 'testing');

    expect(await invoke(SkillChannel.List)).toEqual([]);
  });

  it.each([[undefined], [7], [null]])(
    'delete_withANonString_removesNothing %#',
    async (name: unknown) => {
      await invoke(SkillChannel.Save, draft());

      await invoke(SkillChannel.Delete, name);

      expect(await invoke(SkillChannel.List)).toHaveLength(1);
    },
  );

  it('delete_namedToEscapeTheLibrary_removesNothingOutsideIt', async () => {
    await invoke(SkillChannel.Save, draft());
    const outside: string = path.join(sandbox, 'outside');
    fs.mkdirSync(outside);

    await invoke(SkillChannel.Delete, '../outside').catch((): void => undefined);

    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(library)).toBe(true);
  });

  it('reveal_showsTheSkillsFolder', async () => {
    await invoke(SkillChannel.Save, draft());

    await invoke(SkillChannel.Reveal, 'testing');

    expect(electron.revealed).toEqual([path.join(library, 'testing')]);
  });

  it.each([[7], ['../outside']])(
    'reveal_ofNothingKnown_revealsNothing %#',
    async (name: unknown) => {
      await invoke(SkillChannel.Reveal, name);

      expect(electron.revealed).toEqual([]);
    },
  );

  it('openLibrary_createsTheFolderFirst', async () => {
    await invoke(SkillChannel.OpenLibrary);

    expect(fs.existsSync(library)).toBe(true);
    expect(electron.opened).toEqual([library]);
  });

  it('openLibrary_thatFails_stillResolves', async () => {
    electron.openFailure = 'No application';

    await expect(invoke(SkillChannel.OpenLibrary)).resolves.toBeUndefined();
  });

  it('import_whenCancelled_answersNull', async () => {
    expect(await invoke(SkillChannel.Import)).toBeNull();
  });

  it('import_ofAChosenFolder_addsTheSkill', async () => {
    const folder: string = path.join(sandbox, 'imported');
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, SKILL_FILE),
      '---\nname: imported\ndescription: From elsewhere.\n---\n\nBody.\n',
    );
    electron.chosen = [folder];

    const result: SkillSaveResult = await invoke(SkillChannel.Import);

    expect(result.skill?.name).toBe('imported');
  });
});
