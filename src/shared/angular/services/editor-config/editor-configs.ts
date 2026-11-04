import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  EditorConfigChannel,
  EditorConfigResolution,
  NO_EDITOR_CONFIG,
} from '@shared/api/editor-config-channels';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Tracks the subscribers of one `.editorconfig` path.
 */
interface WatchedCandidate {
  /**
   * Gets the callbacks invoked when the path changes.
   */
  readonly callbacks: Set<() => void>;

  /**
   * Gets the function that stops watching the path.
   */
  readonly stop: () => void;
}

/**
 * Asks the main process what a file's `.editorconfig` files say about it, and says when one of them
 * changes. Honour EditorConfig is read here, so every consumer gets nothing while it is off.
 */
@Service()
export class EditorConfigs {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the settings, read for Honour EditorConfig.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the file watch reporting `.editorconfig` files appearing, changing and going.
   */
  private readonly fileWatch: FileWatch = inject(FileWatch);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the watched `.editorconfig` paths. Many open documents share each one.
   */
  private readonly watched: Map<string, WatchedCandidate> = new Map<string, WatchedCandidate>();

  /**
   * Holds the listeners told of any watched `.editorconfig` changing, once per change.
   */
  private readonly listeners: Set<(path: string) => void> = new Set<(path: string) => void>();

  /**
   * Resolves what EditorConfig says about a file.
   * @param filePath The file's absolute path.
   * @returns Returns the resolution: nothing when Honour EditorConfig is off or it cannot be read.
   */
  public async resolve(filePath: string): Promise<EditorConfigResolution> {
    if (this.bridge === undefined || !this.settings.get('textEditor.honourEditorConfig')) {
      return NO_EDITOR_CONFIG;
    }
    try {
      return await this.bridge.invoke<EditorConfigResolution>(
        EditorConfigChannel.Resolve,
        filePath,
      );
    } catch (error: unknown) {
      this.log.warn('EditorConfigs', `Could not resolve ${filePath}`, error);
      return NO_EDITOR_CONFIG;
    }
  }

  /**
   * Watches `.editorconfig` paths, invoking the callback when any of them appears, changes or goes.
   * @param candidates The paths.
   * @param onChange Invoked on each change.
   * @returns Returns a function that stops this subscription.
   */
  public watch(candidates: readonly string[], onChange: () => void): () => void {
    for (const candidate of candidates) {
      this.watchedFor(candidate).callbacks.add(onChange);
    }
    return (): void => {
      for (const candidate of candidates) {
        this.release(candidate, onChange);
      }
    };
  }

  /**
   * Listens for any watched `.editorconfig` changing, whichever documents it covers.
   * @param listener Receives the changed path.
   * @returns Returns a function that stops listening.
   */
  public onChanged(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Gets a path's entry, starting its watch when it is the first to want one.
   * @param path The `.editorconfig` path.
   * @returns Returns the entry.
   */
  private watchedFor(path: string): WatchedCandidate {
    const existing: WatchedCandidate | undefined = this.watched.get(path);
    if (existing !== undefined) {
      return existing;
    }
    const callbacks: Set<() => void> = new Set<() => void>();
    const created: WatchedCandidate = {
      callbacks,
      stop: this.fileWatch.watchPresence(path, (): void => {
        this.log.debug('EditorConfigs', 'EditorConfig changed', path);
        for (const listener of this.listeners) {
          listener(path);
        }
        for (const callback of [...callbacks]) {
          callback();
        }
      }),
    };
    this.watched.set(path, created);
    return created;
  }

  /**
   * Removes a subscriber from a path, stopping its watch when it was the last.
   * @param path The `.editorconfig` path.
   * @param onChange The subscriber.
   */
  private release(path: string, onChange: () => void): void {
    const entry: WatchedCandidate | undefined = this.watched.get(path);
    entry?.callbacks.delete(onChange);
    if (entry?.callbacks.size === 0) {
      entry.stop();
      this.watched.delete(path);
    }
  }
}
