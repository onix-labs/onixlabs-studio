import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { FileAssociation } from '@shared/angular/services/monaco/file-associations';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import type { LanguageInfo } from '@shared/angular/services/monaco/monaco-languages';
import { Settings } from '@shared/angular/services/settings/settings';
import { FileAssociations } from './file-associations';

/**
 * Stands in for Monaco, whose real load the settings row starts: the languages are fixed, and the
 * load does nothing.
 */
class FakeMonaco {
  /**
   * Gets the languages on offer.
   * @returns Returns three languages, by name.
   */
  public associableLanguages(): readonly LanguageInfo[] {
    return [
      { id: 'groovy', name: 'Groovy' },
      { id: 'json', name: 'JSON' },
      { id: 'yaml', name: 'YAML' },
    ];
  }

  /**
   * Loads nothing.
   * @returns Returns a settled promise.
   */
  public ensureLoaded(): Promise<void> {
    return Promise.resolve();
  }
}

describe('FileAssociations', () => {
  let fixture: ComponentFixture<FileAssociations>;
  let settings: Settings;

  /**
   * Gets the rendered element.
   * @returns Returns the host element.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Reads the patterns listed.
   * @returns Returns each listed association's pattern.
   */
  function listed(): readonly string[] {
    return [...host().querySelectorAll('[data-testid="association-row-pattern"]')].map(
      (pattern: Element): string => pattern.textContent?.trim() ?? '',
    );
  }

  /**
   * Types a pattern.
   * @param text The text to type.
   */
  async function typePattern(text: string): Promise<void> {
    const input: HTMLInputElement | null = host().querySelector<HTMLInputElement>(
      '[data-testid="association-pattern"] input',
    );
    if (input !== null) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
  }

  /**
   * Picks a language in one of the pickers.
   * @param picker The picker host.
   * @param language The language's id.
   */
  async function pick(picker: Element | null, language: string): Promise<void> {
    const select: HTMLSelectElement | null | undefined = picker?.querySelector('select');
    if (select !== null && select !== undefined) {
      select.value = language;
      select.dispatchEvent(new Event('change'));
    }
    await fixture.whenStable();
  }

  /**
   * Clicks a button.
   * @param selector The button's selector.
   */
  async function click(selector: string): Promise<void> {
    host().querySelector<HTMLElement>(selector)?.click();
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [FileAssociations],
      providers: [{ provide: Monaco, useClass: FakeMonaco }],
    }).compileComponents();
    settings = TestBed.inject(Settings);
    fixture = TestBed.createComponent(FileAssociations);
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('startsEmpty_sayingFilesOpenByStudiosOwnRules', (): void => {
    expect(listed()).toEqual([]);
    expect(host().textContent).toContain("Studio's own rules");
  });

  it('offersTheLanguagesByDisplayName', (): void => {
    const labels: readonly string[] = [
      ...host().querySelectorAll('[data-testid="association-language"] option:not([hidden])'),
    ].map((option: Element): string => option.textContent?.trim() ?? '');

    expect(labels).toEqual(['Groovy', 'JSON', 'YAML']);
  });

  it('add_isDisabledUntilBothAPatternAndALanguageAreGiven', async (): Promise<void> => {
    const add: () => HTMLButtonElement | null = (): HTMLButtonElement | null =>
      host().querySelector<HTMLButtonElement>('[data-testid="association-add"] button');
    expect(add()?.disabled).toBe(true);

    await typePattern('Jenkinsfile');
    expect(add()?.disabled).toBe(true);

    await pick(host().querySelector('[data-testid="association-language"]'), 'groovy');
    expect(add()?.disabled).toBe(false);
  });

  it('add_writesTheSetting_andClearsTheFields', async (): Promise<void> => {
    await typePattern('Jenkinsfile');
    await pick(host().querySelector('[data-testid="association-language"]'), 'groovy');

    await click('[data-testid="association-add"] button');

    expect(settings.get('textEditor.fileAssociations')).toEqual([
      { pattern: 'Jenkinsfile', language: 'groovy' },
    ]);
    expect(listed()).toEqual(['Jenkinsfile']);
    expect(
      host().querySelector<HTMLInputElement>('[data-testid="association-pattern"] input')?.value,
    ).toBe('');
  });

  it('add_replacesTheEntryForAPatternAlreadyListed', async (): Promise<void> => {
    settings.set('textEditor.fileAssociations', [{ pattern: '*.foo', language: 'json' }]);
    await fixture.whenStable();

    await typePattern('*.FOO');
    await pick(host().querySelector('[data-testid="association-language"]'), 'yaml');
    await click('[data-testid="association-add"] button');

    expect(settings.get('textEditor.fileAssociations')).toEqual([
      { pattern: '*.FOO', language: 'yaml' },
    ]);
  });

  it('changingAListedLanguage_writesTheSetting', async (): Promise<void> => {
    settings.set('textEditor.fileAssociations', [
      { pattern: '*.foo', language: 'json' },
      { pattern: '*.bar', language: 'json' },
    ]);
    await fixture.whenStable();

    await pick(host().querySelectorAll('[data-testid="association-row-language"]')[1], 'yaml');

    expect(settings.get('textEditor.fileAssociations')).toEqual([
      { pattern: '*.foo', language: 'json' },
      { pattern: '*.bar', language: 'yaml' },
    ]);
  });

  it('remove_takesTheEntryOut', async (): Promise<void> => {
    settings.set('textEditor.fileAssociations', [
      { pattern: '*.foo', language: 'json' },
      { pattern: '*.bar', language: 'yaml' },
    ]);
    await fixture.whenStable();

    await click('[aria-label="Remove the association for *.foo"]');

    const remaining: readonly FileAssociation[] = settings.get('textEditor.fileAssociations');
    expect(remaining).toEqual([{ pattern: '*.bar', language: 'yaml' }]);
    expect(listed()).toEqual(['*.bar']);
  });
});
