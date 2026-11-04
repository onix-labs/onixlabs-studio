import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NumberField } from './number-field';

describe('NumberField', () => {
  let component: NumberField;
  let fixture: ComponentFixture<NumberField>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NumberField],
    }).compileComponents();

    fixture = TestBed.createComponent(NumberField);
    fixture.componentRef.setInput('min', 10);
    fixture.componentRef.setInput('max', 1000);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('value_whenEnteredAboveMaximum_clampsToMaximum', () => {
    setInputValue('5000');
    expect(component.value()).toBe(1000);
  });

  it('value_whenEnteredBelowMinimum_clampsToMinimum', () => {
    setInputValue('1');
    expect(component.value()).toBe(10);
  });

  it('value_whenEnteredWithinRange_isAccepted', () => {
    setInputValue('250');
    expect(component.value()).toBe(250);
  });

  it('typing_whenNotLive_reportsNothingUntilTheFieldIsLeft', () => {
    typeValue('250');
    expect(component.value()).toBe(0);
  });

  it('typing_whenLive_reportsAValueWithinBounds_atOnce', () => {
    fixture.componentRef.setInput('live', true);

    typeValue('250');
    expect(component.value()).toBe(250);

    // Out of bounds is left for the change, which clamps it, rather than reported half-typed.
    typeValue('5');
    expect(component.value()).toBe(250);
  });

  it('zeroIsEmpty_showsZeroAsAnEmptyField_withItsPlaceholder', () => {
    fixture.componentRef.setInput('min', 0);
    fixture.componentRef.setInput('zeroIsEmpty', true);
    fixture.componentRef.setInput('placeholder', 'Issue number');
    fixture.detectChanges();
    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;

    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Issue number');

    setInputValue('');
    expect(component.value()).toBe(0);
  });

  it('floating_rendersALabelTiedToTheControl', () => {
    fixture.componentRef.setInput('variant', 'floating');
    fixture.componentRef.setInput('label', 'Rows');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const label: HTMLLabelElement = host.querySelector<HTMLLabelElement>('label')!;
    expect(label.textContent?.trim()).toBe('Rows');
    expect(label.htmlFor).not.toBe('');
    expect(label.htmlFor).toBe(host.querySelector('input')!.id);
  });

  it('floating_withNoPlaceholder_stillCarriesOne', () => {
    fixture.componentRef.setInput('variant', 'floating');
    fixture.detectChanges();

    // The stylesheet tells an empty field from a filled one by whether the placeholder is showing.
    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('placeholder')).toBe(' ');
  });

  it('outline_rendersNoFloatingLabel_andKeepsItsPlaceholder', () => {
    fixture.componentRef.setInput('label', 'Rows');
    fixture.componentRef.setInput('placeholder', 'Issue number');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('label')).toBeNull();
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Issue number');
  });

  it('digitsOnly_preventsABeforeInputCarryingNonDigits_andAllowsDigits', () => {
    fixture.componentRef.setInput('digitsOnly', true);
    fixture.detectChanges();

    expect(beforeInput('-').defaultPrevented).toBe(true);
    expect(beforeInput('1e').defaultPrevented).toBe(true);
    expect(beforeInput('42').defaultPrevented).toBe(false);
  });

  it('digitsOnly_whenOff_leavesABeforeInputAlone', () => {
    expect(beforeInput('-').defaultPrevented).toBe(false);
  });

  it('clamp_landingOnTheValueAlreadyHeld_writesItBackIntoTheElement', () => {
    fixture.componentRef.setInput('value', 1000);
    fixture.detectChanges();

    // No signal changes here, so nothing but the clamp itself can correct what was typed.
    setInputValue('5000');

    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(component.value()).toBe(1000);
    expect(input.value).toBe('1000');
  });

  function beforeInput(data: string): InputEvent {
    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    const event: InputEvent = new InputEvent('beforeinput', { data, cancelable: true });
    input.dispatchEvent(event);
    return event;
  }

  function typeValue(value: string): void {
    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function setInputValue(value: string): void {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }
  }
});
