import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import type { ForgeResult } from '@shared/api/forge-types';
import type { HostedRepository } from '@shared/api/hosting-protocol';
import type { NewProjectOutcome } from '@shared/api/new-project-channels';
import type { VcsParams, VersionControlResponse } from '@shared/api/version-control-protocol';
import { parseWorktreeConfig, WorktreeConfig } from '@shared/api/worktree';
import type { CloneManager } from '../clone/clone-manager';
import type { HostingManager } from '../hosting/hosting-manager';
import type { TrustedPaths } from '../trusted-paths';
import type { VersionControlDescriptor } from '../version-control/version-control-descriptor';
import type { VersionControlHost } from '../version-control/version-control-host';
import { NewProjectManager, parseProjectRequest } from './new-project-manager';

describe('parseProjectRequest', () => {
  const hosted: Record<string, unknown> = {
    kind: 'hosted',
    host: 'github.com',
    account: 'matthew',
    private: true,
    layout: 'worktree',
  };

  it('acceptsNoRepository_andAHostedOne', () => {
    expect(parseProjectRequest({ name: 'todo', repository: { kind: 'none' } })).toEqual({
      name: 'todo',
      repository: { kind: 'none' },
    });
    expect(parseProjectRequest({ name: 'todo', repository: hosted })).toEqual({
      name: 'todo',
      repository: hosted,
    });
  });

  it('refusesANameThatIsMoreThanOneFolder', () => {
    for (const name of ['a/b', '..', '.', '', 'a\\b', 'a b']) {
      expect(typeof parseProjectRequest({ name, repository: { kind: 'none' } })).toBe('string');
    }
  });

  it('refusesAHostedRepository_missingItsAccountOrLayout', () => {
    expect(
      typeof parseProjectRequest({ name: 'todo', repository: { ...hosted, account: undefined } }),
    ).toBe('string');
    expect(
      typeof parseProjectRequest({ name: 'todo', repository: { ...hosted, layout: 'bare' } }),
    ).toBe('string');
    expect(typeof parseProjectRequest({ name: 'todo', repository: { kind: 'local' } })).toBe(
      'string',
    );
    expect(
      parseProjectRequest({ name: 'todo', repository: { kind: 'local', layout: 'flat' } }),
    ).toEqual({ name: 'todo', repository: { kind: 'local', layout: 'flat' } });
  });
});

describe('NewProjectManager', () => {
  let parent: string | null;
  let trusted: string[];
  let clones: CloneRequest[];
  let cloneOutcome: CloneOutcome;
  let made: { host: string; account: string; name: string; private: boolean }[];
  let repository: ForgeResult<HostedRepository>;
  let inits: VcsParams<'init'>[];
  let initError: string | null;

  /**
   * Builds the manager over stand-ins for the clone and hosting managers.
   * @returns Returns the manager.
   */
  function manager(): NewProjectManager {
    return new NewProjectManager(
      {
        parent: (): string | null => parent,
        clone: (request: CloneRequest): Promise<CloneOutcome> => {
          clones.push(request);
          return Promise.resolve(cloneOutcome);
        },
      } as unknown as CloneManager,
      {
        createRepository: (
          host: string,
          account: string,
          name: string,
          isPrivate: boolean,
        ): Promise<ForgeResult<HostedRepository>> => {
          made.push({ host, account, name, private: isPrivate });
          return Promise.resolve(repository);
        },
      } as unknown as HostingManager,
      {
        preferredPlugin: (): VersionControlDescriptor =>
          ({ id: 'test.git' }) as VersionControlDescriptor,
        initInChosenFolder: (
          _pluginId: string,
          params: VcsParams<'init'>,
        ): Promise<VersionControlResponse<'init'>> => {
          inits.push(params);
          if (initError !== null) {
            return Promise.resolve({ id: 1, ok: false, error: initError });
          }
          fs.mkdirSync(path.join(params.directory, '.git'), { recursive: true });
          return Promise.resolve({ id: 1, ok: true, result: {} });
        },
      } as unknown as VersionControlHost,
      { remember: (target: string): number => trusted.push(target) } as unknown as TrustedPaths,
    );
  }

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'project-parent-'));
    trusted = [];
    clones = [];
    cloneOutcome = { ok: true, path: path.join(parent, 'todo') };
    made = [];
    inits = [];
    initError = null;
    repository = {
      ok: true,
      value: {
        cloneUrl: 'https://github.com/matthew/todo.git',
        webUrl: 'https://github.com/matthew/todo',
      } as HostedRepository,
    };
  });

  afterEach(() => {
    if (parent !== null) {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('noRepository_makesTheFolder_andTrustsIt', async () => {
    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'none' },
    });

    const folder: string = path.join(parent!, 'todo');
    expect(outcome).toEqual({ ok: true, path: folder });
    expect(fs.statSync(folder).isDirectory()).toBe(true);
    expect(trusted).toEqual([folder]);
  });

  it('refuses_untilAFolderIsChosen', async () => {
    fs.rmSync(parent!, { recursive: true, force: true });
    parent = null;

    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'none' },
    });

    expect(outcome.ok).toBe(false);
  });

  it('refuses_aFolderThatAlreadyExists', async () => {
    fs.mkdirSync(path.join(parent!, 'todo'));

    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'none' },
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(trusted).toEqual([]);
  });

  it('aHostedRepository_isMadeByTheHost_thenCloned_inTheLayoutPicked', async () => {
    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: {
        kind: 'hosted',
        host: 'github.com',
        account: 'matthew',
        private: true,
        layout: 'worktree',
      },
    });

    expect(made).toEqual([{ host: 'github.com', account: 'matthew', name: 'todo', private: true }]);
    expect(clones).toEqual([
      { url: 'https://github.com/matthew/todo.git', name: 'todo', layout: 'worktree' },
    ]);
    expect(outcome).toEqual(cloneOutcome);
  });

  it('aHostThatRefuses_clonesNothing', async () => {
    repository = { ok: false, error: 'Name already exists', unauthorized: false };

    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: {
        kind: 'hosted',
        host: 'github.com',
        account: 'matthew',
        private: false,
        layout: 'flat',
      },
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok === false && outcome.error).toContain('Name already exists');
    expect(clones).toEqual([]);
  });

  it('aCloneThatFails_saysWhereTheRepositoryWasMade', async () => {
    cloneOutcome = { ok: false, error: 'Authentication failed' };

    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: {
        kind: 'hosted',
        host: 'github.com',
        account: 'matthew',
        private: true,
        layout: 'flat',
      },
    });

    expect(outcome.ok === false && outcome.error).toContain('https://github.com/matthew/todo');
    expect(outcome.ok === false && outcome.error).toContain('Authentication failed');
  });

  it('aLocalFlatRepository_isMadeInTheFolder_andTrusted', async () => {
    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'local', layout: 'flat' },
    });

    const folder: string = path.join(parent!, 'todo');
    expect(outcome).toEqual({ ok: true, path: folder });
    expect(inits).toEqual([{ directory: folder }]);
    expect(trusted).toEqual([folder]);
  });

  it('aLocalWorktree_isAContainer_whoseFirstCheckoutIsTheRepository_withNoOrigin', async () => {
    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'local', layout: 'worktree' },
    });

    const folder: string = path.join(parent!, 'todo');
    expect(outcome).toEqual({ ok: true, path: folder });
    const config: WorktreeConfig = parseWorktreeConfig(
      JSON.parse(fs.readFileSync(path.join(folder, '.studio', 'worktree.json'), 'utf8')),
    );
    expect(config.origin).toBeNull();
    expect(config.checkouts).toHaveLength(1);
    expect(inits).toEqual([{ directory: path.join(folder, config.checkouts[0].id) }]);
  });

  it('aLocalRepositoryThatFails_removesTheFolderItMade', async () => {
    initError = 'git is not installed';

    const outcome: NewProjectOutcome = await manager().create({
      name: 'todo',
      repository: { kind: 'local', layout: 'worktree' },
    });

    expect(outcome).toEqual({ ok: false, error: 'git is not installed' });
    expect(fs.existsSync(path.join(parent!, 'todo'))).toBe(false);
    expect(trusted).toEqual([]);
  });
});
