import { PluginContribution, PluginInstallKind } from '@shared/api/plugin-channels';
import {
  DebugAdapterCatalogueEntry,
  debugAdapterCatalogue,
} from '../../debug/debug-adapter-registry';
import { DebugAdapterProvision, DebugProvisioner } from '../../debug/debug-provisioner';
import {
  GOPLS_VERSION,
  JDTLS_VERSION,
  KOTLIN_LS_VERSION,
  LspProvisioner,
  ROSLYN_VERSION,
  RUST_ANALYZER_VERSION,
} from '../../lsp/lsp-provisioner';

/**
 * The surface a {@link PluginDescriptor} reaches the application through when it detects or installs
 * itself. Everything a descriptor needs is handed to it, so the catalogue is plain data plus closures
 * and never constructs a provisioner of its own.
 */
export interface PluginContext {
  /**
   * Gets the provisioner that downloads language servers and detects their runtimes.
   */
  readonly provisioner: LspProvisioner;

  /**
   * Gets the provisioner that locates and downloads debug adapters.
   */
  readonly debugProvisioner: DebugProvisioner;

  /**
   * Resolves a bundled npm package's CLI entry point, for detecting plugins that ship inside the
   * application.
   * @param packageName The package whose entry point is resolved.
   * @param binName The named `bin` entry, defaulting to the package name.
   * @returns Returns the absolute path, or null when the package is not present.
   */
  packageBin(packageName: string, binName?: string): string | null;
}

/**
 * Describes one plugin the application knows about: what it is, what it contributes, and how it gets
 * onto the machine.
 *
 * Deliberately **data plus optional closures**. Everything the Plugin Manager shows — identity, the
 * contributions, the install kind — is plain data a declarative manifest could carry. `detect` and
 * `install` are the first-party escape hatch for provisioning a manifest cannot express, which is the
 * boundary a third-party manifest format (#294) will have to draw.
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
   * Gets how the plugin gets onto the machine.
   */
  readonly installKind: PluginInstallKind;

  /**
   * Gets the pinned version Studio installs, or null when Studio does not control the version.
   */
  readonly version: string | null;

  /**
   * Gets the implementations this plugin contributes.
   */
  readonly contributions: readonly PluginContribution[];

  /**
   * Gets a note shown alongside the plugin — typically how to obtain an external tool — or undefined.
   */
  readonly detail?: string;

  /**
   * Detects whether the plugin is present, **without installing anything**. A detection that could
   * trigger a download would turn opening the Plugin Manager into an unasked-for install.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns true when the plugin is present and usable.
   */
  detect(context: PluginContext): Promise<boolean>;

  /**
   * Installs the plugin, returning the path its installation produced. Absent for a plugin Studio
   * cannot install (a built-in, which is already there, or an external tool the user owns).
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns the installed path, or null when the install failed.
   */
  install?(context: PluginContext): Promise<string | null>;

  /**
   * Removes what {@link install} put on disk. Absent for a plugin Studio did not install, so the
   * Plugin Manager never offers to remove something it does not own.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns a promise that resolves once the plugin is gone.
   */
  uninstall?(context: PluginContext): Promise<void>;
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
 * Builds a debug-adapter contribution.
 * @param id The adapter identifier the debug registry knows it by.
 * @param displayName The display name.
 * @param languages The languages the adapter debugs.
 * @param priority The priority used to pick a default among installed implementations.
 * @returns Returns the contribution.
 */
function debugAdapter(
  id: string,
  displayName: string,
  languages: readonly string[],
  priority: number,
): PluginContribution {
  return { slot: 'debug-adapter', id, displayName, languages, priority };
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
 * Builds the descriptor for a debug adapter Studio downloads, wiring its detection and install to the
 * adapter's own pinned recipe.
 * @param id The plugin (and adapter) identifier.
 * @param name The display name.
 * @param description The one-line description.
 * @param languages The languages the adapter debugs.
 * @returns Returns the descriptor.
 */
function managedAdapter(
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
    installKind: 'managed',
    version: provision?.version ?? null,
    contributions: [debugAdapter(id, name, languages, 100)],
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
 * plugins have their contributions registered into a slot. That separation is the whole point: a user
 * who has not installed `ty` is never offered it as a choice of Python language server.
 *
 * @returns Returns the catalogue descriptors.
 */
export function pluginCatalogue(): readonly PluginDescriptor[] {
  return [
    {
      id: 'pyright',
      name: 'Pyright',
      description: "Microsoft's Python type checker and language server. Ships with Studio.",
      installKind: 'built-in',
      version: null,
      contributions: [languageServer('pyright', 'Pyright', ['python'], 100)],
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.packageBin('pyright', 'pyright-langserver') !== null),
    },
    {
      id: 'ty',
      name: 'ty',
      description:
        "Astral's Rust-built Python type checker and language server. An alternative to Pyright.",
      installKind: 'external',
      version: null,
      contributions: [languageServer('ty', 'ty (Astral)', ['python'], 50)],
      detail:
        'Install it yourself — for example `uv tool install ty` — then Studio will detect it.',
      detect: async (context: PluginContext): Promise<boolean> =>
        (await context.provisioner.detectExecutable('ty')) !== null,
    },
    {
      id: 'typescript-language-server',
      name: 'TypeScript Language Server',
      description: 'TypeScript and JavaScript language support. Ships with Studio.',
      installKind: 'built-in',
      version: null,
      contributions: [
        languageServer(
          'typescript',
          'TypeScript Language Server',
          ['typescript', 'javascript'],
          100,
        ),
      ],
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.packageBin('typescript-language-server') !== null),
    },
    {
      id: 'clangd',
      name: 'clangd',
      description: 'C and C++ language support. Part of LLVM, which you install yourself.',
      installKind: 'external',
      version: null,
      contributions: [languageServer('clangd', 'clangd', ['cpp', 'c'], 100)],
      detail: 'Install LLVM or the Xcode Command Line Tools, or set its path in Settings.',
      detect: async (context: PluginContext): Promise<boolean> =>
        (await context.provisioner.detectClangd(null)) !== null,
    },
    {
      id: 'rust-analyzer',
      name: 'rust-analyzer',
      description: 'Rust language support. Downloaded and checksum-verified by Studio.',
      installKind: 'managed',
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
      description: 'Java language support. Downloaded by Studio; needs a Java 21+ runtime to run.',
      installKind: 'managed',
      version: JDTLS_VERSION,
      contributions: [languageServer('java', 'Eclipse JDT Language Server', ['java'], 100)],
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
      description:
        'Kotlin language support. Downloaded by Studio; needs a Java 21+ runtime to run.',
      installKind: 'managed',
      version: KOTLIN_LS_VERSION,
      contributions: [languageServer('kotlin', 'Kotlin Language Server', ['kotlin'], 100)],
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
      description: 'C# language support. Downloaded by Studio; needs the .NET 10+ SDK to run.',
      installKind: 'managed',
      version: ROSLYN_VERSION,
      contributions: [languageServer('csharp', 'Roslyn Language Server', ['csharp'], 100)],
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
      description: 'Go language support. Built by Studio using your Go toolchain.',
      installKind: 'managed',
      version: GOPLS_VERSION,
      contributions: [languageServer('go', 'gopls', ['go'], 100)],
      detail: 'Needs the Go toolchain installed, since gopls is built with it.',
      detect: (context: PluginContext): Promise<boolean> =>
        Promise.resolve(context.provisioner.isProvisioned('gopls', GOPLS_VERSION)),
      install: async (context: PluginContext): Promise<string | null> => {
        const go: string | null = await context.provisioner.detectGo(null);
        return go === null ? null : context.provisioner.ensureGopls(go);
      },
      uninstall: (context: PluginContext): Promise<void> =>
        context.provisioner.removeProvisioned('gopls', GOPLS_VERSION),
    },
    managedAdapter(
      'netcoredbg',
      '.NET Debugger (netcoredbg)',
      'Debug .NET projects. Downloaded and checksum-verified by Studio.',
      ['csharp'],
    ),
    managedAdapter(
      'js-debug',
      'Node Debugger (js-debug)',
      "Debug Node projects with Microsoft's js-debug. Downloaded and checksum-verified by Studio.",
      ['typescript', 'javascript'],
    ),
  ];
}
