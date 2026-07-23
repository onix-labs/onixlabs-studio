import { TerminalScrollback } from './terminal-scrollback';

describe('TerminalScrollback', () => {
  let scrollback: TerminalScrollback;

  beforeEach(() => {
    scrollback = new TerminalScrollback();
  });

  it('snapshot_whenUnknownId_yieldsAnEmptySnapshot', () => {
    expect(scrollback.snapshot('missing')).toEqual({ data: '', seq: 0, exitCode: null, signal: null });
  });

  it('append_accumulatesDataAndNumbersChunksSequentially', () => {
    expect(scrollback.append('t1', 'a')).toBe(1);
    expect(scrollback.append('t1', 'b')).toBe(2);

    expect(scrollback.snapshot('t1')).toEqual({ data: 'ab', seq: 2, exitCode: null, signal: null });
  });

  it('append_keysRecordsBySession', () => {
    scrollback.append('t1', 'one');
    scrollback.append('t2', 'two');

    expect(scrollback.snapshot('t1').data).toBe('one');
    expect(scrollback.snapshot('t2').data).toBe('two');
  });

  it('append_beyondTheCap_trimsFromTheFrontAtALineBreak', () => {
    const line: string = `${'x'.repeat(999)}\n`;
    // Fill past the 1,000,000-character cap, then append a marker line.
    for (let index: number = 0; index < 1001; index++) {
      scrollback.append('t1', line);
    }
    scrollback.append('t1', 'marker');

    const snapshot: string = scrollback.snapshot('t1').data;
    expect(snapshot.length).toBeLessThanOrEqual(1_000_000);
    expect(snapshot.endsWith('marker')).toBe(true);
    // The trim lands on a line-break boundary, so the retained span starts at a fresh line.
    expect(snapshot.startsWith('x'.repeat(999))).toBe(true);
  });

  it('markExited_recordsTheExitCodeWhileKeepingTheOutput', () => {
    scrollback.append('t1', 'output');

    scrollback.markExited('t1', 3);

    expect(scrollback.snapshot('t1')).toEqual({ data: 'output', seq: 1, exitCode: 3, signal: null });
  });

  it('markExited_withASignal_recordsIt', () => {
    scrollback.append('t1', 'output');

    scrollback.markExited('t1', 0, 15);

    expect(scrollback.snapshot('t1')).toEqual({ data: 'output', seq: 1, exitCode: 0, signal: 15 });
  });

  it('markExited_whenUnknownId_isIgnored', () => {
    scrollback.markExited('missing', 1);

    expect(scrollback.snapshot('missing').exitCode).toBeNull();
  });

  it('reset_discardsThePreviousRecord', () => {
    scrollback.append('t1', 'old');
    scrollback.markExited('t1', 1);

    scrollback.reset('t1');

    expect(scrollback.snapshot('t1')).toEqual({ data: '', seq: 0, exitCode: null, signal: null });
  });

  it('delete_removesTheRecordAndReportsWhetherOneExisted', () => {
    scrollback.append('t1', 'data');

    expect(scrollback.delete('t1')).toBe(true);
    expect(scrollback.delete('t1')).toBe(false);
    expect(scrollback.snapshot('t1')).toEqual({ data: '', seq: 0, exitCode: null, signal: null });
  });

  it('clear_removesEveryRecord', () => {
    scrollback.append('t1', 'one');
    scrollback.append('t2', 'two');

    scrollback.clear();

    expect(scrollback.snapshot('t1').data).toBe('');
    expect(scrollback.snapshot('t2').data).toBe('');
  });
});
