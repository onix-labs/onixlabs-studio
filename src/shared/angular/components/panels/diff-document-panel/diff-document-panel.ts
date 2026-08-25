import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  viewChild,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { DiffView } from '../diff-view/diff-view';

/**
 * Hosts a changed file's diff inside the source-control document well. The dock panel id is the diff
 * id; this resolves the {@link GitFileChange} for it from the {@link Diffs} store and projects the
 * shared {@link DiffView}. The dock keeps every well panel mounted, so the Monaco diff survives tab
 * switches and relays out on show through its automatic layout.
 *
 * The panel owns its tool strip (`ownsToolStrip`), which is why the dock's stubbed editor tools no
 * longer appear above it: a diff is not a text editor, and Split Editor and Find in File were
 * offering things this tab cannot do. What it can do is change how the comparison is laid out and
 * walk the changes, so that is what the strip carries.
 */
@Component({
  selector: 'app-diff-document-panel',
  imports: [DiffView, Button, Dropdown, PanelToolbar],
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
   * Gets the icon set, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the file change this panel compares, or null when it is no longer open.
   */
  protected readonly file: Signal<GitFileChange | null> = computed((): GitFileChange | null =>
    this.diffs.get(this.panel().id),
  );

  /**
   * Gets whether there is a comparison to act on, which gates the navigation arrows.
   */
  protected readonly hasFile: Signal<boolean> = computed((): boolean => this.file() !== null);

  /**
   * Gets whether the diff renders inline rather than side by side.
   */
  protected readonly inline: Signal<boolean> = this.diffs.inlineDiff;

  /**
   * The layouts the diff can be read in. Named rather than toggled: a control offering both choices
   * should say which one is in force without the user pressing it to find out.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = [
    { value: 'side-by-side', label: 'Side by side' },
    { value: 'inline', label: 'Inline' },
  ];

  /**
   * Holds the projected diff view, which owns the Monaco editor the arrows drive.
   */
  private readonly view: Signal<DiffView | undefined> = viewChild<DiffView>(DiffView);

  /**
   * Applies the layout chosen from the dropdown, for every open diff.
   * @param value The chosen layout.
   */
  protected onLayoutChange(value: string): void {
    this.diffs.setInline(value === 'inline');
  }

  /**
   * Moves to the previous change in the file.
   */
  protected previousChange(): void {
    this.view()?.goToDiff('previous');
  }

  /**
   * Moves to the next change in the file.
   */
  protected nextChange(): void {
    this.view()?.goToDiff('next');
  }
}
