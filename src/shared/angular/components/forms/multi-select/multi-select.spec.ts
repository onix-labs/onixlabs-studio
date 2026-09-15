import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MultiSelect, MultiSelectItem } from './multi-select';

const OPTIONS: readonly MultiSelectItem[] = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust', disabled: true },
];

describe('MultiSelect', () => {
  let component: MultiSelect;
  let fixture: ComponentFixture<MultiSelect>;
  let host: HTMLElement;

  /**
   * Gets the face button.
   * @returns Returns the face.
   */
  function face(): HTMLButtonElement {
    const button: HTMLButtonElement | null = host.querySelector<HTMLButtonElement>('.multi-select');
    if (button === null) {
      throw new Error('The control has no face.');
    }
    return button;
  }

  /**
   * Opens the panel, which renders through the CDK overlay outside the fixture.
   */
  function open(): void {
    face().click();
    TestBed.tick();
  }

  /**
   * Gets the panel's rows.
   * @returns Returns the row buttons.
   */
  function rows(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.multi-select__option'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MultiSelect] }).compileComponents();

    fixture = TestBed.createComponent(MultiSelect);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('placeholder', 'Every language');
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('face_whenNothingTicked_showsThePlaceholder', () => {
    expect(face().textContent?.trim()).toBe('Every language');
    expect(face().classList.contains('multi-select--empty')).toBe(true);
  });

  it('face_whenOptionsTicked_listsTheirLabelsInOptionOrder', async () => {
    fixture.componentRef.setInput('value', ['python', 'typescript']);
    await fixture.whenStable();

    expect(face().textContent?.trim()).toBe('TypeScript, Python');
    expect(face().classList.contains('multi-select--empty')).toBe(false);
  });

  it('open_whenFaceClicked_rendersARowPerOptionWithItsCheckedState', async () => {
    fixture.componentRef.setInput('value', ['python']);
    await fixture.whenStable();

    open();

    const checked: readonly (string | null)[] = rows().map((row: HTMLButtonElement) =>
      row.getAttribute('aria-checked'),
    );
    expect(rows().map((row: HTMLButtonElement) => row.textContent?.trim())).toEqual([
      'TypeScript',
      'Python',
      'Rust',
    ]);
    expect(checked).toEqual(['false', 'true', 'false']);
    expect(rows()[2].getAttribute('aria-disabled')).toBe('true');
  });

  it('toggle_whenRowClicked_ticksItAndKeepsThePanelOpen', () => {
    const emitted: (readonly string[])[] = [];
    component.value.subscribe((value: readonly string[]): void => void emitted.push(value));
    open();

    rows()[0].click();
    fixture.detectChanges();

    expect(emitted).toEqual([['typescript']]);
    expect(component.value()).toEqual(['typescript']);
    expect(rows()).toHaveLength(3);
    expect(rows()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('toggle_whenTickedRowClicked_untucksIt', async () => {
    fixture.componentRef.setInput('value', ['typescript', 'python']);
    await fixture.whenStable();
    open();

    rows()[0].click();

    expect(component.value()).toEqual(['python']);
  });

  it('toggle_whenDisabledRowClicked_changesNothing', () => {
    open();

    rows()[2].click();

    expect(component.value()).toEqual([]);
  });

  it('open_always_flipsTheCaretUntilClosed', () => {
    open();
    fixture.detectChanges();
    expect(face().classList.contains('multi-select--open')).toBe(true);

    // The CDK menu reads keyCode, which jsdom leaves at 0 unless stated.
    document
      .querySelector('.multi-select__panel')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    TestBed.tick();
    fixture.detectChanges();

    expect(rows()).toHaveLength(0);
    expect(face().classList.contains('multi-select--open')).toBe(false);
  });
});
