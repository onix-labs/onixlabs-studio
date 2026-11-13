import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiWorkspaceExclusions } from '@shared/api/ai-types';
import {
  ExcludedCommandStore,
  readSharedExclusions,
  sameExclusions,
} from './excluded-command-store';

const electron: { userData: string } = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
}));

const ROOT: string = '/work/studio';

describe('ExcludedCommandStore', () => {
  let shared: string[];

  beforeEach(() => {
    electron.userData = mkdtempSync(join(tmpdir(), 'excluded-commands-'));
    shared = [];
  });

  afterEach(() => {
    rmSync(electron.userData, { recursive: true, force: true });
  });

  /**
   * Builds a store whose workspaces share whatever {@link shared} holds.
   * @returns Returns the store.
   */
  function store(): ExcludedCommandStore {
    return new ExcludedCommandStore(() => Promise.resolve([...shared]));
  }

  it('keepsAWorkspacesPrivateList_acrossALaunch', async () => {
    await store().setPrivate(ROOT, ['dotnet:*', '*', 'dotnet:*']);

    expect((await store().describe(ROOT)).private).toEqual(['dotnet:*']);
    expect(await store().applying('/work/other')).toEqual([]);
  });

  it('ignoresASharedListTheUserHasNotReviewed', async () => {
    // The bug this guards: a cloned repository taking commands out of the sandbox on its own say-so.
    shared = ['npx ng:*'];

    const described: AiWorkspaceExclusions = await store().describe(ROOT);

    expect(described).toMatchObject({ shared: ['npx ng:*'], sharedReviewed: false });
    expect(await store().applying(ROOT)).toEqual([]);
  });

  it('appliesASharedListOnceReviewed_andAsksAgainWhenItChanges', async () => {
    shared = ['npx ng:*', 'dotnet:*'];
    const reviewing: ExcludedCommandStore = store();
    await reviewing.reviewShared(ROOT, ['dotnet:*', 'npx ng:*']);

    // Order does not make a different list.
    expect(await reviewing.applying(ROOT)).toEqual(['npx ng:*', 'dotnet:*']);

    shared = ['npx ng:*', 'dotnet:*', 'rm:*'];
    expect(await reviewing.applying(ROOT)).toEqual([]);
    expect((await reviewing.describe(ROOT)).sharedReviewed).toBe(false);
  });

  it('refusesToRecordAReviewOfAListTheFileDoesNotHold', async () => {
    // Approving something other than what the repository says would let a later edit land on it.
    shared = ['npx ng:*'];

    const described: AiWorkspaceExclusions = await store().reviewShared(ROOT, ['rm:*']);

    expect(described.sharedReviewed).toBe(false);
    shared = ['rm:*'];
    expect(await store().applying(ROOT)).toEqual([]);
  });

  it('joinsThePrivateListWithTheReviewedSharedOne', async () => {
    shared = ['npx ng:*'];
    const both: ExcludedCommandStore = store();
    await both.setPrivate(ROOT, ['dotnet:*']);
    await both.reviewShared(ROOT, ['npx ng:*']);

    expect(await both.applying(ROOT)).toEqual(['dotnet:*', 'npx ng:*']);
    expect(await both.applying(null)).toEqual([]);
  });

  it('forgetsACorruptFile_ratherThanThrowing', async () => {
    writeFileSync(join(electron.userData, 'agent-excluded-commands.json'), '{not json');

    expect((await store().describe(ROOT)).private).toEqual([]);
  });

  it('sanitisesWhatItReadsBack', async () => {
    writeFileSync(
      join(electron.userData, 'agent-excluded-commands.json'),
      JSON.stringify({ workspaces: { [ROOT]: { private: ['*', 'make build', 4] } } }),
    );

    expect((await store().describe(ROOT)).private).toEqual(['make build']);
    expect(readFileSync(join(electron.userData, 'agent-excluded-commands.json'), 'utf8')).toContain(
      'make build',
    );
  });
});

describe('readSharedExclusions', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shared-exclusions-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('readsTheWorkspaceFile_throughTheSameParserEverySaveUses', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, '.studio'));
    writeFileSync(
      join(root, '.studio', 'workspace.json'),
      JSON.stringify({ version: 1, runConfigurations: [], excludedCommands: ['npx ng:*', '*'] }),
    );

    expect(await readSharedExclusions(root)).toEqual(['npx ng:*']);
  });

  it('readsNothing_withoutAFileOrForARelativeRoot', async () => {
    expect(await readSharedExclusions(root)).toEqual([]);
    expect(await readSharedExclusions('relative/root')).toEqual([]);
  });

  it('sameExclusions_comparesAsSets', () => {
    expect(sameExclusions(['a:*', 'b'], ['b', 'a:*'])).toBe(true);
    expect(sameExclusions(['a:*'], ['a:*', 'b'])).toBe(false);
  });
});
