import { describe, expect, it } from 'vitest';
import { ArchiveProvision } from '@shared/electron/provisioning/archive-provision';
import {
  CLANGD_PROVISION,
  LUA_PROVISION,
  PERLNAVIGATOR_PROVISION,
  PYRIGHT_PROVISION,
  SQLS_PROVISION,
  TY_PROVISION,
  TYPESCRIPT_SERVER_PROVISION,
} from '@shared/electron/lsp/language-server-downloads';
import {
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
      // The kinds Studio cannot express declaratively — a source build, a pip or npm install — are
      // refused rather than half-understood.
      const result: ManifestResult = parsePluginManifest(
        manifest({ provision: { kind: 'pip', package: 'debugpy' } }),
      );

      expect(paths(result)).toEqual(['provision.kind']);
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
    // live recipes the first-party catalogue installs from, not fixtures written to pass.
    const REAL: readonly {
      id: string;
      provision: ArchiveProvision;
      command: 'executable' | 'node';
    }[] = [
      { id: 'pyright', provision: PYRIGHT_PROVISION, command: 'node' },
      { id: 'typescript-language-server', provision: TYPESCRIPT_SERVER_PROVISION, command: 'node' },
      { id: 'ty', provision: TY_PROVISION, command: 'executable' },
      { id: 'clangd', provision: CLANGD_PROVISION, command: 'executable' },
      { id: 'lua-language-server', provision: LUA_PROVISION, command: 'executable' },
      { id: 'sqls', provision: SQLS_PROVISION, command: 'executable' },
      { id: 'perlnavigator', provision: PERLNAVIGATOR_PROVISION, command: 'executable' },
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
  });
});
