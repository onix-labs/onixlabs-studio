import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { SpellingChannel, SpellingConfiguration } from '@shared/api/spelling-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { Spelling } from './spelling';

/**
 * Records what the renderer sends the main process.
 */
class RecordingBridge implements Bridge {
  /**
   * Holds every invoke, in order.
   */
  public readonly calls: { channel: string; args: unknown[] }[] = [];

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    this.calls.push({ channel, args });
    return Promise.resolve(
      (channel === String(SpellingChannel.AvailableLanguages) ? ['en-GB'] : undefined) as T,
    );
  }

  public send(): void {
    // Not used by Spelling.
  }

  public on(): () => void {
    return (): void => undefined;
  }

  /**
   * Gets the last configuration sent.
   * @returns Returns the configuration, or undefined when none was sent.
   */
  public lastConfiguration(): SpellingConfiguration | undefined {
    const configures: { channel: string; args: unknown[] }[] = this.calls.filter(
      (call: { channel: string; args: unknown[] }): boolean =>
        call.channel === String(SpellingChannel.Configure),
    );
    return configures.at(-1)?.args[0] as SpellingConfiguration | undefined;
  }
}

describe('Spelling', () => {
  let bridge: RecordingBridge;

  beforeEach((): void => {
    localStorage.clear();
    bridge = new RecordingBridge();
    Object.defineProperty(window, 'bridge', { value: bridge, configurable: true });
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'bridge');
    localStorage.clear();
  });

  it('sendsTheSettingsToTheMainProcess_andAgainWhenTheyChange', (): void => {
    const spelling: Spelling = TestBed.inject(Spelling);
    TestBed.tick();
    expect(bridge.lastConfiguration()).toEqual({ enabled: true, languages: [], words: [] });

    spelling.setLanguages(['en-GB', 'en-US']);
    spelling.addWord('Studio');
    TestBed.tick();

    expect(bridge.lastConfiguration()).toEqual({
      enabled: true,
      languages: ['en-GB', 'en-US'],
      words: ['Studio'],
    });
  });

  it('addWord_keepsOneOfEachWordSortedAndRefusesPhrases', (): void => {
    const spelling: Spelling = TestBed.inject(Spelling);

    expect(spelling.addWord(' zebra ')).toBe(true);
    expect(spelling.addWord('Apple')).toBe(true);
    expect(spelling.addWord('apple')).toBe(false);
    expect(spelling.addWord('two words')).toBe(false);
    expect(spelling.addWord('  ')).toBe(false);

    expect(spelling.words()).toEqual(['Apple', 'zebra']);
    expect(spelling.hasWord('ZEBRA')).toBe(true);

    spelling.removeWord('Apple');
    expect(spelling.words()).toEqual(['zebra']);
  });

  it('adoptsTheWordsMarkdownReviewOnceKeptOnItsOwn', (): void => {
    localStorage.setItem('onixlabs-studio-review-dictionary', JSON.stringify(['kubectl', 'onix']));

    const spelling: Spelling = TestBed.inject(Spelling);

    expect(spelling.words()).toEqual(['kubectl', 'onix']);
    expect(localStorage.getItem('onixlabs-studio-review-dictionary')).toBeNull();
  });

  it('checker_isTheWindowsSpellCheckerOnlyWhileSpellCheckingIsOn', (): void => {
    const probe: { isMisspelled(): boolean; suggestions(): string[] } = {
      isMisspelled: (): boolean => false,
      suggestions: (): string[] => [],
    };
    Object.defineProperty(window, 'spelling', { value: probe, configurable: true });
    const spelling: Spelling = TestBed.inject(Spelling);

    expect(spelling.checker()).toBe(probe);

    TestBed.inject(Settings).set('application.spellChecking', false);
    expect(spelling.checker()).toBeUndefined();
    Reflect.deleteProperty(window, 'spelling');
  });

  it('availableLanguages_asksTheMainProcess', async (): Promise<void> => {
    const spelling: Spelling = TestBed.inject(Spelling);

    // The tests run off macOS, where the languages can be chosen.
    expect(spelling.languagesChoosable).toBe(true);
    expect(await spelling.availableLanguages()).toEqual(['en-GB']);
  });
});
