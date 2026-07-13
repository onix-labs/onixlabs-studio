import { inject, Service } from '@angular/core';
import { DiffDocumentPanel } from '@shared/angular/components/panels/diff-document-panel/diff-document-panel';
import { Icon } from '@shared/angular/icons/icon';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';

/**
 * The stable dock panel id the agent's edit preview opens under. One preview shows at a time (the
 * run blocks on the decision), so the panel is registered once and its content replaced per preview
 * — the same reuse pattern as the source-control {@link import('@shared/angular/services/diffs/diff-opener').DiffOpener}.
 */
const PREVIEW_PANEL_ID: string = 'agent-edit-preview';

/**
 * Shows the agent's staged edit as a diff in the document well while the user decides (#242): the
 * document's current text against the prospective text. Only code targets open here — markdown has
 * no diff editor, so its decision card carries the summary alone. Content rides the shared
 * {@link Diffs} store (a synthetic modified-file entry), rendered by the same
 * {@link DiffDocumentPanel} the source-control diffs use.
 */
@Service()
export class AgentEditPreview {
  /**
   * Holds the diff content store the preview panel resolves from.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the dock layout the document well lives in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock focus tracker, so the preview accents its well.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock panel registry the preview panel is registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Opens (or replaces) the staged-edit diff in the document well.
   * @param title The document's display name, shown as the diff tab title.
   * @param language The Monaco language id used to highlight the diff.
   * @param original The document's current text.
   * @param modified The prospective text after the staged edit.
   */
  public open(title: string, language: string, original: string, modified: string): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      return;
    }
    this.diffs.put(PREVIEW_PANEL_ID, {
      path: title,
      status: 'modified',
      additions: 0,
      deletions: 0,
      language,
      original,
      modified,
    });
    if (this.registry.has(PREVIEW_PANEL_ID)) {
      this.dockState.setActive(well.id, PREVIEW_PANEL_ID);
    } else {
      this.registry.register({
        id: PREVIEW_PANEL_ID,
        title: 'Agent edit',
        icon: Icon.GIT_DIFF,
        role: 'document',
        component: DiffDocumentPanel,
      });
      this.dockState.tabInto(well.id, PREVIEW_PANEL_ID);
    }
    this.dockFocus.focus(well.id);
  }

  /**
   * Closes the staged-edit diff, if showing.
   */
  public close(): void {
    this.dockState.removeFromLayout(PREVIEW_PANEL_ID);
  }
}
