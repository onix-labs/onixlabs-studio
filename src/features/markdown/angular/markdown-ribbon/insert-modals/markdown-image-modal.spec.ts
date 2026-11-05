import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { ImageInsert, MarkdownImageModal } from './markdown-image-modal';

@Component({
  imports: [MarkdownImageModal],
  template: `
    <app-markdown-image-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: ImageInsert | null = null;

  public onSubmit(image: ImageInsert): void {
    this.submitted = image;
  }
}

describe('MarkdownImageModal', () => {
  let fixture: ComponentFixture<TestHost>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let component: TestHost;
  let pickedImage: string | null;

  beforeEach(async () => {
    pickedImage = null;
    windows = new FakeModalWindows();

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        { provide: ModalWindows, useValue: windows },
        {
          provide: FileSystem,
          useValue: {
            pickImage: (): Promise<string | null> => Promise.resolve(pickedImage),
          },
        },
      ],
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

  it('insert_whenUrlEmpty_isDisabled', () => {
    const insert: HTMLButtonElement = buttonWithLabel('Insert');

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedUrlAndAlt', () => {
    setField('URL or file', '  https://example.com/image.png  ');
    setField('Alt text', '  A diagram  ');

    buttonWithLabel('Insert').click();

    expect(component.submitted).toEqual({ url: 'https://example.com/image.png', alt: 'A diagram' });
    expect(component.open()).toBe(false);
  });

  it('browse_whenFileChosen_fillsTheUrlField', async () => {
    pickedImage = '/Users/test/picture.png';

    buttonWithLabel('Browse…').click();
    await fixture.whenStable();
    flush();

    expect(fieldWithLabel('URL or file').value).toBe('/Users/test/picture.png');
  });

  it('browse_whenCancelled_leavesTheUrlFieldUnchanged', async () => {
    setField('URL or file', 'https://example.com/original.png');
    pickedImage = null;

    buttonWithLabel('Browse…').click();
    await fixture.whenStable();
    flush();

    expect(fieldWithLabel('URL or file').value).toBe('https://example.com/original.png');
  });

  it('cancel_whenClicked_closesWithoutEmittingAndResetsFields', () => {
    setField('URL or file', 'https://example.com/image.png');

    buttonWithLabel('Cancel').click();
    flush();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);

    component.open.set(true);
    flush();

    expect(fieldWithLabel('URL or file').value).toBe('');
  });
});
