import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioChannel } from '@shared/api/studio-channels';
import type { StudioSnapshot } from '@shared/api/studio';
import {
  STUDIO_DIR,
  STUDIO_USER_FILE,
  STUDIO_USER_IGNORE,
  STUDIO_WORKSPACE_FILE,
} from '@shared/api/studio';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the IPC handlers registered.
 */
const handlers: Map<string, Handler> = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void handlers.set(channel, handler),
  },
}));

const { StudioStore } = await import('./studio-store');
const { WorkspaceContext } = await import('../workspace-context');

describe('StudioStore', () => {
  let sandbox: string;
  let root: string;
  let addsToGitignore: boolean;

  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param args The renderer-supplied arguments.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({}, ...args)) as T;
  }

  /**
   * Gets the path of a file in the workspace's studio folder.
   * @param name The file's name.
   * @returns Returns the path.
   */
  function studioFile(name: string): string {
    return path.join(root, STUDIO_DIR, name);
  }

  /**
   * Reads the workspace's `.gitignore`.
   * @returns Returns its text.
   */
  function gitignore(): string {
    return fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  }

  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-store-')));
    root = path.join(sandbox, 'ws');
    fs.mkdirSync(root);
    handlers.clear();
    addsToGitignore = true;
    const workspace: InstanceType<typeof WorkspaceContext> = new WorkspaceContext();
    workspace.addRoot(root);
    new StudioStore(workspace, (): boolean => addsToGitignore).register();
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it.each([[undefined], [null], [7], ['/not/open'], ['']])(
    'everyChannel_refusesARootThatIsNotOpen %#',
    async (candidate: unknown) => {
      expect(await invoke(StudioChannel.Load, candidate)).toBeNull();
      expect(await invoke(StudioChannel.SaveWorkspace, candidate, {})).toBe(false);
      expect(await invoke(StudioChannel.SaveUser, candidate, {})).toBe(false);

      expect(fs.readdirSync(root)).toEqual([]);
    },
  );

  it('channels_refuseAFolderInsideARoot', async () => {
    const inner: string = path.join(root, 'inner');
    fs.mkdirSync(inner);

    expect(await invoke(StudioChannel.SaveWorkspace, inner, {})).toBe(false);

    expect(fs.readdirSync(inner)).toEqual([]);
  });

  it('load_withNothingOnDisk_answersTheDefaults', async () => {
    const snapshot: StudioSnapshot = await invoke(StudioChannel.Load, root);

    expect(snapshot.workspace.runConfigurations).toEqual([]);
  });

  it('load_ofMalformedFiles_answersTheDefaults', async () => {
    fs.mkdirSync(path.join(root, STUDIO_DIR));
    fs.writeFileSync(studioFile(STUDIO_WORKSPACE_FILE), '{ not json');
    fs.writeFileSync(studioFile(STUDIO_USER_FILE), '[1, 2]');

    const snapshot: StudioSnapshot = await invoke(StudioChannel.Load, root);

    expect(snapshot.workspace.runConfigurations).toEqual([]);
  });

  it('save_thenLoad_roundTrips', async () => {
    const before: StudioSnapshot = await invoke(StudioChannel.Load, root);

    expect(await invoke(StudioChannel.SaveWorkspace, root, before.workspace)).toBe(true);
    expect(await invoke(StudioChannel.SaveUser, root, before.user)).toBe(true);

    expect(await invoke(StudioChannel.Load, root)).toEqual(before);
  });

  it('save_ofGarbage_writesTheSanitisedDefaults', async () => {
    expect(await invoke(StudioChannel.SaveWorkspace, root, { runConfigurations: 'evil' })).toBe(
      true,
    );

    expect(JSON.parse(fs.readFileSync(studioFile(STUDIO_WORKSPACE_FILE), 'utf8'))).toMatchObject({
      runConfigurations: [],
    });
  });

  it('save_leavesNoTemporaryBehind', async () => {
    await invoke(StudioChannel.SaveWorkspace, root, {});

    expect(fs.readdirSync(path.join(root, STUDIO_DIR))).toEqual([STUDIO_WORKSPACE_FILE]);
  });

  it('save_concurrently_allSucceed_andLeaveNoTemporary', async () => {
    const results: readonly boolean[] = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((): Promise<boolean> => invoke(StudioChannel.SaveWorkspace, root, {})),
    );

    expect(results).toEqual([true, true, true, true, true, true]);
    expect(fs.readdirSync(path.join(root, STUDIO_DIR))).toEqual([STUDIO_WORKSPACE_FILE]);
  });

  it('save_whenTheStudioFolderCannotBeMade_answersFalse', async () => {
    fs.writeFileSync(path.join(root, STUDIO_DIR), 'a file in the way');

    await expect(invoke(StudioChannel.SaveWorkspace, root, {})).resolves.toBe(false);
  });

  it('gitignore_isCreatedWithThePattern', async () => {
    await invoke(StudioChannel.SaveUser, root, {});

    expect(gitignore()).toBe(`${STUDIO_USER_IGNORE}\n`);
  });

  it('gitignore_isAppendedTo_onItsOwnLine', async () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules');

    await invoke(StudioChannel.SaveUser, root, {});

    expect(gitignore()).toBe(`node_modules\n${STUDIO_USER_IGNORE}\n`);
  });

  it('gitignore_thatEndsInANewline_gainsNoBlankLine', async () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');

    await invoke(StudioChannel.SaveUser, root, {});

    expect(gitignore()).toBe(`node_modules\n${STUDIO_USER_IGNORE}\n`);
  });

  it('gitignore_alreadyHoldingThePattern_isLeftAlone', async () => {
    const existing: string = `node_modules\r\n  ${STUDIO_USER_IGNORE}  \r\n`;
    fs.writeFileSync(path.join(root, '.gitignore'), existing);

    await invoke(StudioChannel.SaveUser, root, {});

    expect(gitignore()).toBe(existing);
  });

  it('gitignore_withTheSettingOff_isNotTouched', async () => {
    addsToGitignore = false;

    await invoke(StudioChannel.SaveUser, root, {});

    expect(fs.existsSync(path.join(root, '.gitignore'))).toBe(false);
  });

  it('gitignore_thatCannotBeWritten_doesNotCostTheSave', async () => {
    fs.mkdirSync(path.join(root, '.gitignore'));

    expect(await invoke(StudioChannel.SaveWorkspace, root, {})).toBe(true);

    expect(fs.existsSync(studioFile(STUDIO_WORKSPACE_FILE))).toBe(true);
  });
});
