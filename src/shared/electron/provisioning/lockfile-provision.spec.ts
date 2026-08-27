import { LockfilePackage, parseLockfile } from './lockfile-provision';

/**
 * Builds a lockfile document around a set of package entries.
 * @param packages The `packages` map, less the root entry which is always present.
 * @param version The lockfile version.
 * @returns Returns the document as text, which is how a downloaded lockfile arrives.
 */
function lockfile(packages: Record<string, unknown>, version: number = 3): string {
  return JSON.stringify({
    name: 'demo',
    lockfileVersion: version,
    packages: { '': { name: 'demo', version: '1.0.0' }, ...packages },
  });
}

/**
 * Builds a well-formed entry, which tests then break in one place at a time.
 * @param overrides Fields to replace.
 * @returns Returns the entry.
 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.0.0.tgz',
    integrity: `sha512-${'a'.repeat(86)}==`,
    ...overrides,
  };
}

describe('parseLockfile', () => {
  describe('reads', () => {
    it('theTripleEveryEntryCarries', () => {
      const packages: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({ 'node_modules/left-pad': entry() }),
      );

      expect(packages).toEqual([
        {
          path: 'node_modules/left-pad',
          url: 'https://registry.npmjs.org/left-pad/-/left-pad-1.0.0.tgz',
          integrity: `sha512-${'a'.repeat(86)}==`,
          algorithm: 'sha512',
        },
      ]);
    });

    it('nestedNonHoistedPaths', () => {
      // The key is the destination, and a tree that needs two versions of one package says so by
      // nesting. Flattening this would install the wrong one.
      const packages: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({
          'node_modules/a': entry(),
          'node_modules/a/node_modules/b': entry(),
        }),
      );

      expect(packages?.map((p: LockfilePackage): string => p.path)).toEqual([
        'node_modules/a',
        'node_modules/a/node_modules/b',
      ]);
    });

    it('aVersion2Lockfile', () => {
      // v2 carries the same `packages` map as v3, alongside the legacy tree this ignores.
      expect(parseLockfile(lockfile({ 'node_modules/a': entry() }, 2))).toHaveLength(1);
    });
  });

  describe('skips', () => {
    it('theRootProjectWorkspaceLinksAndDevDependencies', () => {
      // None of the three names a tarball, so none is a failure — but none is installed either.
      const packages: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({
          'node_modules/linked': { link: true, resolved: 'packages/linked' },
          'node_modules/only-for-tests': entry({ dev: true }),
          'node_modules/real': entry(),
        }),
      );

      expect(packages?.map((p: LockfilePackage): string => p.path)).toEqual(['node_modules/real']);
    });

    it('aPackageThisPlatformIsNotMeantToHave', () => {
      const packages: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({
          'node_modules/win-only': entry({ os: ['win32'] }),
          'node_modules/mac-only': entry({ os: ['darwin'] }),
        }),
        'darwin',
        'arm64',
      );

      expect(packages?.map((p: LockfilePackage): string => p.path)).toEqual([
        'node_modules/mac-only',
      ]);
    });

    it('aPackageThisArchitectureIsNotMeantToHave', () => {
      const packages: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({ 'node_modules/intel-only': entry({ cpu: ['x64'] }) }),
        'darwin',
        'arm64',
      );

      expect(packages).toEqual([]);
    });

    it('aPackageExcludedByNegation', () => {
      // npm's own semantics: a list of only denials admits everything it does not name.
      const excluded: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({ 'node_modules/not-windows': entry({ os: ['!win32'] }) }),
        'win32',
        'x64',
      );
      const admitted: readonly LockfilePackage[] | null = parseLockfile(
        lockfile({ 'node_modules/not-windows': entry({ os: ['!win32'] }) }),
        'darwin',
        'arm64',
      );

      expect(excluded).toEqual([]);
      expect(admitted).toHaveLength(1);
    });
  });

  describe('refuses', () => {
    it('aDestinationThatEscapesTheTree', () => {
      // The key becomes a filesystem path under the install root, so this is the boundary that stops a
      // hostile document writing anywhere it likes.
      expect(parseLockfile(lockfile({ '../../.ssh/authorized_keys': entry() }))).toBeNull();
      expect(parseLockfile(lockfile({ 'node_modules/../../escape': entry() }))).toBeNull();
      expect(parseLockfile(lockfile({ '/etc/passwd': entry() }))).toBeNull();
    });

    it('aDestinationOutsideNodeModules', () => {
      expect(parseLockfile(lockfile({ 'bin/thing': entry() }))).toBeNull();
    });

    it('aTarballFetchedOverPlainHttp', () => {
      expect(
        parseLockfile(lockfile({ 'node_modules/a': entry({ resolved: 'http://registry/a.tgz' }) })),
      ).toBeNull();
    });

    it('aWeakIntegrityAlgorithm', () => {
      // SHA-1 is collision-broken, so a SHA-1 pin is not the guarantee the rest of this design rests
      // on. Refused rather than quietly accepted.
      expect(
        parseLockfile(
          lockfile({ 'node_modules/a': entry({ integrity: `sha1-${'a'.repeat(27)}=` }) }),
        ),
      ).toBeNull();
    });

    it('anEntryWithATarballButNoIntegrity', () => {
      expect(
        parseLockfile(lockfile({ 'node_modules/a': entry({ integrity: undefined }) })),
      ).toBeNull();
    });

    it('aLockfileVersionThatCarriesNoPackagesMap', () => {
      expect(parseLockfile(lockfile({ 'node_modules/a': entry() }, 1))).toBeNull();
    });

    it('aDocumentThatIsNotALockfile', () => {
      expect(parseLockfile('{ not json')).toBeNull();
      expect(parseLockfile('[]')).toBeNull();
      expect(parseLockfile('null')).toBeNull();
      expect(parseLockfile(JSON.stringify({ lockfileVersion: 3 }))).toBeNull();
    });
  });
});
