import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';

/**
 * Identifies the strip menu's commands.
 */
const MENU_OPEN_IN_BROWSER: string = 'issue.openInBrowser';
const MENU_COPY_LINK: string = 'issue.copyLink';
import { ForgeIssue, ForgeIssueComment } from '@shared/api/forge-types';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { MarkdownRenderer } from '@shared/angular/components/markdown-renderer/markdown-renderer';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { IssueAgentConfirm } from '@shared/angular/components/panels/issue-agent-confirm/issue-agent-confirm';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';
import { IssueStore, OpenIssue } from '@shared/angular/services/issues/issue-store';
import { Shell } from '@shared/angular/services/shell/shell';
import { Chip } from '@shared/angular/components/chip/chip';

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
  imports: [Chip, Button, CdkMenuTrigger, IssueAgentConfirm, MarkdownRenderer, Menu, PanelToolbar],
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
  /**
   * Holds the dock layout, which says whether this issue is the active document in its well.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the well's status strip, which shows what the issue is (#882).
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Gets whether this issue is the active document in its well, so it alone fills the status strip.
   */
  private readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });

  /**
   * Gets the strip menu's items.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => {
    const hasUrl: boolean = (this.issue()?.url ?? '').length > 0;
    return [
      {
        id: MENU_OPEN_IN_BROWSER,
        label: 'Open in Browser',
        icon: Icon.OPEN_EXTERNAL,
        disabled: !hasUrl,
      },
      { id: MENU_COPY_LINK, label: 'Copy Link', icon: Icon.COPY, disabled: !hasUrl },
    ];
  });

  /**
   * Initializes a new instance of the {@link IssueDocumentPanel} class, publishing what the issue is —
   * its state, number, conversation and last update — to the well's status strip while it is the
   * active document (#882).
   */
  public constructor() {
    effect((): void => {
      const issue: ForgeIssue | null = this.issue();
      const id: string = this.panel().id;
      if (!this.isActive() || issue === null) {
        this.documentStatus.clear(id);
        return;
      }
      const open: boolean = issue.state === 'open';
      this.documentStatus.set(id, {
        chip: {
          text: open ? 'Open' : 'Closed',
          tone: open ? 'success' : 'accent',
          title: "The issue's state",
        },
        details: [
          { text: `#${issue.number}`, title: 'Issue number' },
          {
            text: `${issue.commentCount} ${issue.commentCount === 1 ? 'comment' : 'comments'}`,
            title: 'Comments',
          },
          { text: `Updated ${this.formatDate(issue.updatedAt)}`, title: 'Last updated' },
        ],
      });
    });
    inject(DestroyRef).onDestroy((): void => this.documentStatus.clear(this.panel().id));
  }

  /**
   * Runs a command chosen from the strip's menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    const url: string = this.issue()?.url ?? '';
    if (url.length === 0) {
      return;
    }
    if (id === MENU_OPEN_IN_BROWSER) {
      void this.shell.openExternal(url);
    } else if (id === MENU_COPY_LINK) {
      void navigator.clipboard.writeText(url).catch((): void => undefined);
    }
  }

  protected openInAgent(): void {
    const issue: ForgeIssue | null = this.issue();
    if (issue !== null) {
      this.issueAgent.open(issue);
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
