#!/usr/bin/env node
// Asks any language server in Studio's catalogue what it offers, and checks each feature with a real
// request (#1203).
//
// Studio advertises a deliberately narrow set of client capabilities, and a server only reveals what it
// offers in answer to what the client says it can do. This probe starts a server exactly the way Studio
// starts it — the same command, arguments, environment and initializationOptions its descriptor resolves
// to, from the same install — but advertises a feature-complete client, then opens a file and exercises
// every feature the language-parity epic (#1202) builds on. It records:
//
//   - the initialize result and the dynamic registrations the server makes;
//   - the semantic-token legend, and which of its token types are not standard;
//   - every workspace/configuration section the server asks for (at start-up, and after a
//     didChangeConfiguration);
//   - every client command it sends — on code lenses, code actions, completions and inlay hints — and
//     every request and notification it sends the client;
//   - a live check of each feature against the file, beside whether the server advertised it.
//
// It writes one JSON report per server and version (`.cache/lsp-probe/<server>/<version>.json`), so two
// versions can be diffed, and `--matrix` turns the newest report of each server into a markdown table.
//
// Not part of any gate: it needs an installed server and a workspace for it to load. It never installs
// or downloads anything; a server that is not installed is reported as such. Each server is resolved
// as Studio resolves it — the code-first ones (TypeScript, jdtls, Kotlin, gopls, Roslyn) mirror
// `src/shared/electron/lsp/language-server-catalogue.ts`, and every contributed one is read from the
// plugin index, exactly as `plugin-loader.ts` reads it. Keep the two in step.
//
//   node scripts/probe-lsp.mjs --list                                   # the catalogue, and what is installed
//   node scripts/probe-lsp.mjs --server rust --workspace .cache/rust-fixture
//   node scripts/probe-lsp.mjs --server clangd --workspace w --file w/src/main.cpp --out x.json
//   node scripts/probe-lsp.mjs --server csharp --workspace w --solution w/App.slnx   # Roslyn (see probe-roslyn.mjs)
//   node scripts/probe-lsp.mjs --server "my-server --stdio" --workspace w --file w/a.foo --language foo
//   node scripts/probe-lsp.mjs --matrix [--out docs/capability-matrix.md]
//
// Options: --profile <Studio user-data folder> (default: the release profile, then the development one),
// --server-path <path> (as the Settings path override), --settle <seconds> (how long to wait for the
// server to finish loading, default 120), --node (run Node servers under this Node rather than Electron),
// --init-options <json> (merged over the descriptor's initializationOptions) and --settings <json> (the
// values to answer workspace/configuration with, looked up by section, and to push in
// didChangeConfiguration) — both to try what a server would do once Studio sends its settings (#1204).
// --errors (print the server's logged errors), --no-experimental (advertise none of a server's experimental client capabilities), --verbose (print
// the server's stderr and every message it sends). A fixture marks what each check lands on with
// `@probe type=Point member=area call=area interface=Shape value=origin completion=p` in comments.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { arch, argv, env, exit, platform } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(REPO, '.cache', 'lsp-probe');

/**
 * Reads a `--name value` argument.
 * @param {string} name The argument name, without dashes.
 * @returns {string | null} Returns its value, or null when absent.
 */
function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 || index + 1 >= argv.length || argv[index + 1].startsWith('--')
    ? null
    : argv[index + 1];
}

/**
 * Reads a JSON file, or returns a fallback when it is missing or unreadable.
 * @param {string} file The file.
 * @param {unknown} fallback The value to return instead.
 * @returns {any} Returns the parsed value.
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Reads a pinned version constant out of Studio's own source, so the probe looks for the version Studio
 * would, rather than a copy of it that drifts.
 * @param {string} file The source file, relative to the repository.
 * @param {string} name The constant's name.
 * @returns {string | null} Returns the version, or null when it cannot be found.
 */
function pinned(file, name) {
  try {
    const source = readFileSync(path.join(REPO, file), 'utf8');
    return new RegExp(`${name}: string = '([^']+)'`).exec(source)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Compares two version strings part by part as numbers, newest first.
 * @param {string} left One version.
 * @param {string} right The other.
 * @returns {number} Returns the sort order.
 */
function newestFirst(left, right) {
  const numeric = (version) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = numeric(left);
  const b = numeric(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) {
      return (b[index] ?? 0) - (a[index] ?? 0);
    }
  }
  return 0;
}

/**
 * Lists the folders in a folder, or nothing when it does not exist.
 * @param {string} folder The folder.
 * @returns {string[]} Returns the names.
 */
function folders(folder) {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ---- Studio's profile ----------------------------------------------------------------------------

const PLATFORM_KEY = `${platform}-${arch}`;
const INSTALL_MARKER = '.studio-install-complete';

/**
 * Gets Studio's user-data folder for a profile name, per platform, as Electron's `userData` is.
 * @param {string} name The profile folder name.
 * @returns {string} Returns the folder.
 */
function profileFolder(name) {
  return platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', name)
    : platform === 'win32'
      ? path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), name)
      : path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), name);
}

const PROFILES =
  option('profile') !== null
    ? [path.resolve(option('profile'))]
    : [profileFolder('onixlabs-studio'), profileFolder('onixlabs-studio-dev')].filter(existsSync);

/**
 * Reads the manifests Studio would register language servers from, most local first as Studio merges
 * them: the index Studio fetched into the profile, then the one compiled into the application. The
 * first manifest to claim an id wins.
 * @param {string} profile The profile folder.
 * @returns {any[]} Returns the manifests.
 */
function manifests(profile) {
  const merged = new Map();
  const sources = [
    readJson(path.join(profile, 'plugin-index.json'), null),
    readJson(
      path.join(REPO, 'src/shared/electron/contributions/plugins/curated-plugins.json'),
      null,
    ),
  ];
  for (const source of sources) {
    for (const manifest of source?.plugins ?? []) {
      if (!merged.has(manifest.id)) {
        merged.set(manifest.id, manifest);
      }
    }
  }
  return [...merged.values()];
}

/**
 * Gets the version of a plugin installed in a profile, from the Plugin Manager's records, or null.
 * @param {string} profile The profile folder.
 * @param {string} pluginId The plugin.
 * @returns {string | null} Returns the version.
 */
function installedPluginVersion(profile, pluginId) {
  const records = readJson(path.join(profile, 'plugins.json'), []);
  return (
    (Array.isArray(records) ? records : []).find((record) => record.id === pluginId)?.version ??
    null
  );
}

// ---- Resolving a server, as Studio's catalogue does --------------------------------------------

/**
 * Runs an executable and reports whether it ran, the way Studio's provisioner detects a runtime.
 * @param {string} command The executable.
 * @param {string[]} args Its arguments.
 * @returns {string | null} Returns its output, or null when it did not run.
 */
function runs(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return typeof error?.stderr === 'string' && error.status === 0 ? error.stderr : null;
  }
}

/**
 * Detects a Java 21+ runtime as Studio does: the Settings path, `JAVA_HOME`, then `java` on the PATH.
 * @param {string | null} override The Settings path.
 * @returns {string | null} Returns the executable, or null.
 */
function detectJava(override) {
  const candidates = [
    override,
    env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', 'java') : null,
    'java',
  ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const out = execFileSync(candidate, ['-version'], { encoding: 'utf8', stdio: 'pipe' });
      const version = /version "(\d+)/.exec(out)?.[1];
      if (Number(version) >= 21) return candidate;
    } catch (error) {
      const version = /version "(\d+)/.exec(String(error?.stderr ?? ''))?.[1];
      if (Number(version) >= 21) return candidate;
    }
  }
  return null;
}

/**
 * Detects a Go toolchain as Studio does.
 * @returns {string | null} Returns the executable, or null.
 */
function detectGo() {
  const candidates = [
    env.GOROOT ? path.join(env.GOROOT, 'bin', 'go') : null,
    'go',
    '/usr/local/go/bin/go',
    '/opt/homebrew/bin/go',
    '/usr/local/bin/go',
  ];
  return (
    candidates.filter(Boolean).find((go) => /go version/i.test(runs(go, ['version']) ?? '')) ?? null
  );
}

/**
 * Detects a .NET executable as Studio does: the Settings path, `DOTNET_ROOT`, then `dotnet` on the PATH.
 * @param {string | null} override The Settings path.
 * @returns {string | null} Returns the executable, or null.
 */
function detectDotnet(override) {
  const candidates = [
    override,
    env.DOTNET_ROOT ? path.join(env.DOTNET_ROOT, 'dotnet') : null,
    'dotnet',
    '/usr/local/share/dotnet/dotnet',
  ];
  return (
    candidates
      .filter(Boolean)
      .find((dotnet) => /^\s*1\d\./m.test(runs(dotnet, ['--list-sdks']) ?? '')) ?? null
  );
}

/**
 * Finds a per-workspace data folder for a server. Studio keeps these in its profile; the probe keeps
 * them in the temporary folder, so probing never touches the index a running Studio uses.
 * @param {string} serverId The server.
 * @param {string} root The workspace.
 * @returns {string} Returns the folder.
 */
function dataDirectory(serverId, root) {
  const key = createHash('sha256').update(root).digest('hex').slice(0, 32);
  const folder = path.join(tmpdir(), 'probe-lsp', `${serverId}-data`, key);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/**
 * Builds the spawn of a Node server, as Studio's `nodePackageServer` does: the entry point under the
 * Electron binary in Node mode, so the probe runs it under the very runtime Studio does.
 * @param {string} entryPoint The server's entry point.
 * @returns {{ command: string, args: string[], env: Record<string, string> }} Returns the spawn.
 */
function nodeServer(entryPoint) {
  let electron = null;
  if (!argv.includes('--node')) {
    try {
      electron = createRequire(path.join(REPO, 'package.json'))('electron');
    } catch {
      electron = null;
    }
  }
  return typeof electron === 'string' && existsSync(electron)
    ? { command: electron, args: [entryPoint, '--stdio'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: process.execPath, args: [entryPoint, '--stdio'], env: {} };
}

/**
 * Finds a Python 3 runtime for a `python` command, as Studio's `pythonRuntime` does.
 * @param {string} entryPoint The script.
 * @returns {{ command: string, args: string[] } | null} Returns the spawn, or null.
 */
function pythonServer(entryPoint) {
  for (const python of platform === 'win32' ? ['py', 'python'] : ['python3', 'python']) {
    if (/Python 3\./.test(runs(python, ['--version']) ?? '')) {
      return { command: python, args: [entryPoint] };
    }
  }
  return null;
}

/**
 * Finds the first Roslyn server installed in a profile (newest version first).
 * @param {string} root The profile's `lsp-servers` folder.
 * @returns {string | null} Returns the apphost, or null.
 */
function installedRoslyn(root) {
  const binary =
    platform === 'win32'
      ? 'Microsoft.CodeAnalysis.LanguageServer.exe'
      : 'Microsoft.CodeAnalysis.LanguageServer';
  const versions = path.join(root, 'roslyn');
  const pin = pinned('src/shared/electron/lsp/lsp-provisioner.ts', 'ROSLYN_VERSION');
  const ordered = folders(versions).sort((a, b) =>
    a === pin ? -1 : b === pin ? 1 : newestFirst(a, b),
  );
  for (const version of ordered) {
    for (const rid of folders(path.join(versions, version))) {
      for (const layout of [
        ['tools', 'net10.0'],
        ['content', 'LanguageServer'],
      ]) {
        const candidate = path.join(versions, version, rid, ...layout, rid, binary);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Finds the solution (or, failing that, the projects) a .NET workspace opens, as Studio's .NET project
 * system does for Roslyn's `solution/open` / `project/open`.
 * @param {string} root The workspace.
 * @param {string | null} solution An explicit solution.
 * @returns {{ method: string, params: unknown }[]} Returns the notifications to send after the handshake.
 */
function csharpOpenPlan(root, solution) {
  const queue = [root];
  const projects = [];
  let found = solution;
  while (queue.length > 0 && found === null) {
    const folder = queue.shift();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && !['bin', 'obj', 'node_modules', '.git'].includes(entry.name)) {
        queue.push(full);
      } else if (/\.slnx?$/.test(entry.name) && found === null) {
        found = full;
      } else if (entry.name.endsWith('.csproj')) {
        projects.push(full);
      }
    }
  }
  if (found !== null) {
    return [{ method: 'solution/open', params: { solution: pathToFileURL(found).href } }];
  }
  return projects.length === 0
    ? []
    : [
        {
          method: 'project/open',
          params: { projects: projects.map((p) => pathToFileURL(p).href) },
        },
      ];
}

/**
 * Resolves the code-first servers of `language-server-catalogue.ts` — the ones whose resolving is a
 * computation rather than a description.
 * @param {string} profile The profile folder.
 * @param {string} root The workspace.
 * @param {any} settings The profile's `lsp-settings.json`.
 * @returns {Record<string, { displayName: string, languages: string[], resolve: () => any }>} Returns them.
 */
function codeFirstServers(profile, root, settings) {
  const servers = path.join(profile, 'lsp-servers');
  const downloads = 'src/shared/electron/lsp/language-server-downloads.ts';
  const provisioner = 'src/shared/electron/lsp/lsp-provisioner.ts';
  const archiveTarget = (id, version, executablePath) => {
    const folder = path.join(servers, id, version, PLATFORM_KEY);
    return existsSync(path.join(folder, INSTALL_MARKER)) &&
      existsSync(path.join(folder, executablePath))
      ? path.join(folder, executablePath)
      : null;
  };
  return {
    typescript: {
      displayName: 'TypeScript Language Server',
      languages: ['typescript', 'javascript'],
      resolve: () => {
        const bundled = archiveTarget(
          'typescript',
          pinned(downloads, 'TYPESCRIPT_VERSION'),
          'package/lib/tsserver.js',
        );
        const local = path.join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js');
        const initializationOptions =
          existsSync(local) || bundled === null ? undefined : { tsserver: { path: bundled } };
        const entry =
          settings.serverPaths?.typescript ??
          archiveTarget(
            'typescript-language-server',
            pinned(downloads, 'TYPESCRIPT_SERVER_VERSION'),
            'package/lib/cli.mjs',
          );
        return entry === null
          ? { error: 'The TypeScript language server is not installed.' }
          : {
              ...nodeServer(entry),
              initializationOptions,
              version: settings.serverPaths?.typescript
                ? null
                : pinned(downloads, 'TYPESCRIPT_SERVER_VERSION'),
            };
      },
    },
    java: {
      displayName: 'Eclipse JDT Language Server',
      languages: ['java'],
      resolve: () => {
        const java = detectJava(settings.javaPath ?? null);
        if (java === null) return { error: 'No Java 21+ runtime found.' };
        const version = pinned(provisioner, 'JDTLS_VERSION');
        const install = path.join(servers, 'jdtls', version ?? '');
        const launcher = readdirSafe(path.join(install, 'plugins')).find(
          (name) => name.startsWith('org.eclipse.equinox.launcher_') && name.endsWith('.jar'),
        );
        const config = path.join(
          install,
          platform === 'darwin'
            ? 'config_mac'
            : platform === 'win32'
              ? 'config_win'
              : 'config_linux',
        );
        if (launcher === undefined || !existsSync(config)) {
          return { error: `jdtls ${version} is not installed (Studio downloads it on first use).` };
        }
        return {
          command: java,
          args: [
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
            '-jar',
            path.join(install, 'plugins', launcher),
            '-configuration',
            config,
            '-data',
            dataDirectory('jdtls', root),
          ],
          version,
        };
      },
    },
    kotlin: {
      displayName: 'Kotlin Language Server',
      languages: ['kotlin'],
      resolve: () => {
        const java = detectJava(settings.javaPath ?? null);
        if (java === null) return { error: 'No Java 21+ runtime found.' };
        const version = pinned(provisioner, 'KOTLIN_LS_VERSION');
        const launcher = path.join(
          servers,
          'kotlin',
          version ?? '',
          'server',
          'bin',
          platform === 'win32' ? 'kotlin-language-server.bat' : 'kotlin-language-server',
        );
        if (!existsSync(launcher)) {
          return {
            error: `The Kotlin server ${version} is not installed (Studio downloads it on first use).`,
          };
        }
        const javaHome = path.isAbsolute(java) ? path.dirname(path.dirname(java)) : undefined;
        return {
          command: launcher,
          args: [],
          env: javaHome ? { JAVA_HOME: javaHome } : undefined,
          version,
        };
      },
    },
    go: {
      displayName: 'gopls',
      languages: ['go'],
      resolve: () => {
        const go = detectGo();
        if (go === null) return { error: 'No Go toolchain found.' };
        const version = pinned(provisioner, 'GOPLS_VERSION');
        const gopls = path.join(
          servers,
          'gopls',
          version ?? '',
          platform === 'win32' ? 'gopls.exe' : 'gopls',
        );
        if (!existsSync(gopls)) {
          return { error: `gopls ${version} is not built (Studio builds it on first use).` };
        }
        return {
          command: gopls,
          args: [],
          env: path.isAbsolute(go)
            ? { PATH: `${env.PATH ?? ''}${path.delimiter}${path.dirname(go)}` }
            : undefined,
          version,
        };
      },
    },
    csharp: {
      displayName: 'Roslyn Language Server',
      languages: ['csharp'],
      resolve: () => {
        const dotnet = detectDotnet(settings.dotnetPath ?? null);
        if (dotnet === null) return { error: 'No .NET 10+ SDK found.' };
        const server = option('server-path') ?? installedRoslyn(servers);
        if (server === null) return { error: 'The C# language server is not installed.' };
        const logDir = dataDirectory('roslyn', root);
        const spawnEnv = { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
        if (path.isAbsolute(dotnet)) {
          spawnEnv.DOTNET_ROOT = path.dirname(dotnet);
        } else {
          const dotnetOnPath = runs(platform === 'win32' ? 'where' : 'which', ['dotnet']);
          if (dotnetOnPath)
            spawnEnv.DOTNET_ROOT = path.dirname(dotnetOnPath.split(/\r?\n/)[0].trim());
        }
        return {
          command: server,
          args: ['--logLevel', 'Warning', '--extensionLogDirectory', logDir, '--stdio'],
          env: spawnEnv,
          postInitialize: csharpOpenPlan(
            root,
            option('solution') !== null ? path.resolve(option('solution')) : null,
          ),
          // Roslyn loads its solution after the handshake and says when it is done.
          readyNotification: 'workspace/projectInitializationComplete',
          version: server.split(path.sep).at(-6) ?? null,
        };
      },
    },
  };
}

/**
 * Lists a folder's entries, or nothing.
 * @param {string} folder The folder.
 * @returns {string[]} Returns the names.
 */
function readdirSafe(folder) {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/**
 * Resolves a contributed server from its manifest, as `plugin-loader.ts` does: the installed payload's
 * entry point, run as its command's kind says.
 * @param {string} profile The profile folder.
 * @param {any} manifest The plugin manifest.
 * @param {any} server The manifest's language-server contribution.
 * @param {any} settings The profile's `lsp-settings.json`.
 * @returns {any} Returns the spawn, or `{ error }`.
 */
function resolveContributed(profile, manifest, server, settings) {
  const version = installedPluginVersion(profile, manifest.id) ?? manifest.version;
  const folder = path.join(profile, 'lsp-servers', manifest.id, version, PLATFORM_KEY);
  const relative =
    manifest.provision.kind === 'archive'
      ? manifest.provision.downloads?.[PLATFORM_KEY]?.executablePath
      : (server.entryPoint ??
        // An npm tree's default entry point is its package's own `bin`.
        npmBin(folder, manifest.id));
  const override = option('server-path') ?? settings.serverPaths?.[server.id];
  const entry =
    override ??
    (relative !== undefined &&
    relative !== null &&
    existsSync(path.join(folder, INSTALL_MARKER)) &&
    existsSync(path.join(folder, relative))
      ? path.join(folder, relative)
      : null);
  if (entry === null) {
    return {
      error: `${server.displayName} (${manifest.id} ${version}) is not installed in ${profile}.`,
    };
  }
  const command = server.command ?? { kind: 'executable' };
  if (command.kind === 'node') {
    const spec = nodeServer(entry);
    return {
      ...spec,
      args: [...spec.args, ...(command.args ?? [])],
      env: { ...spec.env, ...command.env },
      version,
    };
  }
  if (command.kind === 'python') {
    const python = pythonServer(entry);
    return python === null
      ? { error: 'No Python 3 runtime found.' }
      : { ...python, args: [...python.args, ...(command.args ?? [])], env: command.env, version };
  }
  return { command: entry, args: command.args ?? [], env: command.env, version };
}

/**
 * Finds the `bin` of an npm tree's top package.
 * @param {string} folder The tree's install folder.
 * @param {string} name The package name.
 * @returns {string | null} Returns the entry point relative to the folder, or null.
 */
function npmBin(folder, name) {
  const manifest = readJson(path.join(folder, 'node_modules', name, 'package.json'), null);
  const bin = manifest?.bin;
  const relative = typeof bin === 'string' ? bin : (bin?.[name] ?? Object.values(bin ?? {})[0]);
  return relative === undefined ? null : path.join('node_modules', name, relative);
}

/**
 * Builds the whole catalogue for a profile: every code-first and every contributed server.
 * @param {string} profile The profile folder.
 * @param {string} root The workspace.
 * @returns {Map<string, any>} Returns the servers by id.
 */
function catalogue(profile, root) {
  const settings = readJson(path.join(profile, 'lsp-settings.json'), {});
  const servers = new Map();
  for (const [id, server] of Object.entries(codeFirstServers(profile, root, settings))) {
    servers.set(id, { id, pluginId: null, ...server });
  }
  for (const manifest of manifests(profile)) {
    for (const server of manifest.contributes?.languageServers ?? []) {
      servers.set(server.id, {
        id: server.id,
        pluginId: manifest.id,
        displayName: server.displayName,
        languages: server.languages,
        resolve: () => resolveContributed(profile, manifest, server, settings),
      });
    }
  }
  // The user's extra arguments, as the registry appends them.
  for (const server of servers.values()) {
    const resolve = server.resolve;
    server.resolve = () => {
      const spec = resolve();
      const extra = settings.serverArgs?.[server.id] ?? [];
      return spec.error || extra.length === 0 ? spec : { ...spec, args: [...spec.args, ...extra] };
    };
  }
  return servers;
}

// ---- Which file, and which language --------------------------------------------------------------

/** The file extensions of each Monaco language a catalogue server serves. */
const EXTENSIONS = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  go: ['.go'],
  rust: ['.rs'],
  python: ['.py', '.pyi'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
  csharp: ['.cs'],
  lua: ['.lua'],
  yaml: ['.yaml', '.yml'],
  json: ['.json', '.jsonc'],
  html: ['.html', '.htm'],
  css: ['.css'],
  scss: ['.scss'],
  less: ['.less'],
  shell: ['.sh', '.bash', '.zsh'],
  dockerfile: ['Dockerfile', '.dockerfile'],
  sql: ['.sql'],
  perl: ['.pl', '.pm'],
  svelte: ['.svelte'],
};

/**
 * Finds the Monaco language of a file, among the ones a server serves.
 * @param {string} file The file.
 * @param {string[]} languages The server's languages.
 * @returns {string | null} Returns the language, or null.
 */
function languageOf(file, languages) {
  const name = path.basename(file);
  return (
    languages.find((language) =>
      (EXTENSIONS[language] ?? []).some((ext) => name === ext || name.endsWith(ext)),
    ) ?? null
  );
}

/**
 * Finds a source file to probe with: the first one under the workspace a server's languages cover,
 * outside build output, preferring one carrying `@probe` markers.
 * @param {string} root The folder to search.
 * @param {string[]} languages The server's languages.
 * @returns {string | null} Returns its path, or null.
 */
function firstSourceFile(root, languages) {
  const queue = [root];
  const found = [];
  const skip = ['bin', 'obj', 'node_modules', '.git', 'target', 'build', 'dist', '.venv', 'vendor'];
  while (queue.length > 0) {
    const folder = queue.shift();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && !skip.includes(entry.name)) {
        queue.push(full);
      } else if (entry.isFile() && languageOf(full, languages) !== null) {
        found.push(full);
      }
    }
  }
  return found.find((file) => readFileSync(file, 'utf8').includes('@probe')) ?? found[0] ?? null;
}

// ---- Listing ---------------------------------------------------------------------------------------

if (argv.includes('--list')) {
  for (const profile of PROFILES) {
    console.log(profile);
    for (const server of catalogue(profile, REPO).values()) {
      const spec = server.resolve();
      console.log(
        `  ${server.id.padEnd(28)} ${server.languages.join('/').padEnd(22)} ${
          spec.error ? `- ${spec.error}` : `${spec.version ?? ''} ${spec.command}`
        }`,
      );
    }
  }
  exit(0);
}

// ---- The capability matrix ------------------------------------------------------------------------

/** The features, in the order the matrix and the report list them. */
const FEATURES = [
  'definition',
  'implementation',
  'typeDefinition',
  'references',
  'hover',
  'completion',
  'completion/resolve',
  'signatureHelp',
  'formatting',
  'rangeFormatting',
  'onTypeFormatting',
  'prepareRename',
  'rename',
  'codeAction',
  'codeAction (fix)',
  'codeAction/resolve',
  'codeLens',
  'codeLens/resolve',
  'inlayHint',
  'inlayHint/resolve',
  'foldingRange',
  'documentHighlight',
  'selectionRange',
  'documentLink',
  'linkedEditingRange',
  'semanticTokens/full',
  'semanticTokens/range',
  'semanticTokens/full/delta',
  'documentSymbol',
  'workspace/symbol',
  'callHierarchy',
  'callHierarchy/incomingCalls',
  'callHierarchy/outgoingCalls',
  'typeHierarchy',
  'typeHierarchy/supertypes',
  'typeHierarchy/subtypes',
  'textDocument/diagnostic',
  'workspace/diagnostic',
  'publishDiagnostics',
  'willRenameFiles',
];

/**
 * Renders a check as a matrix cell: `live` (answered with something), `empty` (answered, with
 * nothing), `error`, `-` (not advertised and not answered), with a `*` when the server answers a
 * feature it did not advertise.
 * @param {any} check The check.
 * @returns {string} Returns the cell.
 */
function cell(check) {
  if (check === undefined) return ' ';
  const mark = check.status === 'live' && check.advertised === false ? '*' : '';
  if (check.status === 'skipped') return check.advertised ? 'adv.' : '-';
  if (check.advertised === false && check.status !== 'live') return '-';
  return `${check.status}${mark}`;
}

if (argv.includes('--matrix')) {
  const reportsDir = option('reports') !== null ? path.resolve(option('reports')) : REPORTS;
  const latest = [];
  for (const server of folders(reportsDir)) {
    const reports = readdirSafe(path.join(reportsDir, server))
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(path.join(reportsDir, server, name), null))
      // A server that was not installed when it was probed has no column.
      .filter((report) => report?.checks !== undefined)
      .sort((a, b) => String(b.probedAt).localeCompare(String(a.probedAt)));
    if (reports.length > 0) latest.push(reports[0]);
  }
  latest.sort((a, b) => a.serverId.localeCompare(b.serverId));
  const header = [
    'Feature',
    ...latest.map((r) => `${r.serverId} ${r.version ?? r.serverInfo?.version ?? ''}`.trim()),
  ];
  const rows = FEATURES.map((feature) => [
    `\`${feature}\``,
    ...latest.map((report) => cell(report.checks?.[feature])),
  ]);
  const table = [header, header.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`);
  const markdown = [
    '# Language server capability matrix',
    '',
    `Generated by \`node scripts/probe-lsp.mjs --matrix\` from the newest report of each server under \`.cache/lsp-probe\`. ` +
      '`live`: answered with something; `empty`: advertised and answered with nothing; `error`: advertised and failed; ' +
      '`-`: not advertised; `*`: answered though not advertised; `adv.`: advertised, not checked.',
    '',
    ...table,
    '',
  ].join('\n');
  const out = option('out');
  if (out === null) {
    console.log(markdown);
  } else {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(path.resolve(out), markdown);
    console.error(`wrote ${path.resolve(out)} (${latest.length} server(s))`);
  }
  exit(0);
}

// ---- Arguments ------------------------------------------------------------------------------------

const serverArg = option('server');
const workspaceArg = option('workspace');
if (serverArg === null || workspaceArg === null) {
  console.error(
    'Usage: node scripts/probe-lsp.mjs --server <id | command> --workspace <folder> [--file <path>] [--out <file.json>] [--profile <folder>] [--server-path <path>] [--solution <path>] [--language <id>] [--settle <s>] [--node] [--verbose]\n' +
      '       node scripts/probe-lsp.mjs --list\n' +
      '       node scripts/probe-lsp.mjs --matrix [--reports <folder>] [--out <file.md>]',
  );
  exit(2);
}
const ROOT = path.resolve(workspaceArg);
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  console.error(`${ROOT} is not a folder.`);
  exit(2);
}
const VERBOSE = argv.includes('--verbose');
const SETTLE_MS = Number(option('settle') ?? 120) * 1000;

/**
 * Finds the server to probe: a catalogue id (or a plugin's id), in the first profile it is installed
 * in; otherwise the argument is a command line to run as it stands.
 * @returns {any} Returns the server, with its resolved spawn.
 */
function chooseServer() {
  let unavailable = null;
  for (const profile of PROFILES) {
    const servers = catalogue(profile, ROOT);
    const server =
      servers.get(serverArg) ??
      [...servers.values()].find((candidate) => candidate.pluginId === serverArg);
    if (server === undefined) continue;
    const spec = server.resolve();
    if (!spec.error) return { ...server, spec, profile };
    unavailable ??= { ...server, spec, profile };
  }
  if (unavailable !== null) return unavailable;
  const words = serverArg.match(/"[^"]*"|\S+/g).map((word) => word.replace(/^"|"$/g, ''));
  const language = option('language');
  return {
    id: path.basename(words[0]),
    pluginId: null,
    displayName: words[0],
    languages: language === null ? Object.keys(EXTENSIONS) : [language],
    spec: { command: words[0], args: words.slice(1) },
    profile: null,
  };
}

const SERVER = chooseServer();
/**
 * Parses a JSON argument.
 * @param {string} name The argument name.
 * @returns {any} Returns the value, or undefined when absent.
 */
function jsonOption(name) {
  const raw = option(name);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`--${name} is not JSON: ${error.message}`);
    exit(2);
  }
}
const INIT_OPTIONS = jsonOption('init-options');
const SETTINGS = jsonOption('settings');
if (INIT_OPTIONS !== undefined && !SERVER.spec.error) {
  SERVER.spec = {
    ...SERVER.spec,
    initializationOptions: { ...(SERVER.spec.initializationOptions ?? {}), ...INIT_OPTIONS },
  };
}

/**
 * Answers one workspace/configuration item from `--settings`: the whole object for no section, else
 * the value at the section — as a literal key, then as a dotted path — or null (the server's default).
 * @param {string | null | undefined} section The section asked for.
 * @returns {unknown} Returns the value.
 */
function settingFor(section) {
  if (SETTINGS === undefined) return null;
  if (!section) return SETTINGS;
  if (section in SETTINGS) return SETTINGS[section];
  let value = SETTINGS;
  for (const part of section.split('.')) {
    if (value === null || typeof value !== 'object' || !(part in value)) return null;
    value = value[part];
  }
  return value;
}
const reportPath = (version) =>
  path.resolve(
    option('out') ??
      path.join(
        REPORTS,
        SERVER.id,
        `${String(version ?? 'unknown')
          .replace(/[^\w.-]+/g, '_')
          .replace(/^_+|_+$/g, '')}.json`,
      ),
  );

if (SERVER.spec.error) {
  // Recorded rather than only printed, so a run over every language leaves a trace of what was absent.
  console.error(`${SERVER.id}: ${SERVER.spec.error}`);
  const out = reportPath('not-installed');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        serverId: SERVER.id,
        installed: false,
        reason: SERVER.spec.error,
      },
      null,
      2,
    ),
  );
  exit(3);
}

const FILE =
  option('file') !== null ? path.resolve(option('file')) : firstSourceFile(ROOT, SERVER.languages);
if (FILE === null) {
  console.error(`No ${SERVER.languages.join('/')} file found under ${ROOT}; pass --file.`);
  exit(2);
}
const LANGUAGE = option('language') ?? languageOf(FILE, SERVER.languages) ?? SERVER.languages[0];

// ---- Spawning ------------------------------------------------------------------------------------

const t0 = Date.now();
// Declared before the server starts, so a report written for a server that exits early can read them.
let earlyExit = null;
let init = null;
let settled = null;
const log = (...parts) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...parts);

log(`server ${SERVER.id}: ${SERVER.spec.command} ${SERVER.spec.args.join(' ')}`);
log(`workspace ${ROOT}`);
log(`file ${FILE} (${LANGUAGE})`);

// Its own process group, so the whole tree the server starts (cargo, tsserver, a JVM) is ended with it.
const child = spawn(SERVER.spec.command, SERVER.spec.args, {
  cwd: ROOT,
  env: { ...env, ...SERVER.spec.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: platform !== 'win32',
});
log(`pid ${child.pid}`);
let stderr = '';
let done = false;
child.stderr.on('data', (data) => {
  stderr = (stderr + data).slice(-20000);
  if (VERBOSE) process.stderr.write(`  stderr: ${data}`);
});

/**
 * Ends the server and everything it started.
 */
function killServer() {
  try {
    if (platform === 'win32') child.kill();
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}
process.on('exit', killServer);
process.on('SIGINT', () => exit(130));
process.on('SIGTERM', () => exit(143));

child.on('error', (error) => {
  log(`The server could not be started: ${error.message}`);
  exit(1);
});
child.on('exit', (code, signal) => {
  if (!done) {
    earlyExit = { code, signal, stderr: stderr.slice(-3000) };
    log(`The server exited early (code=${code}, signal=${signal}).\n${stderr.slice(-1500)}`);
    writeReport();
    exit(1);
  }
});

// ---- JSON-RPC over stdio ---------------------------------------------------------------------

let nextId = 1;
const pending = new Map();
const waiters = {};
const registrations = [];
const configuration = [];
const serverMessages = {};
const serverCommands = new Map();
const pushed = new Map();
const progress = new Set();
let configurationPhase = 'start-up';
let lastActivity = Date.now();
let buffer = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) {
      return;
    }
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) {
      return;
    }
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    handle(message);
  }
});
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const request = (method, params, timeoutMs = 30000) =>
  new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ __error: 'timeout' });
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(
        message.error
          ? { __error: `${message.error.code} ${message.error.message}`.slice(0, 300) }
          : message.result,
      );
    });
    send({ id, method, params });
  });
const notify = (method, params) => send({ method, params });
const waitFor = (method) => new Promise((resolve) => (waiters[method] ??= []).push(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Records a command the server hands the client to run.
 * @param {string} where Where it was found (codeLens, codeAction, completion, inlayHint).
 * @param {any} command The LSP Command.
 */
function recordCommand(where, command) {
  if (typeof command?.command !== 'string') return;
  const entry = serverCommands.get(command.command) ?? {
    command: command.command,
    title: command.title ?? null,
    from: [],
    sampleArguments: JSON.stringify(command.arguments ?? null)?.slice(0, 400),
  };
  if (!entry.from.includes(where)) entry.from.push(where);
  serverCommands.set(command.command, entry);
}

function handle(message) {
  lastActivity = Date.now();
  if (message.id !== undefined && message.method === undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  serverMessages[message.method] ??= {
    kind: message.id === undefined ? 'notification' : 'request',
    count: 0,
    sample: null,
  };
  serverMessages[message.method].count++;
  serverMessages[message.method].sample ??= JSON.stringify(message.params ?? null)?.slice(0, 400);
  if (VERBOSE) log(`<- ${message.method} ${JSON.stringify(message.params ?? null).slice(0, 200)}`);
  if (message.id !== undefined) {
    // Answered as Studio's main process answers them (lsp-manager.ts): registrations acknowledged,
    // configuration with the user's values for the settings the server declares (the probe has no
    // user, so null — the server's own default — for every section, unless --settings gives values),
    // edits refused (Studio's
    // renderer would apply them; the probe applies nothing), anything else null.
    if (message.method === 'client/registerCapability') {
      registrations.push(...(message.params.registrations ?? []));
    }
    if (message.method === 'workspace/configuration') {
      for (const item of message.params.items ?? []) {
        configuration.push({
          section: item.section ?? null,
          scopeUri: item.scopeUri ?? null,
          phase: configurationPhase,
        });
      }
    }
    const result =
      message.method === 'workspace/configuration'
        ? (message.params.items ?? []).map((item) => settingFor(item.section))
        : message.method === 'workspace/applyEdit'
          ? { applied: false, failureReason: 'The probe applies no edits.' }
          : null;
    send({ id: message.id, result });
    return;
  }
  if (message.method === '$/progress') {
    const kind = message.params?.value?.kind;
    if (kind === 'begin') progress.add(message.params.token);
    if (kind === 'end') progress.delete(message.params.token);
  }
  if (message.method === 'textDocument/publishDiagnostics') {
    pushed.set(message.params.uri, message.params.diagnostics ?? []);
  }
  if (
    message.method === 'window/logMessage' &&
    message.params.type <= 2 &&
    !VERBOSE &&
    argv.includes('--errors')
  ) {
    log(`server: ${String(message.params.message).split('\n')[0].slice(0, 260)}`);
  }
  for (const resolve of waiters[message.method] ?? []) {
    resolve(message.params);
  }
  waiters[message.method] = [];
}

// ---- The handshake, advertising everything a client could support -----------------------------

/** The experimental client capabilities advertised per server, beyond the standard ones. */
const EXPERIMENTAL = {
  rust: {
    serverStatusNotification: true,
    hoverActions: true,
    codeActionGroup: true,
    snippetTextEdit: true,
    localDocs: true,
    commands: {
      commands: [
        'rust-analyzer.runSingle',
        'rust-analyzer.debugSingle',
        'rust-analyzer.showReferences',
        'rust-analyzer.gotoLocation',
        'editor.action.triggerParameterHints',
      ],
    },
  },
};

const capabilities = {
  textDocument: {
    synchronization: {
      dynamicRegistration: true,
      didSave: true,
      willSave: true,
      willSaveWaitUntil: true,
    },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: true,
      tagSupport: { valueSet: [1, 2] },
      codeDescriptionSupport: true,
      dataSupport: true,
    },
    diagnostic: { dynamicRegistration: true, relatedDocumentSupport: true },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
        insertReplaceSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
        insertTextModeSupport: { valueSet: [1, 2] },
        labelDetailsSupport: true,
      },
      contextSupport: true,
      completionList: {
        itemDefaults: [
          'commitCharacters',
          'editRange',
          'insertTextFormat',
          'insertTextMode',
          'data',
        ],
      },
    },
    hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      dynamicRegistration: true,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    },
    declaration: { dynamicRegistration: true, linkSupport: true },
    definition: { dynamicRegistration: true, linkSupport: true },
    typeDefinition: { dynamicRegistration: true, linkSupport: true },
    implementation: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentHighlight: { dynamicRegistration: true },
    documentSymbol: {
      dynamicRegistration: true,
      hierarchicalDocumentSymbolSupport: true,
      labelSupport: true,
    },
    codeAction: {
      dynamicRegistration: true,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
            'source.fixAll',
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit', 'command'] },
      honorsChangeAnnotations: true,
    },
    codeLens: { dynamicRegistration: true },
    documentLink: { dynamicRegistration: true, tooltipSupport: true },
    colorProvider: { dynamicRegistration: true },
    formatting: { dynamicRegistration: true },
    rangeFormatting: { dynamicRegistration: true, rangesSupport: true },
    onTypeFormatting: { dynamicRegistration: true },
    rename: { dynamicRegistration: true, prepareSupport: true, honorsChangeAnnotations: true },
    foldingRange: {
      dynamicRegistration: true,
      lineFoldingOnly: true,
      foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] },
      foldingRange: { collapsedText: true },
    },
    selectionRange: { dynamicRegistration: true },
    linkedEditingRange: { dynamicRegistration: true },
    callHierarchy: { dynamicRegistration: true },
    typeHierarchy: { dynamicRegistration: true },
    // Any token type and modifier the server names: the legend it answers with is the point.
    semanticTokens: {
      dynamicRegistration: true,
      requests: { full: { delta: true }, range: true },
      tokenTypes: [
        'namespace',
        'type',
        'class',
        'enum',
        'interface',
        'struct',
        'typeParameter',
        'parameter',
        'variable',
        'property',
        'enumMember',
        'event',
        'function',
        'method',
        'macro',
        'keyword',
        'modifier',
        'comment',
        'string',
        'number',
        'regexp',
        'operator',
        'decorator',
      ],
      tokenModifiers: [
        'declaration',
        'definition',
        'readonly',
        'static',
        'deprecated',
        'abstract',
        'async',
        'modification',
        'documentation',
        'defaultLibrary',
      ],
      formats: ['relative'],
      overlappingTokenSupport: true,
      multilineTokenSupport: true,
      augmentsSyntaxTokens: true,
    },
    inlayHint: {
      dynamicRegistration: true,
      resolveSupport: {
        properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'],
      },
    },
    inlineValue: { dynamicRegistration: true },
  },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    applyEdit: true,
    workspaceEdit: {
      documentChanges: true,
      resourceOperations: ['create', 'rename', 'delete'],
      failureHandling: 'textOnlyTransactional',
      changeAnnotationSupport: { groupsOnLabel: true },
    },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    symbol: {
      dynamicRegistration: true,
      symbolKind: { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) },
      resolveSupport: { properties: ['location.range'] },
    },
    executeCommand: { dynamicRegistration: true },
    semanticTokens: { refreshSupport: true },
    codeLens: { refreshSupport: true },
    inlayHint: { refreshSupport: true },
    inlineValue: { refreshSupport: true },
    diagnostics: { refreshSupport: true },
    fileOperations: {
      dynamicRegistration: true,
      willRename: true,
      didRename: true,
      willCreate: true,
      didCreate: true,
      willDelete: true,
      didDelete: true,
    },
  },
  window: {
    workDoneProgress: true,
    showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
    showDocument: { support: true },
  },
  // The non-standard client capabilities a server reveals more behind (rust-analyzer's Run and Debug
  // lenses, its server status) — recorded in the report, since Studio advertises none of them.
  experimental: argv.includes('--no-experimental') ? undefined : EXPERIMENTAL[SERVER.id],
  general: {
    positionEncodings: ['utf-16'],
    markdown: { parser: 'marked' },
  },
};

const rootUri = pathToFileURL(ROOT).href;
init = await request(
  'initialize',
  {
    processId: process.pid,
    clientInfo: { name: 'ONIXLabs Studio (probe-lsp)' },
    rootUri,
    rootPath: ROOT,
    // Named by the path, as Studio names it.
    workspaceFolders: [{ uri: rootUri, name: ROOT }],
    initializationOptions: SERVER.spec.initializationOptions,
    capabilities,
  },
  90000,
);
if (init?.__error) {
  log(`initialize failed: ${init.__error}`);
  earlyExit = { initialize: init.__error, stderr: stderr.slice(-3000) };
  writeReport();
  exit(1);
}
log(`initialized: ${init.serverInfo?.name ?? '?'} ${init.serverInfo?.version ?? ''}`);
notify('initialized', {});
// Settings given to try are pushed at once too, as a server that takes pushed settings is sent them.
if (SETTINGS !== undefined) {
  notify('workspace/didChangeConfiguration', { settings: SETTINGS });
}
for (const message of SERVER.spec.postInitialize ?? []) {
  log(`-> ${message.method}`);
  notify(message.method, message.params);
}
const uri = pathToFileURL(FILE).href;
const text = readFileSync(FILE, 'utf8');
notify('textDocument/didOpen', { textDocument: { uri, languageId: LANGUAGE, version: 1, text } });

// ---- Waiting for the server to load the workspace ---------------------------------------------

/**
 * Waits for the server to settle: its own "loaded" notification when it has one, otherwise no work in
 * progress and no traffic for a few seconds (after at least a few seconds, so a server that has not
 * started reporting progress yet is not mistaken for an idle one), and at most `--settle` seconds.
 * @returns {Promise<string>} Returns how it settled.
 */
async function settle() {
  const deadline = Date.now() + SETTLE_MS;
  if (SERVER.spec.readyNotification) {
    log(`waiting for ${SERVER.spec.readyNotification}`);
    const outcome = await Promise.race([
      waitFor(SERVER.spec.readyNotification).then(() => 'ready'),
      sleep(SETTLE_MS).then(() => 'timeout'),
    ]);
    await sleep(2000);
    return outcome === 'ready'
      ? SERVER.spec.readyNotification
      : `timed out after ${SETTLE_MS / 1000}s`;
  }
  await sleep(3000);
  while (Date.now() < deadline) {
    if (progress.size === 0 && Date.now() - lastActivity > 3000) {
      return `quiet after ${((Date.now() - t0) / 1000).toFixed(1)}s`;
    }
    await sleep(500);
  }
  return `timed out after ${SETTLE_MS / 1000}s with ${progress.size} task(s) in progress`;
}
settled = await settle();
log(`settled: ${settled}`);

// ---- Positions ---------------------------------------------------------------------------------

const lines = text.split('\n');

/**
 * Finds a fixture's `@probe <role>=<identifier>` marker: the identifier on the marker's own line
 * (before the marker) or else on the next line naming it. Fixtures carry markers so each check lands
 * on the identifier it is about, in any language.
 * @param {string} role The role (type, member, call, completion).
 * @returns {{ line: number, character: number, text: string } | null} Returns the position.
 */
function marker(role) {
  const pattern = new RegExp(`@probe\\b[^\\n]*\\b${role}=([\\w$]+)`);
  for (let line = 0; line < lines.length; line++) {
    const match = pattern.exec(lines[line]);
    if (!match) continue;
    const name = match[1];
    const word = new RegExp(`(?<![\\w$])${name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}(?![\\w$])`);
    const before = lines[line].slice(0, lines[line].indexOf('@probe'));
    const here = word.exec(before);
    if (here && !/^\s*(\/\/|#|--|\/\*|\*|<!--)\s*$/.test(before.slice(0, here.index))) {
      return { line, character: here.index + 1, start: here.index, text: name };
    }
    for (let next = line + 1; next < lines.length; next++) {
      const found = word.exec(lines[next]);
      if (found) return { line: next, character: found.index + 1, start: found.index, text: name };
    }
  }
  return null;
}

/**
 * Finds the first line matching a pattern and puts the caret inside its `name` group.
 * @param {RegExp} pattern The pattern.
 * @returns {{ line: number, character: number, text: string } | null} Returns the position.
 */
function find(pattern) {
  for (let line = 0; line < lines.length; line++) {
    if (/^\s*(using|namespace|import|package|use|#include|from)\b/.test(lines[line])) continue;
    const match = pattern.exec(lines[line]);
    if (match) {
      const name = match.groups?.name ?? match[0];
      const start = match.index + match[0].indexOf(name);
      return { line, character: start + 1, start, text: name };
    }
  }
  return null;
}

// Where an implementation lives (a trait or interface), and a value whose type is the fixture's own.
const iface = marker('interface');
const value = marker('value');
const typeName =
  marker('type') ??
  find(/\b(?:class|interface|record|struct|enum|trait|type|impl)\s+(?<name>[A-Za-z_]\w*)/) ??
  find(/\b(?<name>[A-Z][A-Za-z]{3,})\b/) ??
  find(/(?<name>[A-Za-z_][\w-]{2,})/);
const member =
  marker('member') ??
  find(/\b(?:fn|func|def|function|fun|sub)\s+(?:\([^)]*\)\s*)?(?<name>[A-Za-z_]\w*)/) ??
  find(
    /\b(?:public|private|internal|protected|static)\s+(?:static\s+|async\s+|override\s+|virtual\s+)*[\w<>?,.[\]]+\s+(?<name>[A-Za-z_]\w*)\s*\(/,
  ) ??
  typeName;
const call =
  marker('call') ??
  find(/[.:]\s*(?<name>[A-Za-z_]\w*)\s*\(/) ??
  find(/(?<name>[A-Za-z_]\w*)\s*\(/) ??
  member;
if (typeName === null) {
  log(`${FILE} has no identifier to probe with; pass a different --file.`);
  exit(1);
}
const doc = { textDocument: { uri } };
const at = (position) => ({
  ...doc,
  position: { line: position.line, character: position.character },
});
const head = {
  start: { line: 0, character: 0 },
  end: { line: Math.min(lines.length - 1, 60), character: 0 },
};
const all = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: 0 } };
const formatting = { tabSize: 4, insertSpaces: true };
// Completion after the call's receiver (`p.|area`), else at the start of the call's name.
const completionAt = marker('completion') ?? call;
const completionPosition = {
  line: completionAt.line,
  character: completionAt.start ?? completionAt.character - 1,
};
// Signature help just inside the call's parentheses.
const paren = lines[call.line].indexOf('(', call.start ?? 0);
const signaturePosition = { line: call.line, character: paren >= 0 ? paren + 1 : call.character };

// ---- What the server says it offers ---------------------------------------------------------------

const caps = init.capabilities ?? {};
const registered = (method) => registrations.some((registration) => registration.method === method);
const flag = (value) => value !== undefined && value !== null && value !== false;

/**
 * Decides whether a feature was advertised, statically in the initialize result or by a dynamic
 * registration.
 * @param {string} method The LSP method the feature is requested through.
 * @param {unknown} staticCapability The static capability.
 * @returns {'static' | 'dynamic' | false} Returns how it was advertised.
 */
const advertisedBy = (method, staticCapability) =>
  flag(staticCapability) ? 'static' : registered(method) ? 'dynamic' : false;

const ADVERTISED = {
  definition: () => advertisedBy('textDocument/definition', caps.definitionProvider),
  implementation: () => advertisedBy('textDocument/implementation', caps.implementationProvider),
  typeDefinition: () => advertisedBy('textDocument/typeDefinition', caps.typeDefinitionProvider),
  references: () => advertisedBy('textDocument/references', caps.referencesProvider),
  hover: () => advertisedBy('textDocument/hover', caps.hoverProvider),
  completion: () => advertisedBy('textDocument/completion', caps.completionProvider),
  'completion/resolve': () =>
    flag(caps.completionProvider?.resolveProvider)
      ? 'static'
      : registrations.some(
            (r) => r.method === 'textDocument/completion' && r.registerOptions?.resolveProvider,
          )
        ? 'dynamic'
        : false,
  signatureHelp: () => advertisedBy('textDocument/signatureHelp', caps.signatureHelpProvider),
  formatting: () => advertisedBy('textDocument/formatting', caps.documentFormattingProvider),
  rangeFormatting: () =>
    advertisedBy('textDocument/rangeFormatting', caps.documentRangeFormattingProvider),
  onTypeFormatting: () =>
    advertisedBy('textDocument/onTypeFormatting', caps.documentOnTypeFormattingProvider),
  prepareRename: () =>
    flag(caps.renameProvider?.prepareProvider)
      ? 'static'
      : registrations.some(
            (r) => r.method === 'textDocument/rename' && r.registerOptions?.prepareProvider,
          )
        ? 'dynamic'
        : false,
  rename: () => advertisedBy('textDocument/rename', caps.renameProvider),
  codeAction: () => advertisedBy('textDocument/codeAction', caps.codeActionProvider),
  'codeAction/resolve': () =>
    flag(caps.codeActionProvider?.resolveProvider)
      ? 'static'
      : registrations.some(
            (r) => r.method === 'textDocument/codeAction' && r.registerOptions?.resolveProvider,
          )
        ? 'dynamic'
        : false,
  codeLens: () => advertisedBy('textDocument/codeLens', caps.codeLensProvider),
  'codeLens/resolve': () => (flag(caps.codeLensProvider?.resolveProvider) ? 'static' : false),
  inlayHint: () => advertisedBy('textDocument/inlayHint', caps.inlayHintProvider),
  'inlayHint/resolve': () => (flag(caps.inlayHintProvider?.resolveProvider) ? 'static' : false),
  foldingRange: () => advertisedBy('textDocument/foldingRange', caps.foldingRangeProvider),
  documentHighlight: () =>
    advertisedBy('textDocument/documentHighlight', caps.documentHighlightProvider),
  selectionRange: () => advertisedBy('textDocument/selectionRange', caps.selectionRangeProvider),
  documentLink: () => advertisedBy('textDocument/documentLink', caps.documentLinkProvider),
  linkedEditingRange: () =>
    advertisedBy('textDocument/linkedEditingRange', caps.linkedEditingRangeProvider),
  'semanticTokens/full': () =>
    advertisedBy('textDocument/semanticTokens', caps.semanticTokensProvider?.full),
  'semanticTokens/range': () =>
    advertisedBy('textDocument/semanticTokens', caps.semanticTokensProvider?.range),
  'semanticTokens/full/delta': () =>
    flag(caps.semanticTokensProvider?.full?.delta) ? 'static' : false,
  documentSymbol: () => advertisedBy('textDocument/documentSymbol', caps.documentSymbolProvider),
  'workspace/symbol': () => advertisedBy('workspace/symbol', caps.workspaceSymbolProvider),
  callHierarchy: () =>
    advertisedBy('textDocument/prepareCallHierarchy', caps.callHierarchyProvider),
  'callHierarchy/incomingCalls': () => ADVERTISED.callHierarchy(),
  'callHierarchy/outgoingCalls': () => ADVERTISED.callHierarchy(),
  typeHierarchy: () =>
    advertisedBy('textDocument/prepareTypeHierarchy', caps.typeHierarchyProvider),
  'typeHierarchy/supertypes': () => ADVERTISED.typeHierarchy(),
  'typeHierarchy/subtypes': () => ADVERTISED.typeHierarchy(),
  'textDocument/diagnostic': () => advertisedBy('textDocument/diagnostic', caps.diagnosticProvider),
  'workspace/diagnostic': () =>
    flag(caps.diagnosticProvider?.workspaceDiagnostics)
      ? 'static'
      : registrations.some(
            (r) =>
              r.method === 'textDocument/diagnostic' && r.registerOptions?.workspaceDiagnostics,
          )
        ? 'dynamic'
        : false,
  // Push needs no capability: a server simply sends it.
  publishDiagnostics: () => 'static',
  willRenameFiles: () =>
    advertisedBy('workspace/willRenameFiles', caps.workspace?.fileOperations?.willRename),
};

// ---- The checks --------------------------------------------------------------------------------

const checks = {};

/**
 * Decides whether an answer carries anything.
 * @param {unknown} value The answer.
 * @returns {boolean} Returns true when it does.
 */
function hasContent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (Array.isArray(value.data)) return value.data.length > 0 || Array.isArray(value.edits);
  if (Array.isArray(value.items)) return value.items.length > 0;
  if (Array.isArray(value.edits)) return true;
  if (value.contents !== undefined) {
    const contents = value.contents;
    return typeof contents === 'string'
      ? contents.length > 0
      : Array.isArray(contents)
        ? contents.length > 0
        : Boolean(contents.value);
  }
  if (value.signatures !== undefined) return value.signatures.length > 0;
  if (value.changes !== undefined || value.documentChanges !== undefined) {
    return Object.keys(value.changes ?? {}).length > 0 || (value.documentChanges ?? []).length > 0;
  }
  return typeof value === 'object' ? Object.keys(value).length > 0 : true;
}

const summarise = (value) => {
  if (value?.__error) return `ERROR ${value.__error}`;
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (Array.isArray(value.data)) return `${value.data.length / 5} token(s)`;
  if (Array.isArray(value.edits)) return `${value.edits.length} edit(s)`;
  if (Array.isArray(value.items)) return `${value.kind ?? ''} ${value.items.length} item(s)`.trim();
  return typeof value === 'object'
    ? `object {${Object.keys(value).slice(0, 6).join(', ')}}`
    : String(value);
};

/**
 * Makes one request and records its outcome beside whether the feature was advertised.
 * @param {string} name The feature.
 * @param {string} method The LSP method.
 * @param {unknown} params Its parameters.
 * @param {number} [timeoutMs] How long to wait.
 * @returns {Promise<unknown>} Returns the answer.
 */
const check = async (name, method, params, timeoutMs) => {
  const value = await request(method, params, timeoutMs);
  const status = value?.__error
    ? value.__error === 'timeout'
      ? 'timeout'
      : 'error'
    : hasContent(value)
      ? 'live'
      : 'empty';
  checks[name] = {
    method,
    advertised: ADVERTISED[name]?.() ?? null,
    status,
    result: summarise(value),
    sample: JSON.stringify(value)?.slice(0, 800),
  };
  log(`${name.padEnd(28)} ${String(checks[name].advertised).padEnd(8)} ${checks[name].result}`);
  return value;
};

/**
 * Records a feature that could not be checked, and why.
 * @param {string} name The feature.
 * @param {string} reason Why.
 */
const skip = (name, reason) => {
  checks[name] = { advertised: ADVERTISED[name]?.() ?? null, status: 'skipped', result: reason };
  log(`${name.padEnd(28)} ${String(checks[name].advertised).padEnd(8)} skipped: ${reason}`);
};

// A code action is either a CodeAction literal carrying a Command, or a bare Command.
const actionCommand = (action) => (typeof action?.command === 'string' ? action : action?.command);
const asList = (value) =>
  Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];

log(
  `positions: type=${typeName.text}@${typeName.line + 1} member=${member.text}@${member.line + 1} call=${call.text}@${call.line + 1}`,
);

await check('definition', 'textDocument/definition', at(call));
await check('implementation', 'textDocument/implementation', at(iface ?? typeName));
await check('typeDefinition', 'textDocument/typeDefinition', at(value ?? call));
await check('references', 'textDocument/references', {
  ...at(member),
  context: { includeDeclaration: true },
});
await check('hover', 'textDocument/hover', at(typeName));
const completions = await check('completion', 'textDocument/completion', {
  ...doc,
  position: completionPosition,
  context: { triggerKind: 1 },
});
const completionItems = asList(completions);
for (const item of completionItems) recordCommand('completion', item.command);
if (completionItems.length > 0) {
  // An item is resolved as the client holds it: with the list's item defaults filled in (Roslyn keeps
  // the data it resolves from only there, and aborts on an item that arrives without it).
  const defaults = completions?.itemDefaults ?? {};
  const item = completionItems[0];
  const resolvedItem = await check('completion/resolve', 'completionItem/resolve', {
    ...item,
    ...(item.data === undefined && defaults.data !== undefined ? { data: defaults.data } : {}),
    ...(item.commitCharacters === undefined && defaults.commitCharacters !== undefined
      ? { commitCharacters: defaults.commitCharacters }
      : {}),
    ...(item.insertTextFormat === undefined && defaults.insertTextFormat !== undefined
      ? { insertTextFormat: defaults.insertTextFormat }
      : {}),
    ...(item.insertTextMode === undefined && defaults.insertTextMode !== undefined
      ? { insertTextMode: defaults.insertTextMode }
      : {}),
    ...(item.textEdit === undefined && defaults.editRange !== undefined
      ? {
          textEdit:
            'insert' in defaults.editRange
              ? { newText: item.insertText ?? item.label, ...defaults.editRange }
              : { newText: item.insertText ?? item.label, range: defaults.editRange },
        }
      : {}),
  });
  recordCommand('completion', resolvedItem?.command);
} else {
  skip('completion/resolve', 'no completion item to resolve');
}
await check('signatureHelp', 'textDocument/signatureHelp', {
  ...doc,
  position: signaturePosition,
  context: { triggerKind: 1, isRetrigger: false },
});
await check('formatting', 'textDocument/formatting', { ...doc, options: formatting });
await check('rangeFormatting', 'textDocument/rangeFormatting', {
  ...doc,
  range: head,
  options: formatting,
});
const onTypeTrigger = caps.documentOnTypeFormattingProvider?.firstTriggerCharacter ?? '}';
// Just after the first occurrence of the trigger character, so the server has something to lay out.
let onTypeLine = lines.findIndex((line) => line.includes(onTypeTrigger));
if (onTypeLine < 0) onTypeLine = member.line;
await check('onTypeFormatting', 'textDocument/onTypeFormatting', {
  ...doc,
  position: {
    line: onTypeLine,
    character: Math.max(0, lines[onTypeLine].indexOf(onTypeTrigger) + 1),
  },
  ch: onTypeTrigger,
  options: formatting,
});
await check('prepareRename', 'textDocument/prepareRename', at(member));
await check('rename', 'textDocument/rename', { ...at(member), newName: `${member.text}Renamed` });

// Code actions: once over the member (refactors), once over the first error (fixes), resolving one.
const refactors = await check('codeAction', 'textDocument/codeAction', {
  ...doc,
  range: {
    start: { line: member.line, character: member.start ?? 0 },
    end: { line: member.line, character: (member.start ?? 0) + member.text.length },
  },
  context: { diagnostics: [], triggerKind: 1 },
});
for (const action of asList(refactors)) recordCommand('codeAction', actionCommand(action));
const lenses = asList(await check('codeLens', 'textDocument/codeLens', doc));
for (const lens of lenses) recordCommand('codeLens', lens.command);
// A lens the server left to be filled in, or else any, to see whether resolving answers at all.
const unresolvedLens = lenses.find((lens) => lens.command === undefined) ?? lenses[0];
if (unresolvedLens !== undefined) {
  const resolvedLens = await check('codeLens/resolve', 'codeLens/resolve', unresolvedLens);
  recordCommand('codeLens', resolvedLens?.command);
} else {
  skip('codeLens/resolve', 'no code lens to resolve');
}
const hints = await check('inlayHint', 'textDocument/inlayHint', { ...doc, range: all });
for (const hint of asList(hints)) {
  for (const part of Array.isArray(hint.label) ? hint.label : [])
    recordCommand('inlayHint', part.command);
}
if (asList(hints).length > 0) {
  await check('inlayHint/resolve', 'inlayHint/resolve', asList(hints)[0]);
} else {
  skip('inlayHint/resolve', 'no inlay hint to resolve');
}
await check('foldingRange', 'textDocument/foldingRange', doc);
await check('documentHighlight', 'textDocument/documentHighlight', at(call));
await check('selectionRange', 'textDocument/selectionRange', {
  ...doc,
  positions: [{ line: call.line, character: call.character }],
});
await check('documentLink', 'textDocument/documentLink', doc);
await check('linkedEditingRange', 'textDocument/linkedEditingRange', at(typeName));
const fullTokens = await check('semanticTokens/full', 'textDocument/semanticTokens/full', doc);
await check('semanticTokens/range', 'textDocument/semanticTokens/range', { ...doc, range: head });
if (typeof fullTokens?.resultId === 'string') {
  await check('semanticTokens/full/delta', 'textDocument/semanticTokens/full/delta', {
    ...doc,
    previousResultId: fullTokens.resultId,
  });
} else {
  skip('semanticTokens/full/delta', 'the full answer carried no resultId');
}
await check('documentSymbol', 'textDocument/documentSymbol', doc);
await check('workspace/symbol', 'workspace/symbol', { query: typeName.text });
const callItems = await check('callHierarchy', 'textDocument/prepareCallHierarchy', at(member));
if (Array.isArray(callItems) && callItems.length > 0) {
  await check('callHierarchy/incomingCalls', 'callHierarchy/incomingCalls', { item: callItems[0] });
  await check('callHierarchy/outgoingCalls', 'callHierarchy/outgoingCalls', { item: callItems[0] });
} else {
  skip('callHierarchy/incomingCalls', 'no call hierarchy item');
  skip('callHierarchy/outgoingCalls', 'no call hierarchy item');
}
const typeItems = await check(
  'typeHierarchy',
  'textDocument/prepareTypeHierarchy',
  at(iface ?? typeName),
);
if (Array.isArray(typeItems) && typeItems.length > 0) {
  await check('typeHierarchy/supertypes', 'typeHierarchy/supertypes', { item: typeItems[0] });
  await check('typeHierarchy/subtypes', 'typeHierarchy/subtypes', { item: typeItems[0] });
} else {
  skip('typeHierarchy/supertypes', 'no type hierarchy item');
  skip('typeHierarchy/subtypes', 'no type hierarchy item');
}
const pulled = await check('textDocument/diagnostic', 'textDocument/diagnostic', doc, 60000);
await check('workspace/diagnostic', 'workspace/diagnostic', { previousResultIds: [] }, 60000);
const pushedHere = pushed.get(uri) ?? [];
checks.publishDiagnostics = {
  method: 'textDocument/publishDiagnostics',
  advertised: 'static',
  status: pushed.size === 0 ? 'empty' : 'live',
  result: `${pushed.size} file(s) pushed, ${pushedHere.length} diagnostic(s) for the probed file`,
  sample: JSON.stringify(pushedHere.slice(0, 3)).slice(0, 800),
};
log(`${'publishDiagnostics'.padEnd(28)} ${'static'.padEnd(8)} ${checks.publishDiagnostics.result}`);
await check('willRenameFiles', 'workspace/willRenameFiles', {
  files: [{ oldUri: uri, newUri: uri.replace(/(\.[\w]+)?$/, '.renamed$1') }],
});

// Fixes need a diagnostic: the fixture's deliberate error (pulled or pushed), or one injected for a
// server whose probe says how (Roslyn: an unused local). The injection is made to the server's copy of
// the document only; nothing is written to disk.
let diagnostics = [...asList(pulled), ...pushedHere];
if (diagnostics.length === 0 && SERVER.id === 'csharp') {
  let bodyLine = member.line;
  while (bodyLine < lines.length - 1 && !lines[bodyLine].includes('{')) bodyLine++;
  notify('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [
      {
        range: {
          start: { line: bodyLine + 1, character: 0 },
          end: { line: bodyLine + 1, character: 0 },
        },
        text: '        int __probeUnused = 0;\n',
      },
    ],
  });
  await sleep(1500);
  diagnostics = asList(await request('textDocument/diagnostic', doc, 30000)).filter((item) =>
    /__probeUnused/.test(`${item.message}`),
  );
}
const diagnostic = diagnostics.find((item) => item.severity === 1) ?? diagnostics[0];
if (diagnostic !== undefined) {
  const fixes = await request('textDocument/codeAction', {
    ...doc,
    range: diagnostic.range,
    context: { diagnostics: [diagnostic], triggerKind: 1 },
  });
  const list = asList(fixes);
  for (const action of list) recordCommand('codeAction', actionCommand(action));
  const fixAll = list.filter(
    (action) =>
      action?.data?.FixAllFlavors ||
      action?.command?.command === 'roslyn.client.fixAllCodeAction' ||
      String(action?.kind).startsWith('source.fixAll'),
  );
  checks['codeAction (fix)'] = {
    method: 'textDocument/codeAction',
    advertised: ADVERTISED.codeAction(),
    status: list.length > 0 ? 'live' : 'empty',
    result: `for "${String(diagnostic.message).split('\n')[0].slice(0, 120)}" (${diagnostic.code ?? 'no code'}): ${list.length} action(s), ${fixAll.length} fix-all: ${list
      .map((action) => action.title)
      .join(' | ')
      .slice(0, 300)}`,
    sample: JSON.stringify(list[0])?.slice(0, 1500),
  };
  log(
    `${'codeAction (fix)'.padEnd(28)} ${String(checks['codeAction (fix)'].advertised).padEnd(8)} ${checks['codeAction (fix)'].result}`,
  );
  if (checks.codeAction.status !== 'live' && list.length > 0) {
    checks.codeAction.status = 'live';
    checks.codeAction.result += ` (and ${list.length} for a diagnostic)`;
  }
  const toResolve =
    [...list, ...asList(refactors)].find(
      (action) =>
        action.title !== undefined && action.edit === undefined && action.data !== undefined,
    ) ?? list.find((action) => action.title !== undefined && action.kind !== undefined);
  if (toResolve !== undefined) {
    const resolvedAction = await check('codeAction/resolve', 'codeAction/resolve', toResolve);
    recordCommand('codeAction', resolvedAction?.command);
  } else {
    skip('codeAction/resolve', 'no code action to resolve');
  }
} else {
  checks['codeAction (fix)'] = {
    advertised: ADVERTISED.codeAction(),
    status: 'skipped',
    result: 'no diagnostic in the probed file',
  };
  log(`${'codeAction (fix)'.padEnd(28)} skipped: no diagnostic in the probed file`);
  const toResolve = asList(refactors).find(
    (action) => action.title !== undefined && action.edit === undefined,
  );
  if (toResolve !== undefined) {
    await check('codeAction/resolve', 'codeAction/resolve', toResolve);
  } else {
    skip('codeAction/resolve', 'no code action to resolve');
  }
}

if (SERVER.id === 'csharp') {
  await check('_vs_onAutoInsert', 'textDocument/_vs_onAutoInsert', {
    _vs_textDocument: { uri },
    _vs_position: { line: member.line, character: 3 },
    _vs_ch: '/',
    _vs_options: formatting,
  });
}

// What the server asks for once it is told its settings changed (the way Studio tells it, #1143).
configurationPhase = 'after didChangeConfiguration';
notify('workspace/didChangeConfiguration', { settings: SETTINGS ?? null });
await sleep(2000);

// ---- The report --------------------------------------------------------------------------------

/**
 * Writes the report, complete or — for a server that exited or failed to initialise — partial.
 */
function writeReport() {
  const legend =
    init?.capabilities?.semanticTokensProvider?.legend ??
    registrations.find((r) => r.method === 'textDocument/semanticTokens')?.registerOptions
      ?.legend ??
    null;
  const STANDARD_TOKENS = new Set(capabilities.textDocument.semanticTokens.tokenTypes);
  const STANDARD_MODIFIERS = new Set(capabilities.textDocument.semanticTokens.tokenModifiers);
  // Named by the version Studio installed (its pin), else by the version the server reports.
  const version =
    SERVER.spec.version ??
    /\d+(?:\.\d+)+[\w.-]*/.exec(init?.serverInfo?.version ?? '')?.[0] ??
    init?.serverInfo?.version ??
    null;
  const sections = new Map();
  for (const item of configuration) {
    const key = `${item.section}`;
    const entry = sections.get(key) ?? { section: item.section, scopeUris: [], phases: [] };
    if (item.scopeUri && !entry.scopeUris.includes(item.scopeUri))
      entry.scopeUris.push(item.scopeUri);
    if (!entry.phases.includes(item.phase)) entry.phases.push(item.phase);
    sections.set(key, entry);
  }
  const report = {
    probedAt: new Date().toISOString(),
    serverId: SERVER.id,
    pluginId: SERVER.pluginId,
    displayName: SERVER.displayName,
    version,
    profile: SERVER.profile,
    spawn: {
      command: SERVER.spec.command,
      args: SERVER.spec.args,
      env: SERVER.spec.env ?? null,
      initializationOptions: SERVER.spec.initializationOptions ?? null,
      postInitialize: SERVER.spec.postInitialize ?? null,
    },
    settingsOverride: SETTINGS ?? null,
    experimentalClientCapabilities: capabilities.experimental ?? null,
    workspace: ROOT,
    file: FILE,
    languageId: LANGUAGE,
    settled,
    earlyExit,
    serverInfo: init?.serverInfo ?? null,
    capabilities: init?.capabilities ?? null,
    executeCommands: init?.capabilities?.executeCommandProvider?.commands ?? [],
    dynamicRegistrations: registrations.map((registration) => ({
      id: registration.id,
      method: registration.method,
      options: registration.registerOptions ?? null,
    })),
    legend,
    customTokenTypes: (legend?.tokenTypes ?? []).filter((type) => !STANDARD_TOKENS.has(type)),
    customTokenModifiers: (legend?.tokenModifiers ?? []).filter(
      (modifier) => !STANDARD_MODIFIERS.has(modifier),
    ),
    configurationSections: [...sections.values()],
    clientCommands: [...serverCommands.values()],
    serverMessages,
    checks,
  };
  const out = reportPath(version);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  log(`wrote ${out}`);
}

done = true;
writeReport();
log(
  `${registrations.length} dynamic registration(s); ${configuration.length} configuration item(s) asked for; ${serverCommands.size} client command(s) seen`,
);
await request('shutdown', null, 5000);
notify('exit', null);
setTimeout(() => {
  killServer();
  exit(0);
}, 1500);
