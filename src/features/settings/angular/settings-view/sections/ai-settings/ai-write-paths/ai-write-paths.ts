import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Which write-path list a row belongs to: the allow list (extra writable directories) or the deny
 * list (never-writable paths/segments).
 */
type ListKind = 'allow' | 'deny';

/**
 * Represents the write-path editor embedded in the AI settings section (#310): two editable lists —
 * allowed write directories and denied write paths — each a list of text rows with add/remove. Values
 * are held in settings; blank rows are ignored by the main process, so an empty row can sit while the
 * user types.
 */
@Component({
  selector: 'app-ai-write-paths',
  imports: [TextField, AppIcon],
  templateUrl: './ai-write-paths.html',
  styleUrl: './ai-write-paths.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiWritePaths {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service the lists are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the allowed write directories.
   */
  protected readonly allowed: Signal<readonly string[]> = this.settings.aiAllowedWritePaths;

  /**
   * Gets the denied write paths.
   */
  protected readonly denied: Signal<readonly string[]> = this.settings.aiDeniedWritePaths;

  /**
   * Appends a blank row to a list for the user to fill in.
   * @param kind Which list to add to.
   */
  protected add(kind: ListKind): void {
    this.commit(kind, [...this.current(kind), '']);
  }

  /**
   * Updates a row's value.
   * @param kind Which list the row is in.
   * @param index The row index.
   * @param value The new value.
   */
  protected update(kind: ListKind, index: number, value: string): void {
    this.commit(
      kind,
      this.current(kind).map((entry: string, i: number): string => (i === index ? value : entry)),
    );
  }

  /**
   * Removes a row.
   * @param kind Which list the row is in.
   * @param index The row index.
   */
  protected remove(kind: ListKind, index: number): void {
    this.commit(
      kind,
      this.current(kind).filter((_: string, i: number): boolean => i !== index),
    );
  }

  /**
   * Gets a list's current entries.
   * @param kind Which list.
   * @returns Returns the entries.
   */
  private current(kind: ListKind): readonly string[] {
    return kind === 'allow' ? this.allowed() : this.denied();
  }

  /**
   * Persists a list's entries.
   * @param kind Which list.
   * @param next The new entries.
   */
  private commit(kind: ListKind, next: readonly string[]): void {
    if (kind === 'allow') {
      this.settings.setAiAllowedWritePaths(next);
    } else {
      this.settings.setAiDeniedWritePaths(next);
    }
  }
}
