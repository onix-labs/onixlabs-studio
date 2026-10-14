import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { AiManagerView, LibraryCounts } from '../ai-manager-view/ai-manager-view';
import { ModelManagerSummary } from '../model-manager-view/model-manager-view';

/**
 * The segments a status strip shows: those at the start, and those at the end.
 */
interface StripSegments {
  /**
   * Gets the start-aligned segments.
   */
  readonly leading: readonly StatusSegment[];

  /**
   * Gets the end-aligned segments.
   */
  readonly trailing: readonly StatusSegment[];
}

/**
 * The AI Manager tab's status-strip readout (#882, #948), for the sub-view shown.
 *
 * - **Local Models:** on the left, the local runtime and its version — or that it is not running, or not
 *   installed, since an empty model list says nothing about why. At the end: downloads in progress
 *   (while any are), how many models are installed, how many are loaded in memory (while any are), and
 *   the disk the installed models use. The counts come from the runtime's server and are left out
 *   while it is not running; the disk figure is shown either way.
 * - **Prompt Profiles, Skills:** how many there are, and how many are switched on.
 *
 * Mounted by the status strip through the AI Manager view's own injector, from which it reads the
 * view itself.
 */
@Component({
  selector: 'app-ai-manager-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments
    [leading]="segments().leading"
    [trailing]="segments().trailing"
  />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiManagerStatusStrip {
  /**
   * Holds the view whose section is reported.
   */
  private readonly view: AiManagerView = inject(AiManagerView);

  /**
   * Gets the segments for the sub-view shown.
   */
  protected readonly segments: Signal<StripSegments> = computed((): StripSegments => {
    switch (this.view.section()) {
      case 'models': {
        const summary: ModelManagerSummary | null = this.view.modelSummary();
        return summary === null ? { leading: [], trailing: [] } : modelSegments(summary);
      }
      case 'profiles':
        return librarySegments('ai-profiles', 'profile', 'profiles', this.view.profileCounts());
      case 'skills':
        return librarySegments('ai-skills', 'skill', 'skills', this.view.skillCounts());
    }
  });
}

/**
 * Builds a library section's segments: how many entries, then how many are switched on.
 * @param id The segment identifier prefix.
 * @param singular The entry noun, singular.
 * @param plural The entry noun, plural.
 * @param counts The section's counts.
 * @returns Returns the segments.
 */
function librarySegments(
  id: string,
  singular: string,
  plural: string,
  counts: LibraryCounts,
): StripSegments {
  return {
    leading: [{ id, text: `${counts.total} ${counts.total === 1 ? singular : plural}` }],
    trailing:
      counts.total === 0 ? [] : [{ id: `${id}-enabled`, text: `${counts.enabled} switched on` }],
  };
}

/**
 * Builds the Models section's segments.
 * @param summary The runtime's summary.
 * @returns Returns the segments.
 */
function modelSegments(summary: ModelManagerSummary): StripSegments {
  const runtime: string =
    summary.state === 'absent'
      ? `${summary.runtime} not installed`
      : summary.state === 'stopped'
        ? `${summary.runtime} (not running)`
        : summary.version === null
          ? summary.runtime
          : `${summary.runtime} ${summary.version}`;
  const leading: readonly StatusSegment[] = [
    { id: 'models-runtime', text: runtime, shrink: 'end' },
  ];
  if (summary.state === 'absent') {
    return { leading, trailing: [] };
  }
  // The counts come from the runtime's server, so they are only known while it answers; the disk
  // figure is read from the models folder and holds either way.
  const disk: StatusSegment | null =
    summary.disk === null
      ? null
      : { id: 'models-disk', text: `${summary.disk} on disk`, title: 'Disk used by models' };
  if (summary.state === 'stopped') {
    return { leading, trailing: disk === null ? [] : [disk] };
  }
  const trailing: StatusSegment[] = [];
  if (summary.downloading > 0) {
    trailing.push({ id: 'models-downloading', text: `Downloading ${summary.downloading}` });
  }
  trailing.push({ id: 'models-installed', text: `${summary.installed} installed` });
  if (summary.loaded > 0) {
    trailing.push({
      id: 'models-loaded',
      text: `${summary.loaded} loaded`,
      title: 'Models loaded in memory',
    });
  }
  if (disk !== null) {
    trailing.push(disk);
  }
  return { leading, trailing };
}
