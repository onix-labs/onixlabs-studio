import { app, ipcMain, IpcMainInvokeEvent, session, Session } from 'electron';
import {
  parseSpellingConfiguration,
  SpellingChannel,
  SpellingConfiguration,
} from '@shared/api/spelling-channels';
import { logger } from '@shared/electron/logger';

/**
 * Applies the renderer's spell-checking settings to the default session, which every Studio window
 * shares: whether text boxes are checked, the languages checked together, and the personal dictionary.
 *
 * On macOS Electron uses the system spell checker in a single language, the app's locale (the system
 * language), and offers no way to change it, so the language list is not applied there. The personal dictionary is the session's custom dictionary; on macOS and
 * Windows Chromium writes it through to the operating system's dictionary as well, which is the only
 * way a text box stops flagging a word (ruled on #1230). Only the words this manager added or removed
 * are touched, so words the user put in the system dictionary themselves are left alone until Studio's
 * own list removes them.
 */
export class SpellingManager {
  /**
   * Holds the personal-dictionary words applied to the session so far, so a later configuration
   * adds and removes only the difference.
   */
  private applied: ReadonlySet<string> = new Set<string>();

  /**
   * Registers the spelling IPC handlers.
   */
  public register(): void {
    ipcMain.handle(SpellingChannel.Configure, (_event: IpcMainInvokeEvent, raw: unknown): void => {
      const configuration: SpellingConfiguration | undefined = parseSpellingConfiguration(raw);
      if (configuration !== undefined) {
        this.configure(configuration);
      }
    });
    ipcMain.handle(SpellingChannel.AvailableLanguages, (): readonly string[] =>
      process.platform === 'darwin'
        ? []
        : [...session.defaultSession.availableSpellCheckerLanguages],
    );
  }

  /**
   * Applies a configuration to the default session.
   * @param configuration The settings to apply.
   */
  private configure(configuration: SpellingConfiguration): void {
    const target: Session = session.defaultSession;
    target.setSpellCheckerEnabled(configuration.enabled);
    if (process.platform !== 'darwin') {
      const languages: string[] = this.languagesFor(target, configuration.languages);
      if (languages.length > 0) {
        target.setSpellCheckerLanguages(languages);
      }
    }
    const wanted: ReadonlySet<string> = new Set<string>(configuration.words);
    for (const word of wanted) {
      if (!this.applied.has(word)) {
        target.addWordToSpellCheckerDictionary(word);
      }
    }
    for (const word of this.applied) {
      if (!wanted.has(word)) {
        target.removeWordFromSpellCheckerDictionary(word);
      }
    }
    this.applied = wanted;
    logger.info(
      'SpellingManager',
      `Spell checking ${configuration.enabled ? 'on' : 'off'}`,
      configuration.languages,
      wanted.size,
    );
  }

  /**
   * Resolves the languages to check: the chosen ones the checker supports, or the system's language
   * when none are chosen (or none of them is supported).
   * @param target The session whose checker is configured.
   * @param chosen The chosen language codes.
   * @returns Returns the language codes to apply.
   */
  private languagesFor(target: Session, chosen: readonly string[]): string[] {
    const available: ReadonlySet<string> = new Set<string>(target.availableSpellCheckerLanguages);
    const supported: string[] = chosen.filter((code: string): boolean => available.has(code));
    if (supported.length > 0) {
      return supported;
    }
    const locale: string = app.getLocale();
    const system: string | undefined = [locale, locale.split('-')[0]].find(
      (code: string): boolean => available.has(code),
    );
    return system === undefined ? [] : [system];
  }
}
