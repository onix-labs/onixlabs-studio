import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiClient } from '@shared/api/ai-channels';
import type { AiWorkspaceExclusions } from '@shared/api/ai-types';
import { sanitizeExcludedCommands } from '@shared/api/excluded-commands';
import { Ai } from '@shared/angular/services/ai/ai';
import { Log } from '@shared/angular/services/log/log';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';

/**
 * Keeps the renderer's view of each workspace's excluded commands (#1163): the private list Studio
 * keeps for the user, and the shared list the repository brings with whether the user has reviewed it.
 * The global list is a plain setting and is not here.
 *
 * The main process owns both lists and decides what applies to a run; this only reads them for the
 * surfaces that show them (Settings, the transcript's one-click exclusion, the review notice) and
 * passes the user's changes on.
 */
@Service()
export class AgentExclusions {
  /**
   * Holds the AI-agent operations, absent outside Electron.
   */
  private readonly client: AiClient | undefined = inject(Ai).client;

  /**
   * Holds the shared configuration of the focused workspace, which is where a shared list is written.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the focused workspace.
   */
  private readonly workspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each workspace's lists as last read, by root.
   */
  private readonly byRoot: WritableSignal<ReadonlyMap<string, AiWorkspaceExclusions>> = signal<
    ReadonlyMap<string, AiWorkspaceExclusions>
  >(new Map<string, AiWorkspaceExclusions>());

  /**
   * Holds the workspaces whose review the user put off with Not Now, for this session.
   */
  private readonly snoozed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets every workspace's lists as last read.
   */
  public readonly all: Signal<ReadonlyMap<string, AiWorkspaceExclusions>> =
    this.byRoot.asReadonly();

  /**
   * Gets a workspace's lists as last read, or undefined before they have been.
   * @param root The workspace root.
   * @returns Returns the lists.
   */
  public of(root: string): AiWorkspaceExclusions | undefined {
    return this.byRoot().get(root);
  }

  /**
   * Gets the shared exclusions waiting for the user's review in a workspace: the repository's list,
   * when it has one the user has not reviewed and has not put off this session.
   * @param root The workspace root, or null for none.
   * @returns Returns the patterns, empty when nothing is waiting.
   */
  public pendingReview(root: string | null): readonly string[] {
    if (root === null || this.snoozed().has(root)) {
      return [];
    }
    const lists: AiWorkspaceExclusions | undefined = this.byRoot().get(root);
    return lists === undefined || lists.sharedReviewed ? [] : lists.shared;
  }

  /**
   * Reads a workspace's lists afresh.
   * @param root The workspace root.
   * @returns Returns a promise that settles once they are read.
   */
  public async refresh(root: string): Promise<void> {
    this.store(await this.client?.getWorkspaceExclusions(root).catch(() => null), root);
  }

  /**
   * Adds a pattern to a workspace's private list: the one-click exclusion a sandbox crash offers.
   * @param root The workspace root.
   * @param pattern The pattern.
   * @returns Returns a promise that settles once it is saved.
   */
  public async excludeForWorkspace(root: string, pattern: string): Promise<void> {
    await this.refresh(root);
    const current: readonly string[] = this.byRoot().get(root)?.private ?? [];
    this.log.info('AgentExclusions', 'Excluded a command for a workspace', root, pattern);
    await this.setPrivate(root, sanitizeExcludedCommands([...current, pattern]));
  }

  /**
   * Replaces a workspace's private list.
   * @param root The workspace root.
   * @param patterns The new list.
   * @returns Returns a promise that settles once it is saved.
   */
  public async setPrivate(root: string, patterns: readonly string[]): Promise<void> {
    this.store(
      await this.client
        ?.setPrivateExclusions({ workspaceRoot: root, patterns: [...patterns] })
        .catch(() => null),
      root,
    );
  }

  /**
   * Replaces the focused workspace's shared list, which the team commits. The user wrote it, so it is
   * recorded as reviewed in the same step.
   * @param patterns The new list.
   * @returns Returns a promise that settles once it is saved.
   */
  public async setShared(patterns: readonly string[]): Promise<void> {
    const root: string | null = this.workspace.rootPath();
    if (root === null) {
      return;
    }
    const clean: readonly string[] = sanitizeExcludedCommands(patterns);
    await this.studio.saveExcludedCommands(clean);
    await this.review(root, clean);
  }

  /**
   * Records that the user reviewed a workspace's shared list, so exactly it applies (Allow).
   * @param root The workspace root.
   * @param patterns The list the user saw.
   * @returns Returns a promise that settles once it is recorded.
   */
  public async review(root: string, patterns: readonly string[]): Promise<void> {
    this.log.info('AgentExclusions', 'Reviewed shared exclusions', root, patterns.length);
    this.store(
      await this.client
        ?.reviewSharedExclusions({ workspaceRoot: root, patterns: [...patterns] })
        .catch(() => null),
      root,
    );
  }

  /**
   * Puts off a workspace's review for this session (Not Now). The shared list stays ignored.
   * @param root The workspace root.
   */
  public snooze(root: string): void {
    this.snoozed.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      next.add(root);
      return next;
    });
  }

  /**
   * Keeps a workspace's lists as the main process answered them.
   * @param lists The answer, or null/undefined when there was none.
   * @param root The workspace asked about.
   */
  private store(lists: AiWorkspaceExclusions | null | undefined, root: string): void {
    if (lists === null || lists === undefined) {
      return;
    }
    this.byRoot.update(
      (
        current: ReadonlyMap<string, AiWorkspaceExclusions>,
      ): ReadonlyMap<string, AiWorkspaceExclusions> =>
        new Map<string, AiWorkspaceExclusions>(current).set(root, lists),
    );
  }
}
