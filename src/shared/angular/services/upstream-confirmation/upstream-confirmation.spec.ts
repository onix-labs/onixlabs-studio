import { UpstreamChoice, UpstreamConfirmation } from './upstream-confirmation';

describe('UpstreamConfirmation', () => {
  it('ask_waitsForTheAnswer_andClearsTheQuestion', async (): Promise<void> => {
    const confirmation: UpstreamConfirmation = new UpstreamConfirmation();
    const answer: Promise<UpstreamChoice> = confirmation.ask({
      branch: 'feature',
      remote: 'origin',
    });
    expect(confirmation.pending()).toEqual({ branch: 'feature', remote: 'origin' });

    confirmation.answer('push-only');

    expect(await answer).toBe('push-only');
    expect(confirmation.pending()).toBeNull();
  });

  it('ask_cancelsAnEarlierQuestionStillOpen', async (): Promise<void> => {
    const confirmation: UpstreamConfirmation = new UpstreamConfirmation();
    const first: Promise<UpstreamChoice> = confirmation.ask({ branch: 'a', remote: 'origin' });

    void confirmation.ask({ branch: 'b', remote: 'origin' });

    expect(await first).toBe('cancel');
    expect(confirmation.pending()?.branch).toBe('b');
  });
});
