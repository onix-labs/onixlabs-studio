import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { Repository } from '../../../../../services/repository/repository';
import { GitChangeStatus, GitFileChange } from '../../../../../services/repository/repository-data';
import { AppIcon } from '../../../../shared/icon/app-icon';

/**
 * Renders the source-control view's right pane: metadata for the selected commit (or a summary of the
 * working tree when the uncommitted-changes node is selected) above the list of changed files.
 * Selecting a file drives the repository's file selection, which the Monaco diff surface follows.
 */
@Component({
  selector: 'app-commit-detail',
  imports: [AppIcon],
  templateUrl: './commit-detail.html',
  styleUrl: './commit-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitDetail {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the repository model the pane renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Selects a changed file, driving the diff surface.
   * @param file The file to select.
   */
  protected selectFile(file: GitFileChange): void {
    this.repository.selectFile(file.path);
  }

  /**
   * Gets the single-letter status badge for a change kind (A, M, D, R).
   * @param status The change kind.
   * @returns Returns the status letter.
   */
  protected statusLetter(status: GitChangeStatus): string {
    switch (status) {
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      default:
        return 'M';
    }
  }

  /**
   * Gets the trailing file-name segment of a path, shown as the primary label.
   * @param path The full path.
   * @returns Returns the last path segment.
   */
  protected fileName(path: string): string {
    const segments: readonly string[] = path.split('/');
    return segments[segments.length - 1] ?? path;
  }

  /**
   * Gets the leading directory segment of a path, shown as a muted prefix.
   * @param path The full path.
   * @returns Returns the directory portion, or an empty string when the file is at the root.
   */
  protected fileDir(path: string): string {
    const index: number = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
  }
}
