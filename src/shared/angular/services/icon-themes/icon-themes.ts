import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type { Bridge } from '@shared/api/bridge';
import { IconSet, IconTheme, IconThemeChannel } from '@shared/api/icon-theme';
import { Log } from '@shared/angular/services/log/log';
import { languageForFileName } from '@shared/angular/services/monaco/monaco-languages';
import { Theme } from '@shared/angular/services/theme/theme';
import { IconSubject, matchIcon } from './match-icon';

/**
 * Represents the active file icon theme: which picture, if any, a file or folder is drawn with.
 */
@Service()
export class IconThemes {
  /**
   * Holds the transport to the main process, absent outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the colour theme, which decides the set of pictures.
   */
  private readonly colours: Theme = inject(Theme);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the backing state for {@link active}.
   */
  private readonly activeState: WritableSignal<IconTheme | null> = signal<IconTheme | null>(null);

  /**
   * Gets the active theme, or null while Studio's own icons are drawn.
   */
  public readonly active: Signal<IconTheme | null> = this.activeState.asReadonly();

  /**
   * Initializes a new instance of the {@link IconThemes} class and loads the active theme.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Gets the picture a file or folder is drawn with.
   * @param subject The file or folder.
   * @returns Returns the picture as a `data:` URI, or undefined when Studio's own icon is drawn.
   */
  public pictureFor(subject: IconSubject): string | undefined {
    const theme: IconTheme | null = this.active();
    if (theme === null) {
      return undefined;
    }
    const set: IconSet = this.colours.resolvedMode() === 'light' ? theme.light : theme.dark;
    const id: string | undefined = matchIcon(set, {
      ...subject,
      language:
        subject.kind === 'file' && Object.keys(set.languageIds).length > 0
          ? languageForFileName(subject.path)
          : undefined,
    });
    return id === undefined ? undefined : theme.pictures[id];
  }

  /**
   * Loads the active theme from the main process.
   */
  private async load(): Promise<void> {
    try {
      this.activeState.set(
        (await this.bridge?.invoke<IconTheme | null>(IconThemeChannel.GetActive)) ?? null,
      );
    } catch (error: unknown) {
      this.log.warn('IconThemes', 'Could not load the icon theme', error);
    }
  }
}
