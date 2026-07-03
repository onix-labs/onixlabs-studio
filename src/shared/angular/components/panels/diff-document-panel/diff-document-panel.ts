import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { DiffView } from '../diff-view/diff-view';

/**
 * Hosts a changed file's diff inside the source-control document well. The dock panel id is the diff
 * id; this resolves the {@link GitFileChange} for it from the {@link Diffs} store and projects the
 * shared {@link DiffView}. The dock keeps every well panel mounted, so the Monaco diff survives tab
 * switches and relays out on show through its automatic layout.
 */
@Component({
  selector: 'app-diff-document-panel',
  imports: [DiffView],
  templateUrl: './diff-document-panel.html',
  styleUrl: './diff-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffDocumentPanel {
  /**
   * Gets the dock panel descriptor; its id is the diff id this panel hosts.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the diff content store the hosted diff is resolved from.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Gets the file change this panel compares, or null when it is no longer open.
   */
  protected readonly file: Signal<GitFileChange | null> = computed((): GitFileChange | null =>
    this.diffs.get(this.panel().id),
  );

  /**
   * Gets whether the diff renders inline rather than side by side.
   */
  protected readonly inline: Signal<boolean> = this.diffs.inlineDiff;
}
