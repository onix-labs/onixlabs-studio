import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { MarkdownTableModal, TableInsert } from './markdown-table-modal';

@Component({
  imports: [MarkdownTableModal],
  template: `
    <app-markdown-table-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: TableInsert | null = null;

  public onSubmit(table: TableInsert): void {
    this.submitted = table;
  }
}

describe('MarkdownTableModal', () => {
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
  function fieldWithLabel(label: string): HTMLInputElement {
    const labels: HTMLLabelElement[] = Array.from(host.querySelectorAll<HTMLLabelElement>('label'));
    const match: HTMLLabelElement = labels.find(
      (candidate: HTMLLabelElement): boolean => candidate.textContent?.trim() === label,
    )!;
    return match.parentElement!.querySelector<HTMLInputElement>('input, textarea')!;
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
    const field: HTMLInputElement = fieldWithLabel(label);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    flush();
  }

  it('insert_whenUntouched_emitsTheDefaultSize', () => {
    expect(buttonWithLabel('Insert').disabled).toBe(false);

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ rows: 3, columns: 3 });
    expect(component.open()).toBe(false);
  });

  it('insert_whenSubmitted_emitsTheTypedSize', () => {
    setField('Rows', '5');
    setField('Columns', '4');

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ rows: 5, columns: 4 });
  });

  it('insert_whenAFieldIsLeftAboveTheMaximum_emitsTheMaximum', () => {
    const rows: HTMLInputElement = fieldWithLabel('Rows');
    rows.value = '99';
    rows.dispatchEvent(new Event('change'));
    flush();

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ rows: 50, columns: 3 });
  });

  it('cancel_whenClicked_closesWithoutEmitting', () => {
    setField('Rows', '5');

    buttonWithLabel('Cancel').click();
    flush();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);
  });
});
