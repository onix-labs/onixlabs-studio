import { tmpdir } from 'node:os';
import { PluginManifest } from '@shared/api/plugin-manifest';

// `contributed.ts` opens the curated index against the user-data directory, which only Electron can
// answer for. The merge rule under test needs neither, so the application object is stubbed rather than
// the test being run under Electron.
// Hoisted so the factory can read it: `vi.mock` is lifted above everything else, so a plain `let`
// declared here would not exist yet when the factory runs.
const appState: { ready: boolean } = vi.hoisted(() => ({ ready: true }));
vi.mock('electron', () => ({
  app: { getPath: (): string => tmpdir(), isReady: (): boolean => appState.ready },
}));

const { mergeManifests } = await import('./contributed');

/**
 * Builds a manifest with the fields the merge cares about.
 * @param id The plugin identifier.
 * @param version The plugin version, used to tell two entries sharing an id apart.
 * @returns Returns the manifest.
 */
function manifest(id: string, version: string = '1.0.0'): PluginManifest {
  return {
    id,
    name: id,
    description: `${id} support.`,
    version,
    apiVersion: '1.0.0',
    provision: { kind: 'archive', downloads: {} },
    contributes: {},
    requires: [],
  };
}

describe('mergeManifests', () => {
  it('offersEveryPluginWhenNothingCollides', () => {
    const merged: readonly PluginManifest[] = mergeManifests([
      { origin: 'sideloaded', manifests: [manifest('zls')] },
      { origin: 'indexed', manifests: [manifest('taplo'), manifest('marksman')] },
    ]);

    expect(merged.map((entry: PluginManifest): string => entry.id)).toEqual([
      'zls',
      'taplo',
      'marksman',
    ]);
  });

  it('keepsTheEntryFromTheEarlierSource', () => {
    // Most local wins: what the user placed on their own machine beats what Studio fetched on their
    // behalf. Last-wins would let a published index silently displace a hand-placed plugin.
    const merged: readonly PluginManifest[] = mergeManifests([
      { origin: 'sideloaded', manifests: [manifest('zls', '0.14.0')] },
      { origin: 'indexed', manifests: [manifest('zls', '0.13.0')] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].version).toBe('0.14.0');
  });

  it('keepsTheEarlierEntryWithinOneSourceToo', () => {
    const merged: readonly PluginManifest[] = mergeManifests([
      { origin: 'indexed', manifests: [manifest('zls', '0.14.0'), manifest('zls', '0.13.0')] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].version).toBe('0.14.0');
  });

  it('offersNothingWhenNoSourceContributes', () => {
    expect(mergeManifests([])).toEqual([]);
    expect(mergeManifests([{ origin: 'indexed', manifests: [] }])).toEqual([]);
  });
});

describe('contributedManifests, before the app is ready', () => {
  it('refusesToAnswerRatherThanCachingAnEmptyCatalogue', async () => {
    // ⛔ The regression this exists for: `AiManager` is a field initialiser on the application class,
    // so it is constructed before `app.whenReady()`. Wiring contributed harnesses into its constructor
    // made the very first caller populate the session-long cache from a user-data directory that was
    // not resolvable yet — and every later reader got the frozen empty answer. The symptom was an
    // application with no plugins at all, while agents carried on running.
    vi.resetModules();
    appState.ready = false;
    const early: typeof import('./contributed') = await import('./contributed');

    expect(early.contributedManifests()).toEqual([]);

    // And crucially it did not cache: the same module answers properly once the app is ready.
    appState.ready = true;

    expect(early.contributedManifests().length).toBeGreaterThan(0);
  });
});
