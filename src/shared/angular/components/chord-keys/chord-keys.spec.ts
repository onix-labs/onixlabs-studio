import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordKeys } from './chord-keys';

describe('ChordKeys', () => {
  let fixture: ComponentFixture<ChordKeys>;

  /**
   * Reads the rendered key caps.
   * @returns Returns each key cap's text.
   */
  function keys(): readonly string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('kbd')].map(
      (key: Element): string => key.textContent ?? '',
    );
  }

  beforeEach(async (): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [ChordKeys] }).compileComponents();
    fixture = TestBed.createComponent(ChordKeys);
  });

  it('showsEachKeyInItsOwnCap', async (): Promise<void> => {
    // Off macOS, where the tests run, Mod is Ctrl.
    fixture.componentRef.setInput('chord', 'Mod+Shift+T');
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(keys()).toEqual(['Ctrl', 'Shift', 'T']);
    expect(element.getAttribute('aria-label')).toBe('Ctrl Shift T');
  });

  it('showsArrowKeysAsArrows', async (): Promise<void> => {
    fixture.componentRef.setInput('chord', 'Alt+ArrowUp');
    await fixture.whenStable();

    expect(keys()).toEqual(['Alt', '↑']);
  });

  it('showsNothingForAnEmptyChord', async (): Promise<void> => {
    fixture.componentRef.setInput('chord', '');
    await fixture.whenStable();

    expect(keys()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).hasAttribute('aria-label')).toBe(false);
  });
});
