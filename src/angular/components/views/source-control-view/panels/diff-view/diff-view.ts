import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GitChangeStatus } from '../../../../../services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { DiffEditor } from '@shared/angular/components/diff-editor/diff-editor';

/**
 * Hosts the source-control diff surface: a header showing the compared file's path and change-status
 * badge, an empty state when nothing is selected, and the shared {@link DiffEditor} pane comparing the
 * file's before/after content. It owns the source-control chrome the bare pane does not — the file
 * header, the git change-status badge, and the empty state — forwarding the compared content to the
 * shared pane, which owns the Monaco diff editor.
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
   * Gets the path of the compared file, shown in the header and used as the empty-state trigger (a
   * blank path means no file is selected).
   */
  public readonly fileName: InputSignal<string> = input<string>('');

  /**
   * Gets how the compared file changed, shown as a badge in the header.
   */
  public readonly status: InputSignal<GitChangeStatus | null> = input<GitChangeStatus | null>(null);

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
}
