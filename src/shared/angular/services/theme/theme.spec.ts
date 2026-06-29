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

  it('setAccent_whenCalled_appliesTheAccentVariableAndPersists', () => {
    const service: Theme = TestBed.inject(Theme);

    service.setAccent('green');
    TestBed.inject(ApplicationRef).tick();

    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe(
      'var(--accent-green)',
    );
    expect(localStorage.getItem('theme.accent')).toBe(JSON.stringify('green'));
  });
});
