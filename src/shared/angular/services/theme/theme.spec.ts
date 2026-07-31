import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Theme } from './theme';

describe('Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    const root: HTMLElement = document.documentElement;
    root.removeAttribute('data-theme-mode');
    root.style.removeProperty('--accent-color');
    root.style.removeProperty('--accent-color-rgb');
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(Theme)).toBeTruthy();
  });

  it('setMode_whenSetToDark_appliesDarkToTheDocument', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setMode('dark');
    TestBed.inject(ApplicationRef).tick();

    expect(document.documentElement.dataset['themeMode']).toBe('dark');
  });

  it('setMode_whenCalled_persistsTheChoice', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setMode('dark');

    expect(localStorage.getItem('theme.mode')).toBe(JSON.stringify('dark'));
  });

  it('mode_whenChoiceWasPersisted_isRestoredOnCreation', () => {
    localStorage.setItem('theme.mode', JSON.stringify('dark'));

    expect(TestBed.inject(Theme).mode()).toBe('dark');
  });

  it('setAccent_whenAPresetChosen_appliesItsHexAndPersistsTheChoice', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setAccent({ kind: 'preset', id: 'green' });
    TestBed.inject(ApplicationRef).tick();

    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe('#6FBA82');
    expect(localStorage.getItem('theme.accent')).toBe(
      JSON.stringify({ kind: 'preset', id: 'green' }),
    );
  });

  it('setAccent_whenCustomChosen_appliesAResolvedHexAndRgbAndPersists', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setAccent({ kind: 'custom', hue: 210, saturation: 80 });
    TestBed.inject(ApplicationRef).tick();

    const root: HTMLElement = document.documentElement;
    expect(root.style.getPropertyValue('--accent-color')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(root.style.getPropertyValue('--accent-color-rgb')).toMatch(/^\d+, \d+, \d+$/);
    expect(localStorage.getItem('theme.accent')).toBe(
      JSON.stringify({ kind: 'custom', hue: 210, saturation: 80 }),
    );
  });

  it('setAccent_whenCustomSaturationBelowFloor_clampsAwayFromGrey', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setAccent({ kind: 'custom', hue: 120, saturation: 0 });

    expect(service.accent()).toEqual({ kind: 'custom', hue: 120, saturation: 12 });
  });

  it('accent_whenLegacyNameStringWasPersisted_migratesToTheMatchingPreset', () => {
    localStorage.setItem('theme.accent', JSON.stringify('green'));

    expect(TestBed.inject(Theme).accent()).toEqual({ kind: 'preset', id: 'green' });
  });

  it('accent_whenLegacyNameNoLongerAPreset_fallsBackToTheDefault', () => {
    localStorage.setItem('theme.accent', JSON.stringify('magenta'));

    expect(TestBed.inject(Theme).accent()).toEqual({ kind: 'preset', id: 'blue' });
  });

  it('externalChange_fromAnotherWindow_appliesTheStoredModeAndAccentLive', () => {
    const service: Theme = TestBed.inject(Theme);

    // Another window wrote the store, then the browser notified this one.
    localStorage.setItem('theme.mode', JSON.stringify('dark'));
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'theme.mode' }));
    localStorage.setItem('theme.accent', JSON.stringify({ kind: 'preset', id: 'green' }));
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'theme.accent' }));
    TestBed.inject(ApplicationRef).tick();

    expect(service.mode()).toBe('dark');
    expect(service.accent()).toEqual({ kind: 'preset', id: 'green' });
    expect(document.documentElement.dataset['themeMode']).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe('#6FBA82');
  });
});
