import { inject, Service } from '@angular/core';
import { ForgeIssue, ForgeIssueComment, ForgeResult } from '@shared/api/forge-types';
import { IssueDocumentPanel } from '@shared/angular/components/panels/issue-document-panel/issue-document-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { findPrimaryStack, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { Log } from '@shared/angular/services/log/log';
import { IssueStore } from './issue-store';

/**
 * Opens an issue as a document in the well, reusing its tab when it is already open.
 *
 * The diff opener's sibling, and deliberately built the same way: the store holds the content, this
 * holds the dock, and neither the store nor the dock references the other's concerns. It also makes
 * a well when the layout has none, so the Git surface — which opens on the history, with no well
 * standing empty — can still open one.
 */
@Service()
export class IssueOpener {
  /**
   * Holds the store the opened panel resolves from.
   */
  private readonly issues: IssueStore = inject(IssueStore);

  /**
   * Holds the dock layout the document well lives in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock focus tracker, so opening an issue accents its well.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock panel registry issue panels are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the forge-backed repository the conversation is read through.
   */
  private readonly forgeRepository: ForgeRepository = inject(ForgeRepository);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens (or re-activates) an issue in the document well, then reads its conversation.
   *
   * The issue itself needs no request: the list entry carries the body and everything around it, so
   * the panel is complete the moment it opens and the comments fill in underneath.
   *
   * @param issue The issue to open.
   */
  public open(issue: ForgeIssue): void {
    const id: string = this.issues.idForIssue(issue.number);
    this.issues.put(id, issue);
    if (!this.registry.has(id)) {
      this.registry.register({
        id,
        title: `#${issue.number}`,
        icon: Icon.INFO,
        role: 'document',
        component: IssueDocumentPanel,
        // The panel draws its own strip: the well's stubbed editor tools have nothing to do with an
        // issue, and its state badge and Open on GitHub have everything to do with one.
        ownsToolStrip: true,
      });
    }

    const well: StackNode | null =
      firstStackOfRole(this.dockState.layout(), 'document') ?? this.makeWell(id);
    if (well === null) {
      this.log.warn('IssueOpener', `Nowhere to open issue #${issue.number}`);
      return;
    }
    this.log.info('IssueOpener', `Opened issue #${issue.number}`);
    if (well.panels.includes(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
    this.loadComments(id, issue);
  }

  /**
   * Reads an issue's conversation into the store.
   *
   * An issue with no comments is not asked about at all: the count came with the list entry precisely
   * so an empty conversation costs no request.
   *
   * @param id The dock panel id.
   * @param issue The issue whose comments to read.
   */
  private loadComments(id: string, issue: ForgeIssue): void {
    if (issue.commentCount === 0) {
      this.issues.putComments(id, []);
      return;
    }
    this.issues.markLoading(id);
    void this.forgeRepository
      .issueComments(issue.number)
      .then((result: ForgeResult<readonly ForgeIssueComment[]>): void => {
        if (result.ok) {
          this.issues.putComments(id, result.value);
        } else {
          this.issues.putCommentsError(id, result.error);
        }
      });
  }

  /**
   * Makes a document well above the layout's centre slot, holding the given panel.
   * @param panelId The panel the new well opens holding.
   * @returns Returns the new well, or null when there is no centre slot to split.
   */
  private makeWell(panelId: string): StackNode | null {
    const centre: StackNode | null = findPrimaryStack(this.dockState.layout());
    if (centre === null) {
      return null;
    }
    this.log.info('IssueOpener', 'No document well in this layout; making one');
    this.dockState.splitStack(centre.id, panelId, 'top', 'document');
    return firstStackOfRole(this.dockState.layout(), 'document');
  }
}
