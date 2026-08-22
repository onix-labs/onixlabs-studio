import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { LinkInsert, MarkdownLinkModal } from './markdown-link-modal';

@Component({
  imports: [MarkdownLinkModal],
  template: `
    <app-markdown-link-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: LinkInsert | null = null;

  public onSubmit(link: LinkInsert): void {
    this.submitted = link;
  }
}

describe('MarkdownLinkModal', () => {
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

  function setInput(selector: string, value: string): void {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    flush();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('insert_whenUrlEmpty_isDisabled', () => {
    const insert: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.insert-modal__button--primary',
    )!;

    expect(insert.disabled).toBe(true);
  });

  it('insert_whenSubmitted_emitsTrimmedTextAndUrl', () => {
    setInput('#link-text', '  Docs  ');
    setInput('#link-url', '  https://example.com  ');

    host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!.click();

    expect(component.submitted).toEqual({ text: 'Docs', url: 'https://example.com' });
    expect(component.open()).toBe(false);
  });

  it('cancel_whenClicked_closesWithoutEmitting', () => {
    setInput('#link-url', 'https://example.com');

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
  });
});
