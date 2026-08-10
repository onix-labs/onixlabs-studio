import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Which write-path list a row belongs to: the allow list (extra writable directories) or the deny
 * list (never-writable directories).
 */
type ListKind = 'allow' | 'deny';

/**
 * Represents the write-path editor embedded in the AI settings section (#310): two directory lists —
 * allowed write directories and denied write directories — each presented as a labelled setting row
 * whose control opens a directory picker (files are ignored), with the chosen directories listed
 * beneath. Values are held in settings; the main process ignores blanks.
 */
@Component({
  selector: 'app-ai-write-paths',
  imports: [Button, SettingRow],
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
   * Holds the file-system bridge used to show the directory picker.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the allowed write directories.
   */
  protected readonly allowed: Signal<readonly string[]> = this.settings.aiAllowedWritePaths;

  /**
   * Gets the denied write directories.
   */
  protected readonly denied: Signal<readonly string[]> = this.settings.aiDeniedWritePaths;

  /**
   * Opens a directory picker (files are ignored) and appends the chosen directory to a list, skipping
   * a directory already present.
   * @param kind Which list to add to.
   */
  protected async choose(kind: ListKind): Promise<void> {
    const path: string | null = await this.fileSystem.pickPath('folder');
    if (path === null) {
      return;
    }
    const current: readonly string[] = this.current(kind);
    if (current.includes(path)) {
      return;
    }
    this.log.info('settings.ai', 'Write path added', kind, path);
    this.commit(kind, [...current, path]);
  }

  /**
   * Removes a directory from a list.
   * @param kind Which list the directory is in.
   * @param index The entry index.
   */
  protected remove(kind: ListKind, index: number): void {
    this.log.info('settings.ai', 'Write path removed', kind, this.current(kind)[index]);
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
