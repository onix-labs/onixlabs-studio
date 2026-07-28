import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownMathModal, MathInsert } from './markdown-math-modal';

@Component({
  imports: [MarkdownMathModal],
  template: `
    <app-markdown-math-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: MathInsert | null = null;

  public onSubmit(math: MathInsert): void {
    this.submitted = math;
  }
}

describe('MarkdownMathModal', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: HTMLElement;
  let component: TestHost;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  /**
   * Sets the LaTeX expression field and dispatches its input event so the component signal updates.
   * @param value The expression to type into the field.
   */
  function setExpression(value: string): void {
    const field: HTMLTextAreaElement = host.querySelector<HTMLTextAreaElement>('#math-expression')!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * Selects the Block or Inline mode radio by dispatching its change event.
   * @param label The trimmed label of the mode option to select.
   */
  function selectMode(label: string): void {
    const options: HTMLLabelElement[] = Array.from(
      host.querySelectorAll<HTMLLabelElement>('.insert-modal__choice-option'),
    );
    const option: HTMLLabelElement = options.find(
      (candidate: HTMLLabelElement): boolean => candidate.textContent?.trim() === label,
    )!;
    option.querySelector<HTMLInputElement>('input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('insert_whenExpressionEmpty_isDisabled', () => {
    const insert: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.insert-modal__button--primary',
    )!;

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedExpressionAsBlockByDefault', () => {
    setExpression('  \\frac{a}{b}  ');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ expression: '\\frac{a}{b}', block: true });
    expect(component.open()).toBe(false);
  });

  it('insert_whenInlineSelected_emitsInlineExpression', () => {
    setExpression('a^2 + b^2');
    selectMode('Inline');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ expression: 'a^2 + b^2', block: false });
  });

  it('insert_whenSubmitted_resetsExpressionAndModeForTheNextOpen', () => {
    setExpression('a^2');
    selectMode('Inline');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();
    fixture.detectChanges();

    component.open.set(true);
    fixture.detectChanges();

    const radios: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('input[name="math-mode"]'),
    );

    expect(host.querySelector<HTMLTextAreaElement>('#math-expression')!.value).toBe('');
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it('cancel_whenClicked_closesWithoutEmitting', () => {
    setExpression('a^2');

    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.insert-modal__button'),
    );
    const cancel: HTMLButtonElement = buttons.find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    fixture.detectChanges();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);
  });
});
