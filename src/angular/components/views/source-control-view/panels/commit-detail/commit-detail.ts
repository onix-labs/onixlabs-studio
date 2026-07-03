import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { DiffOpener } from '../../../../../services/diffs/diff-opener';
import { Repository } from '@shared/angular/services/repository/repository';
import {
  GitChangeStatus,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

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
   * Gets the dock panel descriptor this panel was projected for. Supplied by the dock outlet; the
   * pane reads its state from the shared {@link Repository} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the repository model the pane renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Holds the diff opener that surfaces a selected file's diff in the document well.
   */
  private readonly diffOpener: DiffOpener = inject(DiffOpener);

  /**
   * Selects a changed file and opens its diff in the document well.
   * @param file The file to select.
   */
  protected selectFile(file: GitFileChange): void {
    this.repository.selectFile(file.path);
    this.diffOpener.open(file);
  }

  /**
   * Updates the draft commit message as the user types.
   * @param event The textarea input event.
   */
  protected onMessageInput(event: Event): void {
    this.repository.setCommitMessage((event.target as HTMLTextAreaElement).value);
  }

  /**
   * Stages a changed file.
   * @param file The file to stage.
   */
  protected stage(file: GitFileChange): void {
    void this.repository.stage(file);
  }

  /**
   * Unstages a changed file.
   * @param file The file to unstage.
   */
  protected unstage(file: GitFileChange): void {
    void this.repository.unstage(file);
  }

  /**
   * Stages every change.
   */
  protected stageAll(): void {
    void this.repository.stageAll();
  }

  /**
   * Unstages every change.
   */
  protected unstageAll(): void {
    void this.repository.unstageAll();
  }

  /**
   * Commits the staged changes with the draft message.
   */
  protected commit(): void {
    void this.repository.commit();
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
