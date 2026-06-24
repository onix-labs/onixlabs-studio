import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

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

  function setInput(selector: string, value: string): void {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
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
    fixture.detectChanges();

    expect(component.submitted).toBeNull();
    expect(component.open()).toBe(false);
  });
});
