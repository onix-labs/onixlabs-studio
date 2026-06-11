import { TestBed } from '@angular/core/testing';

import { SettingsStore } from './settings-store';

describe('SettingsStore', () => {
  let service: SettingsStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(SettingsStore);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('get_whenKeyAbsent_returnsTheFallback', () => {
    expect(service.get('missing', 'fallback')).toBe('fallback');
  });

  it('get_whenValuePreviouslySet_returnsTheStoredValue', () => {
    service.set('mode', 'dark');

    expect(service.get('mode', 'light')).toBe('dark');
  });

  it('get_whenValueIsAnObject_roundTripsThroughJson', () => {
    const value: { readonly a: number; readonly b: readonly string[] } = { a: 1, b: ['x', 'y'] };
    service.set('object', value);

    expect(service.get('object', null)).toEqual(value);
  });

  it('get_whenStoredValueIsMalformed_returnsTheFallback', () => {
    localStorage.setItem('broken', '{ not json');

    expect(service.get('broken', 'fallback')).toBe('fallback');
  });
});
