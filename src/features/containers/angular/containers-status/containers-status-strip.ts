import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { ContainersSummary, ContainersView } from '../containers-view/containers-view';

/**
 * The Containers tab's status-strip readout (#882). On the left, which engine the tab is showing — and
 * that it is not running, when it does not answer, since an empty list says nothing about why. At the
 * end, how many containers and images it holds. How many are running is left to the app-wide segment
 * the strip already shows on every tab.
 *
 * Mounted by the status strip through the Containers view's own injector, from which it reads the view
 * itself.
 */
@Component({
  selector: 'app-containers-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainersStatusStrip {
  /**
   * Holds the view whose engine and lists are reported.
   */
  private readonly view: ContainersView = inject(ContainersView);

  /**
   * Gets the start-aligned segments: the engine, marked when it does not answer.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const summary: ContainersSummary = this.view.summary();
      if (summary.engine === null) {
        return [{ id: 'containers-engine', text: 'No engine installed' }];
      }
      return [
        {
          id: 'containers-engine',
          text: summary.available === false ? `${summary.engine} (not running)` : summary.engine,
          shrink: 'end',
        },
      ];
    },
  );

  /**
   * Gets the end-aligned segments: the container and image counts, once the engine has answered.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const summary: ContainersSummary = this.view.summary();
      if (summary.available !== true) {
        return [];
      }
      return [
        {
          id: 'containers-count',
          text: summary.containers === 1 ? '1 container' : `${summary.containers} containers`,
        },
        {
          id: 'containers-images',
          text: summary.images === 1 ? '1 image' : `${summary.images} images`,
        },
      ];
    },
  );
}
