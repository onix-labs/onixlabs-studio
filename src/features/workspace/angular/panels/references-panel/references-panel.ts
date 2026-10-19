import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ReferencesView } from '@shared/angular/components/references-view/references-view';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Log } from '@shared/angular/services/log/log';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import type {
  ReferenceItem,
  ReferenceList,
} from '@shared/angular/services/references/reference-list';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { ReferencesPanelState } from './references-panel-state';

/**
 * The workspace's References panel (#1014): the shared {@link ReferencesView} in the dock, at the
 * bottom beside the Error List. It shows the list the workspace's latest Find All References — or Go
 * to Definition with several answers — put in {@link ReferencesPanelState}, its files named relative to
 * the workspace's root. Choosing a row opens its file in the well and selects the reference there,
 * centred, with the editor focused.
 */
@Component({
  selector: 'app-references-panel',
  imports: [ReferencesView],
  templateUrl: './references-panel.html',
  styleUrl: './references-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencesPanel {
  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the list this workspace's panel shows.
   */
  private readonly state: ReferencesPanelState = inject(ReferencesPanelState);

  /**
   * Holds the active-workspace seam supplying the root files are named relative to.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the navigation a chosen row goes through.
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the list shown, or null before the first search.
   */
  protected readonly list: Signal<ReferenceList | null> = this.state.list;

  /**
   * Gets the workspace's root, which files are named relative to.
   */
  protected readonly root: Signal<string | null> = this.activeWorkspace.rootPath;

  /**
   * Goes to a chosen place: opens its file in the well, and selects the reference there.
   * @param item The place.
   */
  protected onChosen(item: ReferenceItem): void {
    this.log.debug('references', 'Go to reference', item.path, item.range.startLineNumber);
    void this.navigation.goTo(null, item, true);
  }
}
