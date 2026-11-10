import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { AgentExclusions } from '@shared/angular/services/agent-exclusions/agent-exclusions';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import type { AiWorkspaceExclusions } from '@shared/api/ai-types';
import { isValidExcludedCommand, normaliseExcludedCommand } from '@shared/api/excluded-commands';

/**
 * Which list a row edits: every workspace's (a setting), this workspace's for this user only (Studio's
 * own data), or this workspace's for the team (the repository's `.studio/workspace.json`).
 */
type ListKind = 'global' | 'private' | 'shared';

/**
 * Represents the excluded-command editor in the AI settings section (#1163): the commands a Claude
 * agent's sandbox runs outside it, in the three scopes the user chooses between, as JetBrains offers a
 * word to the machine's dictionary or the project's.
 *
 * The workspace lists are the focused workspace's, until the workspace's own Security & Permissions
 * panel (#1167) takes them over. A shared list the repository brought shows whether it applies: it is
 * ignored until the user has reviewed exactly that list, and adding to it here counts as reviewing it.
 */
@Component({
  selector: 'app-ai-excluded-commands',
  imports: [Button, SettingRow, TextField],
  templateUrl: './ai-excluded-commands.html',
  styleUrl: './ai-excluded-commands.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiExcludedCommands {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service the global list is kept in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the workspace lists.
   */
  private readonly exclusions: AgentExclusions = inject(AgentExclusions);

  /**
   * Holds the focused workspace, whose lists are shown.
   */
  private readonly workspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the focused workspace's root, or null when none is open.
   */
  protected readonly root: Signal<string | null> = this.workspace.rootPath;

  /**
   * Gets the commands excluded in every workspace.
   */
  protected readonly global: Signal<readonly string[]> = this.settings.aiExcludedCommands;

  /**
   * Gets the focused workspace's lists as last read.
   */
  protected readonly lists: Signal<AiWorkspaceExclusions | undefined> = computed(
    (): AiWorkspaceExclusions | undefined => {
      const root: string | null = this.root();
      return root === null ? undefined : this.exclusions.all().get(root);
    },
  );

  /**
   * Holds what is being typed into each list's field.
   */
  protected readonly drafts: Record<ListKind, WritableSignal<string>> = {
    global: signal<string>(''),
    private: signal<string>(''),
    shared: signal<string>(''),
  };

  /**
   * Holds why the last entry was refused, and in which list, or null when none was.
   */
  protected readonly error: WritableSignal<{
    readonly kind: ListKind;
    readonly text: string;
  } | null> = signal<{ readonly kind: ListKind; readonly text: string } | null>(null);

  /**
   * Initializes a new instance of the {@link AiExcludedCommands} class, reading the focused
   * workspace's lists whenever it changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.root();
      if (root !== null) {
        void this.exclusions.refresh(root);
      }
    });
  }

  /**
   * Gets a list's entries.
   * @param kind Which list.
   * @returns Returns the entries.
   */
  protected entries(kind: ListKind): readonly string[] {
    switch (kind) {
      case 'global':
        return this.global();
      case 'private':
        return this.lists()?.private ?? [];
      default:
        return this.lists()?.shared ?? [];
    }
  }

  /**
   * Adds what has been typed to a list, refusing a pattern the sandbox could not use.
   * @param kind Which list to add to.
   */
  protected add(kind: ListKind): void {
    const pattern: string = normaliseExcludedCommand(this.drafts[kind]());
    if (pattern === '') {
      return;
    }
    if (!isValidExcludedCommand(pattern)) {
      this.error.set({
        kind,
        text:
          `"${pattern}" is not a command pattern. Use a command (make build) or a command and :* ` +
          `for it and anything after it (npx ng:*); "*" alone is refused.`,
      });
      return;
    }
    this.error.set(null);
    this.drafts[kind].set('');
    const current: readonly string[] = this.entries(kind);
    if (current.includes(pattern)) {
      return;
    }
    this.log.info('settings.ai', 'Excluded command added', kind, pattern);
    void this.commit(kind, [...current, pattern]);
  }

  /**
   * Removes a pattern from a list.
   * @param kind Which list.
   * @param index The entry index.
   */
  protected remove(kind: ListKind, index: number): void {
    this.log.info('settings.ai', 'Excluded command removed', kind, this.entries(kind)[index]);
    void this.commit(
      kind,
      this.entries(kind).filter((_: string, i: number): boolean => i !== index),
    );
  }

  /**
   * Allows the focused workspace's shared list as it stands: the review a repository's list needs.
   */
  protected allowShared(): void {
    const root: string | null = this.root();
    if (root !== null) {
      void this.exclusions.review(root, this.entries('shared'));
    }
  }

  /**
   * Persists a list.
   * @param kind Which list.
   * @param next The new entries.
   * @returns Returns a promise that settles once it is saved.
   */
  private async commit(kind: ListKind, next: readonly string[]): Promise<void> {
    const root: string | null = this.root();
    if (kind === 'global') {
      this.settings.setAiExcludedCommands(next);
    } else if (root !== null && kind === 'private') {
      await this.exclusions.setPrivate(root, next);
    } else if (root !== null) {
      await this.exclusions.setShared(next);
    }
  }
}
