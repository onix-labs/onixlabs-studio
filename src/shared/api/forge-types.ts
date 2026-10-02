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
   * Gets the name of the branch the changes are on, which names the local branch a checkout creates.
   */
  readonly headRef: string;

  /**
   * Gets the ref on the repository's own remote that carries the pull request's head.
   *
   * This is what a checkout actually fetches, and it is the forge's convention rather than git's —
   * GitHub publishes `refs/pull/N/head`. It matters because a pull request opened from a fork has its
   * branch in the contributor's repository, not this one: there is no {@link headRef} here to check
   * out, but the head is reachable through this ref either way.
   */
  readonly headRefspec: string;

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

  /**
   * Gets whether the issue is open or closed.
   */
  readonly state: 'open' | 'closed';

  /**
   * Gets the issue's body as the author wrote it — Markdown, unrendered.
   *
   * Carried on the list entry rather than fetched per issue, because GitHub's issues endpoint
   * returns it already: asking again for what has been read and thrown away would spend a request to
   * learn nothing.
   */
  readonly body: string;

  /**
   * Gets when the issue was opened, as an ISO 8601 timestamp.
   */
  readonly createdAt: string;

  /**
   * Gets when the issue was last touched, as an ISO 8601 timestamp.
   */
  readonly updatedAt: string;

  /**
   * Gets when the issue was closed, as an ISO 8601 timestamp, or undefined while it is open.
   */
  readonly closedAt?: string;

  /**
   * Gets how many comments the issue has, so a reader knows whether there is a conversation before
   * the request to fetch one is made.
   */
  readonly commentCount: number;

  /**
   * Gets the title of the milestone the issue belongs to, or undefined when it belongs to none.
   */
  readonly milestone?: string;
}

/**
 * Summarises an issue's children: how many sub-issues it has, and how many of those are closed.
 */
export interface ForgeChildSummary {
  /**
   * Gets how many sub-issues the issue has, open or closed.
   */
  readonly total: number;

  /**
   * Gets how many of those sub-issues are closed.
   */
  readonly completed: number;
}

/**
 * Describes an open issue as a node of the repository's work-item hierarchy (epic #788).
 *
 * Deliberately narrower than {@link ForgeIssue}: no body and no comment count, because the hierarchy
 * is read for a whole repository at once and lists every open issue, and a body is the one field large
 * enough to make that payload matter. A reader that wants the body opens the issue.
 */
export interface ForgeWorkItem {
  /**
   * Gets the issue number.
   */
  readonly number: number;

  /**
   * Gets the issue title.
   */
  readonly title: string;

  /**
   * Gets the web URL, for opening it in a browser.
   */
  readonly url: string;

  /**
   * Gets the issue's label names, which is where a repository without issue types says what level an
   * item is (`epic`, `feature`, …).
   */
  readonly labels: readonly string[];

  /**
   * Gets the name of the issue's type (`Bug`, `Feature`, `Task`, …), or null when the repository's
   * organisation does not use issue types.
   */
  readonly type: string | null;

  /**
   * Gets the logins of the accounts the issue is assigned to.
   */
  readonly assignees: readonly string[];

  /**
   * Gets the number of the issue's parent in the same repository, or null when it has none — or when
   * its parent lives in another repository, which this hierarchy does not cross.
   */
  readonly parent: number | null;

  /**
   * Gets the summary of the issue's sub-issues, open and closed. Closed children are not listed (the
   * listing is open issues only), so this is what a parent's progress is derived from.
   */
  readonly children: ForgeChildSummary;

  /**
   * Gets how many open issues block this one.
   */
  readonly blockedBy: number;

  /**
   * Gets a value indicating whether the issue's author is the repository's owner, a member of its
   * organisation, or a collaborator. An issue filed by anyone else is untrusted input: on a public
   * repository anybody can open one, and an agent must not take its body as instructions.
   */
  readonly authorTrusted: boolean;

  /**
   * Gets when the issue was last touched, as an ISO 8601 timestamp.
   */
  readonly updatedAt: string;
}

/**
 * Describes one comment on an issue.
 */
export interface ForgeIssueComment {
  /**
   * Gets the comment's identifier, stable enough to track a rendered list by.
   */
  readonly id: number;

  /**
   * Gets the login of the account that wrote it.
   */
  readonly author: string;

  /**
   * Gets the comment's body as written — Markdown, unrendered.
   */
  readonly body: string;

  /**
   * Gets when the comment was posted, as an ISO 8601 timestamp.
   */
  readonly createdAt: string;

  /**
   * Gets the web URL of the comment, for opening it in a browser.
   */
  readonly url: string;
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

      /**
       * Gets when the forge will accept requests again, as epoch milliseconds, for a failure that is
       * the rate limit rather than anything wrong. Present only then — its presence is what tells a
       * caller to wait rather than to retry, and what lets the panel say how long for.
       */
      readonly retryAt?: number;
    };
