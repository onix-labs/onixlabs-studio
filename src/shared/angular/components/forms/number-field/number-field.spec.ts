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

  function setInputValue(value: string): void {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }
  }
});
