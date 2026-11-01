import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { SpellingChannel } from '@shared/api/spelling-channels';
import { SpellCheckingLanguages } from './spell-checking-languages';

/**
 * Answers the available-languages request as Windows or Linux would.
 */
class LanguagesBridge implements Bridge {
  public invoke<T>(channel: string): Promise<T> {
    return Promise.resolve(
      (channel === String(SpellingChannel.AvailableLanguages)
        ? ['en-US', 'en-GB', 'fr']
        : undefined) as T,
    );
  }

  public send(): void {
    // Not used.
  }

  public on(): () => void {
    return (): void => undefined;
  }
}

describe('SpellCheckingLanguages', () => {
  let fixture: ComponentFixture<SpellCheckingLanguages>;

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    Object.defineProperty(window, 'bridge', { value: new LanguagesBridge(), configurable: true });
    await TestBed.configureTestingModule({
      imports: [SpellCheckingLanguages],
    }).compileComponents();
    fixture = TestBed.createComponent(SpellCheckingLanguages);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'bridge');
    localStorage.clear();
  });

  it('offersTheLanguagesTheSpellCheckerSupports_withTheSystemLanguageAsTheEmptyChoice', (): void => {
    // Off macOS, where the tests run, the languages can be chosen.
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-multi-select')).not.toBeNull();
    expect(element.textContent).toContain('System Language');
  });
});
