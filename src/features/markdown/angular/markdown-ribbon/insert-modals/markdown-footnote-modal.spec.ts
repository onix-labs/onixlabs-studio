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
   * Finds a field's control by the label of the atom holding it.
   * @param label The field's trimmed label text.
   * @returns Returns the matching control.
   */
  function fieldWithLabel(label: string): HTMLInputElement | HTMLTextAreaElement {
    const labels: HTMLLabelElement[] = Array.from(host.querySelectorAll<HTMLLabelElement>('label'));
    const match: HTMLLabelElement = labels.find(
      (candidate: HTMLLabelElement): boolean => candidate.textContent?.trim() === label,
    )!;
    return match.parentElement!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )!;
  }

  /**
   * Finds an action button by its visible label.
   * @param label The button's trimmed text content.
   * @returns Returns the matching button element.
   */
  function buttonWithLabel(label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('app-button button'),
    );
    return buttons.find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === label,
    )!;
  }

  /**
   * Sets a field's value and dispatches its input event so the component signal updates.
   * @param label The label of the field.
   * @param value The value to type into the field.
   */
  function setField(label: string, value: string): void {
    const field: HTMLInputElement | HTMLTextAreaElement = fieldWithLabel(label);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    flush();
  }

  it('insert_whenContentEmpty_isDisabledEvenWithLabel', () => {
    setField('Reference (optional)', 'source');

    const insert: HTMLButtonElement = buttonWithLabel('Insert');

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedLabelAndContent', () => {
    setField('Reference (optional)', '  source  ');
    setField('Footnote content', '  See the manual.  ');

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ label: 'source', content: 'See the manual.' });
    expect(component.open()).toBe(false);
  });

  it('insert_whenLabelOmitted_emitsEmptyLabel', () => {
    setField('Footnote content', 'See the manual.');

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ label: '', content: 'See the manual.' });
  });

  it('cancel_whenClicked_closesWithoutEmittingAndResetsFields', () => {
    setField('Footnote content', 'See the manual.');

    buttonWithLabel('Cancel').click();
    flush();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);

    component.open.set(true);
    flush();

    expect(fieldWithLabel('Footnote content').value).toBe('');
  });
});
