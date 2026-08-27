import { tmpdir } from 'node:os';
import { PluginManifest } from '@shared/api/plugin-manifest';

// `contributed.ts` opens the curated index against the user-data directory, which only Electron can
// answer for. The merge rule under test needs neither, so the application object is stubbed rather than
// the test being run under Electron.
vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }));

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
