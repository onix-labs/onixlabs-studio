import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SourceControlClient, VersionControlPluginInfo } from '@shared/api/source-control-channels';
import { VersionControlExecutableChoice } from '@shared/api/version-control-protocol';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { VersionControlPlugins } from './version-control-plugins';

/**
 * The protected surface exercised by these tests.
 */
interface Internals {
  rows(): readonly { info: VersionControlPluginInfo; mode: string; path: string }[];
  onMode(row: unknown, mode: string): void;
  onPath(row: unknown, path: string): void;
  canSave(row: unknown): boolean;
  onSave(row: unknown): Promise<void>;
}

/**
 * Builds a plugin's information.
 * @param overrides Fields to vary.
 * @returns Returns the information.
 */
function plugin(overrides: Partial<VersionControlPluginInfo> = {}): VersionControlPluginInfo {
  return {
    id: 'onixlabs.git',
    displayName: 'Git',
    installed: true,
    executableModes: ['installed', 'custom'],
    executable: null,
    toolVersion: 'git version 2.50.1',
    ...overrides,
  };
}

describe('VersionControlPlugins', () => {
  let fixture: ComponentFixture<VersionControlPlugins>;
  let internals: Internals;
  let saved: { id: string; executable: VersionControlExecutableChoice | null }[];
  let listed: number;
  let installedPlugins: WritableSignal<readonly PluginSummary[]>;

  /**
   * Creates the component over a client listing the given plugins.
   * @param plugins The plugins the main process reports.
   */
  async function create(plugins: readonly VersionControlPluginInfo[]): Promise<void> {
    saved = [];
    listed = 0;
    installedPlugins = signal<readonly PluginSummary[]>([]);
    const client: Partial<SourceControlClient> = {
      listPlugins: (): Promise<readonly VersionControlPluginInfo[]> => {
        listed += 1;
        return Promise.resolve(plugins);
      },
      setExecutable: (
        id: string,
        executable: VersionControlExecutableChoice | null,
      ): Promise<VersionControlPluginInfo | null> => {
        saved.push({ id, executable });
        return Promise.resolve(
          plugin({ executable, toolVersion: executable === null ? 'git version 2.50.1' : null }),
        );
      },
    };
    TestBed.configureTestingModule({
      imports: [VersionControlPlugins],
      providers: [
        { provide: SourceControl, useValue: { client } },
        { provide: Plugins, useValue: { plugins: installedPlugins } },
      ],
    });
    fixture = TestBed.createComponent(VersionControlPlugins);
    internals = fixture.componentInstance as unknown as Internals;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('listsOnlyInstalledPlugins_withTheToolTheyRun', async () => {
    await create([plugin(), plugin({ id: 'onixlabs.svn', displayName: 'SVN', installed: false })]);
    fixture.detectChanges();

    expect(internals.rows().map((row) => row.info.id)).toEqual(['onixlabs.git']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('git version 2.50.1');
  });

  it('readsAgain_whenAVersionControlPluginIsInstalledWhileOpen', async () => {
    // The settings tab stays mounted, so an install from the Plugin Manager must reach it.
    await create([plugin()]);
    expect(listed).toBe(1);

    installedPlugins.set([
      {
        id: 'onixlabs.git',
        name: 'Git',
        description: '',
        state: 'installed',
        version: '0.1.0',
        contributions: [{ slot: 'version-control', id: 'onixlabs.git' }],
      } as unknown as PluginSummary,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listed).toBe(2);
  });

  it('saysSo_whenNoPluginIsInstalled', async () => {
    await create([]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No version-control plugin is installed',
    );
  });

  it('savesACustomPath_onlyOnceItIsAbsolute', async () => {
    await create([plugin()]);
    internals.onMode(internals.rows()[0], 'custom');
    internals.onPath(internals.rows()[0], 'git');

    expect(internals.canSave(internals.rows()[0])).toBe(false);

    internals.onPath(internals.rows()[0], '/opt/git/bin/git');
    expect(internals.canSave(internals.rows()[0])).toBe(true);

    await internals.onSave(internals.rows()[0]);
    expect(saved).toEqual([
      { id: 'onixlabs.git', executable: { mode: 'custom', path: '/opt/git/bin/git' } },
    ]);
  });

  it('returningToInstalled_clearsTheChoice', async () => {
    await create([plugin({ executable: { mode: 'custom', path: '/opt/git' } })]);
    internals.onMode(internals.rows()[0], 'installed');

    await internals.onSave(internals.rows()[0]);

    expect(saved).toEqual([{ id: 'onixlabs.git', executable: null }]);
  });

  it('cannotSave_whenNothingChanged', async () => {
    await create([plugin()]);

    expect(internals.canSave(internals.rows()[0])).toBe(false);
  });
});
