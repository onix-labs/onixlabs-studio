import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectModel } from '@shared/api/project-system';
import { logger } from '../logger';
import { projectSystems } from '../project-system/default-project-systems';
import {
  LanguageServerContext,
  LanguageServerDescriptor,
  LspPostInitialize,
  LspResolution,
  resolved,
  unavailable,
} from './language-server-descriptor';
import { CUSTOM_AFTER_COMMON_TARGETS, writeCsharpBraceConfig } from './csharp-editor-config';
import { JdtlsInstall } from './lsp-provisioner';
import { TYPESCRIPT_PROVISION, TYPESCRIPT_SERVER_PROVISION } from './language-server-downloads';

/**
 * Holds the JVM arguments passed to the Eclipse JDT Language Server's Equinox launcher, before the
 * launcher JAR, configuration, and data-directory arguments.
 */
const JDTLS_JVM_ARGS: readonly string[] = [
  '-Declipse.application=org.eclipse.jdt.ls.core.id1',
  '-Dosgi.bundles.defaultStartLevel=4',
  '-Declipse.product=org.eclipse.jdt.ls.core.product',
  '-Dlog.level=ALL',
  '-Xmx1G',
  '--add-modules=ALL-SYSTEM',
  '--add-opens',
  'java.base/java.util=ALL-UNNAMED',
  '--add-opens',
  'java.base/java.lang=ALL-UNNAMED',
];

/**
 * The priority given to the implementation shipped as a language's default, chosen when the user has
 * expressed no preference.
 */
const DEFAULT_PRIORITY: number = 100;

/**
 * Translates a .NET project model into the notification that tells Roslyn what to open: the solution
 * as a unit when one backs the model (so it loads exactly and in order), otherwise the loose projects.
 * Returns undefined when there is nothing to open (the server still starts, serving single files).
 * @param model The .NET project model, or null when none was found.
 * @returns Returns the post-initialize notification, or undefined.
 */
export function csharpOpenPlan(
  model: ProjectModel | null,
): readonly LspPostInitialize[] | undefined {
  if (model === null) {
    return undefined;
  }
  if (model.solution !== null) {
    return [
      { method: 'solution/open', params: { solution: pathToFileURL(model.solution.path).href } },
    ];
  }
  if (model.projects.length > 0) {
    return [
      {
        method: 'project/open',
        params: { projects: model.projects.map((p): string => pathToFileURL(p.path).href) },
      },
    ];
  }
  return undefined;
}

/**
 * Decides which `tsserver` the TypeScript language server should drive for a workspace: the
 * workspace's own TypeScript when it has one (version-accurate diagnostics for that project), else
 * the bundled compiler installed alongside the server, else nothing — in which case the server is
 * left to its own search and a workspace without TypeScript gets no service.
 * @param rootPath The workspace root.
 * @param bundled The bundled compiler's `tsserver.js`, or null when it is not installed.
 * @returns Returns the `initializationOptions` to pass, or undefined to pass none.
 */
export function typescriptInitializationOptions(
  rootPath: string,
  bundled: string | null,
): { tsserver: { path: string } } | undefined {
  const local: string = path.join(rootPath, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  if (existsSync(local)) {
    return undefined;
  }
  if (bundled === null) {
    logger.warn(
      'LanguageServerCatalogue',
      `${rootPath} has no TypeScript and the bundled compiler is not installed; the server has nothing to run`,
    );
    return undefined;
  }
  logger.debug(
    'LanguageServerCatalogue',
    `Using the bundled TypeScript ${TYPESCRIPT_PROVISION.version} for ${rootPath}`,
  );
  return { tsserver: { path: bundled } };
}

/**
 * The TypeScript and JavaScript server, downloaded as its npm tarball and honouring a custom path.
 * The server ships without a compiler; {@link typescriptInitializationOptions} points it at the
 * bundled one when the workspace has none of its own.
 */
const TYPESCRIPT: LanguageServerDescriptor = {
  id: 'typescript',
  displayName: 'TypeScript Language Server',
  languages: ['typescript', 'javascript'],
  priority: DEFAULT_PRIORITY,
  resolve: (context: LanguageServerContext): LspResolution => {
    const bundled: string | null = context.installedPath(TYPESCRIPT_PROVISION);
    const initializationOptions: { tsserver: { path: string } } | undefined =
      typescriptInitializationOptions(context.rootPath, bundled);
    const override: string | undefined = context.settings.get().serverPaths['typescript'];
    if (override !== undefined) {
      if (!existsSync(override)) {
        return unavailable(`The TypeScript language server was not found at ${override}.`);
      }
      return resolved({ ...context.nodePackageServer(override), initializationOptions });
    }
    const entry: string | null = context.installedPath(TYPESCRIPT_SERVER_PROVISION);
    return entry === null
      ? unavailable('The TypeScript language server is not installed — install it in Plugins.')
      : resolved({ ...context.nodePackageServer(entry), initializationOptions });
  },
};

/**
 * The Eclipse JDT Language Server, detecting a Java runtime and downloading the server on first use.
 */
const JAVA: LanguageServerDescriptor = {
  id: 'java',
  displayName: 'Eclipse JDT Language Server',
  languages: ['java'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const java: string | null = await context.provisioner.detectJava(
      context.settings.get().javaPath,
    );
    if (java === null) {
      return unavailable('Java 21+ runtime not found — set its path in Settings or install a JDK.');
    }
    const install: JdtlsInstall | null = await context.provisioner.ensureJdtls();
    if (install === null) {
      return unavailable('The Java language server could not be downloaded.');
    }
    const dataDir: string = await context.provisioner.dataDirectory('jdtls', context.rootPath);
    return resolved({
      command: java,
      args: [
        ...JDTLS_JVM_ARGS,
        '-jar',
        install.launcherJar,
        '-configuration',
        install.configDir,
        '-data',
        dataDir,
      ],
    });
  },
};

/**
 * The Kotlin language server, detecting a Java runtime and downloading the server on first use. The
 * launcher script finds its Java runtime from `JAVA_HOME`, so the resolved runtime is passed through
 * the environment (when its path is absolute); the server is rooted at the workspace via the `rootUri`
 * the manager sends, needing no per-workspace data directory.
 */
const KOTLIN: LanguageServerDescriptor = {
  id: 'kotlin',
  displayName: 'Kotlin Language Server',
  languages: ['kotlin'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const java: string | null = await context.provisioner.detectJava(
      context.settings.get().javaPath,
    );
    if (java === null) {
      return unavailable('Java 21+ runtime not found — set its path in Settings or install a JDK.');
    }
    const launcher: string | null = await context.provisioner.ensureKotlin();
    if (launcher === null) {
      return unavailable('The Kotlin language server could not be downloaded.');
    }
    const env: Record<string, string> | undefined = path.isAbsolute(java)
      ? { JAVA_HOME: path.dirname(path.dirname(java)) }
      : undefined;
    return resolved({ command: launcher, args: [], env });
  },
};

/**
 * gopls, detecting the Go toolchain and building the server with it on first use. gopls shells out to
 * `go` at runtime, so the toolchain's directory is appended to the spawned PATH.
 */
const GO: LanguageServerDescriptor = {
  id: 'go',
  displayName: 'gopls',
  languages: ['go'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const go: string | null = await context.provisioner.detectGo(null);
    if (go === null) {
      return unavailable(
        'Go toolchain not found — install Go from go.dev, or add it to your PATH.',
      );
    }
    const gopls: string | null = await context.provisioner.ensureGopls(go);
    if (gopls === null) {
      return unavailable('The Go language server (gopls) could not be built.');
    }
    const env: Record<string, string> | undefined = path.isAbsolute(go)
      ? { PATH: `${process.env['PATH'] ?? ''}${path.delimiter}${path.dirname(go)}` }
      : undefined;
    return resolved({ command: gopls, args: [], env });
  },
};

/**
 * The Roslyn C# language server, detecting a .NET SDK and starting whichever server the plugin has
 * installed. Unlike most servers, Roslyn does not load a workspace from `rootUri` alone, so the spec
 * carries a `solution/open` (or `project/open`) notification for the manager to send after the
 * handshake.
 */
const CSHARP: LanguageServerDescriptor = {
  id: 'csharp',
  displayName: 'Roslyn Language Server',
  languages: ['csharp'],
  priority: DEFAULT_PRIORITY,
  takesBraceStyle: true,
  // Roslyn answers workspace/diagnostic though it advertises otherwise without dynamic registration;
  // how far it reaches is the analysis scope below (#1144).
  servesWorkspaceDiagnostics: true,
  // What Roslyn reads through workspace/configuration that a user would recognise (#1143); the
  // defaults are Roslyn's own, which it uses while the user has set nothing.
  settings: [
    {
      section: 'csharp|background_analysis.dotnet_compiler_diagnostics_scope',
      label: 'Errors and warnings',
      description:
        'Which files the compiler checks for the Error List: the files you have open, or every file in the solution, open or not.',
      default: 'openFiles',
      options: [
        { value: 'openFiles', label: 'Open files' },
        { value: 'fullSolution', label: 'Whole solution' },
      ],
    },
    {
      section: 'csharp|background_analysis.dotnet_analyzer_diagnostics_scope',
      label: 'Code analysis',
      description:
        'Which files code analysis — analyzer warnings and suggestions — runs on. The whole solution is thorough, but slow on a large one.',
      default: 'openFiles',
      options: [
        { value: 'openFiles', label: 'Open files' },
        { value: 'fullSolution', label: 'Whole solution' },
        { value: 'none', label: 'Off' },
      ],
    },
    {
      section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_parameters',
      label: 'Parameter names',
      description:
        'Show the name of the parameter each argument is passed to, before the argument.',
      default: false,
    },
    {
      section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_types',
      label: 'Inferred types',
      description:
        'Show the type the compiler infers where the code does not name it, such as after var.',
      default: false,
    },
    {
      section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_literal_parameters',
      label: 'Names for literal arguments',
      description:
        'Show parameter names for arguments that are literals, such as numbers and strings.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_object_creation_parameters',
      label: 'Names in object creation',
      description: 'Show parameter names for the arguments of a new expression.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_indexer_parameters',
      label: 'Names for indexer arguments',
      description: 'Show parameter names for the arguments of an indexer.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.dotnet_enable_inlay_hints_for_other_parameters',
      label: 'Names for other arguments',
      description:
        'Show parameter names for every other argument, such as variables and member accesses.',
      default: false,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_implicit_variable_types',
      label: 'Types of var declarations',
      description: 'Show the inferred type of a variable declared with var.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_lambda_parameter_types',
      label: 'Types of lambda parameters',
      description: "Show the inferred types of a lambda expression's parameters.",
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_implicit_object_creation',
      label: 'Types of target-typed new',
      description: 'Show the type a target-typed new() creates.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_collection_expressions',
      label: 'Types of collection expressions',
      description: 'Show the type a collection expression creates.',
      default: true,
      advanced: true,
    },
    {
      section: 'csharp|code_lens.dotnet_enable_references_code_lens',
      label: 'Reference counts',
      description:
        'Show how many references a type or member has above it; clicking the count lists them. Each costs a line.',
      default: true,
    },
    {
      section: 'projects.dotnet_enable_automatic_restore',
      label: 'Restore packages',
      description:
        "Restore a project's NuGet packages when it needs them — on opening the solution, or when a project file changes — or ask first.",
      default: true,
      options: [
        { value: true, label: 'Automatically' },
        { value: false, label: 'Ask first' },
      ],
    },
    {
      section: 'projects.dotnet_enable_file_based_programs',
      label: 'File-based programs',
      description:
        'Give a C# file that belongs to no project — a program run with `dotnet run app.cs` — full language support of its own.',
      default: true,
    },
    {
      section: 'navigation.dotnet_navigate_to_decompiled_sources',
      label: 'Go to decompiled sources',
      description:
        'Go to Definition on framework or package code opens its decompiled source, rather than only its signatures.',
      default: true,
    },
  ],
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const dotnet: string | null = await context.provisioner.detectDotnet(
      context.settings.get().dotnetPath,
    );
    if (dotnet === null) {
      return unavailable(
        '.NET SDK 10+ not found — set its path in Settings or install the .NET 10 SDK.',
      );
    }
    // The installed server, whichever version it is — never a download. Installing and updating are
    // the Plugin Manager's, so a release that moves the pin does not fetch ~70 MB the next time a C#
    // file opens (#1135).
    const server: string | null = context.provisioner.installedRoslyn();
    if (server === null) {
      return unavailable('The C# language server is not installed — install it in Plugins.');
    }
    const logDir: string = await context.provisioner.dataDirectory('roslyn', context.rootPath);
    const model: ProjectModel | null =
      (await projectSystems.get('dotnet')?.load(context.rootPath)) ?? null;
    const postInitialize: readonly LspPostInitialize[] | undefined = csharpOpenPlan(model);
    logger.debug(
      'LanguageServerCatalogue',
      `Roslyn open plan: ${postInitialize?.[0]?.method ?? 'none (single-file)'}`,
    );
    const env: Record<string, string> = { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
    if (path.isAbsolute(dotnet)) {
      // Help the server's apphost find the .NET runtime when it is not on the spawned PATH.
      env['DOTNET_ROOT'] = path.dirname(dotnet);
    }
    // Roslyn takes brace placement only from analyzer config, so the user's Brace style reaches it as
    // a global config of Studio's own, which a project's .editorconfig still overrides (#1177).
    if (context.braceStyle !== undefined) {
      Object.assign(
        env,
        await writeCsharpBraceConfig(
          logDir,
          context.braceStyle,
          process.env[CUSTOM_AFTER_COMMON_TARGETS],
        ),
      );
    }
    return resolved({
      command: server,
      // Warning, not Information: during a large solution load the Information stream is a firehose of
      // per-project log notifications, each one an IPC hop to the renderer's Output.
      args: ['--logLevel', 'Warning', '--extensionLogDirectory', logDir, '--stdio'],
      env,
      postInitialize,
    });
  },
};

/**
 * The language servers that need code to resolve. This is the *contents* of the slots, not the slot
 * mechanism: {@link import('./lsp-server-registry').LspServerRegistry} indexes these and accepts
 * further descriptors at runtime, so a plugin-contributed server is a peer of every entry here rather
 * than a special case.
 *
 * Every entry left is here because resolving it is a computation, not a description, and each one is
 * a different computation:
 *
 * - **Kotlin** needs `JAVA_HOME` set from the Java runtime *Studio detected*, which a static manifest
 *   cannot name — and the closed `requires` list exists precisely because a manifest may declare a
 *   prerequisite but may not teach Studio to find one.
 * - **jdtls** additionally globs a version-stamped launcher jar out of its own payload and passes a
 *   data directory computed per workspace.
 * - **gopls** is built with the user's Go toolchain rather than downloaded at all.
 * - **Roslyn** derives its `solution/open` traffic from the workspace.
 * - **TypeScript** decides whether to point the server at the bundled compiler, which depends on
 *   whether the workspace brought its own — pointing there unconditionally would make the editor
 *   disagree with the project's own `tsc`.
 *
 * The servers that resolve to "the entry point of the archive we installed" moved into the curated
 * index, where the facts about them are data. What is left is the line where description stops and
 * execution begins, and it is not expected to get much shorter.
 *
 * @returns Returns the catalogue descriptors.
 */
export function languageServerCatalogue(): readonly LanguageServerDescriptor[] {
  return [TYPESCRIPT, JAVA, KOTLIN, GO, CSHARP];
}
