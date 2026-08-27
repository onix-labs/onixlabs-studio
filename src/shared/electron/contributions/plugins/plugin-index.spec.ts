import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PLUGIN_API_VERSION } from '@shared/api/plugin-manifest';
import CURATED_PLUGINS from './curated-plugins.json';
import {
  IndexFetch,
  IndexResponse,
  parsePluginIndex,
  PluginIndex,
  PluginIndexDocument,
  pluginIndexUrl,
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
      // hand that decision away.
      expect(entry.provision['lockfileUrl']).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/onix-labs\/onixlabs-studio\/main\//,
      );
    });
  }
});
