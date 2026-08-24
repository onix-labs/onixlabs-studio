// The forge capability's slice of the IPC contract: the shapes the renderer's Repository panel renders
// and the main-process forge contribution produces. A "forge" is the hosting service a repository's
// remote points at — GitHub today, with the seam admitting GitLab and self-hosted instances later.
//
// Deliberately a normalised model rather than the provider's own JSON: the panel renders pull requests,
// issues and workflow runs without knowing which forge they came from, and a second implementation
// changes nothing downstream. No credential ever appears in these shapes — only whether one resolved,
// and to whom.

/**
 * Identifies a forge implementation.
 */
export type ForgeKind = 'github';

/**
 * Identifies a repository on a forge, as resolved from a git remote's URL.
 */
export interface ForgeRepositoryRef {
  /**
   * Gets the forge the repository is hosted on.
   */
  readonly kind: ForgeKind;

  /**
   * Gets the forge host (`github.com`), which a self-hosted instance would vary.
   */
  readonly host: string;

  /**
   * Gets the repository's owner (a user or organisation).
   */
  readonly owner: string;

  /**
   * Gets the repository's name, without the `.git` suffix.
   */
  readonly name: string;
}

/**
 * Describes the account a resolved credential authenticates as.
 */
export interface ForgeIdentity {
  /**
   * Gets the account's login handle.
   */
  readonly login: string;

  /**
   * Gets the account's display name, or null when it has none set.
   */
  readonly name: string | null;
}

/**
 * Identifies where the credential in use came from. `none` means no credential resolved at all.
 */
export type ForgeTokenSource = 'stored' | 'gh-cli' | 'none';

/**
 * Reports the forge authentication state, for the settings page and the panel's signed-out row. Carries
 * no token: only its provenance, whether it works, and who it belongs to.
 */
export interface ForgeAuthStatus {
  /**
   * Gets where the credential in use came from.
   */
  readonly source: ForgeTokenSource;

  /**
   * Gets a value indicating whether a credential resolved and the forge accepted it.
   */
  readonly authenticated: boolean;

  /**
   * Gets a value indicating whether a token is stored on this machine, which is what the settings
   * page's Clear action acts on. True even when the stored token turns out to be rejected.
   */
  readonly hasStoredToken: boolean;

  /**
   * Gets the account the credential authenticates as, or null when none did.
   */
  readonly identity: ForgeIdentity | null;

  /**
   * Gets a human-readable explanation of the state, shown verbatim in the settings page. Says what to
   * do about it when the state is unhappy, rather than only naming it.
   */
  readonly detail: string;
}

/**
 * Summarises the outcome of a pull request's checks, as the panel's status badge shows it.
 */
export type ForgeCheckStatus = 'running' | 'succeeded' | 'failed' | 'none';

/**
 * Describes an open pull request.
 */
export interface ForgePullRequest {
  /**
   * Gets the pull request number.
   */
  readonly number: number;

  /**
   * Gets the pull request title.
   */
  readonly title: string;

  /**
   * Gets the login of the account that opened it.
   */
  readonly author: string;

  /**
   * Gets the web URL, for opening it in a browser.
   */
  readonly url: string;

  /**
   * Gets a value indicating whether the pull request is a draft.
   */
  readonly draft: boolean;

  /**
   * Gets the name of the branch the changes are on, which is what checking the pull request out
   * checks out.
   */
  readonly headRef: string;

  /**
   * Gets the rolled-up outcome of the pull request's checks.
   */
  readonly checks: ForgeCheckStatus;
}

/**
 * Describes an open issue.
 */
export interface ForgeIssue {
  /**
   * Gets the issue number.
   */
  readonly number: number;

  /**
   * Gets the issue title.
   */
  readonly title: string;

  /**
   * Gets the login of the account that opened it.
   */
  readonly author: string;

  /**
   * Gets the web URL, for opening it in a browser.
   */
  readonly url: string;

  /**
   * Gets the issue's label names.
   */
  readonly labels: readonly string[];

  /**
   * Gets the logins of the accounts the issue is assigned to.
   */
  readonly assignees: readonly string[];
}

/**
 * Identifies where a CI run has got to. Deliberately distinct from {@link ForgeCheckStatus}: a run
 * queued but not started is a state a pull request's rolled-up checks do not have.
 */
export type ForgeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Describes a CI/CD workflow run.
 */
export interface ForgeWorkflowRun {
  /**
   * Gets the run's forge-assigned identifier, which the re-run and cancel operations address it by.
   */
  readonly id: number;

  /**
   * Gets the workflow's display name.
   */
  readonly name: string;

  /**
   * Gets the run's status.
   */
  readonly status: ForgeRunStatus;

  /**
   * Gets the web URL, for opening the run in a browser.
   */
  readonly url: string;

  /**
   * Gets the branch the run was triggered on.
   */
  readonly branch: string;

  /**
   * Gets the event that triggered the run (`push`, `pull_request`, …).
   */
  readonly event: string;

  /**
   * Gets when the run started, as an ISO-8601 timestamp.
   */
  readonly startedAt: string;
}

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
    };
