import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FindPanel } from '@shared/angular/components/find-panel/find-panel';
import { WorkspaceSearchAdapter } from '@features/workspace/angular/find/workspace-search-adapter';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';

/**
 * Hosts the shared find panel as a workspace dock tool panel, wiring it to a
 * {@link WorkspaceSearchAdapter} that searches the active workspace root. The dock supplies the tab
 * chrome, so the find panel is rendered headerless. This is the workspace's slice of the shared Find
 * & Replace panel: the same component the editors host, backed by a multi-file adapter.
 */
@Component({
  selector: 'app-search-panel',
  imports: [FindPanel],
  template: `<app-find-panel [adapter]="adapter" [showHeader]="false" />`,
  styles: [':host { display: block; block-size: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanel {
  /**
   * Holds the search client that runs the query in the main process.
   */
  private readonly search: Search = inject(Search);

  /**
   * Holds the file opener used to open a match's file.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal an opened match's line.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the active-workspace seam supplying the root to search.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the workspace adapter the find panel drives, rooted at the active workspace.
   */
  protected readonly adapter: WorkspaceSearchAdapter = new WorkspaceSearchAdapter(
    this.search,
    this.fileOpener,
    this.editors,
    (): string | null => this.activeWorkspace.rootPath(),
  );
}
