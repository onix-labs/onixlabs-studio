import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Modal } from './modal';

@Component({
  imports: [Modal],
  template: `
    <app-modal
      [open]="open()"
      [dismissable]="dismissable()"
      [width]="width()"
      ariaLabel="Test modal"
      (dismiss)="onDismiss()"
    >
      <p class="modal-content">Body</p>
    </app-modal>
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public readonly dismissable: WritableSignal<boolean> = signal<boolean>(true);
  public readonly width: WritableSignal<number | undefined> = signal<number | undefined>(undefined);
  public dismissed: number = 0;

  public onDismiss(): void {
    this.dismissed += 1;
  }
}

describe('Modal', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('open_whenTrue_isVisibleAndProjectsContent', () => {
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.modal-content')?.textContent).toContain('Body');
  });

  it('width_whenSet_sizesThePanel', () => {
    component.width.set(30);
    fixture.detectChanges();

    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    expect(panel.style.getPropertyValue('--modal-panel-inline-size')).toBe('min(30rem, 100%)');
  });

  it('width_whenUnset_defersToTheThemedDefault', () => {
    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    expect(panel.style.getPropertyValue('--modal-panel-inline-size')).toBe('');
  });

  it('open_whenFalse_isNotVisible', () => {
    component.open.set(false);
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).toBeNull();
  });

  it('backdropClick_whenDismissable_emitsDismiss', () => {
    const backdrop: HTMLElement = host.querySelector<HTMLElement>('.modal')!;
    backdrop.click();

    expect(component.dismissed).toBe(1);
  });

  it('panelClick_whenDismissable_doesNotEmitDismiss', () => {
    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    panel.click();

    expect(component.dismissed).toBe(0);
  });

  it('escapeKey_whenDismissable_emitsDismiss', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.dismissed).toBe(1);
  });

  it('closeButton_whenDismissable_isShownAndEmitsDismiss', () => {
    const close: HTMLButtonElement | null = host.querySelector<HTMLButtonElement>('.modal__close');
    expect(close).not.toBeNull();

    close!.click();

    expect(component.dismissed).toBe(1);
  });

  it('backdropClick_whenNotDismissable_doesNotEmitDismiss', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    const backdrop: HTMLElement = host.querySelector<HTMLElement>('.modal')!;
    backdrop.click();

    expect(component.dismissed).toBe(0);
  });

  it('escapeKey_whenNotDismissable_doesNotEmitDismiss', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.dismissed).toBe(0);
  });

  it('closeButton_whenNotDismissable_isNotShown', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    expect(host.querySelector('.modal__close')).toBeNull();
  });
});
