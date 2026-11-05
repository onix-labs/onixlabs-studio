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

  /**
   * Puts the control in a label, as a setting row does, with a caption to press.
   * @returns Returns the caption.
   */
  function labelled(): HTMLElement {
    const label: HTMLLabelElement = document.createElement('label');
    const caption: HTMLElement = document.createElement('span');
    host.replaceWith(label);
    label.append(caption, host);
    return caption;
  }

  /**
   * Presses and releases on an element, as a mouse does.
   * @param element The element.
   */
  function press(element: HTMLElement): void {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    element.click();
    TestBed.tick();
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

  it('groups_whenOptionsCarryHeadings_showsEachRunUnderItsHeading', () => {
    fixture.componentRef.setInput('options', [
      { value: 'typescript', label: 'TypeScript', group: 'Languages' },
      { value: 'python', label: 'Python', group: 'Languages' },
      { value: 'angular', label: 'Angular', group: 'Frontend' },
    ]);
    open();

    expect(
      Array.from(document.querySelectorAll('.multi-select__heading')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['Languages', 'Frontend']);
    expect(rows()).toHaveLength(3);
  });

  it('search_whenSearchable_narrowsTheRowsByLabelOrHeading', () => {
    fixture.componentRef.setInput('options', [
      { value: 'typescript', label: 'TypeScript', group: 'Languages' },
      { value: 'angular', label: 'Angular', group: 'Frontend' },
      { value: 'react', label: 'React', group: 'Frontend' },
    ]);
    fixture.componentRef.setInput('searchable', true);
    open();
    const field: HTMLInputElement | null = document.querySelector<HTMLInputElement>(
      '.multi-select__search input',
    );
    expect(field).not.toBeNull();

    field!.value = 'ular';
    field!.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(rows().map((row) => row.textContent?.trim())).toEqual(['Angular']);

    field!.value = 'frontend';
    field!.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(rows().map((row) => row.textContent?.trim())).toEqual(['Angular', 'React']);

    field!.value = 'zzz';
    field!.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.multi-select__empty')?.textContent).toContain('Nothing');
  });

  it('label_opensTheClosedPanel_likeTheFace', () => {
    const caption: HTMLElement = labelled();

    press(caption);

    expect(rows().length).toBeGreaterThan(0);
  });

  it('label_closesTheOpenPanel_ratherThanReopeningIt', () => {
    const caption: HTMLElement = labelled();
    press(caption);

    press(caption);

    expect(rows()).toEqual([]);
  });

  it('label_opensItAgain_onTheThirdPress', async () => {
    const caption: HTMLElement = labelled();
    press(caption);
    press(caption);
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve));

    press(caption);

    expect(rows().length).toBeGreaterThan(0);
  });

  it('floating_namesTheControl_besideItsChoice', async () => {
    fixture.componentRef.setInput('label', 'Applies In');
    await fixture.whenStable();

    expect(host.classList.contains('multi-select--floating')).toBe(true);
    expect(host.querySelector('.multi-select__floating-label')?.textContent).toBe('Applies In');
    expect(face().getAttribute('aria-label')).toBe('Applies In');
  });

  it('plain_hasNoFloatingLabel', () => {
    expect(host.classList.contains('multi-select--floating')).toBe(false);
    expect(host.querySelector('.multi-select__floating-label')).toBeNull();
  });
});
