import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCategoryChannel } from '@shared/api/agent-category-channels';
import type { AgentCategory } from '@shared/api/agent-category-channels';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the IPC handlers registered and the user-data directory.
 */
const electron: { handlers: Map<string, Handler>; userData: string } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  userData: '',
}));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
}));

const { AgentCategoryStore } = await import('./agent-category-store');

/**
 * Builds a category.
 * @param id The id.
 * @param overrides The fields to change.
 * @returns Returns the category.
 */
function category(id: string, overrides: Partial<AgentCategory> = {}): AgentCategory {
  return { id, name: id, sortOrder: 0, createdAt: 0, ...overrides };
}

describe('AgentCategoryStore', () => {
  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param arg The renderer-supplied argument.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, arg?: unknown): Promise<T> {
    return (await electron.handlers.get(channel)?.({}, arg)) as T;
  }

  /**
   * Lists the ids the store answers with.
   * @returns Returns them.
   */
  async function ids(): Promise<readonly string[]> {
    const listed: readonly AgentCategory[] = await invoke(AgentCategoryChannel.List);
    return listed.map((entry: AgentCategory): string => entry.id);
  }

  /**
   * Gets the path of the categories file.
   * @returns Returns the path.
   */
  function file(): string {
    return path.join(electron.userData, 'agent-conversations', 'categories.json');
  }

  beforeEach(() => {
    electron.userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'categories-')));
    electron.handlers.clear();
    new AgentCategoryStore().register();
  });

  afterEach(() => {
    fs.rmSync(electron.userData, { recursive: true, force: true });
  });

  it('list_withNothingStored_answersEmpty', async () => {
    expect(await ids()).toEqual([]);
  });

  it('list_ordersBySortOrderThenCreation', async () => {
    await invoke(AgentCategoryChannel.Save, category('late', { sortOrder: 1, createdAt: 2 }));
    await invoke(AgentCategoryChannel.Save, category('early', { sortOrder: 1, createdAt: 1 }));
    await invoke(AgentCategoryChannel.Save, category('first', { sortOrder: 0, createdAt: 9 }));

    expect(await ids()).toEqual(['first', 'early', 'late']);
  });

  it('save_replacesByIdRatherThanDuplicating', async () => {
    await invoke(AgentCategoryChannel.Save, category('a', { name: 'old' }));
    await invoke(AgentCategoryChannel.Save, category('a', { name: 'new' }));

    expect(await invoke(AgentCategoryChannel.List)).toEqual([category('a', { name: 'new' })]);
  });

  it.each([
    [null],
    ['a'],
    [{ id: '', name: 'x', sortOrder: 0, createdAt: 0 }],
    [{ id: 'a', name: 7, sortOrder: 0, createdAt: 0 }],
    [{ id: 'a', name: 'x', sortOrder: '0', createdAt: 0 }],
    [{ id: 'a', name: 'x', sortOrder: 0, createdAt: 0, color: 7 }],
  ])('save_ofAMalformedCategory_storesNothing %#', async (value: unknown) => {
    expect(await invoke(AgentCategoryChannel.Save, value)).toBeNull();

    expect(await ids()).toEqual([]);
  });

  it.each([
    [{ sortOrder: Number.NaN }],
    [{ sortOrder: Number.POSITIVE_INFINITY }],
    [{ createdAt: Number.NaN }],
  ])('save_ofANumberJsonCannotHold_isRefused_notLostOnNextRead %#', async (bad: object) => {
    expect(await invoke(AgentCategoryChannel.Save, category('a', bad))).toBeNull();
  });

  it('save_whenTheWriteFails_answersNull', async () => {
    fs.writeFileSync(path.join(electron.userData, 'agent-conversations'), 'a file in the way');

    expect(await invoke(AgentCategoryChannel.Save, category('a'))).toBeNull();
  });

  it('delete_removesOnlyTheNamedIds', async () => {
    await invoke(AgentCategoryChannel.Save, category('a'));
    await invoke(AgentCategoryChannel.Save, category('b'));
    await invoke(AgentCategoryChannel.Save, category('c'));

    await invoke(AgentCategoryChannel.Delete, ['a', 7, 'c', 'unknown']);

    expect(await ids()).toEqual(['b']);
  });

  it.each([[undefined], ['a'], [[]], [[7]]])(
    'delete_withNothingUsable_keepsEverything %#',
    async (value: unknown) => {
      await invoke(AgentCategoryChannel.Save, category('a'));

      await invoke(AgentCategoryChannel.Delete, value);

      expect(await ids()).toEqual(['a']);
    },
  );

  it('read_ofACorruptFile_answersEmpty', async () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), '{ corrupt');

    expect(await ids()).toEqual([]);
  });

  it('read_keepsTheValidEntriesOfAPartlyBadFile', async () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), JSON.stringify([category('good'), { id: 7 }, null, 'x']));

    expect(await ids()).toEqual(['good']);
  });

  it('read_ofSomethingNotAList_answersEmpty', async () => {
    fs.mkdirSync(path.dirname(file()));
    fs.writeFileSync(file(), '{"id":"a"}');

    expect(await ids()).toEqual([]);
  });

  it('write_isPrivateToTheUser', async () => {
    await invoke(AgentCategoryChannel.Save, category('a'));

    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });
});
