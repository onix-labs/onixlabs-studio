import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PLUGIN_API_VERSION, PluginManifest } from '@shared/api/plugin-manifest';
import { PluginContribution } from '@shared/api/plugin-channels';
import { ArchiveProvision } from '../../provisioning/archive-provision';
import { LanguageServerDescriptor, LspResolution } from '../../lsp/language-server-descriptor';
import { DebugAdapterCatalogueEntry, DebugAdapterSpec } from '../../debug/debug-adapter-registry';
import {
  discoverPlugins,
  LoadedPlugin,
  MANIFEST_FILE,
  toDebugAdapterEntries,
  toLanguageServerDescriptors,
  toPluginDescriptor,
  toProvision,
  validManifests,
} from './plugin-loader';

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
      const provision: ArchiveProvision = toProvision(validManifests(discoverPlugins(root))[0]);

      expect(provision.id).toBe('zls');
      expect(provision.version).toBe('0.14.0');
      expect(Object.keys(provision.downloads).sort()).toEqual(['darwin-arm64', 'darwin-x64']);
      expect(provision.downloads['darwin-arm64']?.executablePath).toBe('zls');
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
        provisioner: {} as never,
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
      return toDebugAdapterEntries(
        validManifests(discoverPlugins(root))[0],
        (): string | null => installed,
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
        toDebugAdapterEntries(validManifests(discoverPlugins(root))[0], (): null => null),
      ).toEqual([]);
    });
  });
});
