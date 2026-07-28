import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CollapseInsert, MarkdownCollapseModal } from './markdown-collapse-modal';

@Component({
  imports: [MarkdownCollapseModal],
  template: `
    <app-markdown-collapse-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: CollapseInsert | null = null;

  public onSubmit(collapse: CollapseInsert): void {
    this.submitted = collapse;
  }
}

describe('MarkdownCollapseModal', () => {
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
   * Sets a field's value and dispatches its input event so the component signal updates.
   * @param selector The CSS selector locating the field.
   * @param value The value to type into the field.
   */
  function setField(selector: string, value: string): void {
    const field: HTMLInputElement | HTMLTextAreaElement = host.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('insert_whenSummaryEmpty_isDisabled', () => {
    const insert: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.insert-modal__button--primary',
    )!;

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedSummaryAndBody', () => {
    setField('#collapse-summary', '  Details  ');
    setField('#collapse-body', '  Hidden text  ');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ summary: 'Details', body: 'Hidden text' });
    expect(component.open()).toBe(false);
  });

  it('insert_whenSubmitted_resetsFieldsForTheNextOpen', () => {
    setField('#collapse-summary', 'Details');
    setField('#collapse-body', 'Hidden text');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();
    fixture.detectChanges();

    component.open.set(true);
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>('#collapse-summary')!.value).toBe('');
    expect(host.querySelector<HTMLTextAreaElement>('#collapse-body')!.value).toBe('');
  });

  it('cancel_whenClicked_closesWithoutEmitting', () => {
    setField('#collapse-summary', 'Details');

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

    component.open.set(true);
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>('#collapse-summary')!.value).toBe('');
  });
});
