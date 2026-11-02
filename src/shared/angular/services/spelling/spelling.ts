import { computed, effect, inject, Service, Signal, untracked } from '@angular/core';
import type { Bridge } from '@shared/api/bridge';
import {
  SpellingChannel,
  SpellingConfiguration,
  SpellingProbe,
} from '@shared/api/spelling-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Names the local-storage key Markdown review kept its personal dictionary under before the dictionary
 * moved into Settings, read once to carry the words across.
 */
const LEGACY_DICTIONARY_KEY: string = 'onixlabs-studio-review-dictionary';

/**
 * Owns spell checking across Studio: it keeps the main process's spell checker in step with the
 * Spell Checking settings (on or off, the languages checked together, the personal dictionary), and
 * hands out the checker Markdown review uses — the same one every text box uses, while spell
 * checking is on (ruled on #1230).
 *
 * Instantiated at start-up, so text boxes are checked as the settings say from the first paint.
 */
@Service()
export class Spelling {
  /**
   * Holds the settings store the spelling settings live in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the transport to the main process, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets a value indicating whether spell checking is on.
   */
  public readonly enabled: Signal<boolean> = this.settings.value('application.spellChecking');

  /**
   * Gets the language codes checked together; empty for the system language.
   */
  public readonly languages: Signal<readonly string[]> = this.settings.value(
    'application.spellCheckingLanguages',
  );

  /**
   * Gets the personal dictionary, sorted as shown.
   */
  public readonly words: Signal<readonly string[]> = this.settings.value(
    'spelling.personalDictionary',
  );

  /**
   * Gets a value indicating whether the languages can be chosen: everywhere but macOS, where Chromium
   * checks the system language only and Electron cannot change it.
   */
  public readonly languagesChoosable: boolean = window.host?.platform !== 'darwin';

  /**
   * Gets the window's spell checker while spell checking is on, or undefined when it is off or Studio
   * runs outside Electron — when Markdown review falls back to its bundled English list.
   */
  public readonly checker: Signal<SpellingProbe | undefined> = computed(
    (): SpellingProbe | undefined => (this.enabled() ? window.spelling : undefined),
  );

  /**
   * Initializes a new instance of the {@link Spelling} class, carrying over the words Markdown review
   * once kept on its own and keeping the main process in step with the settings.
   */
  public constructor() {
    this.adoptLegacyDictionary();
    effect((): void => {
      const configuration: SpellingConfiguration = {
        enabled: this.enabled(),
        languages: this.languages(),
        words: this.words(),
      };
      untracked((): void => {
        void this.bridge?.invoke(SpellingChannel.Configure, configuration);
      });
    });
  }

  /**
   * Lists the languages the spell checker can check, as language codes.
   * @returns Returns the codes; none on macOS or outside Electron.
   */
  public async availableLanguages(): Promise<readonly string[]> {
    if (this.bridge === undefined || !this.languagesChoosable) {
      return [];
    }
    return this.bridge.invoke<readonly string[]>(SpellingChannel.AvailableLanguages);
  }

  /**
   * Sets the languages checked together.
   * @param codes The language codes; none for the system language.
   */
  public setLanguages(codes: readonly string[]): void {
    this.settings.set('application.spellCheckingLanguages', [...codes]);
  }

  /**
   * Adds a word to the personal dictionary. A word already there (in any case) is left as it is.
   * @param word The word to add.
   * @returns Returns true when the word was added.
   */
  public addWord(word: string): boolean {
    const trimmed: string = word.trim();
    if (trimmed === '' || /\s/.test(trimmed) || this.hasWord(trimmed)) {
      return false;
    }
    this.settings.set(
      'spelling.personalDictionary',
      [...this.words(), trimmed].sort((left: string, right: string): number =>
        left.localeCompare(right, undefined, { sensitivity: 'base' }),
      ),
    );
    this.log.info('Spelling', 'Word added to the personal dictionary', trimmed);
    return true;
  }

  /**
   * Removes a word from the personal dictionary.
   * @param word The word to remove.
   */
  public removeWord(word: string): void {
    this.settings.set(
      'spelling.personalDictionary',
      this.words().filter((candidate: string): boolean => candidate !== word),
    );
    this.log.info('Spelling', 'Word removed from the personal dictionary', word);
  }

  /**
   * Determines whether a word is in the personal dictionary, ignoring case.
   * @param word The word to look for.
   * @returns Returns true when the dictionary holds the word.
   */
  public hasWord(word: string): boolean {
    const lower: string = word.toLowerCase();
    return this.words().some((candidate: string): boolean => candidate.toLowerCase() === lower);
  }

  /**
   * Moves the words Markdown review kept in local storage into the personal dictionary, once.
   */
  private adoptLegacyDictionary(): void {
    let stored: string | null;
    try {
      stored = localStorage.getItem(LEGACY_DICTIONARY_KEY);
    } catch {
      return;
    }
    if (stored === null) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        for (const word of parsed) {
          if (typeof word === 'string') {
            this.addWord(word);
          }
        }
      }
    } catch {
      this.log.warn('Spelling', 'The old review dictionary could not be read; it was dropped');
    }
    localStorage.removeItem(LEGACY_DICTIONARY_KEY);
  }
}
