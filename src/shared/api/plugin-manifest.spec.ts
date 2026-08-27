import { describe, expect, it } from 'vitest';
import { ArchiveProvision } from '@shared/electron/provisioning/archive-provision';
import {
  CLANGD_PROVISION,
  TYPESCRIPT_SERVER_PROVISION,
} from '@shared/electron/lsp/language-server-downloads';
import CURATED_PLUGINS from '@shared/electron/contributions/plugins/curated-plugins.json';
import {
  isApiCompatible,
  ManifestError,
  ManifestResult,
  PLUGIN_API_VERSION,
  parsePluginManifest,
} from './plugin-manifest';

/**
 * Builds a well-formed manifest, modelled on a real catalogue entry (`ty`), which tests then break in
 * one place at a time.
 * @param overrides Fields to replace on the manifest.
 * @returns Returns the manifest as untrusted JSON would arrive.
 */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ty',
    name: 'ty',
    description: "Astral's Python type checker and language server.",
    version: '0.0.74',
    apiVersion: PLUGIN_API_VERSION,
    provision: {
      kind: 'archive',
      downloads: {
        'darwin-arm64': {
          url: 'https://github.com/astral-sh/ty/releases/download/0.0.74/ty-aarch64-apple-darwin.tar.gz',
          sha256: '79b08069f29833383650515a31f260a60a81224b31fdb9fa21a56c1ead032a6e',
          archive: 'tar.gz',
          executablePath: 'ty-aarch64-apple-darwin/ty',
        },
      },
    },
    contributes: {
      languageServers: [
        {
          id: 'ty',
          displayName: 'ty (Astral)',
          languages: ['python'],
          priority: 50,
          command: { kind: 'executable', args: ['server'] },
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Builds a well-formed npm-provisioned manifest, modelled on the server the approach was proven
 * against (#446), which tests then break in one place at a time.
 * @param provision Fields to replace on the provision.
 * @returns Returns the manifest as untrusted JSON would arrive.
 */
function npmManifest(provision: Record<string, unknown> = {}): Record<string, unknown> {
  return manifest({
    id: 'dockerfile-language-server',
    name: 'Dockerfile Language Server',
    provision: {
      kind: 'npm',
      lockfileUrl: 'https://example.com/dockerfile-language-server.lock.json',
      sha256: 'b'.repeat(64),
      executablePath: 'node_modules/dockerfile-language-server-nodejs/bin/docker-langserver',
      ...provision,
    },
  });
}

/**
 * Gets the paths of the reported failures.
 * @param result The validation result.
 * @returns Returns the failure paths.
 */
function paths(result: ManifestResult): readonly string[] {
  return result.errors.map((error: ManifestError): string => error.path);
}

describe('parsePluginManifest', () => {
  describe('accepts', () => {
    it('aWellFormedManifest', () => {
      const result: ManifestResult = parsePluginManifest(manifest());

      expect(result.errors).toEqual([]);
      expect(result.manifest?.id).toBe('ty');
      expect(result.manifest?.contributes.languageServers?.[0]?.command.args).toEqual(['server']);
    });

    it('anNpmProvisionCarryingNoPlatformMap', () => {
      // Unlike an archive, one lockfile describes the tree everywhere and platform variation lives
      // inside it, so a `downloads` key here is not merely optional but meaningless — and must not be
      // quietly required by validation copied from the archive path.
      const result: ManifestResult = parsePluginManifest(npmManifest());

      expect(result.errors).toEqual([]);
      expect(result.manifest?.provision.kind).toBe('npm');
      expect(result.manifest?.provision).toMatchObject({
        lockfileUrl: 'https://example.com/dockerfile-language-server.lock.json',
        sha256: 'b'.repeat(64),
        executablePath: 'node_modules/dockerfile-language-server-nodejs/bin/docker-langserver',
      });
    });

    it('aManifestWithNoDetail', () => {
      // Saying nothing is the common case, and must not be mistaken for saying something empty.
      const result: ManifestResult = parsePluginManifest(manifest());

      expect(result.errors).toEqual([]);
      expect(result.manifest?.detail).toBeUndefined();
    });

    it('aManifestCarryingItsOwnDetail', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({ detail: 'A large download — it carries the Clang toolchain headers.' }),
      );

      expect(result.errors).toEqual([]);
      expect(result.manifest?.detail).toBe(
        'A large download — it carries the Clang toolchain headers.',
      );
    });

    it('aDebugAdapterWithATransport', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          contributes: {
            debugAdapters: [
              {
                id: 'js-debug',
                displayName: 'Node (js-debug)',
                languages: ['typescript', 'javascript'],
                command: { kind: 'node', args: ['0', '127.0.0.1'] },
                transport: 'tcp-server',
              },
            ],
          },
        }),
      );

      expect(result.errors).toEqual([]);
      expect(result.manifest?.contributes.debugAdapters?.[0]?.transport).toBe('tcp-server');
    });

    it('aContributionWithoutAPriority_defaultingIt', () => {
      const value: Record<string, unknown> = manifest();
      const servers: Record<string, unknown>[] = (
        value['contributes'] as { languageServers: Record<string, unknown>[] }
      ).languageServers;
      delete servers[0]['priority'];

      expect(parsePluginManifest(value).manifest?.contributes.languageServers?.[0]?.priority).toBe(
        100,
      );
    });
  });

  describe('refuses', () => {
    it('anythingThatIsNotAnObject', () => {
      expect(parsePluginManifest('nope').manifest).toBeNull();
      expect(parsePluginManifest(null).manifest).toBeNull();
      expect(parsePluginManifest([]).manifest).toBeNull();
    });

    it('anApiVersionThisBuildCannotInterpret', () => {
      // Refusing beats guessing: a manifest written for a later contribution model may mean something
      // different by the same fields.
      const result: ManifestResult = parsePluginManifest(manifest({ apiVersion: 99 }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toEqual(['apiVersion']);
    });

    it('aDetailThatIsPresentButSaysNothing', () => {
      // An empty string is not silence — it is a field someone meant to fill in and did not.
      const result: ManifestResult = parsePluginManifest(manifest({ detail: '' }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toEqual(['detail']);
    });

    it('aNonHttpsDownload', () => {
      // The payload is executable code; over plain HTTP the checksum would be the only thing standing
      // between the user and whatever answered the request.
      const result: ManifestResult = parsePluginManifest(
        manifest({
          provision: {
            kind: 'archive',
            downloads: {
              'darwin-arm64': {
                url: 'http://example.com/ty.tar.gz',
                sha256: 'a'.repeat(64),
                archive: 'tar.gz',
                executablePath: 'ty',
              },
            },
          },
        }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.downloads.darwin-arm64.url');
    });

    it('aChecksumThatIsNotASha256', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          provision: {
            kind: 'archive',
            downloads: {
              'darwin-arm64': {
                url: 'https://example.com/ty.tar.gz',
                sha256: 'not-a-hash',
                archive: 'tar.gz',
                executablePath: 'ty',
              },
            },
          },
        }),
      );

      expect(paths(result)).toContain('provision.downloads.darwin-arm64.sha256');
    });

    it('anEntryPointThatEscapesTheArchive', () => {
      // An entry path is joined onto the install directory, so traversal would let a manifest name a
      // binary anywhere on the machine and have Studio run it.
      const result: ManifestResult = parsePluginManifest(
        manifest({
          provision: {
            kind: 'archive',
            downloads: {
              'darwin-arm64': {
                url: 'https://example.com/ty.tar.gz',
                sha256: 'a'.repeat(64),
                archive: 'tar.gz',
                executablePath: '../../../../usr/bin/whoami',
              },
            },
          },
        }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.downloads.darwin-arm64.executablePath');
    });

    it('anAbsoluteEntryPoint', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          provision: {
            kind: 'archive',
            downloads: {
              'darwin-arm64': {
                url: 'https://example.com/ty.tar.gz',
                sha256: 'a'.repeat(64),
                archive: 'tar.gz',
                executablePath: '/bin/sh',
              },
            },
          },
        }),
      );

      expect(paths(result)).toContain('provision.downloads.darwin-arm64.executablePath');
    });

    it('anIdentifierThatIsNotSafeAsADirectoryName', () => {
      const result: ManifestResult = parsePluginManifest(manifest({ id: '../escape' }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('id');
    });

    it('aPluginThatContributesNothing', () => {
      const result: ManifestResult = parsePluginManifest(manifest({ contributes: {} }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('contributes');
    });

    it('aProvisionPublishingNoPlatforms', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({ provision: { kind: 'archive', downloads: {} } }),
      );

      expect(paths(result)).toContain('provision.downloads');
    });

    it('anUnknownPlatformKey', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          provision: {
            kind: 'archive',
            downloads: {
              'sunos-sparc': {
                url: 'https://example.com/ty.tar.gz',
                sha256: 'a'.repeat(64),
                archive: 'tar.gz',
                executablePath: 'ty',
              },
            },
          },
        }),
      );

      expect(paths(result)).toContain('provision.downloads.sunos-sparc');
    });

    it('anUnknownProvisioningKind', () => {
      // The kinds Studio cannot express declaratively — a source build, a pip install into a managed
      // environment — are refused rather than half-understood.
      const result: ManifestResult = parsePluginManifest(
        manifest({ provision: { kind: 'pip', package: 'debugpy' } }),
      );

      expect(paths(result)).toEqual(['provision.kind']);
    });

    it('anNpmProvisionWithANonHttpsLockfileUrl', () => {
      // The lockfile decides which tarballs are fetched, so a channel that can be rewritten in flight
      // would make its checksum the only defence.
      const result: ManifestResult = parsePluginManifest(
        npmManifest({ lockfileUrl: 'http://example.com/server.lock.json' }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.lockfileUrl');
    });

    it('anNpmProvisionWithAMalformedLockfileChecksum', () => {
      const result: ManifestResult = parsePluginManifest(npmManifest({ sha256: 'NOTAHASH' }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.sha256');
    });

    it('anNpmProvisionWithNoLockfileUrl', () => {
      const result: ManifestResult = parsePluginManifest(npmManifest({ lockfileUrl: undefined }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.lockfileUrl');
    });

    it('anNpmProvisionWhoseEntryPointEscapesTheTree', () => {
      const result: ManifestResult = parsePluginManifest(
        npmManifest({ executablePath: '../../../etc/passwd' }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.executablePath');
    });

    it('anNpmProvisionWhoseEntryPointIsAbsolute', () => {
      const result: ManifestResult = parsePluginManifest(
        npmManifest({ executablePath: '/usr/local/bin/docker-langserver' }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('provision.executablePath');
    });

    it('aCommandKindThatIsNotOneOfTheTwoShapes', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          contributes: {
            languageServers: [
              {
                id: 'ty',
                displayName: 'ty',
                languages: ['python'],
                command: { kind: 'shell', args: ['rm -rf /'] },
              },
            ],
          },
        }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('contributes.languageServers[0].command.kind');
    });

    it('aContributionServingNoLanguages', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({
          contributes: {
            languageServers: [
              { id: 'ty', displayName: 'ty', languages: [], command: { kind: 'executable' } },
            ],
          },
        }),
      );

      expect(paths(result)).toContain('contributes.languageServers[0].languages');
    });
  });

  it('reportsEveryProblemAtOnce', () => {
    // A loader that reports one problem at a time makes fixing a manifest an afternoon of guesses.
    const result: ManifestResult = parsePluginManifest({
      apiVersion: PLUGIN_API_VERSION,
      id: '',
      name: '',
      description: '',
      version: '',
      provision: { kind: 'archive', downloads: {} },
      contributes: {},
    });

    expect(paths(result)).toEqual(
      expect.arrayContaining(['id', 'name', 'description', 'version', 'contributes']),
    );
    expect(result.errors.length).toBeGreaterThan(4);
  });

  describe('describes the real catalogue', () => {
    // The format is only worth having if it can describe plugins that actually exist. These are the
    // live recipes Studio installs from, not fixtures written to pass: the two whose descriptors still
    // need code to resolve, and every entry of the curated index Studio ships.
    const REAL: readonly {
      id: string;
      provision: ArchiveProvision;
      command: 'executable' | 'node';
    }[] = [
      { id: 'typescript-language-server', provision: TYPESCRIPT_SERVER_PROVISION, command: 'node' },
      { id: 'clangd', provision: CLANGD_PROVISION, command: 'executable' },
    ];

    for (const entry of REAL) {
      it(`acceptsAManifestFor_${entry.id}`, () => {
        const result: ManifestResult = parsePluginManifest({
          id: entry.id,
          name: entry.id,
          description: 'A real catalogue entry.',
          version: entry.provision.version,
          apiVersion: PLUGIN_API_VERSION,
          provision: { kind: 'archive', downloads: entry.provision.downloads },
          contributes: {
            languageServers: [
              {
                id: entry.id,
                displayName: entry.id,
                languages: ['python'],
                command: { kind: entry.command },
              },
            ],
          },
        });

        expect(result.errors).toEqual([]);
        expect(result.manifest).not.toBeNull();
      });
    }

    for (const entry of CURATED_PLUGINS.plugins) {
      it(`acceptsTheShippedIndexEntryFor_${(entry as { id: string }).id}`, () => {
        // The index Studio compiles in has to validate against the validator Studio reads it with.
        // A typo here would otherwise be a plugin that silently disappears from the manager.
        const result: ManifestResult = parsePluginManifest(entry);

        expect(result.errors).toEqual([]);
        expect(result.manifest).not.toBeNull();
      });
    }
  });

  describe('API compatibility', () => {
    it('acceptsTheExactVersionTheBuildImplements', () => {
      expect(isApiCompatible('1.2.3', '1.2.3')).toBe(true);
    });

    it('theNpmKindArrivedIn_1_2_0', () => {
      // The bump is the promise. A build implementing 1.1.0 has never heard of an npm provision, so it
      // must decline the whole manifest rather than parse the parts it recognises and install a plugin
      // that half works.
      expect(isApiCompatible('1.2.0', '1.1.0')).toBe(false);
      expect(isApiCompatible('1.2.0', PLUGIN_API_VERSION)).toBe(true);
    });

    it('everyArchiveManifestStillMeansWhatItMeant', () => {
      // The evidence that 1.2.0 only adds: a 1.1.0 manifest, unchanged, still validates against the
      // build that implements 1.2.0.
      const result: ManifestResult = parsePluginManifest(manifest({ apiVersion: '1.1.0' }));

      expect(result.errors).toEqual([]);
      expect(result.manifest?.provision.kind).toBe('archive');
    });

    it('acceptsAnOlderMinorOrPatch', () => {
      // Older minors are the whole point of a minor: a plugin written against less of the API still
      // works against more of it.
      expect(isApiCompatible('1.0.0', '1.4.2')).toBe(true);
      expect(isApiCompatible('1.4.0', '1.4.2')).toBe(true);
    });

    it('refusesANewerMinorOrPatch', () => {
      // The plugin may use contribution points this build has never heard of; dropping them silently
      // would install something that half works.
      expect(isApiCompatible('1.5.0', '1.4.2')).toBe(false);
      expect(isApiCompatible('1.4.3', '1.4.2')).toBe(false);
    });

    it('refusesADifferentMajorInEitherDirection', () => {
      // A major bump is how we say the same field means something new.
      expect(isApiCompatible('2.0.0', '1.4.2')).toBe(false);
      expect(isApiCompatible('1.9.9', '2.0.0')).toBe(false);
    });

    it('refusesAnythingThatIsNotAPlainSemver', () => {
      expect(isApiCompatible('1', '1.0.0')).toBe(false);
      expect(isApiCompatible('1.0', '1.0.0')).toBe(false);
      expect(isApiCompatible(1, '1.0.0')).toBe(false);
      expect(isApiCompatible('^1.0.0', '1.0.0')).toBe(false);
      expect(isApiCompatible(undefined, '1.0.0')).toBe(false);
    });

    it('refusesAManifestBuiltForAFutureMajor', () => {
      const result: ManifestResult = parsePluginManifest(manifest({ apiVersion: '2.0.0' }));

      expect(result.manifest).toBeNull();
      expect(paths(result)).toEqual(['apiVersion']);
    });
  });

  describe('runtime prerequisites', () => {
    it('acceptsARequirementFromTheKnownRuntimes', () => {
      // This is what makes the Java-family servers describable: the manifest declares that a JDK is
      // needed, without saying how to find one.
      const result: ManifestResult = parsePluginManifest(
        manifest({ requires: [{ runtime: 'java', minimumVersion: '21' }] }),
      );

      expect(result.errors).toEqual([]);
      expect(result.manifest?.requires).toEqual([{ runtime: 'java', minimumVersion: '21' }]);
    });

    it('acceptsARequirementWithNoMinimumVersion', () => {
      const result: ManifestResult = parsePluginManifest(
        manifest({ requires: [{ runtime: 'go' }] }),
      );

      expect(result.errors).toEqual([]);
      expect(result.manifest?.requires[0]?.minimumVersion).toBeUndefined();
    });

    it('defaultsToRequiringNothing', () => {
      expect(parsePluginManifest(manifest()).manifest?.requires).toEqual([]);
    });

    it('refusesARuntimeStudioCannotDetect', () => {
      // Detection is code. A manifest may declare a prerequisite from the known list; it may not invent
      // one, because inventing one would mean shipping the code that finds it.
      const result: ManifestResult = parsePluginManifest(
        manifest({ requires: [{ runtime: 'haskell' }] }),
      );

      expect(result.manifest).toBeNull();
      expect(paths(result)).toContain('requires[0].runtime');
    });

    it('refusesAMalformedRequirement', () => {
      expect(parsePluginManifest(manifest({ requires: 'java' })).manifest).toBeNull();
      expect(
        parsePluginManifest(manifest({ requires: [{ runtime: 'java', minimumVersion: 21 }] }))
          .manifest,
      ).toBeNull();
    });
  });
});
