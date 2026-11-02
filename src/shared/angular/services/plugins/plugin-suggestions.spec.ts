import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { PluginSuggestions } from './plugin-suggestions';

describe('PluginSuggestions', () => {
  let suggestions: PluginSuggestions;

  beforeEach(() => {
    localStorage.removeItem('settings');
    suggestions = TestBed.inject(PluginSuggestions);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('allowsEveryOffer_byDefault', () => {
    expect(suggestions.allows('language-support:rust')).toBe(true);
  });

  it('suggestPluginsOff_allowsNone', () => {
    TestBed.inject(Settings).set('plugins.suggestPlugins', false);

    expect(suggestions.allows('language-support:rust')).toBe(false);
  });

  it('dontSuggestAgain_turnsDownThatOfferOnly_once', () => {
    suggestions.dontSuggestAgain('language-support:rust').run();
    suggestions.dismiss('language-support:rust');

    expect(suggestions.allows('language-support:rust')).toBe(false);
    expect(suggestions.allows('language-support:go')).toBe(true);
    expect(suggestions.dismissed()).toEqual(['language-support:rust']);
  });

  it('restore_letsEveryOfferBeMadeAgain', () => {
    suggestions.dismiss('container-engine-support');
    suggestions.restore();

    expect(suggestions.allows('container-engine-support')).toBe(true);
    expect(suggestions.dismissedCount()).toBe(0);
  });
});
