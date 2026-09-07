import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PLUGIN_API_VERSION, PluginManifest } from '@shared/api/plugin-manifest';
import { PluginContribution, PluginOrigin } from '@shared/api/plugin-channels';
import { ArchiveProvision } from '../../provisioning/archive-provision';
import { LockfileProvision } from '../../provisioning/lockfile-provision';
import { LspProvisioner } from '../../lsp/lsp-provisioner';
import { DecoderDescriptor, DecoderResolution } from '../../decoders/decoder-descriptor';
import { LanguageServerDescriptor, LspResolution } from '../../lsp/language-server-descriptor';
import { DebugAdapterCatalogueEntry, DebugAdapterSpec } from '../../debug/debug-adapter-registry';
import {
  discoverPlugins,
  LoadedPlugin,
  MANIFEST_FILE,
  NodeRuntimeSpec,
  payloadOps,
  PayloadOps,
  toContainerEngineDescriptors,
  toDebugAdapterEntries,
  toDecoderDescriptors,
  toOrigin,
  toLanguageServerDescriptors,
  toPluginDescriptor,
  toProvision,
  validManifests,
} from './plugin-loader';
import { ContainerEngineDescriptor } from '../containers/container-engine';

/**
 * Builds a well-formed manifest for a sideloaded plugin.
 * @param overrides Fields to replace.
 * @returns Returns the manifest as it would be written to disk.
 */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
        'darwin-x64': {
          url: 'https://example.com/zls-x86_64-macos.tar.gz',
          sha256: 'c'.repeat(64),
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
          command: { kind: 'executable', args: ['--enable-debug-log'] },
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Builds a provisioner that reports one fixed install path, so resolution can be exercised without a
 * real install. Answers for both provisioning kinds, because which one a manifest uses is exactly what
 * the code under test is deciding.
 * @param installedPath The path to report, or null for not installed.
 * @returns Returns the stub.
 */
function stubProvisioner(installedPath: string | null): LspProvisioner {
  return {
    isArchiveInstalled: (): boolean => installedPath !== null,
    archiveTarget: (): string | null => installedPath,
    treeDirectory: (): string | null => installedPath,
    isTreeInstalled: (): boolean => installedPath !== null,
    // Mirrors `LockfileProvisioner.targetOf` exactly, including returning null when neither the
    // provision nor the contribution names an entry point. A stub looser than the thing it stands in
    // for passes tests the application fails — which is how the "Not supported here" regression got
    // out in the first place.
    treeTarget: (provision: LockfileProvision, entryPoint?: string): string | null => {
      const relative: string | undefined = entryPoint ?? provision.executablePath;
      return installedPath === null || relative === undefined
        ? null
        : path.join(installedPath, relative);
    },
  } as unknown as LspProvisioner;
}

/**
 * A two-package lockfile, as a compiled-in document would arrive.
 */
const LOCKFILE: unknown = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'demo' },
    'node_modules/a': {
      resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
      integrity: `sha512-${'a'.repeat(86)}==`,
    },
    'node_modules/b': {
      resolved: 'https://registry.npmjs.org/b/-/b-1.0.0.tgz',
      integrity: `sha512-${'b'.repeat(86)}==`,
    },
  },
};

/**
 * Builds an npm-provisioned manifest.
 * @returns Returns the manifest as it would be written to disk.
 */
function npmManifest(): Record<string, unknown> {
  return manifest({
    id: 'dockerfile',
    provision: {
      kind: 'npm',
      lockfileUrl: 'https://example.com/dockerfile.lock.json',
      sha256: 'd'.repeat(64),
      executablePath: 'node_modules/a/bin/run',
    },
  });
}

describe('plugin loader', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-plugins-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes a plugin directory containing the given manifest content.
   * @param name The directory name.
   * @param content The manifest content, written verbatim when a string.
   */
  function writePlugin(name: string, content: Record<string, unknown> | string): void {
    const directory: string = path.join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, MANIFEST_FILE),
      typeof content === 'string' ? content : JSON.stringify(content),
      'utf8',
    );
  }

  describe('discoverPlugins', () => {
    it('findsAValidPlugin', () => {
      writePlugin('zls', manifest());
      const found: readonly LoadedPlugin[] = discoverPlugins(root);

      expect(found).toHaveLength(1);
      expect(found[0]?.manifest?.id).toBe('zls');
      expect(found[0]?.errors).toEqual([]);
    });

    it('findsNothingInADirectoryThatDoesNotExist', () => {
      expect(discoverPlugins(path.join(root, 'absent'))).toEqual([]);
    });

    it('ignoresADirectoryWithNoManifest', () => {
      mkdirSync(path.join(root, 'not-a-plugin'), { recursive: true });

      expect(discoverPlugins(root)).toEqual([]);
    });

    it('ignoresLooseFiles', () => {
      writeFileSync(path.join(root, 'README.md'), 'not a plugin', 'utf8');

      expect(discoverPlugins(root)).toEqual([]);
    });

    it('refusesAManifestThatIsNotReadableJson', () => {
      writePlugin('broken', '{ not json');
      const found: readonly LoadedPlugin[] = discoverPlugins(root);

      expect(found[0]?.manifest).toBeNull();
      expect(found[0]?.errors[0]?.message).toContain('readable JSON');
    });

    it('refusesAManifestThatDoesNotValidate', () => {
      writePlugin('bad', manifest({ id: '../escape' }));
      const found: readonly LoadedPlugin[] = discoverPlugins(root);

      expect(found[0]?.manifest).toBeNull();
      expect(found[0]?.errors.length).toBeGreaterThan(0);
    });

    it('oneBadPluginDoesNotCostTheUserTheGoodOnes', () => {
      // A broken plugin should cost its owner that plugin and nothing else.
      writePlugin('good', manifest());
      writePlugin('broken', '{ not json');
      writePlugin('invalid', manifest({ id: 'x', contributes: {} }));

      expect(
        validManifests(discoverPlugins(root)).map((m: PluginManifest): string => m.id),
      ).toEqual(['zls']);
    });
  });

  describe('toProvision', () => {
    it('carriesEveryPlatformThroughUnchanged', () => {
      writePlugin('zls', manifest());
      const provision: ArchiveProvision | null = toProvision(
        validManifests(discoverPlugins(root))[0],
      );

      expect(provision).not.toBeNull();
      expect(provision?.id).toBe('zls');
      expect(provision?.version).toBe('0.14.0');
      expect(Object.keys(provision?.downloads ?? {}).sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
      ]);
      expect(provision?.downloads['darwin-arm64']?.executablePath).toBe('zls');
    });

    it('hasNoArchiveRecipeForAnNpmProvision', () => {
      // An npm provision names a dependency tree, which the reifier installs (#450); there is no
      // archive to hand the archive provisioner. Until then the plugin degrades to unsupported and not
      // installed, which is the same shape as a platform the plugin does not publish.
      writePlugin(
        'dockerfile',
        manifest({
          id: 'dockerfile',
          provision: {
            kind: 'npm',
            lockfileUrl: 'https://example.com/dockerfile.lock.json',
            sha256: 'd'.repeat(64),
            executablePath: 'node_modules/dockerfile-language-server-nodejs/bin/docker-langserver',
          },
        }),
      );

      expect(toProvision(validManifests(discoverPlugins(root))[0])).toBeNull();
    });
  });

  describe('toOrigin', () => {
    it('describesAnArchiveAsOnePackageFromItsHosts', () => {
      writePlugin('zls', manifest());
      const origin: PluginOrigin | undefined = toOrigin(validManifests(discoverPlugins(root))[0]);

      expect(origin).toEqual({ hosts: ['example.com'], packageCount: 1 });
    });

    it('describesAnNpmTreeByItsWholeSize', () => {
      // The entry names one publisher; the tree is written by everyone in it. The count is the honest
      // answer to what is actually being accepted.
      writePlugin('dockerfile', npmManifest());
      const origin: PluginOrigin | undefined = toOrigin(
        validManifests(discoverPlugins(root))[0],
        (): unknown => LOCKFILE,
      );

      expect(origin).toEqual({ hosts: ['registry.npmjs.org'], packageCount: 2 });
    });

    it('describesNothingWhenTheLockfileIsNotCompiledIn', () => {
      // Answered while listing plugins, so it must never trigger a download. No bundled lockfile means
      // no count rather than a wrong one.
      writePlugin('dockerfile', npmManifest());

      expect(toOrigin(validManifests(discoverPlugins(root))[0])).toBeUndefined();
    });
  });

  describe('per-contribution entry points', () => {
    it('resolveEachServerToItsOwnBinaryFromOneTree', () => {
      // The whole point of #454: one installed payload, several servers, each starting its own
      // program. Sharing the provision's entry point would start the same binary three times.
      writePlugin(
        'web',
        manifest({
          id: 'web',
          provision: {
            kind: 'npm',
            lockfileUrl: 'https://example.com/web.lock.json',
            sha256: 'e'.repeat(64),
          },
          contributes: {
            languageServers: [
              {
                id: 'html',
                displayName: 'HTML',
                languages: ['html'],
                priority: 100,
                entryPoint: 'node_modules/web/bin/html',
                command: { kind: 'node' },
              },
              {
                id: 'css',
                displayName: 'CSS',
                languages: ['css'],
                priority: 100,
                entryPoint: 'node_modules/web/bin/css',
                command: { kind: 'node' },
              },
            ],
          },
        }),
      );
      const descriptors: readonly LanguageServerDescriptor[] = toLanguageServerDescriptors(
        validManifests(discoverPlugins(root))[0],
      );
      const resolveContext: Parameters<LanguageServerDescriptor['resolve']>[0] = {
        rootPath: '/w',
        settings: { get: (): never => ({}) as never } as never,
        provisioner: stubProvisioner('/tree'),
        nodePackageServer: (entry: string) => ({
          command: '/electron',
          args: [entry, '--stdio'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        }),
        installedPath: (): string | null => '/tree',
      };
      const resolved: readonly string[] = descriptors.map((descriptor): string =>
        JSON.stringify(descriptor.resolve(resolveContext)),
      );

      expect(resolved[0]).toContain('node_modules/web/bin/html');
      expect(resolved[1]).toContain('node_modules/web/bin/css');
    });
  });

  describe('a payload naming no single entry point', () => {
    /**
     * Loads a manifest whose servers each name their own entry point and whose provision names none.
     * @returns Returns the manifest.
     */
    function multiServer(): PluginManifest {
      writePlugin(
        'web',
        manifest({
          id: 'web',
          provision: {
            kind: 'npm',
            lockfileUrl: 'https://example.com/web.lock.json',
            sha256: 'e'.repeat(64),
          },
          contributes: {
            languageServers: [
              {
                id: 'html',
                displayName: 'HTML',
                languages: ['html'],
                priority: 100,
                entryPoint: 'node_modules/web/bin/html',
                command: { kind: 'node' },
              },
            ],
          },
        }),
      );
      return validManifests(discoverPlugins(root))[0];
    }

    it('isOfferedRatherThanReportedUnsupported', () => {
      // The regression: `supported` asked whether the payload had an entry point, and a tree that
      // names none at the provision has exactly one correct answer to that — none. The Plugin Manager
      // showed "Not supported here" for a plugin that installs perfectly well.
      const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(multiServer());

      expect(descriptor.supported?.({ provisioner: stubProvisioner('/tree') } as never)).not.toBe(
        false,
      );
    });

    it('isNotReportedInstalledMerelyBecauseItHasNoEntryPoint', async () => {
      const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(multiServer());

      expect(await descriptor.detect?.({ provisioner: stubProvisioner(null) } as never)).toBe(
        false,
      );
    });
  });

  describe('toPluginDescriptor', () => {
    /**
     * Loads the sample manifest through discovery, so the descriptor is built from a validated one.
     * @returns Returns the manifest.
     */
    function loaded(overrides: Record<string, unknown> = {}): PluginManifest {
      writePlugin('zls', manifest(overrides));
      return validManifests(discoverPlugins(root))[0];
    }

    it('describesThePluginTheManagerLists', () => {
      const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(loaded());

      expect(descriptor.id).toBe('zls');
      expect(descriptor.name).toBe('Zig Language Server');
      expect(descriptor.version).toBe('0.14.0');
    });

    it('carriesTheContributionsSoTheSlotJoinSeesThem', () => {
      const contributions: readonly PluginContribution[] =
        toPluginDescriptor(loaded()).contributions;

      expect(contributions).toEqual([
        {
          slot: 'language-server',
          id: 'zls',
          displayName: 'Zig Language Server',
          languages: ['zig'],
          priority: 100,
        },
      ]);
    });

    it('surfacesARequiredRuntimeAsTheRowsNote', () => {
      const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(
        loaded({ requires: [{ runtime: 'java', minimumVersion: '21' }] }),
      );

      expect(descriptor.detail).toContain('java 21+');
    });

    it('saysNothingAboutRuntimesWhenItNeedsNone', () => {
      expect(toPluginDescriptor(loaded()).detail).toBeUndefined();
    });

    it('prefersWhatTheManifestSaysOverWhatCouldBeDerived', () => {
      // The author knows things no rule could derive; a derived sentence is the fallback, not the truth.
      const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(
        loaded({
          detail: 'A large download.',
          requires: [{ runtime: 'java', minimumVersion: '21' }],
        }),
      );

      expect(descriptor.detail).toBe('A large download.');
    });
  });

  describe('toLanguageServerDescriptors', () => {
    /**
     * Builds a resolve context whose installed path is fixed, so resolution can be exercised without a
     * real install.
     * @param installedPath The path to report, or null for not installed.
     * @returns Returns the context.
     */
    function context(
      installedPath: string | null,
    ): Parameters<LanguageServerDescriptor['resolve']>[0] {
      return {
        rootPath: '/w',
        settings: { get: (): never => ({}) as never } as never,
        provisioner: stubProvisioner(installedPath),
        nodePackageServer: (entry: string) => ({
          command: '/electron',
          args: [entry, '--stdio'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        }),
        installedPath: (): string | null => installedPath,
      };
    }

    it('resolvesAnExecutableCommandToTheProvisionedBinary', async () => {
      writePlugin('zls', manifest());
      const descriptors: readonly LanguageServerDescriptor[] = toLanguageServerDescriptors(
        validManifests(discoverPlugins(root))[0],
      );

      const resolution: LspResolution = await descriptors[0].resolve(context('/installed/zls'));
      expect(resolution.spec).toEqual({
        command: '/installed/zls',
        args: ['--enable-debug-log'],
        env: undefined,
      });
    });

    it('resolvesANodeCommandThroughTheBundledRuntime', async () => {
      writePlugin(
        'jsonls',
        manifest({
          id: 'jsonls',
          contributes: {
            languageServers: [
              {
                id: 'jsonls',
                displayName: 'JSON',
                languages: ['json'],
                command: { kind: 'node', args: ['--extra'] },
              },
            ],
          },
        }),
      );
      const descriptors: readonly LanguageServerDescriptor[] = toLanguageServerDescriptors(
        validManifests(discoverPlugins(root))[0],
      );

      const resolution: LspResolution = await descriptors[0].resolve(
        context('/installed/server.js'),
      );
      expect(resolution.spec?.command).toBe('/electron');
      expect(resolution.spec?.args).toEqual(['/installed/server.js', '--stdio', '--extra']);
    });

    it('reportsNotInstalledRatherThanSpawningNothing', async () => {
      writePlugin('zls', manifest());
      const descriptors: readonly LanguageServerDescriptor[] = toLanguageServerDescriptors(
        validManifests(discoverPlugins(root))[0],
      );

      const resolution: LspResolution = await descriptors[0].resolve(context(null));
      expect(resolution.spec).toBeNull();
      expect(resolution.error).toContain('not installed');
    });
  });

  describe('toDebugAdapterEntries', () => {
    /**
     * Writes a plugin contributing one debug adapter and returns its catalogue entries.
     * @param adapter The adapter contribution.
     * @param installed The path the plugin's archive is installed at, or null.
     * @returns Returns the entries.
     */
    function entriesFor(
      adapter: Record<string, unknown>,
      installed: string | null = '/installed/dbg',
    ): readonly DebugAdapterCatalogueEntry[] {
      writePlugin('dbg', manifest({ id: 'dbg', contributes: { debugAdapters: [adapter] } }));
      return toDebugAdapterEntries(validManifests(discoverPlugins(root))[0], () =>
        stubProvisioner(installed),
      );
    }

    it('registersTheAdapterTheManifestAdvertises', () => {
      // The manifest accepts `contributes.debugAdapters` and the Plugin Manager lists them, so they
      // have to actually reach the registry — otherwise the format promises something that never works.
      const entries: readonly DebugAdapterCatalogueEntry[] = entriesFor({
        id: 'zdb',
        displayName: 'Zig Debugger',
        languages: ['zig'],
        priority: 100,
        command: { kind: 'executable', args: ['--dap'] },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe('zdb');
      expect(entries[0]?.languages).toEqual(['zig']);
    });

    it('locatesTheAdapterInsideThePluginsOwnPayload', async () => {
      // A plugin is one archive however many things it contributes, so the adapter is found where that
      // archive was installed rather than by searching the PATH.
      const entries: readonly DebugAdapterCatalogueEntry[] = entriesFor({
        id: 'zdb',
        displayName: 'Zig Debugger',
        languages: ['zig'],
        command: { kind: 'executable' },
      });

      await expect(entries[0]?.locate?.()).resolves.toBe('/installed/dbg');
    });

    it('reportsNotLocatedWhenThePluginIsNotInstalled', async () => {
      const entries: readonly DebugAdapterCatalogueEntry[] = entriesFor(
        {
          id: 'zdb',
          displayName: 'Zig Debugger',
          languages: ['zig'],
          command: { kind: 'executable' },
        },
        null,
      );

      await expect(entries[0]?.locate?.()).resolves.toBeNull();
    });

    it('spawnsAnExecutableAdapterDirectly', () => {
      const entries: readonly DebugAdapterCatalogueEntry[] = entriesFor({
        id: 'zdb',
        displayName: 'Zig Debugger',
        languages: ['zig'],
        command: { kind: 'executable', args: ['--dap'] },
      });
      const spec: DebugAdapterSpec = entries[0].buildSpec('/installed/dbg');

      expect(spec.command).toBe('/installed/dbg');
      expect(spec.args).toEqual(['--dap']);
    });

    it('spawnsANodeAdapterUnderTheBundledRuntime', () => {
      const entries: readonly DebugAdapterCatalogueEntry[] = entriesFor({
        id: 'jsdbg',
        displayName: 'JS Debugger',
        languages: ['javascript'],
        command: { kind: 'node', args: ['0', '127.0.0.1'] },
        transport: 'tcp-server',
      });
      const spec: DebugAdapterSpec = entries[0].buildSpec('/installed/server.js');

      expect(spec.command).toBe(process.execPath);
      expect(spec.args).toEqual(['/installed/server.js', '0', '127.0.0.1']);
      expect(spec.env?.['ELECTRON_RUN_AS_NODE']).toBe('1');
      expect(spec.transport).toBe('tcp-server');
    });

    it('contributesNoAdaptersWhenTheManifestDeclaresNone', () => {
      writePlugin('zls', manifest());

      expect(
        toDebugAdapterEntries(validManifests(discoverPlugins(root))[0], () =>
          stubProvisioner(null),
        ),
      ).toEqual([]);
    });
  });
});

describe('a sideloaded plugin carrying its own payload', () => {
  /**
   * Builds a manifest contributing one decoder, provisioned from an archive that does not exist.
   * @returns Returns the manifest.
   */
  function decoderManifest(): PluginManifest {
    return {
      id: 'local.decoder',
      name: 'Local Decoder',
      description: 'A decoder built locally.',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      provision: {
        kind: 'archive',
        downloads: {
          'darwin-arm64': {
            url: 'https://example.invalid/never-published.tar.gz',
            sha256: '0'.repeat(64),
            archive: 'tar.gz',
            executablePath: 'payload/main.js',
          },
        },
      },
      contributes: {
        decoders: [
          {
            id: 'local.decoder',
            displayName: 'Local Decoder',
            formats: ['jvm'],
            priority: 100,
            command: { kind: 'node' },
          },
        ],
      },
      requires: [],
    };
  }

  /**
   * A provisioner that reports nothing downloaded, which is the real situation for a plugin that was
   * never published.
   */
  const nothingDownloaded: LspProvisioner = {
    archiveTarget: (): string | null => null,
    isArchiveInstalled: (): boolean => false,
  } as unknown as LspProvisioner;

  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sideload-payload-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('payloadOps_reportsInstalledWhenThePayloadIsBesideTheManifest', () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const ops: PayloadOps = payloadOps(decoderManifest(), root);
    // Installed by the only definition that matters: the thing to run is on disk.
    expect(ops.isInstalled(nothingDownloaded)).toBe(true);
    expect(ops.target(nothingDownloaded)).toBe(path.join(root, 'payload', 'main.js'));
  });

  it('payloadOps_fallsBackToTheProvisionerWhenNoPayloadIsPresent', () => {
    // An empty sideload directory must not claim the plugin is installed, or the Plugin Manager would
    // report a working plugin that cannot run.
    const ops: PayloadOps = payloadOps(decoderManifest(), root);
    expect(ops.isInstalled(nothingDownloaded)).toBe(false);
  });

  it('payloadOps_neverDownloadsWhenThePayloadIsAlreadyThere', async () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const ops: PayloadOps = payloadOps(decoderManifest(), root);
    // Installing must resolve to what is already on disk rather than fetching the unpublished archive.
    expect(await ops.ensure(nothingDownloaded)).toBe(path.join(root, 'payload', 'main.js'));
  });

  it('toPluginDescriptor_reportsTheSideloadedPluginAsInstalled', async () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const descriptor: ReturnType<typeof toPluginDescriptor> = toPluginDescriptor(
      decoderManifest(),
      root,
    );
    // The Plugin Manager and the decoder registry must agree: one saying "not installed" while the
    // other happily runs it is how a working plugin ends up offering an install that must fail.
    expect(await descriptor.detect?.({ provisioner: nothingDownloaded } as never)).toBe(true);
    expect(descriptor.supported?.({ provisioner: nothingDownloaded } as never)).toBe(true);
  });

  it('toDecoderDescriptors_resolvesTheLocalPayload', () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const descriptors: readonly DecoderDescriptor[] = toDecoderDescriptors(
      decoderManifest(),
      (): LspProvisioner => nothingDownloaded,
      (entryPoint: string): NodeRuntimeSpec => ({
        command: '/runtime',
        args: [entryPoint],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }),
      root,
    );
    const resolution: DecoderResolution = descriptors[0].resolve();
    expect(resolution.available).toBe(true);
    if (resolution.available) {
      expect(resolution.spec.args).toEqual([path.join(root, 'payload', 'main.js')]);
      expect(resolution.spec.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    }
  });

  it('toDecoderDescriptors_isUnavailableWithNeitherPayloadNorDownload', () => {
    const descriptors: readonly DecoderDescriptor[] = toDecoderDescriptors(
      decoderManifest(),
      (): LspProvisioner => nothingDownloaded,
      (entryPoint: string): NodeRuntimeSpec => ({ command: '/runtime', args: [entryPoint] }),
      root,
    );
    expect(descriptors[0].resolve().available).toBe(false);
  });

  /**
   * A sideloaded manifest contributing a container engine, whose payload is its client CLI.
   * @returns Returns the manifest.
   */
  function engineManifest(): PluginManifest {
    return {
      ...decoderManifest(),
      id: 'local.engine',
      contributes: {
        containerEngines: [
          {
            id: 'local.engine',
            displayName: 'Local Engine',
            priority: 10,
            discovery: {
              hostVariable: 'LOCAL_HOST',
              dockerContext: true,
              sockets: { darwin: ['/run/local.sock'], linux: ['/run/local.sock'] },
            },
            startCommands: { darwin: 'local machine start' },
          },
        ],
      },
    };
  }

  it('toContainerEngineDescriptors_describesTheEngineFromItsManifest', () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const descriptors: readonly ContainerEngineDescriptor[] = toContainerEngineDescriptors(
      engineManifest(),
      (): LspProvisioner => nothingDownloaded,
      root,
    );

    expect(descriptors).toHaveLength(1);
    // The CLI is the provisioned client's absolute path, not a bare name: the point of provisioning it
    // is that nothing has to be on the PATH.
    expect(descriptors[0].cli).toBe(path.join(root, 'payload', 'main.js'));
    expect(descriptors[0].discovery.hostVariable).toBe('LOCAL_HOST');
    expect(descriptors[0].discovery.defaults('darwin')).toEqual(['/run/local.sock']);
    expect(descriptors[0].startCommand('darwin')).toBe('local machine start');
  });

  it('toContainerEngineDescriptors_reportsNoSocketsForAPlatformTheEngineOmits', () => {
    mkdirSync(path.join(root, 'payload'), { recursive: true });
    writeFileSync(path.join(root, 'payload', 'main.js'), '', 'utf8');
    const descriptors: readonly ContainerEngineDescriptor[] = toContainerEngineDescriptors(
      engineManifest(),
      (): LspProvisioner => nothingDownloaded,
      root,
    );

    // No candidates is how "this engine does not run here" is expressed, which discovery turns into
    // no endpoint at all rather than into a path that cannot exist.
    expect(descriptors[0].discovery.defaults('win32')).toEqual([]);
    expect(descriptors[0].startCommand('win32')).toBeNull();
  });

  it('toContainerEngineDescriptors_dropsAnEngineWhosePayloadIsNotInstalled', () => {
    // Unlike a decoder, which registers as unavailable and has the panel offer the install: an engine
    // left in the catalogue would be selectable, and would report "not running" about something that
    // is not there at all.
    const descriptors: readonly ContainerEngineDescriptor[] = toContainerEngineDescriptors(
      engineManifest(),
      (): LspProvisioner => nothingDownloaded,
      root,
    );

    expect(descriptors).toEqual([]);
  });
});
