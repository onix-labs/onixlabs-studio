import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ForgeIssue, ForgeIssueComment } from '@shared/api/forge-types';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { MarkdownView } from '@shared/angular/components/markdown-view/markdown-view';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { IssueAgentConfirm } from '@shared/angular/components/panels/issue-agent-confirm/issue-agent-confirm';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';
import { IssueStore, OpenIssue } from '@shared/angular/services/issues/issue-store';
import { Shell } from '@shared/angular/services/shell/shell';

/**
 * Hosts one issue as a document in the well.
 *
 * The dock panel id names the issue; this resolves it from the {@link IssueStore} and renders what
 * the forge knows about it — the title and number, whether it is open or closed, who opened it and
 * when, its labels, assignees and milestone, its body, and the conversation beneath.
 *
 * The body and the comments are Markdown as their authors wrote them, so they go through the same
 * renderer an agent's messages do rather than being shown as source or, worse, as HTML this panel
 * assembled itself.
 */
@Component({
  selector: 'app-issue-document-panel',
  imports: [AppIcon, Button, MarkdownView, PanelToolbar, IssueAgentConfirm],
  templateUrl: './issue-document-panel.html',
  styleUrl: './issue-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueDocumentPanel {
  /**
   * Gets the dock panel descriptor; its id names the issue this panel shows.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the store the shown issue is resolved from.
   */
  private readonly issues: IssueStore = inject(IssueStore);

  /**
   * Holds the shell seam the issue is opened in a browser through.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the seam that starts a conversation about this issue, shared with the rail's row menu.
   */
  private readonly issueAgent: IssueAgent = inject(IssueAgent);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the issue this panel shows, or null when it is no longer open.
   */
  protected readonly entry: Signal<OpenIssue | null> = computed((): OpenIssue | null =>
    this.issues.get(this.panel().id),
  );

  /**
   * Gets the issue itself, or null when the panel shows none.
   */
  protected readonly issue: Signal<ForgeIssue | null> = computed(
    (): ForgeIssue | null => this.entry()?.issue ?? null,
  );

  /**
   * Gets the conversation, empty until it has been read.
   */
  protected readonly comments: Signal<readonly ForgeIssueComment[]> = computed(
    (): readonly ForgeIssueComment[] => this.entry()?.comments ?? [],
  );

  /**
   * Gets whether the body is empty, so the panel can say so rather than showing a blank.
   */
  protected readonly hasBody: Signal<boolean> = computed(
    (): boolean => (this.issue()?.body ?? '').trim().length > 0,
  );

  /**
   * Starts a conversation about this issue in the view's agent.
   *
   * The same seam the issue's row in the rail asks through, so the opening message and the warning
   * about discarding a transcript are one behaviour offered from two places.
   */
  protected openInAgent(): void {
    const issue: ForgeIssue | null = this.issue();
    if (issue !== null) {
      this.issueAgent.open(issue);
    }
  }

  /**
   * Opens the issue on the forge.
   */
  protected openExternally(): void {
    const url: string = this.issue()?.url ?? '';
    if (url.length > 0) {
      void this.shell.openExternal(url);
    }
  }

  /**
   * Formats an ISO timestamp for reading, falling back to the raw value when it cannot be parsed —
   * an unparseable date is still worth showing, and is better evidence of a problem than a blank.
   * @param iso The ISO 8601 timestamp.
   * @returns Returns the formatted date.
   */
  protected formatDate(iso: string): string {
    const parsed: number = Date.parse(iso);
    return Number.isNaN(parsed)
      ? iso
      : new Date(parsed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
