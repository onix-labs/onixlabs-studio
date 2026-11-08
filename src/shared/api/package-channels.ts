import type { PackageManagerCapability, PackageManagerErrorCode } from './package-manager-protocol';
import type { RepositoryTrustDecision } from './source-control-channels';

/**
 * Names the package-management IPC channels the Packages panel and Settings speak to the main process
 * over. Every package manager is a plugin (#907, #911), so each question names the plugin it is for:
 * a folder can hold an npm package and a .NET solution side by side, and each is answered by its own.
 * The model payload types live in {@link import('./package-management')}.
 */
export enum PackageChannel {
  /**
   * Says which package managers apply to a workspace root, installed or not, and whether the user
   * trusts it (invoke).
   */
  Managers = 'package:managers',

  /**
   * Loads one plugin's package model for a workspace root, with installed and latest versions (invoke).
   */
  ModelLoad = 'package:model-load',

  /**
   * Lists one plugin's package sources available to browse and search for a workspace root (invoke).
   */
  Sources = 'package:sources',

  /**
   * Searches (or browses, with an empty query) one of a plugin's sources for a workspace root (invoke).
   */
  Search = 'package:search',

  /**
   * Trusts an open workspace root that is not a repository, so package managers may read it (invoke).
   * A repository is asked about by version control; a plain folder has nobody else to ask it.
   */
  TrustFolder = 'package:trust-folder',

  /**
   * Lists the registries a token is saved for, per plugin, never the tokens themselves (invoke).
   */
  Tokens = 'package:tokens',

  /**
   * Saves a token for one plugin and one registry, answering the new list (invoke).
   */
  SaveToken = 'package:save-token',

  /**
   * Forgets the token saved for one plugin and one registry, answering the new list (invoke).
   */
  ClearToken = 'package:clear-token',
}

/**
 * Describes a package manager that applies to a folder: a contributed plugin whose marker the folder
 * holds, whether it is installed or only offered.
 */
export interface PackageManagerSummary {
  /**
   * Gets the plugin's identifier, which every other question names.
   */
  readonly pluginId: string;

  /**
   * Gets the plugin's display name, such as `npm`.
   */
  readonly displayName: string;

  /**
   * Gets the ecosystem it serves, as the plugin names it.
   */
  readonly ecosystem: string;

  /**
   * Gets whether it is installed. One that is not is what the panel offers to install.
   */
  readonly installed: boolean;

  /**
   * Gets the capabilities its manifest declares. The panel draws its controls from these; the running
   * plugin confirms them, and the main process refuses whatever it does not.
   */
  readonly capabilities: readonly PackageManagerCapability[];
}

/**
 * Describes what the Packages panel can show for a workspace root.
 */
export interface PackageWorkspaceStatus {
  /**
   * Gets the package managers that apply, installed or not, highest priority first. Empty when the
   * folder holds nothing any contributed plugin recognises.
   */
  readonly managers: readonly PackageManagerSummary[];

  /**
   * Gets whether the user trusts the folder. A package manager reads only a trusted folder: its
   * configuration names the registries to talk to, and what to send them.
   */
  readonly trust: RepositoryTrustDecision;
}

/**
 * Describes a registry a token is saved for. The token itself never leaves the main process.
 */
export interface PackageRegistryToken {
  /**
   * Gets the plugin the token is handed to. A token saved for one plugin is never given another.
   */
  readonly pluginId: string;

  /**
   * Gets the registry, as an https URL without credentials, query or trailing slash.
   */
  readonly registry: string;
}

/**
 * Describes the answer to saving or clearing a token: the list as it now stands, or why it was refused.
 */
export type PackageTokenResult =
  | {
      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets every saved registry, per plugin.
       */
      readonly tokens: readonly PackageRegistryToken[];
    }
  | {
      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;
    };

/**
 * Describes a plugin's answer to one of the panel's questions: the result, or why there is none.
 */
export type PackageAnswer<Result> =
  | {
      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the result.
       */
      readonly result: Result;
    }
  | {
      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;

      /**
       * Gets what kind of failure it is, when that changes what the panel says: `unsupported` (the
       * plugin cannot do this), `refused` (Studio would not ask), `untrusted` (the folder is not
       * trusted).
       */
      readonly code?: PackageManagerErrorCode;
    };
