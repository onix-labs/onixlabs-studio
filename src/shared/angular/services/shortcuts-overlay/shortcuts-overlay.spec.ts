import { TestBed } from '@angular/core/testing';

import { ShortcutsOverlay } from './shortcuts-overlay';

describe('ShortcutsOverlay', () => {
  let overlay: ShortcutsOverlay;

  beforeEach((): void => {
    overlay = TestBed.inject(ShortcutsOverlay);
  });

  it('startsClosed', (): void => {
    expect(overlay.visible()).toBe(false);
  });

  it('toggle_flipsVisibility', (): void => {
    overlay.toggle();
    expect(overlay.visible()).toBe(true);
    overlay.toggle();
    expect(overlay.visible()).toBe(false);
  });

  it('close_whenOpen_closes', (): void => {
    overlay.toggle();
    overlay.close();
    expect(overlay.visible()).toBe(false);
  });
});
