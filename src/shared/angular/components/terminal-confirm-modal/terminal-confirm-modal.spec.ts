import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { TerminalConfirmation } from '@shared/angular/services/terminal-confirmation/terminal-confirmation';
import { TerminalConfirmModal } from './terminal-confirm-modal';

describe('TerminalConfirmModal', () => {
  let fixture: ComponentFixture<TerminalConfirmModal>;
  let windows: FakeModalWindows;
  let confirmation: TerminalConfirmation;

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [TerminalConfirmModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();
    confirmation = TestBed.inject(TerminalConfirmation);
    fixture = TestBed.createComponent(TerminalConfirmModal);
    await fixture.whenStable();
  });

  it('showsTheQuestionWithItsDetail_andAnswersIt', async (): Promise<void> => {
    const answer: Promise<boolean> = confirmation.ask({
      title: 'Paste 2 Lines?',
      body: 'Each line may run as soon as it arrives.',
      detail: 'rm -rf build\nnpm ci',
      confirmLabel: 'Paste',
      setting: 'Warn Before Multi-Line Paste: On',
    });
    await fixture.whenStable();

    expect(windows.contentHost?.textContent).toContain('Paste 2 Lines?');
    expect(windows.contentHost?.querySelector('pre')?.textContent).toBe('rm -rf build\nnpm ci');
    windows.contentHost
      ?.querySelector<HTMLElement>('[data-testid="terminal-confirm"] button')
      ?.click();

    expect(await answer).toBe(true);
  });

  it('cancel_answersNo', async (): Promise<void> => {
    const answer: Promise<boolean> = confirmation.ask({
      title: 'Close Terminal?',
      body: 'A program is still running.',
      confirmLabel: 'Close',
      setting: 'Confirm Before Closing a Running Terminal: When Running',
    });
    await fixture.whenStable();
    windows.contentHost
      ?.querySelector<HTMLElement>('[data-testid="terminal-cancel"] button')
      ?.click();

    expect(await answer).toBe(false);
  });
});
