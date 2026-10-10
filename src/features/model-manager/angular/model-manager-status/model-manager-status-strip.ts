import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { ModelManagerSummary, ModelManagerView } from '../model-manager-view/model-manager-view';

/**
 * The Model Manager tab's status-strip readout (#882). On the left, the local runtime and its version
 * — or that it is not running, or not installed, since an empty model list says nothing about why. At
 * the end: downloads in progress (while any are), how many models are installed, how many are loaded
 * in memory (while any are), and the disk the installed models use. The counts come from the
 * runtime's server and are left out while it is not running; the disk figure is shown either way.
 *
 * Mounted by the status strip through the Model Manager view's own injector, from which it reads the
 * view itself.
 */
@Component({
  selector: 'app-model-manager-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelManagerStatusStrip {
  /**
   * Holds the view whose runtime and models are reported.
   */
  private readonly view: ModelManagerView = inject(ModelManagerView);

  /**
   * Gets the start-aligned segments: the runtime, with its version or its state.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const summary: ModelManagerSummary = this.view.summary();
      const text: string =
        summary.state === 'absent'
          ? `${summary.runtime} not installed`
          : summary.state === 'stopped'
            ? `${summary.runtime} (not running)`
            : summary.version === null
              ? summary.runtime
              : `${summary.runtime} ${summary.version}`;
      return [{ id: 'models-runtime', text, shrink: 'end' }];
    },
  );

  /**
   * Gets the end-aligned segments: downloads, installed and loaded models, and the disk used.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const summary: ModelManagerSummary = this.view.summary();
      if (summary.state === 'absent') {
        return [];
      }
      const segments: StatusSegment[] = [];
      // The counts come from the runtime's server, so they are only known while it answers; the disk
      // figure is read from the models folder and holds either way.
      const disk: StatusSegment | null =
        summary.disk === null
          ? null
          : { id: 'models-disk', text: `${summary.disk} on disk`, title: 'Disk used by models' };
      if (summary.state === 'stopped') {
        return disk === null ? [] : [disk];
      }
      if (summary.downloading > 0) {
        segments.push({ id: 'models-downloading', text: `Downloading ${summary.downloading}` });
      }
      segments.push({ id: 'models-installed', text: `${summary.installed} installed` });
      if (summary.loaded > 0) {
        segments.push({
          id: 'models-loaded',
          text: `${summary.loaded} loaded`,
          title: 'Models loaded in memory',
        });
      }
      if (disk !== null) {
        segments.push(disk);
      }
      return segments;
    },
  );
}
