import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  ManifestError,
  ManifestResult,
  parsePluginManifest,
  PLUGIN_API_VERSION,
  PluginManifest,
} from '@shared/api/plugin-manifest';
import CURATED_PLUGINS from './curated-plugins.json';
import {
  IndexFetch,
  IndexResponse,
  overlayPluginIndex,
  parsePluginIndex,
  PluginIndex,
  PluginIndexDocument,
  pluginIndexUrl,
  pluginReleaseCandidates,
  PluginReleaseSelection,
  selectPluginRelease,
} from './plugin-index';

/**
 * Builds a well-formed index entry.
 * @param overrides Fields to replace on the manifest.
 * @returns Returns the entry as untrusted JSON would arrive.
 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'zls',
    name: 'Zig Language Server',
    description: 'Zig language support.',
    version: '0.14.0',
    apiVersion: PLUGIN_API_VERSION,
    provision: {
      kind: 'archive',
      downloads: {
        'darwin-arm64': {
          url: 'https://example.com/zls-aarch64-macos.tar.gz',
          sha256: 'b'.repeat(64),
          archive: 'tar.gz',
          executablePath: 'zls',
        },
      },
    },
    contributes: {
      languageServers: [
        {
          id: 'zls',
          displayName: 'Zig Language Server',
          languages: ['zig'],
          priority: 100,
          command: { kind: 'executable' },
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Builds an index document as it would be published.
 * @param revision The document revision.
 * @param plugins The entries it carries.
 * @returns Returns the document.
 */
function document(revision: number, plugins: readonly unknown[]): Record<string, unknown> {
  return { revision, plugins };
}

/**
 * Builds a fetch that answers with a body.
 * @param body The body to answer with.
 * @param ok Whether the response is successful.
 * @param status The status code.
 * @returns Returns the fetch.
 */
function answering(body: string, ok: boolean = true, status: number = 200): IndexFetch {
  return (): Promise<IndexResponse> =>
    Promise.resolve({ ok, status, text: (): Promise<string> => Promise.resolve(body) });
}

describe('parsePluginIndex', () => {
  it('acceptsADocumentOfValidEntries', () => {
    const result: PluginIndexDocument | null = parsePluginIndex(document(3, [entry()]));

    expect(result?.revision).toBe(3);
    expect(result?.manifests.map((manifest): string => manifest.id)).toEqual(['zls']);
    expect(result?.errors).toEqual([]);
  });

  it('acceptsADocumentThatOffersNothing', () => {
    // Retiring the last plugin is a legitimate thing for a publisher to do, and is not the same as
    // publishing something broken.
    const result: PluginIndexDocument | null = parsePluginIndex(document(1, []));

    expect(result?.manifests).toEqual([]);
    expect(result?.errors).toEqual([]);
  });

  it('reportsABadEntryAndKeepsTheGoodOnes', () => {
    // One bad plugin costs the user that plugin and nothing else — the same rule the sideload
    // directory follows.
    const result: PluginIndexDocument | null = parsePluginIndex(
      document(1, [{ id: 'broken' }, entry()]),
    );

    expect(result?.manifests.map((manifest): string => manifest.id)).toEqual(['zls']);
    expect(result?.errors[0].path).toMatch(/^plugins\[0\]\./);
  });

  it('keepsTheFirstOfTwoEntriesSharingAnIdentifier', () => {
    // First registration wins and the collision is said out loud, rather than quietly renaming
    // something the author chose.
    const result: PluginIndexDocument | null = parsePluginIndex(
      document(1, [entry({ version: '0.14.0' }), entry({ version: '0.13.0' })]),
    );

    expect(result?.manifests.map((manifest): string => manifest.version)).toEqual(['0.14.0']);
    expect(result?.errors).toEqual([{ path: 'plugins[1].id', message: "duplicates 'zls'" }]);
  });

  it('offersTheNewestReleaseOfEachEntryTheBuildCanRun', () => {
    const result: PluginIndexDocument | null = parsePluginIndex(
      document(5, [
        entry({ version: '0.15.0', apiVersion: '1.29.0', releases: [release('0.14.5', '1.28.0')] }),
        entry({ id: 'other', version: '1.0.0', apiVersion: '1.20.0' }),
      ]),
      '1.28.0',
    );

    expect(result?.manifests.map((m: PluginManifest): string => `${m.id} ${m.version}`)).toEqual([
      'zls 0.14.5',
      'other 1.0.0',
    ]);
    expect(result?.errors).toEqual([]);
    expect(result?.refused).toEqual([]);
  });

  it('refusesAnEntryOnlyWhenItOffersNoReleaseTheBuildCanRun', () => {
    const result: PluginIndexDocument | null = parsePluginIndex(
      document(5, [
        entry({ version: '0.15.0', apiVersion: '1.29.0', releases: [release('0.14.5', '1.28.0')] }),
      ]),
      '1.27.0',
    );

    expect(result?.manifests).toEqual([]);
    expect(result?.refused).toEqual(['zls']);
    expect(result?.errors.map((error: ManifestError): string => error.path)).toEqual([
      'plugins[0].apiVersion',
      'plugins[0].releases[0].apiVersion',
    ]);
  });

  it('refusesAnEnvelopeThatIsNotAnIndex', () => {
    expect(parsePluginIndex('nope')).toBeNull();
    expect(parsePluginIndex(null)).toBeNull();
    expect(parsePluginIndex([entry()])).toBeNull();
    expect(parsePluginIndex({ plugins: [] })).toBeNull();
    expect(parsePluginIndex({ revision: '1', plugins: [] })).toBeNull();
    expect(parsePluginIndex({ revision: 1.5, plugins: [] })).toBeNull();
    expect(parsePluginIndex({ revision: 1 })).toBeNull();
  });
});

/**
 * Builds a release of the test plugin as a `releases` element would carry it.
 * @param version The plugin version.
 * @param apiVersion The plugin API it was written against.
 * @param overrides Further fields the release restates.
 * @returns Returns the release.
 */
function release(
  version: string,
  apiVersion: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version,
    apiVersion,
    provision: {
      kind: 'npm',
      lockfileUrl: `https://example.com/zls-${version}.lock.json`,
      sha256: 'c'.repeat(64),
      executablePath: 'node_modules/zls/bin/zls',
    },
    ...overrides,
  };
}

describe('selectPluginRelease', () => {
  /**
   * Selects a release and reads back its version.
   * @param value The entry.
   * @param supported The plugin API the build implements.
   * @returns Returns the chosen version, or null when none was.
   */
  function chosen(value: unknown, supported: string = PLUGIN_API_VERSION): string | null {
    return selectPluginRelease(value, 0, supported).manifest?.version ?? null;
  }

  it('readsAnEntryWithoutReleasesAsItsOneRelease', () => {
    // Every index already published has this shape, and has to keep meaning what it meant.
    const result: PluginReleaseSelection = selectPluginRelease(entry(), 0);

    expect(result.manifest?.version).toBe('0.14.0');
    expect(result.errors).toEqual([]);
  });

  it('choosesTheNewestReleaseThisBuildCanRun', () => {
    const value: Record<string, unknown> = entry({
      version: '0.3.0',
      apiVersion: '1.29.0',
      releases: [release('0.2.0', '1.20.0'), release('0.2.5', '1.28.0'), release('0.1.0', '1.1.0')],
    });

    expect(chosen(value, '1.28.0')).toBe('0.2.5');
  });

  it('choosesTheEntryItself_whenThisBuildCanRunIt', () => {
    const value: Record<string, unknown> = entry({
      version: '0.3.0',
      apiVersion: '1.29.0',
      releases: [release('0.2.5', '1.28.0')],
    });

    expect(chosen(value, '1.30.0')).toBe('0.3.0');
  });

  it('choosesByVersionRatherThanByTheOrderReleasesAreListedIn', () => {
    // A publisher listing oldest-first must not make a build install an older release than it can run.
    const value: Record<string, unknown> = entry({
      version: '0.3.0',
      apiVersion: '1.99.0',
      releases: [release('0.1.0', '1.1.0'), release('0.2.10', '1.1.0'), release('0.2.9', '1.1.0')],
    });

    expect(chosen(value)).toBe('0.2.10');
  });

  it('ranksAPrereleaseBelowTheReleaseItLeadsUpTo', () => {
    const value: Record<string, unknown> = entry({
      version: '1.0.0-rc.1',
      releases: [release('1.0.0', '1.1.0'), release('1.0.0-beta.2', '1.1.0')],
    });

    expect(chosen(value)).toBe('1.0.0');
  });

  it('ordersPrereleasesAmongThemselvesNumerically', () => {
    const value: Record<string, unknown> = entry({
      version: '1.0.0-beta.9',
      releases: [release('1.0.0-beta.10', '1.1.0'), release('0.9.0', '1.1.0')],
    });

    expect(chosen(value)).toBe('1.0.0-beta.10');
  });

  it('choosesAPrerelease_whenItIsTheNewestThisBuildCanRun', () => {
    const value: Record<string, unknown> = entry({
      version: '2.0.0',
      apiVersion: '1.99.0',
      releases: [release('2.0.0-rc.1', '1.1.0'), release('1.9.0', '1.1.0')],
    });

    expect(chosen(value)).toBe('2.0.0-rc.1');
  });

  it('ordersVersionsThatAreNotSemver', () => {
    // rust-analyzer's versions are dates.
    const value: Record<string, unknown> = entry({
      version: '2026-07-13',
      apiVersion: '1.99.0',
      releases: [release('2026-05-04', '1.1.0'), release('2026-06-29', '1.1.0')],
    });

    expect(chosen(value)).toBe('2026-06-29');
  });

  it('keepsTheFirstListed_whenTwoReleasesClaimTheSameVersion', () => {
    const value: Record<string, unknown> = entry({
      releases: [release('0.14.0', '1.1.0', { name: 'Impostor' })],
    });

    expect(selectPluginRelease(value, 0).manifest?.name).toBe('Zig Language Server');
  });

  it('choosesNothing_whenThisBuildCanRunNoRelease', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.98.0')],
    });

    const result: PluginReleaseSelection = selectPluginRelease(value, 4);

    expect(result.manifest).toBeNull();
    // Nothing stands in, so every refusal is worth saying.
    expect(result.errors.map((error: ManifestError): string => error.path)).toEqual([
      'plugins[4].apiVersion',
      'plugins[4].releases[0].apiVersion',
    ]);
  });

  it('saysNothingOfAReleaseThatOnlyNeedsANewerApi_whenAnotherStandsIn', () => {
    // The expected case — the reason the list exists — and not a mistake to warn about every launch.
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0')],
    });

    expect(selectPluginRelease(value, 0).errors).toEqual([]);
  });

  it('inheritsWhatAReleaseDoesNotRestate', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0')],
    });

    const manifest: PluginManifest | null = selectPluginRelease(value, 0).manifest;

    expect(manifest?.name).toBe('Zig Language Server');
    expect(manifest?.contributes.languageServers?.[0].id).toBe('zls');
    expect(manifest?.provision.kind).toBe('npm');
  });

  it('takesWhatAReleaseRestates', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0', { description: 'Older Zig support.' })],
    });

    expect(selectPluginRelease(value, 0).manifest?.description).toBe('Older Zig support.');
  });

  it('neverLetsAReleaseNameADifferentPlugin', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0', { id: 'someone-else' })],
    });

    const result: PluginReleaseSelection = selectPluginRelease(value, 0);

    expect(result.manifest).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'plugins[0].releases[0].id' }),
    );
  });

  it('acceptsAReleaseThatRestatesItsOwnId', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0', { id: 'zls' })],
    });

    expect(chosen(value)).toBe('0.13.0');
  });

  it('refusesAReleaseThatInheritsItsProvision', () => {
    // Inheriting the entry's provision would install the newest payload under an older version.
    const incomplete: Record<string, unknown> = { version: '0.13.0', apiVersion: '1.1.0' };
    const value: Record<string, unknown> = entry({ apiVersion: '1.99.0', releases: [incomplete] });

    const result: PluginReleaseSelection = selectPluginRelease(value, 0);

    expect(result.manifest).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'plugins[0].releases[0].provision' }),
    );
  });

  it('refusesAReleaseThatInheritsItsVersionOrApi', () => {
    const value: Record<string, unknown> = entry({
      releases: [{ provision: release('0.13.0', '1.1.0')['provision'] }],
    });

    const result: PluginReleaseSelection = selectPluginRelease(value, 0);

    expect(result.manifest?.version).toBe('0.14.0');
    expect(result.errors.map((error: ManifestError): string => error.path)).toEqual([
      'plugins[0].releases[0].version',
      'plugins[0].releases[0].apiVersion',
    ]);
  });

  it('reportsAMalformedRelease_andStillChoosesAmongTheRest', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [
        'not a release',
        release('0.13.5', '1.1.0', { provision: { kind: 'npm', lockfileUrl: 'http://x' } }),
        release('0.13.0', '1.1.0'),
      ],
    });

    const result: PluginReleaseSelection = selectPluginRelease(value, 0);

    expect(result.manifest?.version).toBe('0.13.0');
    expect(
      result.errors.some(
        (error: ManifestError): boolean => error.path === 'plugins[0].releases[0]',
      ),
    ).toBe(true);
    expect(
      result.errors.some((error: ManifestError): boolean =>
        error.path.startsWith('plugins[0].releases[1].provision'),
      ),
    ).toBe(true);
    // The entry's own refusal is only the expected one, so it stays quiet.
    expect(
      result.errors.some((error: ManifestError): boolean => error.path === 'plugins[0].apiVersion'),
    ).toBe(false);
  });

  it('reportsReleasesThatAreNotAList_andReadsTheEntryAsItsOneRelease', () => {
    const result: PluginReleaseSelection = selectPluginRelease(entry({ releases: {} }), 0);

    expect(result.manifest?.version).toBe('0.14.0');
    expect(result.errors).toEqual([
      { path: 'plugins[0].releases', message: 'must be an array of releases' },
    ]);
  });

  it('ignoresReleasesNestedInARelease', () => {
    const value: Record<string, unknown> = entry({
      apiVersion: '1.99.0',
      releases: [release('0.13.0', '1.1.0', { releases: [release('0.99.0', '1.1.0')] })],
    });

    expect(chosen(value)).toBe('0.13.0');
  });

  it('refusesAnEntryThatIsNotAnObject', () => {
    expect(selectPluginRelease('zls', 0).manifest).toBeNull();
  });

  describe('the example from #1467', () => {
    // beta.10 implements plugin API 1.28. GitHub 0.7.0 needs 1.29; had 0.6.5 shipped against 1.28,
    // beta.10 should be offered it rather than staying on the 0.6.0 it shipped with.
    const github: Record<string, unknown> = entry({
      id: 'onixlabs.github',
      name: 'GitHub',
      version: '0.7.0',
      apiVersion: '1.29.0',
      releases: [release('0.6.5', '1.28.0'), release('0.6.0', '1.25.0')],
    });

    it('offersBeta10TheNewestReleaseItCanRun', () => {
      expect(chosen(github, '1.28.0')).toBe('0.6.5');
    });

    it('offersABuildOnTheNewerApiTheNewestRelease', () => {
      expect(chosen(github, '1.29.0')).toBe('0.7.0');
    });

    it('offersAnOlderBuildWhatItCanStillRun', () => {
      expect(chosen(github, '1.25.0')).toBe('0.6.0');
    });

    it('offersNothingToABuildOlderThanEveryRelease', () => {
      expect(chosen(github, '1.24.0')).toBeNull();
    });

    it('offersNothingToABuildOnADifferentMajor', () => {
      expect(chosen(github, '2.0.0')).toBeNull();
    });
  });
});

describe('overlayPluginIndex', () => {
  /**
   * Parses a document the test knows to be valid.
   * @param revision The revision.
   * @param plugins The entries.
   * @returns Returns the parsed document.
   */
  function parsed(revision: number, plugins: readonly unknown[]): PluginIndexDocument {
    return parsePluginIndex(document(revision, plugins))!;
  }

  it('recordsTheIdOfAnEntryItRefuses', () => {
    const result: PluginIndexDocument = parsed(2, [
      entry({ id: 'zls', apiVersion: '1.999.0' }),
      entry({ id: 'other' }),
    ]);

    expect(result.refused).toEqual(['zls']);
  });

  it('keepsTheBundledEntry_whenTheNewerOneNeedsANewerApi', () => {
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls', version: '0.13.0' })]);
    const newer: PluginIndexDocument = parsed(2, [
      entry({ id: 'zls', version: '0.14.0', apiVersion: '1.999.0' }),
    ]);

    const result: PluginIndexDocument = overlayPluginIndex(newer, seed);

    expect(result.revision).toBe(2);
    expect(
      result.manifests.map((manifest: { version: string }): string => manifest.version),
    ).toEqual(['0.13.0']);
  });

  it('prefersTheNewerEntry_whenThisBuildCanHonourIt', () => {
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls', version: '0.13.0' })]);
    const newer: PluginIndexDocument = parsed(2, [entry({ id: 'zls', version: '0.14.0' })]);

    expect(
      overlayPluginIndex(newer, seed).manifests.map((m: { version: string }) => m.version),
    ).toEqual(['0.14.0']);
  });

  it('prefersAnOlderReleaseTheNewerEntryLists_overTheBundledEntry', () => {
    // The point of #1467: a newer release than the one this build shipped with, which it can run.
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls', version: '0.13.0' })]);
    const newer: PluginIndexDocument = parsed(2, [
      entry({
        id: 'zls',
        version: '0.15.0',
        apiVersion: '1.999.0',
        releases: [release('0.14.5', '1.1.0')],
      }),
    ]);

    const result: PluginIndexDocument = overlayPluginIndex(newer, seed);

    expect(result.manifests.map((manifest: PluginManifest): string => manifest.version)).toEqual([
      '0.14.5',
    ]);
    expect(newer.refused).toEqual([]);
  });

  it('keepsTheBundledEntry_whenNoReleaseTheNewerEntryListsCanRun', () => {
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls', version: '0.13.0' })]);
    const newer: PluginIndexDocument = parsed(2, [
      entry({
        id: 'zls',
        version: '0.15.0',
        apiVersion: '1.999.0',
        releases: [release('0.14.5', '1.998.0')],
      }),
    ]);

    const result: PluginIndexDocument = overlayPluginIndex(newer, seed);

    expect(result.manifests.map((manifest: PluginManifest): string => manifest.version)).toEqual([
      '0.13.0',
    ]);
  });

  it('honoursTheNewerIndex_evenWhereItsRunnableReleaseIsOlderThanTheBundledOne', () => {
    // The published copy is the curated one: withdrawing a bad release has to reach the builds that
    // shipped with it.
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls', version: '0.14.0' })]);
    const newer: PluginIndexDocument = parsed(2, [
      entry({
        id: 'zls',
        version: '0.15.0',
        apiVersion: '1.999.0',
        releases: [release('0.13.0', '1.1.0')],
      }),
    ]);

    expect(
      overlayPluginIndex(newer, seed).manifests.map((m: PluginManifest): string => m.version),
    ).toEqual(['0.13.0']);
  });

  it('doesNotRestoreAPluginTheNewerIndexLeftOut', () => {
    const seed: PluginIndexDocument = parsed(1, [entry({ id: 'zls' }), entry({ id: 'retired' })]);
    const newer: PluginIndexDocument = parsed(2, [entry({ id: 'zls' })]);

    expect(overlayPluginIndex(newer, seed).manifests.map((m: { id: string }) => m.id)).toEqual([
      'zls',
    ]);
  });
});

describe('pluginIndexUrl', () => {
  it('fetchesTheStudioIndexByDefault', () => {
    delete process.env['STUDIO_PLUGIN_INDEX_URL'];

    expect(pluginIndexUrl()).toContain('onixlabs-studio');
  });

  it('honoursTheEnvironmentOverride', () => {
    process.env['STUDIO_PLUGIN_INDEX_URL'] = 'https://example.com/index.json';

    expect(pluginIndexUrl()).toBe('https://example.com/index.json');

    delete process.env['STUDIO_PLUGIN_INDEX_URL'];
  });
});

describe('PluginIndex', () => {
  const URL: string = 'https://example.com/index.json';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-plugin-index-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes a cached index into the user-data directory.
   * @param revision The revision to cache.
   * @param plugins The entries to cache.
   */
  function cache(revision: number, plugins: readonly unknown[]): void {
    writeFileSync(
      path.join(root, 'plugin-index.json'),
      JSON.stringify(document(revision, plugins)),
    );
  }

  it('usesTheBundledIndexWhenNothingIsCached', () => {
    const index: PluginIndex = new PluginIndex(root, URL, answering(''));

    expect(index.revision()).toBeGreaterThan(0);
  });

  it('offersTheServersThatMovedOutOfTheCodeCatalogue', () => {
    // These stopped being TypeScript and became data. If the bundled document ever stops carrying
    // them, a fresh installation quietly loses Python, Lua, SQL and Perl support with nothing failing.
    const offered: readonly string[] = new PluginIndex(root, URL, answering(''))
      .manifests()
      .map((manifest): string => manifest.id);

    // Containment rather than equality: the point is that these five are still carried, not that the
    // catalogue never grows, and asserting the whole list would fail every time it does.
    expect(offered).toEqual(
      expect.arrayContaining(['pyright', 'ty', 'lua-language-server', 'sqls', 'perlnavigator']),
    );
  });

  it('prefersACacheThatSupersedesTheBundledIndex', () => {
    cache(9999, [entry()]);

    const index: PluginIndex = new PluginIndex(root, URL, answering(''));

    expect(index.revision()).toBe(9999);
    expect(index.manifests().map((manifest): string => manifest.id)).toEqual(['zls']);
  });

  it('ignoresACacheThatDoesNotSupersedeTheBundledIndex', () => {
    // Upgrading Studio ships a seed that may well be newer than a cache fetched months ago.
    cache(0, [entry()]);

    const index: PluginIndex = new PluginIndex(root, URL, answering(''));

    expect(index.manifests().map((manifest): string => manifest.id)).not.toContain('zls');
  });

  it('ignoresACacheThatIsNotReadable', () => {
    writeFileSync(path.join(root, 'plugin-index.json'), '{ not json');

    expect(new PluginIndex(root, URL, answering('')).revision()).toBeGreaterThan(0);
  });

  it('cachesAFetchedIndexThatSupersedesWhatIsInForce', async () => {
    const body: string = JSON.stringify(document(9999, [entry()]));
    const index: PluginIndex = new PluginIndex(root, URL, answering(body));

    expect(await index.refresh()).toBe(true);
    expect(readFileSync(path.join(root, 'plugin-index.json'), 'utf8')).toBe(body);
    // Deliberately not applied to this launch: unregistering a server out from under a running
    // session is the problem the sideload directory already declined to solve.
    expect(index.manifests().map((manifest): string => manifest.id)).not.toContain('zls');
  });

  it('doesNotCacheAnIndexThatIsNotNewer', async () => {
    const index: PluginIndex = new PluginIndex(
      root,
      URL,
      answering(JSON.stringify(document(1, []))),
    );

    expect(await index.refresh()).toBe(false);
  });

  it('keepsWhatItHasWhenTheIndexIsUnavailable', async () => {
    const index: PluginIndex = new PluginIndex(root, URL, answering('Not Found', false, 404));

    expect(await index.refresh()).toBe(false);
  });

  it('keepsWhatItHasWhenTheIndexCannotBeReached', async () => {
    const failing: IndexFetch = (): Promise<IndexResponse> =>
      Promise.reject(new Error('ENOTFOUND'));

    expect(await new PluginIndex(root, URL, failing).refresh()).toBe(false);
  });

  it('refusesToFetchOverPlainHttp', async () => {
    const index: PluginIndex = new PluginIndex(
      root,
      'http://example.com/index.json',
      answering(JSON.stringify(document(9999, [entry()]))),
    );

    expect(await index.refresh()).toBe(false);
  });

  it('refusesAnImplausiblyLargeBody', async () => {
    const index: PluginIndex = new PluginIndex(root, URL, answering('x'.repeat(1024 * 1024 + 1)));

    expect(await index.refresh()).toBe(false);
  });

  it('refusesAnIndexWhoseEveryEntryIsInvalid', async () => {
    // All of them being bad means this is not the document we think it is, and acting on it would
    // replace a working catalogue with an empty one.
    const body: string = JSON.stringify(document(9999, [{ id: 'broken' }, { id: 'alsoBroken' }]));

    expect(await new PluginIndex(root, URL, answering(body)).refresh()).toBe(false);
  });
});

describe('an index carrying releases, read by a build that predates them', () => {
  // Builds before #1467 read each entry with the manifest validator alone, which ignores fields it
  // does not know. This is that reader, so these hold the format to staying readable by them.
  const value: Record<string, unknown> = entry({
    version: '0.15.0',
    releases: [release('0.14.5', '1.1.0'), release('0.14.0', '1.1.0')],
  });

  it('readsTheEntryAsTheSingleReleaseItAlwaysWas', () => {
    const result: ManifestResult = parsePluginManifest(value);

    expect(result.errors).toEqual([]);
    expect(result.manifest?.version).toBe('0.15.0');
    expect(result.manifest?.provision.kind).toBe('archive');
  });

  it('readsTheSameManifestANewerBuildChoosesWhenBothCanRunTheEntry', () => {
    expect(selectPluginRelease(value, 0).manifest).toEqual(parsePluginManifest(value).manifest);
  });

  it('doesNotCarryTheReleasesIntoTheManifest', () => {
    expect(Object.keys(selectPluginRelease(value, 0).manifest ?? {})).not.toContain('releases');
  });
});

describe('the bundled index', () => {
  /**
   * The entries of the index Studio compiles in, as untrusted JSON.
   */
  const entries: readonly unknown[] = CURATED_PLUGINS.plugins;

  it('offersEveryEntry_eachAtTheReleaseItsTopLevelNames', () => {
    // The top level is what every older build reads, so it must stay the newest release: a build that
    // can run everything chooses exactly what an older build would have.
    entries.forEach((value: unknown, index: number): void => {
      expect(selectPluginRelease(value, index).manifest).toEqual(
        parsePluginManifest(value).manifest,
      );
    });
  });

  it('listsOnlyWellFormedReleases', () => {
    entries.forEach((value: unknown, index: number): void => {
      const errors: ManifestError[] = [];
      for (const candidate of pluginReleaseCandidates(value, index, errors)) {
        const result: ManifestResult = parsePluginManifest(candidate.value);

        expect(result.errors, candidate.path).toEqual([]);
      }

      expect(errors).toEqual([]);
    });
  });
});

describe('first-party releases listed under an entry', () => {
  // A listed release inherits whatever it does not restate, and the top level is the *newest*
  // release. An older first-party release that restated only its version, API and provision would
  // claim the newest release's contributions (GitHub 0.6.0 would offer `editIssue`, which only 0.7.0
  // implements). So each one, once laid over its entry, must be exactly that release's plugin.json at
  // its tag — which in practice means carrying all of it but the id.

  /**
   * Maps each first-party plugin's id to its directory under `plugins/`.
   */
  const firstParty: ReadonlyMap<string, string> = new Map<string, string>(
    readdirSync('plugins')
      .filter((directory: string): boolean =>
        existsSync(path.join('plugins', directory, 'plugin.json')),
      )
      .map((directory: string): [string, string] => [
        (
          JSON.parse(readFileSync(path.join('plugins', directory, 'plugin.json'), 'utf8')) as {
            id: string;
          }
        ).id,
        directory,
      ]),
  );

  /**
   * Reads a first-party plugin's plugin.json as it is at one of its release tags.
   * @param directory The plugin's directory under `plugins/`.
   * @param version The release.
   * @returns Returns the parsed document, or undefined when this checkout lacks the tag.
   */
  function pluginJsonAt(directory: string, version: string): unknown {
    try {
      const text: string = execFileSync(
        'git',
        ['show', `plugin-${directory}-v${version}:plugins/${directory}/plugin.json`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * Gives a release's plugin.json at its tag as an entry must list it.
   *
   * A release cut before #1465 names its lockfile at `main`, which serves whatever main holds today:
   * listed as it stands, it would hand an older build the newest release's lockfile, under a hash that
   * no longer matches. Listed, it names its own tag instead, as the index already did for it before it
   * was superseded. The path and every other field are unchanged.
   * @param atTag The release's plugin.json at its tag.
   * @param directory The plugin's directory under `plugins/`.
   * @param version The release.
   * @returns Returns the document an entry must list.
   */
  function pinnedAtItsTag(atTag: unknown, directory: string, version: string): unknown {
    const document: { provision?: { lockfileUrl?: unknown } } = atTag as {
      provision?: { lockfileUrl?: unknown };
    };
    const url: unknown = document.provision?.lockfileUrl;
    const main: string = 'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/';
    if (typeof url !== 'string' || !url.startsWith(main)) {
      return atTag;
    }
    return {
      ...document,
      provision: {
        ...document.provision,
        lockfileUrl:
          `https://raw.githubusercontent.com/onix-labs/onixlabs-studio/plugin-${directory}-v${version}/` +
          url.slice(main.length),
      },
    };
  }

  /**
   * Holds every first-party release an entry lists to its plugin.json at its tag.
   *
   * A missing tag is skipped locally (a shallow clone has none) but fails on CI, whose unit-test job
   * fetches every tag precisely so that this runs.
   * @param value The index entry.
   * @param index Its position in the document.
   * @returns Returns how many releases were checked, and the labels of those skipped.
   */
  function holdReleasesToTheirTags(
    value: unknown,
    index: number,
  ): { checked: number; skipped: string[] } {
    const result: { checked: number; skipped: string[] } = { checked: 0, skipped: [] };
    const directory: string | undefined = firstParty.get(
      (value as { id?: string } | undefined)?.id ?? '',
    );
    if (directory === undefined) {
      return result;
    }
    for (const candidate of pluginReleaseCandidates(value, index).slice(1)) {
      const version: string = String((candidate.value as { version?: unknown }).version);
      const atTag: unknown = pluginJsonAt(directory, version);
      if (atTag === undefined) {
        expect(
          process.env['CI'],
          `plugin-${directory}-v${version} is not in this checkout; CI must fetch every tag`,
        ).toBeFalsy();
        result.skipped.push(`${directory} ${version}`);
        continue;
      }

      expect(candidate.value, `${candidate.path} against plugin-${directory}-v${version}`).toEqual(
        pinnedAtItsTag(atTag, directory, version),
      );
      result.checked += 1;
    }
    return result;
  }

  it('holdsEveryListedReleaseToItsPluginJsonAtItsTag', (context: { skip: () => void }) => {
    let checked: number = 0;
    let skipped: number = 0;
    CURATED_PLUGINS.plugins.forEach((value: unknown, index: number): void => {
      const result: { checked: number; skipped: string[] } = holdReleasesToTheirTags(value, index);
      checked += result.checked;
      skipped += result.skipped.length;
    });

    if (checked === 0 && skipped > 0) {
      context.skip();
    }
  });

  describe('against GitHub 0.6.0', () => {
    const latest: Record<string, unknown> = JSON.parse(
      readFileSync('plugins/github/plugin.json', 'utf8'),
    ) as Record<string, unknown>;
    const atTag: unknown = pluginJsonAt('github', '0.6.0');

    /**
     * Builds the GitHub entry listing 0.6.0 as an older release.
     * @param listed The release as the entry lists it.
     * @returns Returns the entry.
     */
    function listing(listed: Record<string, unknown>): Record<string, unknown> {
      return { ...latest, releases: [listed] };
    }

    it('acceptsTheReleaseCarriedWhole', (context: { skip: () => void }) => {
      if (atTag === undefined) {
        context.skip();
        return;
      }
      const { id, ...whole }: Record<string, unknown> = pinnedAtItsTag(
        atTag,
        'github',
        '0.6.0',
      ) as Record<string, unknown>;
      void id;

      expect(holdReleasesToTheirTags(listing(whole), 0)).toEqual({ checked: 1, skipped: [] });
    });

    // GitHub 0.6.0 predates #1465, so its plugin.json names its lockfile at `main`.
    it('refusesTheReleaseThatStillNamesMain', (context: { skip: () => void }) => {
      if (atTag === undefined) {
        context.skip();
        return;
      }
      const { id, ...asTagged }: Record<string, unknown> = atTag as Record<string, unknown>;
      void id;

      expect(() => holdReleasesToTheirTags(listing(asTagged), 0)).toThrow(/plugin-github-v0\.6\.0/);
    });

    it('refusesTheReleaseThatInheritsTheNewestContributions', (context: { skip: () => void }) => {
      if (atTag === undefined) {
        context.skip();
        return;
      }
      const old: Record<string, unknown> = atTag as Record<string, unknown>;
      const thin: Record<string, unknown> = {
        version: old['version'],
        apiVersion: old['apiVersion'],
        provision: old['provision'],
      };

      expect(() => holdReleasesToTheirTags(listing(thin), 0)).toThrow(/plugin-github-v0\.6\.0/);
    });
  });
});

describe('the shipped lockfiles', () => {
  /**
   * The npm-provisioned entries of the index Studio compiles in.
   */
  const npmEntries: readonly { id: string; provision: Record<string, string> }[] = (
    CURATED_PLUGINS.plugins as readonly Record<string, unknown>[]
  )
    .map((plugin): { id: string; provision: Record<string, string> } => ({
      id: plugin['id'] as string,
      provision: plugin['provision'] as Record<string, string>,
    }))
    .filter((entry): boolean => entry.provision['kind'] === 'npm');

  for (const entry of npmEntries) {
    it(`matchTheHashPinnedFor_${entry.id}`, () => {
      // The index pins a hash of the lockfile, and both are files in this repository — so anything
      // that rewrites one without repinning the other (a formatter, a careless dependency bump)
      // would ship an entry that fails to install, and would do it silently.
      const name: string = entry.provision['lockfileUrl'].split('/').pop() ?? '';
      // From the repository root: `import.meta.dirname` is the spec's directory when this file runs
      // alone and the bundle's when it runs with the suite, which silently passes in one mode.
      const file: string = path.join(
        process.cwd(),
        'src/shared/electron/contributions/plugins/lockfiles',
        name,
      );
      const digest: string = createHash('sha256').update(readFileSync(file)).digest('hex');

      expect(digest).toBe(entry.provision['sha256']);
    });

    it(`areServedFromThisRepositoryFor_${entry.id}`, () => {
      // A lockfile decides which tarballs are fetched. Pointing one somewhere we do not control would
      // hand that decision away. The ref is a plugin's release tag, or `main` for a third-party
      // server's lockfile, which has no tag of its own.
      expect(entry.provision['lockfileUrl']).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/onix-labs\/onixlabs-studio\/(main|plugin-[a-z0-9-]+-v[0-9][^/]*)\/src\/shared\/electron\/contributions\/plugins\/lockfiles\/[^/]+\.lock\.json$/,
      );
    });
  }
});
