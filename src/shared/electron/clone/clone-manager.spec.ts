import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloneOutcome } from '@shared/api/clone-channels';
import type { VcsParams, VersionControlResponse } from '@shared/api/version-control-protocol';
import { parseWorktreeConfig } from '@shared/api/worktree';
import type { TrustedPaths } from '../trusted-paths';
import type { VersionControlDescriptor } from '../version-control/version-control-descriptor';
import type { VersionControlHost } from '../version-control/version-control-host';
import { CloneManager, parseRequest } from './clone-manager';

/**
 * A version-control host that "clones" by creating the directory, and records what it was asked.
 */
class FakeHost {
  /**
   * Holds the clones asked for.
   */
  public readonly clones: VcsParams<'clone'>[] = [];

  /**
   * Holds the error the next clone fails with, or null to succeed.
   */
  public failWith: string | null = null;

  /**
   * Gets the plugin that clones.
   * @returns Returns a stand-in descriptor.
   */
  public preferredPlugin(): VersionControlDescriptor {
    return { id: 'test.git' } as VersionControlDescriptor;
  }

  /**
   * Records a clone, and makes its directory as git would.
   * @param _pluginId The plugin.
   * @param params The clone.
   * @returns Returns the outcome.
   */
  public cloneToChosenFolder(
    _pluginId: string,
    params: VcsParams<'clone'>,
  ): Promise<VersionControlResponse<'clone'>> {
    this.clones.push(params);
    if (this.failWith !== null) {
      return Promise.resolve({ id: 1, ok: false, error: this.failWith });
    }
    fs.mkdirSync(params.directory, { recursive: true });
    fs.writeFileSync(path.join(params.directory, 'README.md'), '# cloned');
    return Promise.resolve({ id: 1, ok: true, result: {} });
  }
}

describe('parseRequest', () => {
  const valid: Record<string, unknown> = {
    url: 'https://github.com/onix-labs/onixlabs-studio.git',
    name: 'onixlabs-studio',
    layout: 'flat',
  };

  it('acceptsARemoteUrlInEitherForm', () => {
    expect(parseRequest(valid)).toEqual(valid);
    expect(parseRequest({ ...valid, url: 'git@github.com:onix-labs/onixlabs-studio.git' })).toEqual(
      { ...valid, url: 'git@github.com:onix-labs/onixlabs-studio.git' },
    );
  });

  it('refusesAnythingThatIsNotARemote_orReadsAsAnOption', () => {
    // A local path or file URL would copy any folder on the machine; an option would be read by git.
    for (const url of ['/etc', 'file:///etc', '--upload-pack=touch /tmp/x', 'https://a b']) {
      expect(typeof parseRequest({ ...valid, url })).toBe('string');
    }
  });

  it('refusesAFolderNameThatIsMoreThanOneName', () => {
    for (const name of ['a/b', '..', '.', '', 'a\\b']) {
      expect(typeof parseRequest({ ...valid, name })).toBe('string');
    }
  });

  it('refusesABranchThatReadsAsAnOption_andAnUnknownLayout', () => {
    expect(typeof parseRequest({ ...valid, branch: '-x' })).toBe('string');
    expect(typeof parseRequest({ ...valid, layout: 'bare' })).toBe('string');
    expect(parseRequest({ ...valid, branch: 'main' })).toEqual({ ...valid, branch: 'main' });
  });
});

describe('CloneManager', () => {
  let parent: string;
  let file: string;
  let host: FakeHost;
  let trusted: string[];

  /**
   * Builds the manager, with the parent folder already chosen unless told otherwise.
   * @param chosen Whether a parent folder is remembered.
   * @returns Returns the manager.
   */
  function manager(chosen: boolean = true): CloneManager {
    if (chosen) {
      fs.writeFileSync(file, JSON.stringify({ parent }));
    }
    return new CloneManager(
      file,
      () => null,
      host as unknown as VersionControlHost,
      { remember: (target: string): number => trusted.push(target) } as unknown as TrustedPaths,
    );
  }

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-parent-'));
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-settings-')), 'clone.json');
    host = new FakeHost();
    trusted = [];
  });

  afterEach(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('refuses_untilAFolderIsChosen', async () => {
    const outcome: CloneOutcome = await manager(false).clone({
      url: 'https://github.com/a/b.git',
      name: 'b',
      layout: 'flat',
    });

    expect(outcome).toEqual({ ok: false, error: 'Choose a folder to clone into first.' });
    expect(host.clones).toEqual([]);
  });

  it('clonesFlat_intoTheChosenFolder_andTrustsTheResult', async () => {
    const outcome: CloneOutcome = await manager().clone({
      url: 'https://github.com/a/b.git',
      name: 'b',
      layout: 'flat',
      branch: 'develop',
    });

    const destination: string = path.join(parent, 'b');
    expect(outcome).toEqual({ ok: true, path: destination });
    expect(host.clones).toEqual([
      { url: 'https://github.com/a/b.git', directory: destination, branch: 'develop' },
    ]);
    expect(trusted).toEqual([destination]);
  });

  it('refusesAFolderThatAlreadyExists', async () => {
    fs.mkdirSync(path.join(parent, 'b'));

    const outcome: CloneOutcome = await manager().clone({
      url: 'https://github.com/a/b.git',
      name: 'b',
      layout: 'flat',
    });

    expect(outcome.ok).toBe(false);
    expect(host.clones).toEqual([]);
  });

  it('makesAWorktreeContainer_withTheCloneAsItsFirstCheckout', async () => {
    const outcome: CloneOutcome = await manager().clone({
      url: 'https://github.com/a/b.git',
      name: 'b',
      layout: 'worktree',
    });

    const container: string = path.join(parent, 'b');
    expect(outcome).toEqual({ ok: true, path: container });
    const config: ReturnType<typeof parseWorktreeConfig> = parseWorktreeConfig(
      JSON.parse(fs.readFileSync(path.join(container, '.studio', 'worktree.json'), 'utf8')),
    );
    expect(config.origin).toBe('https://github.com/a/b.git');
    expect(config.checkouts.length).toBe(1);
    expect(host.clones[0].directory).toBe(path.join(container, config.checkouts[0].id));
    expect(fs.existsSync(path.join(host.clones[0].directory, 'README.md'))).toBe(true);
    expect(trusted).toEqual([container]);
  });

  it('removesTheContainer_whenItsCloneFails', async () => {
    host.failWith = 'Authentication failed';

    const outcome: CloneOutcome = await manager().clone({
      url: 'https://github.com/a/b.git',
      name: 'b',
      layout: 'worktree',
    });

    expect(outcome).toEqual({ ok: false, error: 'Authentication failed' });
    expect(fs.existsSync(path.join(parent, 'b'))).toBe(false);
    expect(trusted).toEqual([]);
  });
});
