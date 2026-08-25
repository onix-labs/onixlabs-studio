import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Textarea } from './textarea';

describe('Textarea', () => {
  let fixture: ComponentFixture<Textarea>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Textarea] }).compileComponents();
    fixture = TestBed.createComponent(Textarea);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('typing_updatesTheValueModel', () => {
    const control: HTMLTextAreaElement = host.querySelector('textarea')!;
    control.value = 'a commit message';
    control.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.value()).toBe('a commit message');
  });

  it('rows_andAriaLabel_reachTheControl', () => {
    fixture.componentRef.setInput('rows', 7);
    fixture.componentRef.setInput('ariaLabel', 'Commit message');
    fixture.detectChanges();

    const control: HTMLTextAreaElement = host.querySelector('textarea')!;
    expect(control.rows).toBe(7);
    expect(control.getAttribute('aria-label')).toBe('Commit message');
  });

  it('boxedIsTheDefault_soAnOrdinaryFieldDrawsItsOwnChrome', () => {
    const control: HTMLTextAreaElement = host.querySelector('textarea')!;

    expect(control.classList.contains('textarea--seamless')).toBe(false);
    expect(control.classList.contains('textarea--fixed')).toBe(false);
    expect(control.style.blockSize).toBe('');
  });

  it('seamless_marksTheControl_forACardThatHasAlreadyDrawnTheBox', () => {
    fixture.componentRef.setInput('variant', 'seamless');
    fixture.detectChanges();

    expect(host.querySelector('textarea')!.classList.contains('textarea--seamless')).toBe(true);
  });

  it('fixedHeight_bindsTheHeightFromRows_soTheTwoCannotDrift', () => {
    fixture.componentRef.setInput('rows', 6);
    fixture.componentRef.setInput('fixedHeight', true);
    fixture.detectChanges();

    const control: HTMLTextAreaElement = host.querySelector('textarea')!;
    expect(control.classList.contains('textarea--fixed')).toBe(true);
    expect(control.rows).toBe(6);
    // Line boxes, not a guess at what a line is worth.
    expect(control.style.blockSize).toBe('6lh');
  });

  it('element_exposesTheControl_forACallerThatMeasuresIt', () => {
    // A composer grows with its content, which needs the element itself rather than its value.
    expect(fixture.componentInstance.element()).toBe(host.querySelector('textarea'));
  });
});
