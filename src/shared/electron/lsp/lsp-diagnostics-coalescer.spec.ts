import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_DIAGNOSTICS_METHOD, WORKSPACE_DIAGNOSTICS_METHOD } from '@shared/api/lsp-channels';
import { DIAGNOSTICS_WINDOW_MS, LspDiagnosticsCoalescer } from './lsp-diagnostics-coalescer';
import { WorkspaceDocumentReport } from './lsp-workspace-diagnostics';

/**
 * One notification that reached the renderer.
 */
interface Sent {
  readonly sessionId: string;
  readonly method: string;
  readonly params: unknown;
}

/**
 * Builds a full report.
 * @param uri The document.
 * @param message Its one diagnostic.
 * @returns Returns the report.
 */
function full(uri: string, message: string): WorkspaceDocumentReport {
  return { uri, kind: 'full', items: [{ message }], resultId: `r-${message}` };
}

describe('LspDiagnosticsCoalescer', () => {
  let sent: Sent[];
  let coalescer: LspDiagnosticsCoalescer;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    coalescer = new LspDiagnosticsCoalescer(
      (sessionId: string, method: string, params: unknown): void => {
        sent.push({ sessionId, method, params });
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Reads the params of what was sent.
   * @returns Returns them, in order.
   */
  function params(): readonly unknown[] {
    return sent.map((message: Sent): unknown => message.params);
  }

  it('publish_afterAQuietSpell_goesAtOnce', () => {
    coalescer.publish('s', { uri: 'a', diagnostics: [] });

    expect(sent).toEqual([
      {
        sessionId: 's',
        method: PUBLISH_DIAGNOSTICS_METHOD,
        params: { uri: 'a', diagnostics: [] },
      },
    ]);
  });

  it('publish_ofOneDocumentInAWindow_keepsOnlyTheLatest', () => {
    coalescer.publish('s', { uri: 'first', version: 0 });
    coalescer.publish('s', { uri: 'a', version: 1 });
    coalescer.publish('s', { uri: 'a', version: 2 });
    coalescer.publish('s', { uri: 'a', version: 3 });

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(params()).toEqual([
      { uri: 'first', version: 0 },
      { uri: 'a', version: 3 },
    ]);
  });

  it('publish_ofDifferentDocuments_losesNone', () => {
    coalescer.publish('s', { uri: 'first' });
    coalescer.publish('s', { uri: 'a' });
    coalescer.publish('s', { uri: 'b' });

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(params()).toEqual([{ uri: 'first' }, { uri: 'a' }, { uri: 'b' }]);
  });

  it('publish_clearingADocumentInAWindow_endsWithItCleared', () => {
    // The last word for a document is what the Error List must show, not the loudest one.
    coalescer.publish('s', { uri: 'first' });
    coalescer.publish('s', { uri: 'a', diagnostics: [{ message: 'wrong' }] });
    coalescer.publish('s', { uri: 'a', diagnostics: [] });

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(params()[1]).toEqual({ uri: 'a', diagnostics: [] });
  });

  it('publish_withNoUri_isPassedOnUntouched', () => {
    coalescer.publish('s', { uri: 'first' });
    coalescer.publish('s', { nonsense: true });

    expect(params()).toEqual([{ uri: 'first' }, { nonsense: true }]);
  });

  it('publish_afterAWindowCloses_goesAtOnceAgain', () => {
    coalescer.publish('s', { uri: 'a' });
    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    coalescer.publish('s', { uri: 'b' });

    expect(params()).toEqual([{ uri: 'a' }, { uri: 'b' }]);
  });

  it('publish_inTwoSessions_keepsThemApart', () => {
    coalescer.publish('one', { uri: 'a' });
    coalescer.publish('two', { uri: 'a' });

    expect(sent.map((message: Sent): string => message.sessionId)).toEqual(['one', 'two']);
  });

  it('flush_withAnOpenWindow_sendsWhatGathered_andStopsTheTimer', () => {
    coalescer.publish('s', { uri: 'first' });
    coalescer.publish('s', { uri: 'last words' });

    coalescer.flush('s');

    expect(params()).toEqual([{ uri: 'first' }, { uri: 'last words' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flush_withNothingGathered_sendsNothing', () => {
    coalescer.flush('s');
    coalescer.publish('s', { uri: 'a' });
    coalescer.flush('s');
    coalescer.flush('s');

    expect(sent).toHaveLength(1);
  });

  it('report_mergesBatchesInAWindow_latestPerDocument', () => {
    coalescer.report('s', [full('first', 'x')]);
    coalescer.report('s', [full('a', 'old'), full('b', 'b')]);
    coalescer.report('s', [full('a', 'new')]);

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(sent).toHaveLength(2);
    expect(sent[1].method).toBe(WORKSPACE_DIAGNOSTICS_METHOD);
    expect(sent[1].params).toEqual({ reports: [full('a', 'new'), full('b', 'b')] });
  });

  it('report_unchangedAfterAFullOne_keepsTheDiagnostics', () => {
    // The trap in latest-wins: the renderer skips `unchanged`, so replacing the full report with one
    // would lose diagnostics it has never seen.
    coalescer.report('s', []);
    coalescer.report('s', [full('a', 'real')]);
    coalescer.report('s', [{ uri: 'a', kind: 'unchanged', resultId: 'r2' }]);

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(sent[1].params).toEqual({ reports: [{ ...full('a', 'real'), resultId: 'r2' }] });
  });

  it('report_fullAfterUnchanged_replacesIt', () => {
    coalescer.report('s', []);
    coalescer.report('s', [{ uri: 'a', kind: 'unchanged', resultId: 'r1' }]);
    coalescer.report('s', [full('a', 'real')]);

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(sent[1].params).toEqual({ reports: [full('a', 'real')] });
  });

  it('report_withAResetInAWindow_dropsWhatCameBefore_andKeepsWhatCameAfter', () => {
    coalescer.report('s', []);
    coalescer.report('s', [full('stale', 'x')], false, true);
    coalescer.report('s', [], true);
    coalescer.report('s', [full('fresh', 'y')]);

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(sent[1].params).toEqual({ reports: [full('fresh', 'y')], reset: true });
  });

  it('report_markedCompleteWithNoReports_stillArrives', () => {
    // The end of a pull is news in itself: it is what finishes analysis in the renderer.
    coalescer.report('s', []);
    coalescer.report('s', [], false, true);

    vi.advanceTimersByTime(DIAGNOSTICS_WINDOW_MS);

    expect(sent[1].params).toEqual({ reports: [], complete: true });
  });

  it('report_afterAQuietSpell_goesAtOnce_withItsFlags', () => {
    coalescer.report('s', [full('a', 'x')], true, true);

    expect(sent[0].params).toEqual({ reports: [full('a', 'x')], reset: true, complete: true });
  });
});
