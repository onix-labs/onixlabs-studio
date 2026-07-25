import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUDIO_DIR } from '@shared/api/studio';
import {
  isSafeCheckoutId,
  parseWorktreeConfig,
  serializeWorktreeConfig,
  WORKTREE_CONFIG_FILE,
  WorktreeCheckoutInfo,
  WorktreeConfig,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { TrustedPaths } from '../trusted-paths';
import { WorkspaceContext } from '../workspace-context';
import { WorktreeOperations } from './worktree-operations';

/**
 * The per-test timeout: these tests shell out to real git (init, commit, clone), which is quick but
 * not instant.
 */
const GIT_TEST_TIMEOUT: { timeout: number } = { timeout: 30000 };

/**
 * Runs git in a directory, throwing on failure.
 * @param cwd The working directory.
 * @param args The git argument vector.
 * @returns Resolves when the invocation succeeds.
 */
function git(cwd: string, ...args: string[]): Promise<void> {
  return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
    execFile('git', args, { cwd, timeout: 20000 }, (error: Error | null): void => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Initializes a repository with one committed file.
 * @param dir The repository directory, which must exist.
 */
async function initRepo(dir: string): Promise<void> {
  await git(dir, 'init', '-b', 'main');
  await fs.writeFile(path.join(dir, 'README.md'), '# Fixture\n', 'utf8');
  await git(dir, 'add', '.');
  await git(dir, '-c', 'user.email=spec@studio', '-c', 'user.name=Spec', 'commit', '-m', 'initial');
}

describe('WorktreeOperations', () => {
  let base: string;
  let workspace: WorkspaceContext;
  let trusted: TrustedPaths;
  let trashed: string[];
  let operations: WorktreeOperations;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-spec-'));
    workspace = new WorkspaceContext();
    trusted = new TrustedPaths(path.join(base, 'trusted.json'));
    trashed = [];
    operations = new WorktreeOperations(
      workspace,
      trusted,
      async (target: string): Promise<void> => {
        trashed.push(target);
        await fs.rm(target, { recursive: true, force: true });
      },
    );
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  /**
   * Creates, initializes, opens, and promotes a repository, returning the container root and its
   * descriptor.
   * @returns Returns the container root and the promotion descriptor.
   */
  async function promoteFixture(): Promise<{ root: string; descriptor: WorktreeDescriptor }> {
    const root: string = path.join(base, 'repo');
    await fs.mkdir(root);
    await initRepo(root);
    workspace.addRoot(root);
    const outcome: WorktreeOutcome<WorktreeDescriptor> = await operations.promote(root);
    if (!outcome.ok) {
      throw new Error(outcome.error);
    }
    return { root, descriptor: outcome.value };
  }

  describe('resolveKind', () => {
    it('deniesPathsThatAreNeitherTrustedNorWithinAnOpenRoot', async () => {
      const dir: string = path.join(base, 'somewhere');
      await fs.mkdir(dir);

      expect(await operations.resolveKind(dir)).toBeNull();
      expect(await operations.resolveKind(42)).toBeNull();
      expect(await operations.resolveKind('')).toBeNull();
    });

    it('distinguishesFolderWorkspaceAndWorktree', GIT_TEST_TIMEOUT, async () => {
      const dir: string = path.join(base, 'thing');
      await fs.mkdir(dir);
      trusted.remember(dir);

      expect(await operations.resolveKind(dir)).toBe('folder');

      await initRepo(dir);
      expect(await operations.resolveKind(dir)).toBe('workspace');

      workspace.addRoot(dir);
      const outcome: WorktreeOutcome<WorktreeDescriptor> = await operations.promote(dir);
      expect(outcome.ok).toBe(true);
      expect(await operations.resolveKind(dir)).toBe('worktree');
    });
  });

  describe('promote', () => {
    it('movesTheEntireWorkingCopyIntoTheFirstCheckout', GIT_TEST_TIMEOUT, async () => {
      const root: string = path.join(base, 'repo');
      await fs.mkdir(root);
      await initRepo(root);
      // The repository's own committed studio persistence must travel with the checkout.
      await fs.mkdir(path.join(root, STUDIO_DIR));
      await fs.writeFile(path.join(root, STUDIO_DIR, 'workspace.json'), '{"version":1}\n', 'utf8');
      workspace.addRoot(root);

      const outcome: WorktreeOutcome<WorktreeDescriptor> = await operations.promote(root);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        return;
      }
      const descriptor: WorktreeDescriptor = outcome.value;
      expect(descriptor.root).toBe(root);
      expect(descriptor.origin).toBeNull();
      expect(descriptor.checkouts).toHaveLength(1);
      const id: string = descriptor.checkouts[0].id;
      expect(isSafeCheckoutId(id)).toBe(true);
      expect(descriptor.checkouts[0].exists).toBe(true);
      expect(descriptor.checkouts[0].branch).toBe('main');

      // The container holds exactly the checkout and the new container meta.
      expect((await fs.readdir(root)).sort()).toEqual([STUDIO_DIR, id].sort());
      // The checkout holds everything the repository held, including its own .studio.
      const moved: readonly string[] = await fs.readdir(path.join(root, id));
      expect(moved).toContain('README.md');
      expect(moved).toContain('.git');
      expect(moved).toContain(STUDIO_DIR);
      // The container meta registers the checkout.
      const config: WorktreeConfig = parseWorktreeConfig(
        JSON.parse(await fs.readFile(path.join(root, STUDIO_DIR, WORKTREE_CONFIG_FILE), 'utf8')),
      );
      expect(config.checkouts).toEqual([{ id, alias: undefined }]);
    });

    it('refusesUnopenedNonRepositoryAndAlreadyPromotedRoots', GIT_TEST_TIMEOUT, async () => {
      const unopened: string = path.join(base, 'unopened');
      await fs.mkdir(unopened);
      expect((await operations.promote(unopened)).ok).toBe(false);

      const plain: string = path.join(base, 'plain');
      await fs.mkdir(plain);
      workspace.addRoot(plain);
      const notRepo: WorktreeOutcome<WorktreeDescriptor> = await operations.promote(plain);
      expect(notRepo.ok).toBe(false);
      if (!notRepo.ok) {
        expect(notRepo.error).toContain('not a git repository');
      }

      const { root } = await promoteFixture();
      const again: WorktreeOutcome<WorktreeDescriptor> = await operations.promote(root);
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.error).toContain('already');
      }
    });
  });

  describe('describe', () => {
    it('returnsNullForRootsThatAreNotContainers', async () => {
      const plain: string = path.join(base, 'plain');
      await fs.mkdir(plain);
      workspace.addRoot(plain);

      expect(await operations.describe(plain)).toBeNull();
      expect(await operations.describe(path.join(base, 'missing'))).toBeNull();
    });
  });

  describe('addCheckout', () => {
    it('clonesFromASiblingCheckoutWhenTheContainerIsLocalOnly', GIT_TEST_TIMEOUT, async () => {
      const { root } = await promoteFixture();

      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await operations.addCheckout(root, {
        branch: 'feature/spec',
        alias: 'Spec work',
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        return;
      }
      expect(outcome.value.exists).toBe(true);
      expect(outcome.value.branch).toBe('feature/spec');
      expect(outcome.value.alias).toBe('Spec work');
      expect(await fs.readFile(path.join(outcome.value.path, 'README.md'), 'utf8')).toContain(
        'Fixture',
      );

      const descriptor: WorktreeDescriptor | null = await operations.describe(root);
      expect(descriptor?.checkouts).toHaveLength(2);
      expect(descriptor?.checkouts.map((checkout): string | null => checkout.branch)).toEqual([
        'main',
        'feature/spec',
      ]);
    });

    it('clonesFromTheRecordedOriginWhenOneIsSet', GIT_TEST_TIMEOUT, async () => {
      const source: string = path.join(base, 'source');
      await fs.mkdir(source);
      await initRepo(source);

      const container: string = path.join(base, 'container');
      await fs.mkdir(path.join(container, STUDIO_DIR), { recursive: true });
      await fs.writeFile(
        path.join(container, STUDIO_DIR, WORKTREE_CONFIG_FILE),
        serializeWorktreeConfig({ version: 1, origin: source, checkouts: [] }),
        'utf8',
      );
      workspace.addRoot(container);

      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await operations.addCheckout(
        container,
        {},
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        return;
      }
      expect(outcome.value.branch).toBe('main');
      expect((await operations.describe(container))?.checkouts).toHaveLength(1);
    });

    it('refusesContainersWithNothingToCloneFrom', async () => {
      const container: string = path.join(base, 'empty');
      await fs.mkdir(path.join(container, STUDIO_DIR), { recursive: true });
      await fs.writeFile(
        path.join(container, STUDIO_DIR, WORKTREE_CONFIG_FILE),
        serializeWorktreeConfig({ version: 1, origin: null, checkouts: [] }),
        'utf8',
      );
      workspace.addRoot(container);

      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await operations.addCheckout(
        container,
        {},
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toContain('no origin');
      }
    });
  });

  describe('removeCheckout', () => {
    it('trashesTheDirectoryAndUpdatesTheRegistry', GIT_TEST_TIMEOUT, async () => {
      const { root } = await promoteFixture();
      const added: WorktreeOutcome<WorktreeCheckoutInfo> = await operations.addCheckout(root, {});
      expect(added.ok).toBe(true);
      if (!added.ok) {
        return;
      }

      const outcome: WorktreeOutcome<null> = await operations.removeCheckout(root, added.value.id);

      expect(outcome.ok).toBe(true);
      expect(trashed).toEqual([added.value.path]);
      expect((await operations.describe(root))?.checkouts).toHaveLength(1);
    });

    it('refusesUnregisteredAndUnsafeIds', GIT_TEST_TIMEOUT, async () => {
      const { root } = await promoteFixture();

      expect((await operations.removeCheckout(root, '../evil')).ok).toBe(false);
      expect(
        (await operations.removeCheckout(root, '01234567-89ab-cdef-0123-456789abcdef')).ok,
      ).toBe(false);
      expect(trashed).toEqual([]);
    });
  });
});
