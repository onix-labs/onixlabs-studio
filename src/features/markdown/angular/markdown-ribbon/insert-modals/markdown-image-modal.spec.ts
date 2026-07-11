import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileSystem } from '@shared/angular/services/file-system/file-system';
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
  let host: HTMLElement;
  let component: TestHost;
  let pickedImage: string | null;

  beforeEach(async () => {
    pickedImage = null;

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
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
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  /**
   * Sets a field's value and dispatches its input event so the component signal updates.
   * @param selector The CSS selector locating the field.
   * @param value The value to type into the field.
   */
  function setField(selector: string, value: string): void {
    const field: HTMLInputElement = host.querySelector<HTMLInputElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * Finds an action button by its visible label.
   * @param label The button's trimmed text content.
   * @returns Returns the matching button element.
   */
  function buttonWithLabel(label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.insert-modal__button'),
    );
    return buttons.find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === label,
    )!;
  }

  it('insert_whenUrlEmpty_isDisabled', () => {
    const insert: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.insert-modal__button--primary',
    )!;

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedUrlAndAlt', () => {
    setField('#image-url', '  https://example.com/image.png  ');
    setField('#image-alt', '  A diagram  ');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ url: 'https://example.com/image.png', alt: 'A diagram' });
    expect(component.open()).toBe(false);
  });

  it('browse_whenFileChosen_fillsTheUrlField', async () => {
    pickedImage = '/Users/test/picture.png';

    buttonWithLabel('Browse…').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>('#image-url')!.value).toBe(
      '/Users/test/picture.png',
    );
  });

  it('browse_whenCancelled_leavesTheUrlFieldUnchanged', async () => {
    setField('#image-url', 'https://example.com/original.png');
    pickedImage = null;

    buttonWithLabel('Browse…').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>('#image-url')!.value).toBe(
      'https://example.com/original.png',
    );
  });

  it('cancel_whenClicked_closesWithoutEmittingAndResetsFields', () => {
    setField('#image-url', 'https://example.com/image.png');

    buttonWithLabel('Cancel').click();
    fixture.detectChanges();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#image-url')!.value).toBe('');
  });
});
