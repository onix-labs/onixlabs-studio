import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CancellationToken } from 'vscode-jsonrpc/node';

vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp' } }));

const { WorkspaceDiagnosticsPull } = await import('./lsp-workspace-diagnostics');
type WorkspaceDocumentReport = import('./lsp-workspace-diagnostics').WorkspaceDocumentReport;

/**
 * One request the fake server was sent, with the means to answer it.
 */
interface SentRequest {
  readonly params: {
    previousResultIds: { uri: string; value: string }[];
    partialResultToken: string;
  };
  readonly token: CancellationToken;
  answer(result: unknown): void;
  fail(error: Error): void;
}

describe('WorkspaceDiagnosticsPull (#1144)', () => {
  let sent: SentRequest[];
  let delivered: (readonly WorkspaceDocumentReport[])[];
  let resets: number;

  /**
   * Builds a pull over a fake server that holds each request until the test answers it.
   * @returns Returns the pull.
   */
  function pull(): InstanceType<typeof WorkspaceDiagnosticsPull> {
    return new WorkspaceDiagnosticsPull(
      {
        sendRequest: (
          _method: string,
          params: unknown,
          token: CancellationToken,
        ): Promise<unknown> =>
          new Promise((resolve: (value: unknown) => void, reject: (error: Error) => void): void => {
            sent.push({
              params: params as SentRequest['params'],
              token,
              answer: resolve,
              fail: reject,
            });
          }),
      },
      (reports: readonly WorkspaceDocumentReport[], reset?: boolean): void => {
        if (reset === true) {
          resets += 1;
          return;
        }
        delivered.push(reports);
      },
      '/root::csharp',
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    delivered = [];
    resets = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holdsOneRequest_deliversItsPartialResultsAsTheyCome_andOnlyForItsOwnToken', () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    subject.start();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.params.previousResultIds).toEqual([]);
    const token: string = sent[0].params.partialResultToken;
    expect(subject.owns(token)).toBe(true);
    expect(subject.owns('someone-elses')).toBe(false);

    subject.partial({
      items: [
        { uri: 'file:///root/Broken.cs', kind: 'full', resultId: 'r1', items: [{ message: 'x' }] },
        { uri: 'file:///root/Bad.cs', kind: 'weird' },
      ],
    });

    expect(delivered).toEqual([
      [{ uri: 'file:///root/Broken.cs', kind: 'full', resultId: 'r1', items: [{ message: 'x' }] }],
    ]);
  });

  it('whenARequestCompletes_sendsTheNext_carryingTheResultIdentifiersItHolds', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    subject.partial({
      items: [{ uri: 'file:///root/A.cs', kind: 'full', resultId: 'a1', items: [] }],
    });

    sent[0].answer({
      items: [{ uri: 'file:///root/B.cs', kind: 'unchanged', resultId: 'b1' }],
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.params.previousResultIds).toEqual([
      { uri: 'file:///root/A.cs', value: 'a1' },
      { uri: 'file:///root/B.cs', value: 'b1' },
    ]);
    expect(subject.owns(sent[0].params.partialResultToken)).toBe(false);
  });

  it('aRefresh_cancelsTheOpenRequest_andSendsAnother_whoseLateAnswerTheOldOneCannotOvertake', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    await vi.advanceTimersByTimeAsync(2_000);

    subject.refresh();

    expect(sent[0]?.token.isCancellationRequested).toBe(true);
    expect(sent).toHaveLength(2);
    sent[0].answer({ items: [{ uri: 'file:///root/Old.cs', kind: 'full', items: [] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(delivered).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it('stopping_cancelsTheOpenRequest_andSendsNoMore', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();

    subject.stop();
    sent[0].answer({ items: [] });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sent[0]?.token.isCancellationRequested).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('retriesAFailedRequest_andGivesUpAfterThreeInARow', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();

    for (let attempt: number = 0; attempt < 3; attempt++) {
      sent.at(-1)!.fail(new Error('boom'));
      await vi.advanceTimersByTimeAsync(5_000);
    }

    expect(sent).toHaveLength(3);
  });

  it('aClosedDocument_isForgotten_soTheNextPullReportsItInFull', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    subject.partial({
      items: [
        { uri: 'file:///root/Broken.cs', kind: 'full', resultId: 'b1', items: [] },
        { uri: 'file:///root/A.cs', kind: 'full', resultId: 'a1', items: [] },
      ],
    });
    await vi.advanceTimersByTimeAsync(2_000);

    subject.refresh('file:///root/Broken.cs');

    expect(sent[1]?.params.previousResultIds).toEqual([{ uri: 'file:///root/A.cs', value: 'a1' }]);
  });

  it('aReset_forgetsEverything_tellsTheReceiverToDropWhatItHolds_andPullsAfresh', async () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    subject.partial({
      items: [{ uri: 'file:///root/A.cs', kind: 'full', resultId: 'a1', items: [] }],
    });
    await vi.advanceTimersByTimeAsync(2_000);

    subject.reset();

    expect(resets).toBe(1);
    expect(sent[0]?.token.isCancellationRequested).toBe(true);
    expect(sent[1]?.params.previousResultIds).toEqual([]);
  });

  it('keepsEachDocumentsLatestFullReport_forAWindowThatAttachesLater_andDropsThemOnReset (#1182)', () => {
    const subject: InstanceType<typeof WorkspaceDiagnosticsPull> = pull();
    subject.start();
    subject.partial({
      items: [
        { uri: 'file:///root/A.cs', kind: 'full', resultId: 'a1', items: [{ message: 'old' }] },
        { uri: 'file:///root/B.cs', kind: 'full', resultId: 'b1', items: [] },
      ],
    });
    subject.partial({
      items: [
        { uri: 'file:///root/A.cs', kind: 'full', resultId: 'a2', items: [{ message: 'new' }] },
        { uri: 'file:///root/B.cs', kind: 'unchanged', resultId: 'b1' },
      ],
    });

    // An unchanged report leaves the last full one standing.
    expect(subject.snapshot()).toEqual([
      { uri: 'file:///root/A.cs', kind: 'full', resultId: 'a2', items: [{ message: 'new' }] },
      { uri: 'file:///root/B.cs', kind: 'full', resultId: 'b1', items: [] },
    ]);

    subject.reset();
    expect(subject.snapshot()).toEqual([]);
  });
});
