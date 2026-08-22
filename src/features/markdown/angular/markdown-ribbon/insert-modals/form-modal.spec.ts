import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { FormModal } from './form-modal';

@Component({
  imports: [FormModal],
  template: `
    <app-form-modal
      [open]="true"
      heading="Test Heading"
      [canSubmit]="canSubmit()"
      [submitLabel]="submitLabel()"
      (confirmed)="confirmedCount = confirmedCount + 1"
      (cancelled)="cancelledCount = cancelledCount + 1"
    >
      <p class="projected">Projected content</p>
    </app-form-modal>
  `,
})
class TestHost {
  public readonly canSubmit: WritableSignal<boolean> = signal<boolean>(false);
  public readonly submitLabel: WritableSignal<string> = signal<string>('Insert');
  public confirmedCount: number = 0;
  public cancelledCount: number = 0;
}

describe('FormModal', () => {
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
   * Finds the primary (submit) action button.
   * @returns Returns the primary button element.
   */
  function primaryButton(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>('.insert-modal__button--primary')!;
  }

  /**
   * Finds the Cancel action button by its label.
   * @returns Returns the Cancel button element.
   */
  function cancelButton(): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.insert-modal__button'),
    );
    return buttons.find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Cancel',
    )!;
  }

  it('render_whenOpen_showsHeadingAndProjectedContent', () => {
    expect(host.querySelector('.insert-modal__title')?.textContent?.trim()).toBe('Test Heading');
    expect(host.querySelector('.projected')?.textContent?.trim()).toBe('Projected content');
  });

  it('primaryButton_whenCanSubmitFalse_isDisabled', () => {
    expect(primaryButton().disabled).toBe(true);
  });

  it('primaryButton_whenCanSubmitTrue_emitsConfirmedOnClick', () => {
    component.canSubmit.set(true);
    flush();

    expect(primaryButton().disabled).toBe(false);

    primaryButton().click();

    expect(component.confirmedCount).toBe(1);
    expect(component.cancelledCount).toBe(0);
  });

  it('cancelButton_whenClicked_emitsCancelledWithoutConfirming', () => {
    cancelButton().click();

    expect(component.cancelledCount).toBe(1);
    expect(component.confirmedCount).toBe(0);
  });

  it('submitLabel_whenProvided_labelsThePrimaryButton', () => {
    expect(primaryButton().textContent?.trim()).toBe('Insert');

    component.submitLabel.set('Save');
    flush();

    expect(primaryButton().textContent?.trim()).toBe('Save');
  });
});
