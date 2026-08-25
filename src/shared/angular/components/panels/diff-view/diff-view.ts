import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  Signal,
  viewChild,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { DiffEditor } from '@shared/angular/components/diff-editor/diff-editor';

/**
 * Hosts the source-control diff surface: the shared {@link DiffEditor} pane comparing a file's
 * before/after content, with an empty state over it when nothing is selected, and the navigation the
 * pane's owner drives through {@link goToDiff}.
 *
 * It used to draw a header carrying the file's path and its change-status badge. The path was the tab
 * title said a second time, and the badge belongs on the tool strip beside the commands — between
 * them they cost a whole row of vertical space to say nothing new.
 */
@Component({
  selector: 'app-diff-view',
  imports: [AppIcon, DiffEditor],
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the path of the compared file, which triggers the empty state: a blank path means no file is
   * selected. Not drawn — the tab already carries the name.
   */
  public readonly fileName: InputSignal<string> = input<string>('');

  /**
   * Gets the file's content before the change (the diff's original side).
   */
  public readonly original: InputSignal<string> = input<string>('');

  /**
   * Gets the file's content after the change (the diff's modified side).
   */
  public readonly modified: InputSignal<string> = input<string>('');

  /**
   * Gets the Monaco language identifier used to highlight both sides.
   */
  public readonly language: InputSignal<string> = input<string>('plaintext');

  /**
   * Gets a value indicating whether the diff renders inline (unified) rather than side by side.
   */
  public readonly inline: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the shared pane that owns the Monaco diff editor.
   */
  private readonly pane: Signal<DiffEditor | undefined> = viewChild<DiffEditor>(DiffEditor);

  /**
   * Moves the diff to the next or previous change.
   *
   * Forwarded to Monaco, which owns what "the next change" means: it knows where the hunks are, wraps
   * at the end, and scrolls both sides together. Re-deriving any of that here from the line changes
   * would be a second opinion about a diff Monaco has already computed.
   *
   * @param target Which way to go.
   */
  public goToDiff(target: 'next' | 'previous'): void {
    this.pane()?.getDiffEditor()?.goToDiff(target);
  }
}
