// The forge capability's slice of the IPC contract: the shapes the renderer's source-control panels
// render. A "forge" is the hosting service a repository's remote points at — served by whichever hosting
// plugin declares the host (#819, #820): GitHub today, GitLab and self-hosted instances later.
//
// The renderer's view of the hosting protocol. The item shapes are the protocol's own, so a plugin's
// answer reaches a panel unchanged; what is the renderer's alone is the repository reference (which
// names the plugin serving it, for display), the authentication summary the settings page draws, and
// the result wrapper a panel reads. No credential ever appears in these shapes — only whether one
// resolved, and to whom.

import type {
  HostedCheckStatus,
  HostedCiRun,
  HostedCiRunStatus,
  HostedIdentity,
  HostedIssue,
  HostedIssueComment,
  HostedPullRequest,
  HostingAuthMode,
  HostingCapability,
} from './hosting-protocol';

/**
 * Names a repository on a forge, as the renderer holds it.
 */
export interface ForgeRepositoryRef {
  /**
   * Gets the display name of the plugin serving the repository's host, such as `GitHub`.
   */
  readonly provider: string;

  /**
   * Gets the host's name, lowercased, such as `github.com`.
   */
  readonly host: string;

  /**
   * Gets the owning account's name.
   */
  readonly owner: string;

  /**
   * Gets the repository's name.
   */
  readonly name: string;
}

/**
 * Describes what a forge repository allows: the capabilities its plugin has, narrowed to those the
 * repository itself allows. What the panels gate their sections and commands on.
 */
export interface ForgeRepositoryCapabilities {
  /**
   * Gets the display name of the plugin serving the repository.
   */
  readonly provider: string;

  /**
   * Gets the capabilities on offer.
   */
  readonly capabilities: readonly HostingCapability[];
}

/**
 * Describes the account a credential authenticates as.
 */
export type ForgeIdentity = HostedIdentity;

/**
 * Reports how a hosting plugin is signed in to one host, for the settings page and the setup summary.
 * Carries no token: only how the plugin signed in, whether it works, and who it belongs to.
 */
export interface ForgeAuthStatus {
  /**
   * Gets how the plugin signed in — its host's own CLI login, or the token Studio keeps — or null when
   * it could not.
   */
  readonly mode: HostingAuthMode | null;

  /**
   * Gets whether the host accepted the credential.
   */
  readonly authenticated: boolean;

  /**
   * Gets whether Studio holds a token of its own for the host — what the settings page's Clear acts on,
   * true even when the stored token is rejected or another credential is in use.
   */
  readonly hasStoredToken: boolean;

  /**
   * Gets who the credential authenticates as, or null when it does not.
   */
  readonly identity: ForgeIdentity | null;

  /**
   * Gets what to tell the user.
   */
  readonly detail: string;
}

/**
 * Describes one host an installed hosting plugin serves, and how it is signed in to it (#821): one
 * row of Settings ▸ Source Control, and of the setup summary. Core names no host; these come from the
 * plugins' manifests.
 */
export interface ForgeHostAccount {
  /**
   * Gets the plugin's id.
   */
  readonly pluginId: string;

  /**
   * Gets the plugin's display name, such as `GitHub`.
   */
  readonly provider: string;

  /**
   * Gets the host's name, lowercased, such as `github.com`.
   */
  readonly host: string;

  /**
   * Gets the ways the plugin can sign in, as its manifest declares them.
   */
  readonly authModes: readonly HostingAuthMode[];

  /**
   * Gets the way the user chose, or null when the plugin decides: its CLI's login when that is signed
   * in, the token Studio keeps otherwise.
   */
  readonly authMode: HostingAuthMode | null;

  /**
   * Gets how the plugin is signed in to the host now.
   */
  readonly status: ForgeAuthStatus;
}

/**
 * Describes the combined state of a pull request's checks.
 */
export type ForgeCheckStatus = HostedCheckStatus;

/**
 * Describes a pull request.
 */
export type ForgePullRequest = HostedPullRequest;

/**
 * Describes an issue.
 */
export type ForgeIssue = HostedIssue;

/**
 * Describes a comment on an issue.
 */
export type ForgeIssueComment = HostedIssueComment;

/**
 * Describes where a CI run is.
 */
export type ForgeRunStatus = HostedCiRunStatus;

/**
 * Describes a CI run.
 */
export type ForgeWorkflowRun = HostedCiRun;

/**
 * Wraps a forge read so a failure is data rather than a thrown error crossing IPC. The panel needs to
 * tell "the forge said there are none" from "the request failed" — an empty list cannot express the
 * difference, and a rejected promise loses the reason by the time it reaches a template.
 */
export type ForgeResult<T> =
  | {
      /**
       * Marks the read as successful.
       */
      readonly ok: true;

      /**
       * Gets the value read.
       */
      readonly value: T;
    }
  | {
      /**
       * Marks the read as failed.
       */
      readonly ok: false;

      /**
       * Gets why it failed, in terms the panel can show the user.
       */
      readonly error: string;

      /**
       * Gets a value indicating whether the failure was an authentication problem, which the panel
       * answers with "sign in" rather than "try again".
       */
      readonly unauthorized: boolean;

      /**
       * Gets when the forge will accept requests again, as epoch milliseconds, for a failure that is
       * the rate limit rather than anything wrong.
       */
      readonly retryAt?: number;
    };
