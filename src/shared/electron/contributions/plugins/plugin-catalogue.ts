import { PluginContribution } from '@shared/api/plugin-channels';
import {
  DebugAdapterCatalogueEntry,
  debugAdapterCatalogue,
} from '../../debug/debug-adapter-registry';
import { DebugAdapterProvision, DebugProvisioner } from '../../debug/debug-provisioner';
import {
  DEBUGPY_VERSION,
  installDebugpy,
  isDebugpyInstalled,
  uninstallDebugpy,
} from '../../debug/debugpy-install';
import {
  CLANGD_PROVISION,
  LUA_PROVISION,
  PERLNAVIGATOR_PROVISION,
  PYRIGHT_PROVISION,
  SQLS_PROVISION,
  TY_PROVISION,
  TYPESCRIPT_SERVER_PROVISION,
} from '../../lsp/language-server-downloads';
import {
  GOPLS_VERSION,
  JDTLS_VERSION,
  KOTLIN_LS_VERSION,
  LspProvisioner,
  ROSLYN_VERSION,
  RUST_ANALYZER_VERSION,
} from '../../lsp/lsp-provisioner';
import { ArchiveProvision } from '../../provisioning/archive-provision';

/**
 * The surface a {@link PluginDescriptor} reaches the application through when it detects, installs, or
 * removes itself. Everything a descriptor needs is handed to it, so the catalogue is plain data plus
 * closures and never constructs a provisioner of its own.
 */
export interface PluginContext {
  /**
   * Gets the provisioner that downloads language servers and detects the runtimes some of them need.
   */
  readonly provisioner: LspProvisioner;

  /**
   * Gets the provisioner that downloads debug adapters.
   */
  readonly debugProvisioner: DebugProvisioner;
}

/**
 * Describes one plugin the application knows about: what it is, what it contributes, and how it is
 * installed and removed.
 *
 * **Every plugin is installable and removable.** Nothing is bundled into the application and nothing is
 * borrowed from whatever happens to be on the machine — that is the point of a plugin, and it is why
 * there is no "built-in" or "external" kind here. A plugin the user has not installed contributes
 * nothing, and every plugin can be removed again.
 *
 * Deliberately **data plus closures**. Everything the Plugin Manager shows — identity, contributions,
 * version — is plain data a declarative manifest could carry, and most plugins are installed by a plain
 * {@link ArchiveProvision} recipe a manifest could carry too. The closures are the first-party escape
 * hatch for the few that cannot be expressed that way (gopls is *built* with the user's Go toolchain),
 * which is the line a third-party manifest format (#294) will have to draw.
 */
export interface PluginDescriptor {
  /**
   * Gets the stable plugin identifier.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly name: string;

  /**
   * Gets a one-line description of what the plugin is for.
   */
  readonly description: string;

  /**
   * Gets the pinned version Studio installs.
   */
  readonly version: string;

  /**
   * Gets the implementations this plugin contributes.
   */
  readonly contributions: readonly PluginContribution[];

  /**
   * Gets a note shown alongside the plugin — typically a runtime it needs once installed — or undefined.
   */
  readonly detail?: string;

  /**
   * Gets whether the plugin can be installed on this machine at all. A plugin whose publisher ships no
   * build for this platform is not "not installed yet" — it is not on offer, and an Install button that
   * could only ever fail is worse than none. Absent means always installable.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns true when this platform is supported.
   */
  supported?(context: PluginContext): boolean;

  /**
   * Detects whether the plugin is installed, **without installing anything**. A detection that could
   * trigger a download would turn opening the Plugin Manager into an unasked-for install.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns true when the plugin is installed.
   */
  detect(context: PluginContext): Promise<boolean>;

  /**
   * Installs the plugin, returning the path its installation produced.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns the installed path, or null when the install failed.
   */
  install(context: PluginContext): Promise<string | null>;

  /**
   * Removes what {@link install} put on disk.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns a promise that resolves once the plugin is gone.
   */
  uninstall(context: PluginContext): Promise<void>;
}

/**
 * Builds a language-server contribution.
 * @param id The server identifier the LSP registry knows it by.
 * @param displayName The display name.
 * @param languages The languages the server serves.
 * @param priority The priority used to pick a default among installed implementations.
 * @returns Returns the contribution.
 */
function languageServer(
  id: string,
  displayName: string,
  languages: readonly string[],
  priority: number,
): PluginContribution {
  return { slot: 'language-server', id, displayName, languages, priority };
}

/**
 * Builds the descriptor for a plugin installed from a pinned, checksum-verified archive — the common
 * case, and the one a declarative manifest could describe end to end.
 * @param id The plugin identifier.
 * @param name The display name.
 * @param description The one-line description.
 * @param provision The pinned provisioning recipe.
 * @param contributions The implementations the plugin contributes.
 * @param detail An optional note about runtimes the plugin needs once installed.
 * @returns Returns the descriptor.
 */
function archivePlugin(
  id: string,
  name: string,
  description: string,
  provision: ArchiveProvision,
  contributions: readonly PluginContribution[],
  detail?: string,
): PluginDescriptor {
  return {
    id,
    name,
    description,
    version: provision.version,
    contributions,
    detail,
    supported: (context: PluginContext): boolean =>
      context.provisioner.archiveTarget(provision) !== null,
    detect: (context: PluginContext): Promise<boolean> =>
      Promise.resolve(context.provisioner.isArchiveInstalled(provision)),
    install: (context: PluginContext): Promise<string | null> =>
      context.provisioner.ensureArchive(provision),
    uninstall: (context: PluginContext): Promise<void> =>
      context.provisioner.removeArchive(provision),
  };
}

/**
 * Looks up a first-party debug adapter's pinned provisioning recipe from the adapter catalogue, so the
 * pinned URL and checksum are declared once and the plugin entry cannot drift from what the registry
 * actually spawns.
 * @param adapterId The adapter identifier.
 * @returns Returns the provisioning recipe, or undefined when the adapter ships none.
 */
function adapterProvision(adapterId: string): DebugAdapterProvision | undefined {
  return debugAdapterCatalogue().find(
    (entry: DebugAdapterCatalogueEntry): boolean => entry.id === adapterId,
  )?.provision;
}

/**
 * Builds the descriptor for a debug adapter Studio downloads, wiring it to the adapter's own recipe.
 * @param id The plugin (and adapter) identifier.
 * @param name The display name.
 * @param description The one-line description.
 * @param languages The languages the adapter debugs.
 * @returns Returns the descriptor.
 */
function adapterPlugin(
  id: string,
  name: string,
  description: string,
  languages: readonly string[],
): PluginDescriptor {
  const provision: DebugAdapterProvision | undefined = adapterProvision(id);
  return {
    id,
    name,
    description,
    version: provision?.version ?? 'unknown',
    contributions: [{ slot: 'debug-adapter', id, displayName: name, languages, priority: 100 }],
    detect: (context: PluginContext): Promise<boolean> =>
      provision === undefined
        ? Promise.resolve(false)
        : context.debugProvisioner.isProvisioned(provision),
    install: (context: PluginContext): Promise<string | null> =>
      provision === undefined ? Promise.resolve(null) : context.debugProvisioner.ensure(provision),
    uninstall: (context: PluginContext): Promise<void> =>
      provision === undefined
        ? Promise.resolve()
        : context.debugProvisioner.removeProvisioned(provision),
  };
}

/**
 * The plugins the application knows about — the **available** layer of the plugin model.
 *
 * Being in this list means the Plugin Manager offers the plugin; it says nothing about whether it is
 * present. What is *installed* is decided per machine by each descriptor's `detect`, and only installed
 * plugins have their contributions registered into a slot. That separation is the whole point: a fresh
 * installation ships no language servers at all, and someone who writes only Python never carries a C++
 * toolchain they did not ask for.
 *
 * @returns Returns the catalogue descriptors.
 */
export function pluginCatalogue(): readonly PluginDescriptor[] {
  return [
    archivePlugin(
      'pyright',
      'Pyright',
      "Microsoft's Python type checker and language server.",
      PYRIGHT_PROVISION,
      [languageServer('pyright', 'Pyright', ['python'], 100)],
    ),
    archivePlugin(
      'ty',
      'ty',
      "Astral's Rust-built Python type checker and language server. An alternative to Pyright.",
      TY_PROVISION,
      [languageServer('ty', 'ty (Astral)', ['python'], 50)],
    ),
    archivePlugin(
      'typescript-language-server',
      'TypeScript Language Server',
      'TypeScript and JavaScript language support.',
      TYPESCRIPT_SERVER_PROVISION,
      [
        languageServer(
          'typescript',
          'TypeScript Language Server',
          ['typescript', 'javascript'],
          100,
        ),
      ],
    ),
    archivePlugin(
      'clangd',
      'clangd',
      'C and C++ language support, from the LLVM project.',
      CLANGD_PROVISION,
      [languageServer('clangd', 'clangd', ['cpp', 'c'], 100)],
      'A large download — it carries the Clang toolchain headers.',
    ),
    archivePlugin(
      'lua-language-server',
      'Lua Language Server',
      'Lua language support, from the sumneko project.',
      LUA_PROVISION,
      [languageServer('lua-language-server', 'Lua Language Server', ['lua'], 100)],
    ),
    archivePlugin(
      'sqls',
      'sqls',
      'SQL language support: completion, formatting and query execution.',
      SQLS_PROVISION,
      [languageServer('sqls', 'sqls', ['sql'], 100)],
      'Configure a database connection to get schema-aware completion.',
    ),
    archivePlugin(
      'perlnavigator',
      'Perl Navigator',
      'Perl language support: diagnostics, completion and navigation.',
      PERLNAVIGATOR_PROVISION,
      [languageServer('perlnavigator', 'Perl Navigator', ['perl'], 100)],
    ),
    {
      id: 'rust-analyzer',
      name: 'rust-analyzer',
      description: 'Rust language support.',
      version: RUST_ANALYZER_VERSION,
      contributions: [languageServer('rust', 'rust-analyzer', ['rust'], 100)],
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('rust-analyzer', RUST_ANALYZER_VERSION)),
      install: (context: PluginContext): Promise<string | null> =>
        context.provisioner.ensureRustAnalyzer(),
      uninstall: (context: PluginContext): Promise<void> =>
        context.provisioner.removeProvisioned('rust-analyzer', RUST_ANALYZER_VERSION),
    },
    {
      id: 'jdtls',
      name: 'Eclipse JDT Language Server',
      description: 'Java language support.',
      version: JDTLS_VERSION,
      contributions: [languageServer('java', 'Eclipse JDT Language Server', ['java'], 100)],
      detail: 'Needs a Java 21+ runtime to run once installed.',
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('jdtls', JDTLS_VERSION)),
      install: async (context: PluginContext): Promise<string | null> =>
        (await context.provisioner.ensureJdtls())?.launcherJar ?? null,
      uninstall: (context: PluginContext): Promise<void> =>
        context.provisioner.removeProvisioned('jdtls', JDTLS_VERSION),
    },
    {
      id: 'kotlin-language-server',
      name: 'Kotlin Language Server',
      description: 'Kotlin language support.',
      version: KOTLIN_LS_VERSION,
      contributions: [languageServer('kotlin', 'Kotlin Language Server', ['kotlin'], 100)],
      detail: 'Needs a Java 21+ runtime to run once installed.',
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('kotlin', KOTLIN_LS_VERSION)),
      install: (context: PluginContext): Promise<string | null> =>
        context.provisioner.ensureKotlin(),
      uninstall: (context: PluginContext): Promise<void> =>
        context.provisioner.removeProvisioned('kotlin', KOTLIN_LS_VERSION),
    },
    {
      id: 'roslyn',
      name: 'Roslyn Language Server',
      description: 'C# language support.',
      version: ROSLYN_VERSION,
      contributions: [languageServer('csharp', 'Roslyn Language Server', ['csharp'], 100)],
      detail: 'Needs the .NET 10+ SDK to run once installed.',
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('roslyn', ROSLYN_VERSION)),
      install: (context: PluginContext): Promise<string | null> =>
        context.provisioner.ensureRoslyn(),
      uninstall: (context: PluginContext): Promise<void> =>
        context.provisioner.removeProvisioned('roslyn', ROSLYN_VERSION),
    },
    {
      id: 'gopls',
      name: 'gopls',
      description: 'Go language support.',
      version: GOPLS_VERSION,
      contributions: [languageServer('go', 'gopls', ['go'], 100)],
      detail: 'Built with your Go toolchain, so Go must be installed to install this.',
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('gopls', GOPLS_VERSION)),
      install: async (context: PluginContext): Promise<string | null> => {
        const go: string | null = await context.provisioner.detectGo(null);
        return go === null ? null : context.provisioner.ensureGopls(go);
      },
      uninstall: async (context: PluginContext): Promise<void> => {
        await context.provisioner.removeProvisioned('gopls', GOPLS_VERSION);
        // gopls is built rather than downloaded, so removing the binary leaves the module cache and
        // compiled objects it was built from behind.
        await context.provisioner.removeGoBuildCache();
      },
    },
    {
      id: 'debugpy',
      name: 'Python Debugger (debugpy)',
      description: 'Debug Python projects.',
      version: DEBUGPY_VERSION,
      contributions: [
        {
          slot: 'debug-adapter',
          id: 'debugpy',
          displayName: 'Python (debugpy)',
          languages: ['python'],
          priority: 100,
        },
      ],
      detail: 'Installed into its own environment, so it needs Python 3.8+ to install.',
      detect: (): Promise<boolean> => Promise.resolve(isDebugpyInstalled()),
      install: (): Promise<string | null> => installDebugpy(),
      uninstall: (): Promise<void> => uninstallDebugpy(),
    },
    adapterPlugin('netcoredbg', '.NET Debugger (netcoredbg)', 'Debug .NET projects.', ['csharp']),
    adapterPlugin(
      'js-debug',
      'Node Debugger (js-debug)',
      "Debug Node projects with Microsoft's js-debug.",
      ['typescript', 'javascript'],
    ),
  ];
}
