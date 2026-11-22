import type * as MonacoApi from 'monaco-editor';
import {
  registerSvelteLanguage,
  SVELTE_LANGUAGE_ID,
  svelteGrammar,
} from './monaco-svelte-language';

/**
 * A fake of the part of Monaco's languages API the registration uses.
 */
class FakeLanguages {
  public readonly registered: MonacoApi.languages.ILanguageExtensionPoint[] = [];
  public readonly grammars: string[] = [];
  public readonly configurations: string[] = [];

  /**
   * Lists the registered languages.
   * @returns Returns them.
   */
  public getLanguages(): MonacoApi.languages.ILanguageExtensionPoint[] {
    return this.registered;
  }

  /**
   * Registers a language.
   * @param language The language.
   */
  public register(language: MonacoApi.languages.ILanguageExtensionPoint): void {
    this.registered.push(language);
  }

  /**
   * Records a grammar set for a language.
   * @param id The language.
   */
  public setMonarchTokensProvider(id: string): void {
    this.grammars.push(id);
  }

  /**
   * Records a configuration set for a language.
   * @param id The language.
   */
  public setLanguageConfiguration(id: string): void {
    this.configurations.push(id);
  }
}

describe('registerSvelteLanguage (#1214)', (): void => {
  it('registers svelte by its extension, with a grammar and a configuration', (): void => {
    const languages: FakeLanguages = new FakeLanguages();

    registerSvelteLanguage({ languages } as unknown as typeof MonacoApi);

    expect(languages.registered).toEqual([
      { id: SVELTE_LANGUAGE_ID, extensions: ['.svelte'], aliases: ['Svelte'] },
    ]);
    expect(languages.grammars).toEqual([SVELTE_LANGUAGE_ID]);
    expect(languages.configurations).toEqual([SVELTE_LANGUAGE_ID]);
  });

  it('registers it once however often it is called', (): void => {
    const languages: FakeLanguages = new FakeLanguages();
    const monaco: typeof MonacoApi = { languages } as unknown as typeof MonacoApi;

    registerSvelteLanguage(monaco);
    registerSvelteLanguage(monaco);

    expect(languages.registered).toHaveLength(1);
  });

  it('does nothing before Monaco has loaded', (): void => {
    expect((): void => registerSvelteLanguage(undefined)).not.toThrow();
  });

  it('colours the script block as typescript and the style block as css', (): void => {
    const tokenizer: Record<string, unknown[]> = svelteGrammar().tokenizer;
    const embedded: (state: string) => unknown = (state: string): unknown =>
      tokenizer[state]
        .map((rule: unknown): unknown => (rule as unknown[])[1])
        .find(
          (action: unknown): boolean =>
            typeof action === 'object' && action !== null && 'nextEmbedded' in action,
        );

    expect(embedded('script')).toMatchObject({ nextEmbedded: 'text/typescript' });
    expect(embedded('style')).toMatchObject({ nextEmbedded: 'text/css' });
  });
});
