import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentVisibility } from './document-visibility';

describe('DocumentVisibility', () => {
  /**
   * Makes the test document report the given visibility state.
   * @param state The state to report.
   */
  function pretend(state: DocumentVisibilityState): void {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('startsFromTheDocumentsCurrentState', () => {
    pretend('hidden');
    expect(TestBed.inject(DocumentVisibility).visible()).toBe(false);
  });

  it('followsVisibilityChanges_hiddenThenBack', () => {
    pretend('visible');
    const visibility: DocumentVisibility = TestBed.inject(DocumentVisibility);
    expect(visibility.visible()).toBe(true);

    pretend('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(visibility.visible()).toBe(false);

    pretend('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(visibility.visible()).toBe(true);
  });

  it('stopsListeningWhenItsInjectorIsDestroyed', () => {
    pretend('visible');
    const visibility: DocumentVisibility = TestBed.inject(DocumentVisibility);
    TestBed.resetTestingModule();

    pretend('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(visibility.visible()).toBe(true);
  });
});
