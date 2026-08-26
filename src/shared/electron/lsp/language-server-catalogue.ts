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
import { JdtlsInstall } from './lsp-provisioner';

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
 * The priority given to an alternative implementation: offered in the picker, but never chosen unless
 * the user asks for it by name.
 */
const ALTERNATIVE_PRIORITY: number = 50;

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
 * The TypeScript and JavaScript server, bundled as an npm package and honouring a custom server path.
 */
const TYPESCRIPT: LanguageServerDescriptor = {
  id: 'typescript',
  displayName: 'TypeScript Language Server',
  languages: ['typescript', 'javascript'],
  priority: DEFAULT_PRIORITY,
  resolve: (context: LanguageServerContext): LspResolution => {
    const override: string | null = context.settings.get().typescriptServerPath;
    if (override !== null) {
      if (!existsSync(override)) {
        return unavailable(`The TypeScript language server was not found at ${override}.`);
      }
      return resolved(context.nodePackageServer(override));
    }
    const binPath: string | null = context.packageBin('typescript-language-server');
    return binPath === null
      ? unavailable('The TypeScript language server is not available.')
      : resolved(context.nodePackageServer(binPath));
  },
};

/**
 * Pyright, the Python default: bundled as an npm package and run through the Electron binary in Node
 * mode, so it needs neither a `node` executable nor a Python interpreter to start.
 */
const PYRIGHT: LanguageServerDescriptor = {
  id: 'pyright',
  displayName: 'Pyright',
  languages: ['python'],
  priority: DEFAULT_PRIORITY,
  resolve: (context: LanguageServerContext): LspResolution => {
    const binPath: string | null = context.packageBin('pyright', 'pyright-langserver');
    return binPath === null
      ? unavailable('The Pyright language server is not available.')
      : resolved(context.nodePackageServer(binPath));
  },
};

/**
 * `ty` (Astral), the alternative Python implementation — and the proof that the Python slot takes more
 * than one. Deliberately detected on the PATH rather than downloaded: it is not bundled, so a user who
 * has not installed it simply sees it offered and unavailable, and the catalogue ships no pinned
 * release asset for a tool still in preview.
 */
const TY: LanguageServerDescriptor = {
  id: 'ty',
  displayName: 'ty (Astral)',
  languages: ['python'],
  priority: ALTERNATIVE_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const binary: string | null = await context.provisioner.detectExecutable('ty');
    return binary === null
      ? unavailable('ty was not found — install it (for example `uv tool install ty`) to use it.')
      : resolved({ command: binary, args: ['server'] });
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
 * rust-analyzer, downloading its platform binary on first use. It runs `cargo`/`rustc` to load a Cargo
 * workspace, so the toolchain's `~/.cargo/bin` is appended to the spawned PATH — a GUI-launched app
 * does not inherit the shell PATH that rustup adds.
 */
const RUST: LanguageServerDescriptor = {
  id: 'rust',
  displayName: 'rust-analyzer',
  languages: ['rust'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const binary: string | null = await context.provisioner.ensureRustAnalyzer();
    if (binary === null) {
      return unavailable('The Rust language server could not be downloaded.');
    }
    const home: string | undefined = process.env['HOME'] ?? process.env['USERPROFILE'];
    const env: Record<string, string> | undefined =
      home === undefined
        ? undefined
        : {
            PATH: `${process.env['PATH'] ?? ''}${path.delimiter}${path.join(home, '.cargo', 'bin')}`,
          };
    return resolved({ command: binary, args: [], env });
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
 * The Roslyn C# language server, detecting a .NET SDK and downloading the server on first use. Unlike
 * most servers, Roslyn does not load a workspace from `rootUri` alone, so the spec carries a
 * `solution/open` (or `project/open`) notification for the manager to send after the handshake.
 */
const CSHARP: LanguageServerDescriptor = {
  id: 'csharp',
  displayName: 'Roslyn Language Server',
  languages: ['csharp'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const dotnet: string | null = await context.provisioner.detectDotnet(
      context.settings.get().dotnetPath,
    );
    if (dotnet === null) {
      return unavailable(
        '.NET SDK 10+ not found — set its path in Settings or install the .NET 10 SDK.',
      );
    }
    const server: string | null = await context.provisioner.ensureRoslyn();
    if (server === null) {
      return unavailable('The C# language server could not be downloaded.');
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
 * clangd, detected on the system rather than downloaded (it ships with LLVM/Xcode). It discovers its
 * compile flags from a `compile_commands.json` relative to the workspace root.
 */
const CLANGD: LanguageServerDescriptor = {
  id: 'clangd',
  displayName: 'clangd',
  languages: ['cpp', 'c'],
  priority: DEFAULT_PRIORITY,
  resolve: async (context: LanguageServerContext): Promise<LspResolution> => {
    const clangd: string | null = await context.provisioner.detectClangd(
      context.settings.get().clangdPath,
    );
    if (clangd === null) {
      return unavailable(
        'clangd not found — install LLVM or Xcode Command Line Tools, or set its path in Settings.',
      );
    }
    return resolved({ command: clangd, args: ['--log=error'] });
  },
};

/**
 * The first-party language servers the application ships, as data. This is the *contents* of the slots,
 * not the slot mechanism: {@link import('./lsp-server-registry').LspServerRegistry} indexes these and
 * accepts further descriptors at runtime, so a plugin-contributed server is a peer of every entry here
 * rather than a special case.
 *
 * @returns Returns the catalogue descriptors.
 */
export function languageServerCatalogue(): readonly LanguageServerDescriptor[] {
  return [TYPESCRIPT, PYRIGHT, TY, JAVA, KOTLIN, RUST, GO, CSHARP, CLANGD];
}
