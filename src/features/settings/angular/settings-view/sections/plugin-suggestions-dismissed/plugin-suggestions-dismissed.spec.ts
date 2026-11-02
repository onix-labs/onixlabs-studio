import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { PluginSuggestionsDismissed } from './plugin-suggestions-dismissed';

describe('PluginSuggestionsDismissed', () => {
  let fixture: ComponentFixture<PluginSuggestionsDismissed>;

  /**
   * Reads the row's text, once it has caught up.
   * @returns Returns its text.
   */
  function text(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => {
    localStorage.removeItem('settings');
    fixture = TestBed.createComponent(PluginSuggestionsDismissed);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('showsNothing_untilAnOfferIsTurnedDown', () => {
    expect(text()).toBe('');
  });

  it('countsTheTurnedDownOffers_andRestoresThem', () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.set('plugins.dismissedSuggestions', [
      'language-support:rust',
      'container-engine-support',
    ]);
    expect(text()).toContain('2 plugin offers are turned off');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="plugin-suggestions-restore"] button')
      ?.click();

    expect(settings.get('plugins.dismissedSuggestions')).toEqual([]);
    expect(text()).toBe('');
  });
});
