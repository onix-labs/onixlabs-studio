import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import {
  UpstreamChoice,
  UpstreamConfirmation,
} from '@shared/angular/services/upstream-confirmation/upstream-confirmation';
import { UpstreamConfirmModal } from './upstream-confirm-modal';

describe('UpstreamConfirmModal', () => {
  let fixture: ComponentFixture<UpstreamConfirmModal>;
  let windows: FakeModalWindows;
  let confirmation: UpstreamConfirmation;

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [UpstreamConfirmModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();
    confirmation = TestBed.inject(UpstreamConfirmation);
    fixture = TestBed.createComponent(UpstreamConfirmModal);
    await fixture.whenStable();
  });

  it('asksAboutThePush_andAnswersWithTheChoice', async (): Promise<void> => {
    const answer: Promise<UpstreamChoice> = confirmation.ask({
      branch: 'feature',
      remote: 'origin',
    });
    await fixture.whenStable();

    expect(windows.contentHost?.textContent).toContain('origin/feature');
    windows.contentHost
      ?.querySelector<HTMLElement>('[data-testid="upstream-push-only"] button')
      ?.click();

    expect(await answer).toBe('push-only');
  });
});
