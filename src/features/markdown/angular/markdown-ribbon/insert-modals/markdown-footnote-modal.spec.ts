import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { FootnoteInsert, MarkdownFootnoteModal } from './markdown-footnote-modal';

@Component({
  imports: [MarkdownFootnoteModal],
  template: `
    <app-markdown-footnote-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: FootnoteInsert | null = null;

  public onSubmit(footnote: FootnoteInsert): void {
    this.submitted = footnote;
  }
}

describe('MarkdownFootnoteModal', () => {
  let fixture: ComponentFixture<TestHost>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let component: TestHost;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The modal is presented in a window; its content renders into that window's host.
    host = windows.contentHost!;
  });

  /**
   * Flushes change detection through the modal window's attached view, then re-points the content
   * host at the current window (a reopen presents a fresh one).
   */
  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
    host = windows.contentHost!;
  }

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
    flush();
  }

  it('insert_whenContentEmpty_isDisabledEvenWithLabel', () => {
    setField('#footnote-label', 'source');

    const insert: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.insert-modal__button--primary',
    )!;

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedLabelAndContent', () => {
    setField('#footnote-label', '  source  ');
    setField('#footnote-content', '  See the manual.  ');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ label: 'source', content: 'See the manual.' });
    expect(component.open()).toBe(false);
  });

  it('insert_whenLabelOmitted_emitsEmptyLabel', () => {
    setField('#footnote-content', 'See the manual.');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ label: '', content: 'See the manual.' });
  });

  it('cancel_whenClicked_closesWithoutEmittingAndResetsFields', () => {
    setField('#footnote-content', 'See the manual.');

    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.insert-modal__button'),
    );
    const cancel: HTMLButtonElement = buttons.find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    flush();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);

    component.open.set(true);
    flush();

    expect(host.querySelector<HTMLTextAreaElement>('#footnote-content')!.value).toBe('');
  });
});
