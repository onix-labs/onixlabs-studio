import { TestBed } from '@angular/core/testing';
import { TerminalConfirmation, TerminalQuestion } from './terminal-confirmation';

describe('TerminalConfirmation', () => {
  const question: TerminalQuestion = {
    title: 'Paste 3 Lines?',
    body: 'Each line may run as soon as it arrives.',
    confirmLabel: 'Paste',
    setting: 'Warn Before Multi-Line Paste',
  };

  it('opensTheQuestion_andResolvesWithTheAnswer', async () => {
    const confirmation: TerminalConfirmation = TestBed.inject(TerminalConfirmation);
    const answer: Promise<boolean> = confirmation.ask(question);
    expect(confirmation.pending()).toBe(question);

    confirmation.answer(true);

    expect(await answer).toBe(true);
    expect(confirmation.pending()).toBeNull();
  });

  it('aSecondQuestion_answersTheFirstNo', async () => {
    const confirmation: TerminalConfirmation = TestBed.inject(TerminalConfirmation);
    const first: Promise<boolean> = confirmation.ask(question);
    const second: Promise<boolean> = confirmation.ask({ ...question, title: 'Close?' });

    expect(await first).toBe(false);
    expect(confirmation.pending()?.title).toBe('Close?');
    confirmation.answer(true);
    expect(await second).toBe(true);
  });
});
