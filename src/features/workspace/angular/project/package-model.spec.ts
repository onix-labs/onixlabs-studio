import { Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  PackageChannel,
  PackageManagerSummary,
  PackageWorkspaceStatus,
} from '@shared/api/package-channels';
import type { PackageManagerModel } from '@shared/api/package-management';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import {
  RepositoryTrust,
  RepositoryTrustQuestion,
} from '@shared/angular/services/repository-trust/repository-trust';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import {
  TerminalLaunchOptions,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { PackageModel, PackageRow } from './package-model';

/**
 * Builds a package manager that applies to the folder.
 * @param pluginId The plugin.
 * @param installed Whether it is installed.
 * @returns Returns the summary.
 */
function manager(pluginId: string, installed: boolean): PackageManagerSummary {
  return { pluginId, displayName: pluginId, ecosystem: pluginId, installed, capabilities: [] };
}

/**
 * Builds a model with one project holding one outdated and one current package.
 * @param ecosystem The ecosystem.
 * @returns Returns the model.
 */
function model(ecosystem: string): PackageManagerModel {
  return {
    ecosystem,
    root: '/work',
    projects: [
      {
        name: `${ecosystem}-app`,
        manifestPath: `/work/${ecosystem}.manifest`,
        packages: [
          {
            name: 'b',
            requested: '1',
            installed: '1',
            latest: '1',
            status: 'current',
            scope: 'production',
          },
          {
            name: 'a',
            requested: '1',
            installed: '1',
            latest: '2',
            status: 'outdated',
            scope: 'production',
          },
        ],
      },
    ],
  };
}

describe('PackageModel', () => {
  let status: PackageWorkspaceStatus;
  let calls: string[];
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let pending: WritableSignal<RepositoryTrustQuestion | null>;
  let launched: TerminalLaunchOptions[];
  let exitCode: number;
  let command: unknown;

  /**
   * Builds the model and lets its first refresh land.
   * @returns Returns the model.
   */
  async function create(): Promise<PackageModel> {
    const created: PackageModel = TestBed.inject(PackageModel);
    TestBed.tick();
    await vi.waitFor((): void => {
      expect(created.loading()).toBe(false);
    });
    return created;
  }

  beforeEach(() => {
    calls = [];
    status = { managers: [manager('npm', true), manager('nuget', true)], trust: 'trusted' };
    plugins = signal<readonly PluginSummary[]>([]);
    pending = signal<RepositoryTrustQuestion | null>(null);
    launched = [];
    exitCode = 0;
    command = {
      ok: true,
      result: {
        executable: 'npm',
        args: ['install', 'left-pad'],
        cwd: '/work',
        title: 'Install left-pad',
      },
    };
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push(`${channel} ${args.slice(1).join(' ')}`.trim());
        if (channel === (PackageChannel.Managers as string)) {
          return Promise.resolve(status as T);
        }
        if (channel === (PackageChannel.Command as string)) {
          return Promise.resolve(command as T);
        }
        if (channel === (PackageChannel.TrustFolder as string)) {
          status = { ...status, trust: 'trusted' };
          return Promise.resolve('trusted' as T);
        }
        const pluginId: string = args[1] as string;
        return Promise.resolve(
          (pluginId === 'broken'
            ? { ok: false, error: 'It broke.' }
            : { ok: true, result: model(pluginId) }) as T,
        );
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        PackageModel,
        {
          provide: Workspace,
          useValue: { root: signal({ path: '/work' }) as Signal<{ path: string } | null> },
        },
        { provide: Plugins, useValue: { plugins } },
        { provide: RepositoryTrust, useValue: { pending } },
        {
          provide: TerminalSessions,
          useValue: {
            launch: (options: TerminalLaunchOptions): Promise<unknown> => {
              launched.push(options);
              return Promise.resolve({ exited: Promise.resolve(exitCode) });
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('refresh_asksWhichManagersApply_thenEachInstalledOneReadsTheFolder', async () => {
    const packages: PackageModel = await create();

    expect(calls).toEqual([
      PackageChannel.Managers,
      `${PackageChannel.ModelLoad} npm`,
      `${PackageChannel.ModelLoad} nuget`,
    ]);
    expect(packages.available()).toBe(true);
    expect(packages.outdatedCount()).toBe(2);
  });

  it('rows_putEachManagersProjectsInTurn_outdatedPackagesFirst', async () => {
    const packages: PackageModel = await create();

    expect(
      packages
        .rows()
        .map((row: PackageRow): string =>
          row.kind === 'project' ? `${row.manager}:${row.name}` : row.package.name,
        ),
    ).toEqual(['npm:npm-app', 'a', 'b', 'nuget:nuget-app', 'a', 'b']);
  });

  it('refresh_inAFolderNotTrusted_readsNothing', async () => {
    status = { ...status, trust: 'unknown' };

    const packages: PackageModel = await create();

    expect(calls).toEqual([PackageChannel.Managers]);
    expect(packages.trust()).toBe('unknown');
    expect(packages.hasModels()).toBe(false);
  });

  it('refresh_withNothingInstalled_offersThePluginsThatWouldReadTheFolder', async () => {
    status = { managers: [manager('npm', false)], trust: 'trusted' };
    plugins.set([
      {
        id: 'onixlabs.npm',
        state: 'available',
        contributions: [{ slot: 'package-manager', id: 'npm' }],
      } as unknown as PluginSummary,
      {
        id: 'onixlabs.git',
        state: 'available',
        contributions: [{ slot: 'version-control', id: 'npm' }],
      } as unknown as PluginSummary,
    ]);

    const packages: PackageModel = await create();

    expect(packages.available()).toBe(true);
    expect(packages.installed()).toEqual([]);
    expect(packages.offered().map((plugin: PluginSummary): string => plugin.id)).toEqual([
      'onixlabs.npm',
    ]);
    expect(calls).toEqual([PackageChannel.Managers]);
  });

  it('refresh_withNothingThatApplies_isNotAvailable', async () => {
    status = { managers: [], trust: 'trusted' };

    const packages: PackageModel = await create();

    expect(packages.available()).toBe(false);
  });

  it('refresh_whenOneManagerFails_keepsTheOthersAndSaysWhy', async () => {
    status = { managers: [manager('npm', true), manager('broken', true)], trust: 'trusted' };

    const packages: PackageModel = await create();

    expect(packages.hasModels()).toBe(true);
    expect(packages.states()[1].error).toBe('It broke.');
  });

  it('trustFolder_recordsTheDecisionThenReadsTheFolder', async () => {
    status = { ...status, trust: 'unknown' };
    const packages: PackageModel = await create();

    await packages.trustFolder();

    expect(calls).toContain(`${PackageChannel.TrustFolder}`);
    expect(packages.trust()).toBe('trusted');
    expect(packages.hasModels()).toBe(true);
  });

  it('aTrustQuestionAnswered_readsTheFolderAgain', async () => {
    await create();
    calls = [];

    pending.set({ root: '/work', name: 'work' });
    TestBed.tick();
    pending.set(null);
    TestBed.tick();

    await vi.waitFor((): void => {
      expect(calls[0]).toBe(PackageChannel.Managers);
    });
  });

  describe('changes', () => {
    it('write_runsThePluginsCommandInATerminal_thenReadsTheFolderAgain', async () => {
      const packages: PackageModel = await create();
      calls = [];

      await packages.write('npm', 'install', { project: '/work/package.json', name: 'left-pad' });

      expect(calls[0]).toBe(`${PackageChannel.Command} npm install [object Object]`);
      expect(launched).toEqual([
        {
          kind: 'task',
          name: 'Install left-pad',
          command: 'npm',
          args: ['install', 'left-pad'],
          cwd: '/work',
        },
      ]);
      expect(calls).toContain(PackageChannel.Managers);
      expect(packages.writing()).toBeNull();
      expect(packages.writeError()).toBeNull();
    });

    it('write_whenThePluginGivesNoCommand_runsNothingAndSaysWhy', async () => {
      command = { ok: false, error: 'Remove is not offered for this project.' };
      const packages: PackageModel = await create();

      await packages.write('npm', 'remove', { project: '/work/package.json', name: 'x' });

      expect(launched).toEqual([]);
      expect(packages.writeError()).toBe('Remove is not offered for this project.');
    });

    it('write_thatFails_saysWithWhichExitCode', async () => {
      exitCode = 1;
      const packages: PackageModel = await create();

      await packages.write('npm', 'install', { project: '/work/package.json', name: 'left-pad' });

      expect(packages.writeError()).toBe('Install left-pad ended with exit code 1.');
    });
  });
});
