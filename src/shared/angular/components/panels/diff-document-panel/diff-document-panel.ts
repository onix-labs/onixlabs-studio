import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { DiffView } from '../diff-view/diff-view';

/**
 * Hosts a changed file's diff inside the source-control document well. The dock panel id is the diff
 * id; this resolves the {@link GitFileChange} for it from the {@link Diffs} store and projects the
 * shared {@link DiffView}. The dock keeps every well panel mounted, so the Monaco diff survives tab
 * switches and relays out on show through its automatic layout.
 */
@Component({
  selector: 'app-diff-document-panel',
  imports: [DiffView, Button, PanelToolbar],
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

  /**
   * Gets the icon set, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Toggles every open diff between inline and side-by-side rendering.
   *
   * The control sits here, on the thing it changes, rather than on the Commit panel's tool strip
   * where it used to live — a diff's layout is a property of the diff, and reaching for it meant
   * finding a git panel that had nothing else to do with it.
   */
  protected toggleLayout(): void {
    this.diffs.toggleInline();
  }
}
