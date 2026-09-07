import { DECODER_FORMATS } from './decoder-protocol';

// The plugin manifest: the declarative description a third-party plugin ships so Studio can install it
// and register what it contributes, without running any of its code to find out. Keep this module
// platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// The shape is not invented. It is what the fifteen first-party plugins turned out to need, and its
// boundaries are where they turned out to need more:
//
//   - Provisioning is pinned, and pinned means hashed before anything is extracted. Two kinds: an
//     archive (a URL, a SHA-256, an archive kind and an entry path), or an npm dependency tree named
//     by a lockfile, which is the same promise one level down — the manifest pins a hash of the
//     lockfile, and the lockfile pins one per tarball.
//   - Starting the contributed thing is an executable plus arguments, or a JavaScript entry point run
//     under the bundled Node runtime. Those are the only two shapes in the catalogue.
//   - A contribution point does not assume a key. Language servers and debug adapters are chosen per
//     language; a container engine is chosen once. Keying is per contribution point, not universal.
//
// What it deliberately cannot express — because attempting it would mean running plugin code, which is
// the guardrail this whole design exists to keep:
//
//   - Building from source with the user's toolchain (gopls).
//   - Installing into a managed language environment (debugpy's pip install).
//   - Provisioning that needs a detected runtime to even start (the Java and .NET servers), or that
//     computes its start-up traffic from the workspace (Roslyn's solution/open).
//
// Those stay first-party. A manifest that cannot describe them is doing its job: the line is drawn
// where description stops and execution begins.

/**
 * The contribution API version this build implements, as semver. A manifest declares the version it was
 * written against and Studio decides whether it can honour it — see {@link isApiCompatible}.
 *
 * `1.1.0` added the optional {@link PluginManifest.detail}. A minor bump rather than a major one because
 * it only adds: every 1.0.0 manifest still validates and still means what it meant.
 *
 * `1.2.0` added the `npm` provisioning kind (#446). Also only adds — `kind` was already a discriminant
 * with one value precisely so a second could arrive without reinterpreting what was already published,
 * so every 1.1.0 manifest is still an archive manifest and still means what it meant.
 *
 * `1.3.0` added a per-contribution `entryPoint`, for a payload holding more than one program (#454),
 * and made `provision.executablePath` optional for the manifests that use it. Adds again: a
 * contribution that names none still resolves to the provision's entry point, exactly as before.
 *
 * `1.4.0` added the `decoders` contribution point (#584), the third slot after language servers and
 * debug adapters, and the first keyed by binary *format* rather than by language. Adds only: every
 * 1.3.0 manifest still validates and still means what it meant. The rule that a manifest contributing
 * nothing is refused now counts decoders, which widens what is accepted rather than narrowing it.
 *
 * `1.5.0` added the `containerEngines` contribution point (#594), the fourth slot, and the first keyed
 * by nothing at all — an engine is chosen once for the application rather than per language or per
 * format. Adds only, on the same terms as every minor before it.
 *
 * It is also the first contribution point whose payload is not the thing being contributed: Studio
 * speaks to an engine over a socket the user's own engine serves, and provisions only the client CLI
 * for the operations that are a terminal session. That is a widening of what a contribution *is*, and
 * it is recorded here rather than left to be inferred.
 *
 * `1.6.0` added the optional `members` to a download (#596), for an upstream that publishes one archive
 * holding more than the thing being contributed. Adds only: a download naming none still extracts the
 * whole archive, exactly as before.
 */
export const PLUGIN_API_VERSION: string = '1.6.0';

/**
 * Matches a plain three-part semver. Deliberately strict and deliberately local: the rule below is the
 * only version comparison this contract needs, and `shared/api` is imported by both compilations, so it
 * stays free of dependencies rather than pulling one in for twenty lines.
 */
const VERSION_PATTERN: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parses a semver string into its numeric parts.
 * @param value The candidate version.
 * @returns Returns the major, minor and patch, or null when the value is not a plain semver.
 */
function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match: RegExpExecArray | null = VERSION_PATTERN.exec(value);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Determines whether this build can honour a manifest written against a given API version.
 *
 * The rule is the ordinary host/plugin one, in both directions. A **different major** is refused: a
 * major bump is what we say when the same field means something new, so a plugin built for 1.x cannot
 * be interpreted by 2.x. A **newer minor or patch** is also refused: a plugin written against 1.3 may
 * use contribution points a build implementing 1.2 has never heard of, and silently dropping them
 * would install a plugin that half works. Older minors are fine, which is the whole point of a minor.
 * @param declared The API version the manifest declares.
 * @param supported The API version this build implements, defaulting to {@link PLUGIN_API_VERSION}.
 * @returns Returns true when the manifest can be honoured.
 */
export function isApiCompatible(
  declared: unknown,
  supported: string = PLUGIN_API_VERSION,
): boolean {
  const wanted: [number, number, number] | null = parseVersion(declared);
  const have: [number, number, number] | null = parseVersion(supported);
  if (wanted === null || have === null) {
    return false;
  }
  if (wanted[0] !== have[0]) {
    return false;
  }
  return wanted[1] < have[1] || (wanted[1] === have[1] && wanted[2] <= have[2]);
}

/**
 * Matches a lower-case hex SHA-256.
 */
const SHA256_PATTERN: RegExp = /^[0-9a-f]{64}$/;

/**
 * Matches the identifiers a plugin and its contributions may use: lower-case, digits, hyphens and
 * dots. Deliberately narrow — an id reaches the file system as an install directory.
 */
const ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * The platform keys a manifest may publish downloads for, matching `${process.platform}-${arch}`.
 */
const PLATFORM_KEYS: readonly string[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
];

/**
 * The platform keys a container engine's discovery and start-command maps are keyed by, matching
 * `process.platform`.
 *
 * Deliberately not the `${platform}-${arch}` keys downloads use: a download differs per architecture
 * because it is a binary, whereas where a socket lives does not.
 */
const PLATFORMS: readonly string[] = ['darwin', 'linux', 'win32'];

/**
 * The archive kinds the provisioner can extract.
 */
const ARCHIVE_KINDS: readonly string[] = ['tar.gz', 'zip'];

/**
 * Describes one platform's download: where it comes from, what it must hash to, and what to run inside
 * it once extracted.
 */
export interface ManifestDownload {
  /**
   * Gets the archive URL. Must be HTTPS: a plugin's payload is executable code, and fetching it over a
   * channel that can be rewritten in flight would make the checksum the only defence.
   */
  readonly url: string;

  /**
   * Gets the expected lower-case hex SHA-256, verified before anything is extracted.
   */
  readonly sha256: string;

  /**
   * Gets the archive kind.
   */
  readonly archive: 'tar.gz' | 'zip';

  /**
   * Gets the executable or entry point's path within the extracted tree.
   */
  readonly executablePath: string;

  /**
   * Gets the archive members to extract, or undefined to extract the whole archive.
   *
   * For an upstream that publishes one archive holding more than the thing being contributed. Docker's
   * static package is the case that forced it (#596): on macOS it carries the client alone, but on Linux
   * and Windows it carries the whole engine, and extracting all of it would put a second container
   * daemon on the disk of a machine already running one.
   *
   * The archive is still downloaded and verified whole — a hash of part of a file is not a hash of the
   * file — so this narrows what is written to disk, never what is checked.
   */
  readonly members?: readonly string[];
}

/**
 * Describes a plugin obtained by downloading one self-contained archive per platform.
 */
export interface ManifestArchiveProvision {
  /**
   * Gets the provisioning kind.
   */
  readonly kind: 'archive';

  /**
   * Gets the per-platform downloads. A platform with no entry is one the plugin does not support, and
   * the Plugin Manager reports it unsupported rather than offering an install that cannot work.
   */
  readonly downloads: Readonly<Record<string, ManifestDownload>>;
}

/**
 * Describes a plugin obtained by installing an npm dependency tree, for the many servers that ship
 * only their own code and name the rest (#446).
 *
 * Deliberately **not** per-platform, unlike {@link ManifestArchiveProvision}: one lockfile describes
 * the same tree everywhere, and what varies by platform varies inside it, in the `os` and `cpu` fields
 * of individual entries. A `downloads` map here would invite publishing one lockfile per platform,
 * which is four chances for them to disagree.
 *
 * The verification story is the archive one, one level down. A lockfile is a list of
 * (destination path, tarball URL, integrity hash) triples, so pinning a hash of the lockfile pins a
 * hash of every package it names — an unbroken chain from here to every installed byte, with nothing
 * resolved and nothing executed at install time.
 */
export interface ManifestNpmProvision {
  /**
   * Gets the provisioning kind.
   */
  readonly kind: 'npm';

  /**
   * Gets the URL of the lockfile naming the tree. Must be HTTPS, for the same reason an archive URL
   * must be: this document decides what code is fetched, so a channel that can be rewritten in flight
   * would make {@link sha256} the only defence.
   */
  readonly lockfileUrl: string;

  /**
   * Gets the expected lower-case hex SHA-256 of the lockfile, verified before it is parsed. The
   * lockfile is itself a downloaded artefact and gets no more trust than one.
   */
  readonly sha256: string;

  /**
   * Gets the entry point's path within the installed tree, such as
   * `node_modules/some-server/bin/some-server`, or undefined when every contribution names its own.
   *
   * Points at the package's own file rather than at a `node_modules/.bin` shim: no shims are created,
   * and none are needed, because a `node` command runs the entry point as a path argument rather than
   * executing it.
   *
   * Optional because a tree holding several servers has no single entry point to name (#454). A
   * manifest must still say how to start each thing it contributes — here, or on the contribution.
   */
  readonly executablePath?: string;
}

/**
 * Describes how a plugin's payload is obtained.
 */
export type ManifestProvision = ManifestArchiveProvision | ManifestNpmProvision;

/**
 * Describes how to start what a plugin contributes.
 *
 * `executable` runs the provisioned entry point directly. `node` runs it as JavaScript under the
 * runtime Studio ships, so a plugin distributed as a JavaScript bundle needs no Node on the machine.
 * Those are the only two shapes the first-party catalogue uses.
 */
export interface ManifestCommand {
  /**
   * Gets how the entry point is run.
   */
  readonly kind: 'executable' | 'node';

  /**
   * Gets the arguments passed to it, or undefined for none.
   */
  readonly args?: readonly string[];

  /**
   * Gets environment variables overlaid on the spawned process, or undefined for none.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Describes a decoder a plugin contributes. Keyed by *format* rather than by language: what decodes a
 * JVM class file has nothing to say about a Mach-O binary.
 *
 * Studio ships no decoder of its own — including for native machine code — so every listing the binary
 * editor shows comes from one of these.
 */
export interface ManifestDecoder {
  /**
   * Gets the identifier the decoder is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name shown when choosing between decoders.
   */
  readonly displayName: string;

  /**
   * Gets the format keys this decoder handles, from {@link DECODER_FORMATS}.
   *
   * Validated against that list rather than accepted freely: a key is the join between what the
   * sniffer detects and what a plugin claims, so a misspelled key would not fail — it would simply
   * never match, and the decoder would appear installed but inert.
   */
  readonly formats: readonly string[];

  /**
   * Gets the priority used to pick a default among installed decoders, higher first.
   */
  readonly priority: number;

  /**
   * Gets how to start the decoder.
   */
  readonly command: ManifestCommand;

  /**
   * Gets this contribution's own entry point within the installed payload, or undefined to use the
   * provision's. See {@link ManifestLanguageServer.entryPoint}.
   */
  readonly entryPoint?: string;
}

/**
 * Describes how a contributed container engine's socket is found, as data.
 *
 * This is the shape core already resolves against (#593), lifted verbatim: the variable that names the
 * endpoint outright, whether the `docker` CLI's context store names it, and the per-platform fallbacks.
 * Nothing here is a function of anything but the platform and the environment, which is what makes an
 * engine describable at all — a manifest can say *where to look*, and never has to run code to decide.
 */
export interface ManifestEndpointDiscovery {
  /**
   * Gets the environment variable that names the endpoint, such as `DOCKER_HOST`.
   */
  readonly hostVariable: string;

  /**
   * Gets whether the active `docker` context names this engine's endpoint. Honouring it is what makes
   * Colima, OrbStack and Rancher Desktop reachable, since all three publish a socket that way.
   */
  readonly dockerContext?: boolean;

  /**
   * Gets the fallback socket paths per platform key (`darwin`, `linux`, `win32`), nearest first. A
   * platform with no entry is one the engine does not run on.
   */
  readonly sockets: Readonly<Record<string, readonly string[]>>;
}

/**
 * Describes a container engine a plugin contributes.
 *
 * Keyed by nothing at all, which is the point {@link import('./slot').SlotEntry} exists to make: a
 * language server is chosen per language and a decoder per format, but an engine is chosen once for the
 * application because there is nothing to vary it by.
 *
 * The payload is the engine's **client CLI**, not the engine itself. Studio speaks the Engine API over
 * a socket the user's engine already serves; the CLI is needed only for the operations that are a
 * terminal session rather than an API call — following logs, opening a shell in a container.
 */
export interface ManifestContainerEngine {
  /**
   * Gets the identifier the engine is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name, which is what the surface calls the engine when it names it.
   */
  readonly displayName: string;

  /**
   * Gets the priority used to pick a default among installed engines, higher first.
   */
  readonly priority: number;

  /**
   * Gets how the engine's socket is found.
   */
  readonly discovery: ManifestEndpointDiscovery;

  /**
   * Gets the command the user runs to start this engine themselves, per platform key, or undefined
   * where there is nothing useful to tell them.
   *
   * There is deliberately no way for a manifest to say "Studio can start this for you". Studio can
   * launch an *application* it did not install (Docker Desktop, historically); it cannot start an
   * engine out of a CLI it provisioned, and a manifest claiming otherwise would be claiming something
   * the host cannot honour.
   */
  readonly startCommands?: Readonly<Record<string, string>>;

  /**
   * Gets this contribution's own entry point within the installed payload — the client CLI — or
   * undefined to use the provision's. See {@link ManifestLanguageServer.entryPoint}.
   */
  readonly entryPoint?: string;
}

/**
 * Describes a language server a plugin contributes. Keyed by language: a language served by more than
 * one installed plugin is a choice the user makes.
 */
export interface ManifestLanguageServer {
  /**
   * Gets the identifier the server is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name shown when choosing between servers.
   */
  readonly displayName: string;

  /**
   * Gets the language identifiers this server serves.
   */
  readonly languages: readonly string[];

  /**
   * Gets the priority used to pick a default among installed servers, higher first.
   */
  readonly priority: number;

  /**
   * Gets how to start the server.
   */
  readonly command: ManifestCommand;

  /**
   * Gets this contribution's own entry point within the installed payload, or undefined to use the
   * provision's.
   *
   * A payload usually holds one program, and `provision.executablePath` names it. Some hold several —
   * `vscode-langservers-extracted` ships five servers from one tree — and those cannot share an entry
   * point without every one of them starting the same binary. Splitting such a package into one plugin
   * per server would install the same tree several times over, so the payload stays whole and each
   * contribution says which part of it to run.
   */
  readonly entryPoint?: string;
}

/**
 * Describes a debug adapter a plugin contributes. Keyed by language, like a language server.
 */
export interface ManifestDebugAdapter {
  /**
   * Gets the identifier the adapter is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name shown when choosing between adapters.
   */
  readonly displayName: string;

  /**
   * Gets the languages this adapter debugs.
   */
  readonly languages: readonly string[];

  /**
   * Gets the priority used to pick a default among installed adapters, higher first.
   */
  readonly priority: number;

  /**
   * Gets how to start the adapter.
   */
  readonly command: ManifestCommand;

  /**
   * Gets how the adapter is spoken to, or undefined for the default of standard streams.
   */
  readonly transport?: 'stdio' | 'tcp-server';

  /**
   * Gets this contribution's own entry point within the installed payload, or undefined to use the
   * provision's. See {@link ManifestLanguageServer.entryPoint}.
   */
  readonly entryPoint?: string;
}

/**
 * The runtimes Studio knows how to detect, and therefore the only ones a manifest may require.
 *
 * Closed on purpose. A manifest can *declare* that it needs a Java runtime; it cannot teach Studio how
 * to find one, because detection is code. Keeping the list closed is what lets a prerequisite be pure
 * data without smuggling execution in behind it.
 */
export const KNOWN_RUNTIMES: readonly string[] = ['java', 'dotnet', 'go', 'node', 'python'];

/**
 * Describes a runtime a plugin needs before what it contributes can start.
 *
 * Declaring one makes the servers that were previously inexpressible describable — the Java and Kotlin
 * servers need a JDK, the C# server needs the .NET SDK — without the manifest having to say how to find
 * it. Studio detects the runtime; installing one on the user's behalf is later work.
 */
export interface ManifestRequirement {
  /**
   * Gets the runtime required, from {@link KNOWN_RUNTIMES}.
   */
  readonly runtime: string;

  /**
   * Gets the lowest acceptable version, or undefined when any will do.
   */
  readonly minimumVersion?: string;
}

/**
 * What a plugin contributes. Every contribution point is optional, and a plugin contributing nothing is
 * refused — it would install something that could never be used.
 */
export interface ManifestContributions {
  /**
   * Gets the language servers contributed.
   */
  readonly languageServers?: readonly ManifestLanguageServer[];

  /**
   * Gets the debug adapters contributed.
   */
  readonly debugAdapters?: readonly ManifestDebugAdapter[];

  /**
   * Gets the decoders contributed.
   */
  readonly decoders?: readonly ManifestDecoder[];

  /**
   * Gets the container engines contributed.
   */
  readonly containerEngines?: readonly ManifestContainerEngine[];
}

/**
 * A validated plugin manifest.
 */
export interface PluginManifest {
  /**
   * Gets the plugin identifier, unique across installed plugins.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly name: string;

  /**
   * Gets the one-line description shown in the Plugin Manager.
   */
  readonly description: string;

  /**
   * Gets the plugin's own version, which scopes its install directory.
   */
  readonly version: string;

  /**
   * Gets the contribution API version the manifest was written against, as semver.
   */
  readonly apiVersion: string;

  /**
   * Gets a note shown alongside the plugin before it is installed — what it will cost, or what it will
   * need once it is there — or undefined when there is nothing to say.
   *
   * Present because the first-party catalogue had things to say that {@link requires} cannot: that
   * clangd is a large download, that sqls does nothing useful until a database connection is configured.
   * Those are facts about the plugin, so they belong to the plugin rather than to the code that lists
   * it. Studio derives a note from {@link requires} when this is absent, so a manifest that says nothing
   * still reads sensibly.
   */
  readonly detail?: string;

  /**
   * Gets how the plugin's payload is obtained.
   */
  readonly provision: ManifestProvision;

  /**
   * Gets what the plugin contributes.
   */
  readonly contributes: ManifestContributions;

  /**
   * Gets the runtimes that must be present before the plugin's contributions can start, or an empty
   * list when it needs none.
   */
  readonly requires: readonly ManifestRequirement[];
}

/**
 * Describes why a manifest was refused: which part of it, and what was wrong.
 */
export interface ManifestError {
  /**
   * Gets the dotted path of the offending field, for example `contributes.languageServers[0].id`.
   */
  readonly path: string;

  /**
   * Gets the human-readable reason.
   */
  readonly message: string;
}

/**
 * The outcome of validating a manifest: the manifest when it is well-formed, otherwise every reason it
 * is not. Every reason, rather than the first — a plugin author fixing one problem at a time through a
 * loader that only reports one is a bad afternoon.
 */
export interface ManifestResult {
  /**
   * Gets the validated manifest, or null when it was refused.
   */
  readonly manifest: PluginManifest | null;

  /**
   * Gets the reasons it was refused, empty when it was accepted.
   */
  readonly errors: readonly ManifestError[];
}

/**
 * Collects validation failures while walking an untrusted value.
 */
class Errors {
  /**
   * Holds the failures found so far.
   */
  public readonly items: ManifestError[] = [];

  /**
   * Records a failure.
   * @param path The dotted path of the offending field.
   * @param message The reason.
   */
  public add(path: string, message: string): void {
    this.items.push({ path, message });
  }
}

/**
 * Reads a required string, recording a failure when it is absent or empty.
 * @param source The object to read from.
 * @param key The property name.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the string, or an empty string when invalid.
 */
function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
): string {
  const value: unknown = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    errors.add(`${path}${key}`, 'must be a non-empty string');
    return '';
  }
  return value;
}

/**
 * Reads an optional string, recording a failure when it is present but not a non-empty string. Absent
 * and empty are deliberately not the same thing: omitting a field says nothing, while writing `""` says
 * something empty, which is a mistake worth reporting rather than quietly treating as silence.
 * @param source The object to read from.
 * @param key The property name.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the string, or undefined when absent or invalid.
 */
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
): string | undefined {
  const value: unknown = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    errors.add(`${path}${key}`, 'must be a non-empty string when present');
    return undefined;
  }
  return value;
}

/**
 * Reads a required identifier, which must also be safe to use as a directory name.
 * @param source The object to read from.
 * @param key The property name.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the identifier, or an empty string when invalid.
 */
function readId(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
): string {
  const value: string = readString(source, key, path, errors);
  if (value.length > 0 && !ID_PATTERN.test(value)) {
    errors.add(
      `${path}${key}`,
      'must be lower-case letters, digits, dots or hyphens, and start with a letter or digit',
    );
    return '';
  }
  return value;
}

/**
 * Narrows an unknown value to a plain object, recording a failure when it is not one.
 * @param value The value to narrow.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the object, or null when the value is not one.
 */
function readObject(value: unknown, path: string, errors: Errors): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.add(path, 'must be an object');
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a list of language identifiers.
 * @param value The candidate list.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the languages, or an empty list when invalid.
 */
function readLanguages(value: unknown, path: string, errors: Errors): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.add(path, 'must be a non-empty array of language identifiers');
    return [];
  }
  if (!value.every((entry: unknown): boolean => typeof entry === 'string' && entry.length > 0)) {
    errors.add(path, 'must contain only non-empty language identifiers');
    return [];
  }
  return value as readonly string[];
}

/**
 * Validates how something is started.
 * @param value The candidate command.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the command, or null when invalid.
 */
function readCommand(value: unknown, path: string, errors: Errors): ManifestCommand | null {
  const source: Record<string, unknown> | null = readObject(value, path, errors);
  if (source === null) {
    return null;
  }
  const kind: unknown = source['kind'];
  if (kind !== 'executable' && kind !== 'node') {
    errors.add(`${path}.kind`, "must be 'executable' or 'node'");
    return null;
  }
  const args: unknown = source['args'];
  if (
    args !== undefined &&
    (!Array.isArray(args) || !args.every((a: unknown): boolean => typeof a === 'string'))
  ) {
    errors.add(`${path}.args`, 'must be an array of strings');
    return null;
  }
  const env: unknown = source['env'];
  if (env !== undefined) {
    const table: Record<string, unknown> | null = readObject(env, `${path}.env`, errors);
    if (table === null) {
      return null;
    }
    if (!Object.values(table).every((v: unknown): boolean => typeof v === 'string')) {
      errors.add(`${path}.env`, 'must map names to string values');
      return null;
    }
  }
  return {
    kind,
    args: args as readonly string[] | undefined,
    env: env as Readonly<Record<string, string>> | undefined,
  };
}

/**
 * Validates one platform download.
 * @param value The candidate download.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the download, or null when invalid.
 */
function readDownload(value: unknown, path: string, errors: Errors): ManifestDownload | null {
  const source: Record<string, unknown> | null = readObject(value, path, errors);
  if (source === null) {
    return null;
  }
  const url: string = readString(source, 'url', `${path}.`, errors);
  if (url.length > 0 && !url.startsWith('https://')) {
    errors.add(`${path}.url`, 'must be an https URL');
  }
  const sha256: string = readString(source, 'sha256', `${path}.`, errors);
  if (sha256.length > 0 && !SHA256_PATTERN.test(sha256)) {
    errors.add(`${path}.sha256`, 'must be a lower-case hex SHA-256');
  }
  const archive: unknown = source['archive'];
  if (typeof archive !== 'string' || !ARCHIVE_KINDS.includes(archive)) {
    errors.add(`${path}.archive`, `must be one of ${ARCHIVE_KINDS.join(', ')}`);
  }
  const executablePath: string = readString(source, 'executablePath', `${path}.`, errors);
  if (executablePath.startsWith('/') || executablePath.includes('..')) {
    errors.add(
      `${path}.executablePath`,
      'must be a relative path inside the archive, with no parent traversal',
    );
  }
  const members: readonly string[] | undefined = readMembers(source['members'], path, errors);
  return errors.items.length > 0
    ? null
    : { url, sha256, archive: archive as ManifestDownload['archive'], executablePath, members };
}

/**
 * Validates the optional archive members to extract.
 *
 * Held to the same rule as an entry point — relative, no parent traversal — because a member name is a
 * path handed to an extractor, and `../` in one writes outside the install directory just as surely.
 * @param value The candidate members, or undefined when the field is absent.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the members, or undefined when the field was absent.
 */
function readMembers(value: unknown, path: string, errors: Errors): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    errors.add(`${path}.members`, 'must be a non-empty array of archive member paths');
    return undefined;
  }
  const members: string[] = [];
  for (const member of value) {
    if (typeof member !== 'string' || member.length === 0) {
      errors.add(`${path}.members`, 'must be a non-empty array of archive member paths');
      continue;
    }
    if (member.startsWith('/') || member.includes('..')) {
      errors.add(
        `${path}.members`,
        'must name relative paths inside the archive, with no parent traversal',
      );
      continue;
    }
    members.push(member);
  }
  return members;
}

/**
 * Validates an optional path into an installed payload: relative, and no escaping the tree it indexes.
 * @param source The object carrying the field.
 * @param key The field name.
 * @param path The error path prefix.
 * @param errors The failure collector.
 * @returns Returns the path, or undefined when absent.
 */
function readEntryPoint(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
): string | undefined {
  const value: unknown = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    errors.add(`${path}${key}`, 'must be a non-empty string');
    return undefined;
  }
  if (value.startsWith('/') || value.includes('..')) {
    errors.add(
      `${path}${key}`,
      'must be a relative path inside the installed payload, with no parent traversal',
    );
    return undefined;
  }
  return value;
}

/**
 * Validates an npm provision: the pinned lockfile that names the tree, and the entry point within it.
 *
 * The rules are deliberately the archive rules — HTTPS, lower-case hex SHA-256, a relative entry path
 * with no parent traversal — because the thing being described is the same thing: a pinned download
 * whose hash is checked before anything is trusted.
 * @param source The candidate provision, already known to be an object of kind `npm`.
 * @param errors The failure collector.
 * @returns Returns the provision, or null when invalid.
 */
function readNpmProvision(
  source: Record<string, unknown>,
  errors: Errors,
): ManifestNpmProvision | null {
  const before: number = errors.items.length;
  const lockfileUrl: string = readString(source, 'lockfileUrl', 'provision.', errors);
  if (lockfileUrl.length > 0 && !lockfileUrl.startsWith('https://')) {
    errors.add('provision.lockfileUrl', 'must be an https URL');
  }
  const sha256: string = readString(source, 'sha256', 'provision.', errors);
  if (sha256.length > 0 && !SHA256_PATTERN.test(sha256)) {
    errors.add('provision.sha256', 'must be a lower-case hex SHA-256');
  }
  const executablePath: string | undefined = readEntryPoint(
    source,
    'executablePath',
    'provision.',
    errors,
  );
  // Only this provision's own failures decide it, so a manifest that is already failing elsewhere
  // still reports what is wrong here rather than reporting nothing.
  return errors.items.length > before ? null : { kind: 'npm', lockfileUrl, sha256, executablePath };
}

/**
 * Validates how a plugin's payload is obtained.
 * @param value The candidate provision.
 * @param errors The failure collector.
 * @returns Returns the provision, or null when invalid.
 */
function readProvision(value: unknown, errors: Errors): ManifestProvision | null {
  const source: Record<string, unknown> | null = readObject(value, 'provision', errors);
  if (source === null) {
    return null;
  }
  if (source['kind'] === 'npm') {
    return readNpmProvision(source, errors);
  }
  if (source['kind'] !== 'archive') {
    errors.add('provision.kind', 'must be one of archive, npm');
    return null;
  }
  const downloads: Record<string, unknown> | null = readObject(
    source['downloads'],
    'provision.downloads',
    errors,
  );
  if (downloads === null) {
    return null;
  }
  const entries: [string, unknown][] = Object.entries(downloads);
  if (entries.length === 0) {
    errors.add('provision.downloads', 'must publish at least one platform');
    return null;
  }
  const parsed: Record<string, ManifestDownload> = {};
  for (const [platform, download] of entries) {
    if (!PLATFORM_KEYS.includes(platform)) {
      errors.add(`provision.downloads.${platform}`, `is not a supported platform key`);
      continue;
    }
    const result: ManifestDownload | null = readDownload(
      download,
      `provision.downloads.${platform}`,
      errors,
    );
    if (result !== null) {
      parsed[platform] = result;
    }
  }
  return { kind: 'archive', downloads: parsed };
}

/**
 * Validates the contributions, which must include at least one of something.
 * @param value The candidate contributions.
 * @param errors The failure collector.
 * @returns Returns the contributions.
 */
function readContributions(value: unknown, errors: Errors): ManifestContributions {
  const source: Record<string, unknown> | null = readObject(value, 'contributes', errors);
  if (source === null) {
    return {};
  }
  const languageServers: ManifestLanguageServer[] = [];
  const debugAdapters: ManifestDebugAdapter[] = [];
  readContributionList(
    source['languageServers'],
    'contributes.languageServers',
    errors,
    (entry: Record<string, unknown>, path: string): void => {
      const command: ManifestCommand | null = readCommand(
        entry['command'],
        `${path}.command`,
        errors,
      );
      languageServers.push({
        id: readId(entry, 'id', `${path}.`, errors),
        displayName: readString(entry, 'displayName', `${path}.`, errors),
        languages: readLanguages(entry['languages'], `${path}.languages`, errors),
        priority: readPriority(entry, path, errors),
        command: command ?? { kind: 'executable' },
        entryPoint: readEntryPoint(entry, 'entryPoint', `${path}.`, errors),
      });
    },
  );
  readContributionList(
    source['debugAdapters'],
    'contributes.debugAdapters',
    errors,
    (entry: Record<string, unknown>, path: string): void => {
      const command: ManifestCommand | null = readCommand(
        entry['command'],
        `${path}.command`,
        errors,
      );
      const transport: unknown = entry['transport'];
      if (transport !== undefined && transport !== 'stdio' && transport !== 'tcp-server') {
        errors.add(`${path}.transport`, "must be 'stdio' or 'tcp-server'");
      }
      debugAdapters.push({
        id: readId(entry, 'id', `${path}.`, errors),
        displayName: readString(entry, 'displayName', `${path}.`, errors),
        languages: readLanguages(entry['languages'], `${path}.languages`, errors),
        priority: readPriority(entry, path, errors),
        command: command ?? { kind: 'executable' },
        transport: transport as ManifestDebugAdapter['transport'],
        entryPoint: readEntryPoint(entry, 'entryPoint', `${path}.`, errors),
      });
    },
  );
  const decoders: ManifestDecoder[] = [];
  readContributionList(
    source['decoders'],
    'contributes.decoders',
    errors,
    (entry: Record<string, unknown>, path: string): void => {
      const command: ManifestCommand | null = readCommand(
        entry['command'],
        `${path}.command`,
        errors,
      );
      decoders.push({
        id: readId(entry, 'id', `${path}.`, errors),
        displayName: readString(entry, 'displayName', `${path}.`, errors),
        formats: readFormats(entry['formats'], `${path}.formats`, errors),
        priority: readPriority(entry, path, errors),
        command: command ?? { kind: 'executable' },
        entryPoint: readEntryPoint(entry, 'entryPoint', `${path}.`, errors),
      });
    },
  );
  const containerEngines: ManifestContainerEngine[] = [];
  readContributionList(
    source['containerEngines'],
    'contributes.containerEngines',
    errors,
    (entry: Record<string, unknown>, path: string): void => {
      containerEngines.push({
        id: readId(entry, 'id', `${path}.`, errors),
        displayName: readString(entry, 'displayName', `${path}.`, errors),
        priority: readPriority(entry, path, errors),
        discovery: readDiscovery(entry['discovery'], `${path}.discovery`, errors),
        startCommands: readPlatformStrings(entry['startCommands'], `${path}.startCommands`, errors),
        entryPoint: readEntryPoint(entry, 'entryPoint', `${path}.`, errors),
      });
    },
  );
  if (
    languageServers.length === 0 &&
    debugAdapters.length === 0 &&
    decoders.length === 0 &&
    containerEngines.length === 0
  ) {
    errors.add(
      'contributes',
      'must contribute at least one language server, debug adapter, decoder or container engine',
    );
  }
  return { languageServers, debugAdapters, decoders, containerEngines };
}

/**
 * Validates a container engine's discovery rules.
 *
 * The socket map is required and must name at least one platform: an engine that says nothing about
 * where it is served describes no way to reach it, and would install as an option that can never
 * connect — the same failure mode as a decoder claiming a format nothing produces.
 * @param value The candidate discovery object.
 * @param path The dotted path, for error messages.
 * @param errors The failure collector.
 * @returns Returns the discovery rules.
 */
function readDiscovery(value: unknown, path: string, errors: Errors): ManifestEndpointDiscovery {
  const source: Record<string, unknown> | null = readObject(value, path, errors);
  if (source === null) {
    return { hostVariable: '', sockets: {} };
  }
  const context: unknown = source['dockerContext'];
  if (context !== undefined && typeof context !== 'boolean') {
    errors.add(`${path}.dockerContext`, 'must be a boolean');
  }
  const sockets: Readonly<Record<string, readonly string[]>> = readPlatformSockets(
    source['sockets'],
    `${path}.sockets`,
    errors,
  );
  if (Object.keys(sockets).length === 0) {
    errors.add(`${path}.sockets`, 'must name a socket path for at least one platform');
  }
  return {
    hostVariable: readString(source, 'hostVariable', `${path}.`, errors),
    dockerContext: context === true,
    sockets,
  };
}

/**
 * Validates a map of platform key to socket paths.
 * @param value The candidate map.
 * @param path The dotted path, for error messages.
 * @param errors The failure collector.
 * @returns Returns the map, with unusable entries dropped.
 */
function readPlatformSockets(
  value: unknown,
  path: string,
  errors: Errors,
): Readonly<Record<string, readonly string[]>> {
  const source: Record<string, unknown> | null = readObject(value, path, errors);
  if (source === null) {
    return {};
  }
  const parsed: Record<string, readonly string[]> = {};
  for (const [platform, paths] of Object.entries(source)) {
    if (!PLATFORMS.includes(platform)) {
      errors.add(`${path}.${platform}`, `must be one of ${PLATFORMS.join(', ')}`);
      continue;
    }
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((entry: unknown): boolean => typeof entry !== 'string' || entry.length === 0)
    ) {
      errors.add(`${path}.${platform}`, 'must be a non-empty array of socket paths');
      continue;
    }
    parsed[platform] = paths as readonly string[];
  }
  return parsed;
}

/**
 * Validates a map of platform key to a single string.
 * @param value The candidate map, or undefined when the field is absent.
 * @param path The dotted path, for error messages.
 * @param errors The failure collector.
 * @returns Returns the map, or undefined when the field was absent.
 */
function readPlatformStrings(
  value: unknown,
  path: string,
  errors: Errors,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const source: Record<string, unknown> | null = readObject(value, path, errors);
  if (source === null) {
    return undefined;
  }
  const parsed: Record<string, string> = {};
  for (const [platform, command] of Object.entries(source)) {
    if (!PLATFORMS.includes(platform)) {
      errors.add(`${path}.${platform}`, `must be one of ${PLATFORMS.join(', ')}`);
      continue;
    }
    if (typeof command !== 'string' || command.length === 0) {
      errors.add(`${path}.${platform}`, 'must be a non-empty string');
      continue;
    }
    parsed[platform] = command;
  }
  return parsed;
}

/**
 * Validates a decoder's format keys against the canonical list.
 *
 * Unknown keys are rejected rather than ignored: an unrecognised key cannot match anything the sniffer
 * produces, so accepting one would install a decoder that silently never runs — the hardest kind of
 * failure to diagnose, because everything reports success.
 * @param value The candidate format array.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the format keys, or an empty array when invalid.
 */
function readFormats(value: unknown, path: string, errors: Errors): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.add(path, 'must be a non-empty array of format keys');
    return [];
  }
  if (!value.every((entry: unknown): boolean => typeof entry === 'string' && entry.length > 0)) {
    errors.add(path, 'must contain only non-empty format keys');
    return [];
  }
  const keys: readonly string[] = value as readonly string[];
  const unknown: readonly string[] = keys.filter(
    (key: string): boolean => !DECODER_FORMATS.includes(key),
  );
  if (unknown.length > 0) {
    errors.add(path, `has unknown format keys: ${unknown.join(', ')}`);
    return [];
  }
  return keys;
}

/**
 * Reads a contribution priority, which decides the default among installed implementations.
 * @param entry The contribution object.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @returns Returns the priority, defaulting to 100.
 */
function readPriority(entry: Record<string, unknown>, path: string, errors: Errors): number {
  const value: unknown = entry['priority'];
  if (value === undefined) {
    return 100;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.add(`${path}.priority`, 'must be a number');
    return 100;
  }
  return value;
}

/**
 * Walks an optional list of contributions, validating each entry is an object before handing it on.
 * @param value The candidate list.
 * @param path The dotted path for failures.
 * @param errors The failure collector.
 * @param read Reads one validated entry.
 */
function readContributionList(
  value: unknown,
  path: string,
  errors: Errors,
  read: (entry: Record<string, unknown>, path: string) => void,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.add(path, 'must be an array');
    return;
  }
  value.forEach((entry: unknown, index: number): void => {
    const source: Record<string, unknown> | null = readObject(entry, `${path}[${index}]`, errors);
    if (source !== null) {
      read(source, `${path}[${index}]`);
    }
  });
}

/**
 * Validates the runtime prerequisites.
 * @param value The candidate list.
 * @param errors The failure collector.
 * @returns Returns the requirements, empty when none are declared.
 */
function readRequirements(value: unknown, errors: Errors): readonly ManifestRequirement[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.add('requires', 'must be an array');
    return [];
  }
  const parsed: ManifestRequirement[] = [];
  value.forEach((entry: unknown, index: number): void => {
    const path: string = `requires[${index}]`;
    const source: Record<string, unknown> | null = readObject(entry, path, errors);
    if (source === null) {
      return;
    }
    const runtime: unknown = source['runtime'];
    if (typeof runtime !== 'string' || !KNOWN_RUNTIMES.includes(runtime)) {
      errors.add(`${path}.runtime`, `must be one of ${KNOWN_RUNTIMES.join(', ')}`);
      return;
    }
    const minimumVersion: unknown = source['minimumVersion'];
    if (minimumVersion !== undefined && typeof minimumVersion !== 'string') {
      errors.add(`${path}.minimumVersion`, 'must be a version string');
      return;
    }
    parsed.push({ runtime, minimumVersion });
  });
  return parsed;
}

/**
 * Validates an untrusted value as a plugin manifest.
 *
 * Refuses rather than repairs. A manifest describes code that will be downloaded and executed, so a
 * field that is not exactly what it should be is a reason to stop, not to guess — and every reason is
 * reported at once so an author can fix them in one pass.
 * @param value The parsed JSON to validate.
 * @returns Returns the manifest, or the reasons it was refused.
 */
export function parsePluginManifest(value: unknown): ManifestResult {
  const errors: Errors = new Errors();
  const source: Record<string, unknown> | null = readObject(value, 'manifest', errors);
  if (source === null) {
    return { manifest: null, errors: errors.items };
  }
  const apiVersion: unknown = source['apiVersion'];
  if (!isApiCompatible(apiVersion)) {
    errors.add(
      'apiVersion',
      `must be a semver this build can honour; it implements ${PLUGIN_API_VERSION}`,
    );
    return { manifest: null, errors: errors.items };
  }
  const id: string = readId(source, 'id', '', errors);
  const name: string = readString(source, 'name', '', errors);
  const description: string = readString(source, 'description', '', errors);
  const detail: string | undefined = readOptionalString(source, 'detail', '', errors);
  const version: string = readString(source, 'version', '', errors);
  const contributes: ManifestContributions = readContributions(source['contributes'], errors);
  const requires: readonly ManifestRequirement[] = readRequirements(source['requires'], errors);
  const provision: ManifestProvision | null = readProvision(source['provision'], errors);
  if (errors.items.length > 0 || provision === null) {
    return { manifest: null, errors: errors.items };
  }
  return {
    manifest: {
      id,
      name,
      description,
      version,
      apiVersion: apiVersion as string,
      detail,
      provision,
      contributes,
      requires,
    },
    errors: [],
  };
}
