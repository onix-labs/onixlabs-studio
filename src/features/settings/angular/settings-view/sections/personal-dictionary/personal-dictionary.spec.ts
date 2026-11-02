import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Spelling } from '@shared/angular/services/spelling/spelling';
import { PersonalDictionary } from './personal-dictionary';

describe('PersonalDictionary', () => {
  let fixture: ComponentFixture<PersonalDictionary>;
  let spelling: Spelling;

  /**
   * Reads the words listed.
   * @returns Returns each listed word.
   */
  function listed(): readonly string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.dictionary__word')].map(
      (word: Element): string => word.textContent?.trim() ?? '',
    );
  }

  /**
   * Types a word into the field.
   * @param word The word to type.
   */
  async function type(word: string): Promise<void> {
    const input: HTMLInputElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('[data-testid="dictionary-word"] input');
    if (input !== null) {
      input.value = word;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PersonalDictionary] }).compileComponents();
    spelling = TestBed.inject(Spelling);
    fixture = TestBed.createComponent(PersonalDictionary);
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('saysSoWhenTheDictionaryIsEmpty', (): void => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No words yet.');
  });

  it('add_putsTheTypedWordInTheDictionaryAndClearsTheField', async (): Promise<void> => {
    await type('kubectl');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[data-testid="dictionary-add"] button')
      ?.click();
    await fixture.whenStable();

    expect(spelling.words()).toEqual(['kubectl']);
    expect(listed()).toEqual(['kubectl']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '[data-testid="dictionary-word"] input',
      )?.value,
    ).toBe('');
  });

  it('remove_takesTheWordOut', async (): Promise<void> => {
    spelling.addWord('kubectl');
    spelling.addWord('onix');
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[aria-label="Remove kubectl"]')
      ?.click();
    await fixture.whenStable();

    expect(listed()).toEqual(['onix']);
  });
});
