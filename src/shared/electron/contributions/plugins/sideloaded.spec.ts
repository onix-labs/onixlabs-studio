import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SideloadingState } from '@shared/api/plugin-channels';
import { PLUGIN_API_VERSION, PluginManifest } from '@shared/api/plugin-manifest';

/**
 * Holds what the stubbed application reports: whether this is a packaged build, and the user-data
 * directory, which each test points at a fresh temporary directory.
 */
const host: { isPackaged: boolean; userData: string } = vi.hoisted(
  (): { isPackaged: boolean; userData: string } => ({ isPackaged: true, userData: '' }),
);

// The sideload directory and the startup preferences both live under the user-data directory, which
// only Electron can answer for; a temporary directory stands in for it.
vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return host.isPackaged;
    },
    getPath: (): string => host.userData,
  },
}));

/**
 * Places a sideloaded plugin whose manifest validates in the sideload directory.
 * @param id The plugin identifier, also its directory name.
 */
function sideload(id: string): void {
  const directory: string = join(host.userData, 'plugins', id);
  mkdirSync(directory, { recursive: true });
  const manifest: Record<string, unknown> = {
    id,
    name: id,
    description: `${id} support.`,
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    provision: {
      kind: 'archive',
      downloads: {
        'darwin-arm64': {
          url: `https://example.com/${id}.tar.gz`,
          sha256: 'b'.repeat(64),
          archive: 'tar.gz',
          executablePath: id,
        },
      },
    },
    contributes: {
      languageServers: [
        {
          id,
          displayName: id,
          languages: ['zig'],
          priority: 100,
          command: { kind: 'executable', args: [] },
        },
      ],
    },
  };
  writeFileSync(join(directory, 'plugin.json'), JSON.stringify(manifest));
}

/**
 * Persists the user's sideloading choice where the main process reads it at launch.
 * @param choice The choice.
 */
function choose(choice: boolean): void {
  writeFileSync(
    join(host.userData, 'startup-preferences.json'),
    JSON.stringify({ loadSideloadedPlugins: choice }),
  );
}

describe('sideloaded plugins', () => {
  beforeEach(() => {
    host.userData = mkdtempSync(join(tmpdir(), 'studio-sideload-'));
    host.isPackaged = true;
    // The module resolves the switch and scans the directory once per launch; each test is a launch.
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(host.userData, { recursive: true, force: true });
  });

  it('resolveSideloading_isOffInAPackagedBuildUntilChosen_andAlwaysOnInTheDevelopmentApp', async () => {
    const { resolveSideloading } = await import('./sideloaded');

    expect(resolveSideloading(true, null)).toBe(false);
    expect(resolveSideloading(true, false)).toBe(false);
    expect(resolveSideloading(true, true)).toBe(true);
    expect(resolveSideloading(false, null)).toBe(true);
    expect(resolveSideloading(false, false)).toBe(true);
  });

  it('sideloadedManifests_whenOffInAPackagedBuild_yieldsNothing_andLogsWhatWasSkipped', async () => {
    sideload('zls');
    sideload('taplo');
    const { logger } = await import('../../logger');
    const info: ReturnType<typeof vi.spyOn> = vi.spyOn(logger, 'info');
    const { sideloadedDirectories, sideloadedManifests, sideloadingState } =
      await import('./sideloaded');

    expect(sideloadedManifests()).toEqual([]);
    expect(sideloadedDirectories().size).toBe(0);
    expect(info).toHaveBeenCalledWith(
      'SideloadedPlugins',
      expect.stringContaining('Skipped 2 sideloaded plugins'),
    );
    expect(sideloadingState()).toEqual<SideloadingState>({
      enabled: false,
      inForce: false,
      locked: false,
      skipped: 2,
    });
  });

  it('sideloadedManifests_whenTurnedOnInAPackagedBuild_loadsThem', async () => {
    sideload('zls');
    choose(true);
    const { sideloadedDirectories, sideloadedManifests } = await import('./sideloaded');

    expect(sideloadedManifests().map((manifest: PluginManifest): string => manifest.id)).toEqual([
      'zls',
    ]);
    expect(sideloadedDirectories().get('zls')).toBe(join(host.userData, 'plugins', 'zls'));
  });

  it('sideloadedManifests_inTheDevelopmentApp_loadsThemWhateverWasChosen', async () => {
    host.isPackaged = false;
    sideload('zls');
    choose(false);
    const { sideloadedManifests, sideloadingState } = await import('./sideloaded');

    expect(sideloadedManifests()).toHaveLength(1);
    expect(sideloadingState()).toEqual<SideloadingState>({
      enabled: true,
      inForce: true,
      locked: true,
      skipped: 0,
    });
  });

  it('setSideloading_persistsForTheNextLaunch_withoutChangingThisOne', async () => {
    sideload('zls');
    const { setSideloading, sideloadedManifests } = await import('./sideloaded');

    expect(sideloadedManifests()).toEqual([]);
    expect(setSideloading(true)).toEqual<SideloadingState>({
      enabled: true,
      inForce: false,
      locked: false,
      skipped: 1,
    });
    expect(sideloadedManifests()).toEqual([]);

    vi.resetModules();
    const relaunched: typeof import('./sideloaded') = await import('./sideloaded');

    expect(relaunched.sideloadedManifests()).toHaveLength(1);
  });

  it('setSideloading_refusesAnythingButABoolean_andAnyChangeInTheDevelopmentApp', async () => {
    const { setSideloading, sideloadingState } = await import('./sideloaded');

    expect(setSideloading('true').enabled).toBe(false);

    // Nothing is written from the development app, so a packaged build reading the same file later
    // still finds no choice.
    host.isPackaged = false;
    setSideloading(true);
    host.isPackaged = true;

    expect(sideloadingState().enabled).toBe(false);
  });

  it('countPluginDirectories_countsOnlyDirectoriesHoldingAManifest', async () => {
    sideload('zls');
    mkdirSync(join(host.userData, 'plugins', 'empty'));
    writeFileSync(join(host.userData, 'plugins', 'stray.txt'), '');
    const { countPluginDirectories, sideloadDirectory } = await import('./sideloaded');

    expect(countPluginDirectories(sideloadDirectory())).toBe(1);
    expect(countPluginDirectories(join(host.userData, 'absent'))).toBe(0);
  });
});
