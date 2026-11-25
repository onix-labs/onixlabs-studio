import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { SearchView } from '@shared/angular/components/search-view/search-view';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiFind } from '../../api-find/api-find';

/**
 * The API Explorer's Find & Replace panel (#1564): the shared search view — the same one the workspace's
 * panel shows — over the body of the request in front, which {@link ApiFind} keeps track of.
 */
@Component({
  selector: 'app-api-find-panel',
  imports: [SearchView],
  templateUrl: './api-find-panel.html',
  styleUrl: './api-find-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiFindPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the explorer's Find.
   */
  protected readonly find: ApiFind = inject(ApiFind);
}
