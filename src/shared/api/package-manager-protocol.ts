// The package-manager protocol shared between the Electron main process and every package-manager
// plugin (#907, #908). Keep this module platform-neutral (no Node or DOM dependencies) so both
// compilation targets can import it.
//
// Package management is a plugin like every other seam: Studio defines what a package manager can be
// asked, and a plugin — npm and NuGet first, then Python, Rust, Go, the JVM and C/C++ — answers. The
// vocabulary below is the one the Packages panel already draws (`package-management.ts`), so it means
// the same in every ecosystem.
//
// The transport is newline-delimited JSON over standard streams, exactly as for version control: one
// request per line in, one response per line out, correlated by `id`. One addition, taken from the
// hosting protocol: a plugin may ask Studio for a registry's credential mid-request
// (`{ request: 'credential' }`), so a token saved in Studio is handed over only when needed and never
// stored by the plugin.
//
// Rulings this protocol carries (2026-10-12, #908):
// - **Reads and writes.** `install`, `update`, `remove` and `restore` are capabilities, but ⛔ a plugin
//   never performs one. It answers with a {@link PackageCommand} — the program, arguments and folder —
//   and Studio runs that in a visible terminal, where the user can read it, stop it and see its output.
// - **Credentials match GitHub hosting.** The tool's own configuration comes first: `.npmrc` and
//   `nuget.config` are read by the plugin, and core stops reading them. A token saved in Studio is the
//   optional second route, through the credential request.
// - **Several plugins per workspace.** Detection is per folder by marker files, and every plugin whose
//   marker a folder holds applies. A request names the plugin it is for. How the panel presents several
//   at once is decided later, so nothing here assumes one.

import type {
  PackageManagerModel,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './package-management';

/**
 * Holds the protocol version this build speaks. A plugin announcing a different major version is
 * refused rather than spoken to: one that misreads a request could hand back a command the user did
 * not ask for.
 */
export const PACKAGE_MANAGER_PROTOCOL_VERSION: string = '1.0';

/**
 * Names one optional capability a package-manager plugin can advertise. Reading a folder's projects and
 * packages (`load`) is what makes a plugin a package manager, so it is not one of these.
 *
 * A plugin declares these in its manifest, because the panel draws its controls before any process has
 * started, and the handshake confirms them: Studio offers only what both say.
 */
export type PackageManagerCapability =
  /**
   * Listing the registries or feeds a folder can browse and search. Names only, never a credential.
   */
  | 'sources'

  /**
   * Searching a source's packages.
   */
  | 'search'

  /**
   * A qualifier on `search`: the registry needs search text, so an empty query is not sent to it. npm
   * needs text; NuGet lists its packages without any.
   */
  | 'searchRequiresQuery'

  /**
   * A qualifier on `search`: prerelease versions can be asked for. Without it the option is not offered
   * and is never sent. npm's search reports latest versions only, so it does not have this.
   */
  | 'prerelease'

  /**
   * Answering with the command that adds a package to a project.
   */
  | 'install'

  /**
   * Answering with the command that moves a project's package to another version.
   */
  | 'update'

  /**
   * Answering with the command that removes a package from a project.
   */
  | 'remove'

  /**
   * Answering with the command that restores a project's packages from what it declares.
   */
  | 'restore';

/**
 * The optional capabilities a plugin can advertise, the closed list a manifest is validated against.
 */
export const PACKAGE_MANAGER_CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'searchRequiresQuery',
  'prerelease',
  'install',
  'update',
  'remove',
  'restore',
];

/**
 * Describes what a plugin said it is, in answer to `initialize`.
 */
export interface PackageManagerDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets the capabilities the running plugin confirms.
   */
  readonly capabilities: readonly PackageManagerCapability[];

  /**
   * Gets the version of the tool the plugin found, or null when it found none or needs none.
   */
  readonly toolVersion: string | null;

  /**
   * Gets why the plugin cannot do its work, when it cannot.
   */
  readonly problem?: string;
}

/**
 * Describes a command a plugin wants run. Studio runs it in a visible terminal; the plugin never does.
 */
export interface PackageCommand {
  /**
   * Gets the program to run, by name or path.
   */
  readonly executable: string;

  /**
   * Gets the arguments, one per entry, so a package name cannot be read as anything but an argument.
   */
  readonly args: readonly string[];

  /**
   * Gets the absolute folder to run it in, which must lie within the root the request named.
   */
  readonly cwd: string;

  /**
   * Gets the title of the terminal it runs in, in the user's terms, such as `Install left-pad`.
   */
  readonly title: string;
}

/**
 * Describes a request to change one package in one project.
 */
export interface PackageChange {
  /**
   * Gets the absolute manifest path of the project, as {@link PackageManagerModel} reported it. It must
   * lie within the root the request named.
   */
  readonly project: string;

  /**
   * Gets the package name.
   */
  readonly name: string;

  /**
   * Gets the version to move to, or null for the latest.
   */
  readonly version: string | null;
}

/**
 * Describes every operation: its parameters and its result.
 */
export interface PackageManagerOperations {
  /**
   * Completes the handshake. Sent once, first, and carries no root.
   */
  initialize: {
    readonly params: {
      /**
       * Gets the protocol version Studio speaks.
       */
      readonly protocol: string;
    };
    readonly result: PackageManagerDescription;
  };

  /**
   * Reads a folder's projects and the packages each declares, with installed and latest versions.
   * Answers null when the folder holds nothing the plugin can model.
   */
  load: {
    readonly params: Readonly<Record<string, never>>;
    readonly result: PackageManagerModel | null;
  };

  /**
   * Lists the sources a folder can browse and search.
   */
  sources: {
    readonly params: Readonly<Record<string, never>>;
    readonly result: { readonly sources: readonly PackageSourceInfo[] };
  };

  /**
   * Searches a source, or browses it with an empty query.
   */
  search: {
    readonly params: PackageSearchOptions & {
      /**
       * Gets the source to search, as named by `sources`.
       */
      readonly source: string;

      /**
       * Gets the search text, empty to browse.
       */
      readonly query: string;
    };
    readonly result: PackageSearchResult;
  };

  /**
   * Answers with the command that adds a package to a project.
   */
  install: { readonly params: PackageChange; readonly result: PackageCommand };

  /**
   * Answers with the command that moves a project's package to another version.
   */
  update: { readonly params: PackageChange; readonly result: PackageCommand };

  /**
   * Answers with the command that removes a package from a project.
   */
  remove: {
    readonly params: Omit<PackageChange, 'version'>;
    readonly result: PackageCommand;
  };

  /**
   * Answers with the command that restores what a project declares.
   */
  restore: {
    readonly params: Pick<PackageChange, 'project'>;
    readonly result: PackageCommand;
  };
}

/**
 * Names an operation.
 */
export type PackageManagerOp = keyof PackageManagerOperations;

/**
 * Gets an operation's parameters.
 */
export type PackageManagerParams<Op extends PackageManagerOp> =
  PackageManagerOperations[Op]['params'];

/**
 * Gets an operation's result.
 */
export type PackageManagerResult<Op extends PackageManagerOp> =
  PackageManagerOperations[Op]['result'];

/**
 * The operations that change nothing, so the host can answer identical concurrent ones with one
 * request: the panel and whatever else is watching the same folder ask at the same moment.
 */
export const PM_READ_OPS: readonly PackageManagerOp[] = ['load', 'sources', 'search'];

/**
 * The operations that answer with a {@link PackageCommand}. Studio runs what comes back, so each is
 * checked on the way in and on the way out.
 */
export const PM_WRITE_OPS: readonly PackageManagerOp[] = ['install', 'update', 'remove', 'restore'];

/**
 * The capability each optional operation needs. An operation not listed needs none.
 */
export const PM_OP_CAPABILITY: Readonly<
  Partial<Record<PackageManagerOp, PackageManagerCapability>>
> = {
  sources: 'sources',
  search: 'search',
  install: 'install',
  update: 'update',
  remove: 'remove',
  restore: 'restore',
};

/**
 * Describes a request sent to a plugin.
 */
export interface PackageManagerRequest<Op extends PackageManagerOp = PackageManagerOp> {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation requested.
   */
  readonly op: Op;

  /**
   * Gets the absolute folder the request acts on, absent only for `initialize`.
   */
  readonly root?: string;

  /**
   * Gets the operation's parameters.
   */
  readonly params: PackageManagerParams<Op>;
}

/**
 * Says why a request failed, when the reason changes what the surface does:
 * - `unsupported`: the plugin did not both declare and confirm the capability;
 * - `refused`: the host would not send the request, or would not accept its answer;
 * - `untrusted`: the user has not said they trust the folder.
 */
export type PackageManagerErrorCode = 'unsupported' | 'refused' | 'untrusted';

/**
 * Describes a plugin's answer to a request: the result on success, or the reason it failed.
 */
export type PackageManagerResponse<Op extends PackageManagerOp = PackageManagerOp> =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the operation's result.
       */
      readonly result: PackageManagerResult<Op>;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;

      /**
       * Gets what kind of failure it is, when that changes what the surface does.
       */
      readonly code?: PackageManagerErrorCode;
    };

/**
 * Describes a plugin asking Studio for a registry's credential, mid-request. Written to stdout like a
 * response, and answered on stdin with a {@link PackageManagerCredentialAnswer}.
 */
export interface PackageManagerCredentialRequest {
  /**
   * Discriminates this from a response.
   */
  readonly request: 'credential';

  /**
   * Gets the correlation identifier of this ask.
   */
  readonly callId: number;

  /**
   * Gets the https URL of the registry whose credential is wanted. Studio answers with a token the user
   * saved for this plugin and this registry, and with nothing otherwise.
   */
  readonly registry: string;
}

/**
 * Describes Studio's answer to a credential request, written to the plugin's stdin.
 */
export interface PackageManagerCredentialAnswer {
  /**
   * Discriminates this from a request.
   */
  readonly answer: 'credential';

  /**
   * Gets the correlation identifier of the ask this answers.
   */
  readonly callId: number;

  /**
   * Gets the credential, or null when Studio holds none or will not hand it over.
   */
  readonly token: string | null;
}

/**
 * Determines whether a plugin's announced protocol version is one this build can speak: the same major
 * version. A newer minor only adds things, which a plugin may use and this build ignores.
 * @param announced The version the plugin announced.
 * @returns Returns true when the version can be spoken.
 */
export function isCompatiblePackageManagerProtocol(announced: unknown): boolean {
  if (typeof announced !== 'string' || !/^\d+(\.\d+)*$/.test(announced)) {
    return false;
  }
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(PACKAGE_MANAGER_PROTOCOL_VERSION);
}

/**
 * Determines whether a value is a known optional capability.
 * @param value The candidate.
 * @returns Returns true when the value names a capability.
 */
export function isPackageManagerCapability(value: unknown): value is PackageManagerCapability {
  return (
    typeof value === 'string' && (PACKAGE_MANAGER_CAPABILITIES as readonly string[]).includes(value)
  );
}
