import { describe, expect, it, type MockInstance, vi } from 'vitest';
import { LineSplitter } from './line-splitter';

/**
 * Splits chunks with a fresh splitter and collects the lines.
 * @param chunks The chunks.
 * @param trim Whether to trim.
 * @returns Returns the lines.
 */
function split(chunks: readonly string[], trim: boolean = true): readonly string[] {
  const lines: string[] = [];
  const splitter: LineSplitter = new LineSplitter({
    trim,
    onLine: (line: string): void => {
      lines.push(line);
    },
  });
  for (const chunk of chunks) {
    splitter.push(chunk);
  }
  return lines;
}

describe('LineSplitter', () => {
  it('push_withSeveralLinesInOneChunk_deliversEachInOrder', () => {
    expect(split(['a\nb\nc\n'])).toEqual(['a', 'b', 'c']);
  });

  it('push_withALineAcrossManyChunks_joinsThePieces', () => {
    expect(split(['al', 'ph', 'a\nbe', 'ta\n'])).toEqual(['alpha', 'beta']);
  });

  it('push_withAnUnterminatedTail_holdsItBack', () => {
    expect(split(['done\npartial'])).toEqual(['done']);
  });

  it('push_withEveryChunkBoundary_givesTheSameLines', () => {
    const text: string = '  one \r\n\r\ntwo\n\n\tthree\t\n';

    for (let cut: number = 0; cut <= text.length; cut += 1) {
      expect(split([text.slice(0, cut), text.slice(cut)])).toEqual(['one', 'two', 'three']);
    }
  });

  it('push_whenTrimming_dropsCarriageReturnsAndBlankLines', () => {
    expect(split(['  a  \r\n   \r\n\nb\r\n'])).toEqual(['a', 'b']);
  });

  it('push_whenNotTrimming_keepsWhitespaceBlankLinesAndCarriageReturns', () => {
    expect(split([' a \r\n\n'], false)).toEqual([' a \r', '']);
  });

  it('push_withACarriageReturnEndingAChunk_stillTrimsItOffTheLine', () => {
    expect(split(['line\r', '\nnext\n'])).toEqual(['line', 'next']);
  });

  it('push_withAnEmptyChunk_changesNothing', () => {
    expect(split(['ab', '', 'c\n', ''])).toEqual(['abc']);
  });

  it('push_withMultiByteText_keepsItWhole', () => {
    expect(split(['héllo wörld ✓ 𝒳\n'])).toEqual(['héllo wörld ✓ 𝒳']);
  });

  it('push_whenTheUnfinishedLineOutgrowsTheCap_refusesItOnceAndSkipsToItsNewline', () => {
    const lines: string[] = [];
    const onOversized: () => void = vi.fn();
    const splitter: LineSplitter = new LineSplitter({
      trim: true,
      maxLineLength: 4,
      onOversized,
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('abc');
    splitter.push('def');
    splitter.push('ghi');
    splitter.push('jkl\nkept\n');

    expect(onOversized).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(['kept']);
  });

  it('push_withAnUnfinishedLineExactlyAtTheCap_holdsIt', () => {
    const lines: string[] = [];
    const onOversized: () => void = vi.fn();
    const splitter: LineSplitter = new LineSplitter({
      maxLineLength: 4,
      onOversized,
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('abcd');
    splitter.push('\n');

    expect(onOversized).not.toHaveBeenCalled();
    expect(lines).toEqual(['abcd']);
  });

  it('push_withACompleteLineOverTheCap_deliversIt', () => {
    // The cap protects against waiting for a newline; this one is already here, and refusing it
    // would change what an answer arriving in a single chunk has always done.
    const lines: string[] = [];
    const onOversized: () => void = vi.fn();
    const splitter: LineSplitter = new LineSplitter({
      maxLineLength: 4,
      onOversized,
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('abcdefgh\n');

    expect(onOversized).not.toHaveBeenCalled();
    expect(lines).toEqual(['abcdefgh']);
  });

  it('push_whenLinesCompleteBeforeTheOversizedTail_deliversThemFirst', () => {
    const lines: string[] = [];
    const onOversized: () => void = vi.fn();
    const splitter: LineSplitter = new LineSplitter({
      maxLineLength: 2,
      onOversized,
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('ok\ntoolong');

    expect(lines).toEqual(['ok']);
    expect(onOversized).toHaveBeenCalledTimes(1);
  });

  it('reset_withAnUnfinishedLine_forgetsIt', () => {
    const lines: string[] = [];
    const splitter: LineSplitter = new LineSplitter({
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('half of a dead process');
    splitter.reset();
    splitter.push('first\n');

    expect(lines).toEqual(['first']);
  });

  it('reset_whileSkippingARefusedLine_deliversTheNextStreamsFirstLine', () => {
    const lines: string[] = [];
    const splitter: LineSplitter = new LineSplitter({
      maxLineLength: 1,
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    splitter.push('too long');
    splitter.reset();
    splitter.push('handshake\n');

    expect(lines).toEqual(['handshake']);
  });

  it('reset_fromInsideAHandler_dropsTheRestOfTheChunk', () => {
    const lines: string[] = [];
    const splitter: LineSplitter = new LineSplitter({
      onLine: (line: string): void => {
        lines.push(line);
        splitter.reset();
      },
    });

    splitter.push('a\nb\nc');
    splitter.push('d\n');

    expect(lines).toEqual(['a', 'd']);
  });

  it('push_withAMultiMegabyteLineInSmallChunks_doesNotRescanWhatItHolds', () => {
    // A regression guard on the shape of the work rather than on the clock: `String.prototype.indexOf`
    // counted across the run stays at one scan per chunk. The rescanning loop made it scan a growing
    // buffer, and a timing assertion would be a flaky way of saying the same thing.
    const chunk: string = 'x'.repeat(1024);
    const scanned: number[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only ever called with its own `this`.
    const indexOf: typeof String.prototype.indexOf = String.prototype.indexOf;
    const spy: MockInstance<typeof String.prototype.indexOf> = vi
      .spyOn(String.prototype, 'indexOf')
      .mockImplementation(function (this: string, search: string, position?: number): number {
        scanned.push(this.length);
        return indexOf.call(this, search, position);
      });
    const lines: string[] = [];
    const splitter: LineSplitter = new LineSplitter({
      onLine: (line: string): void => {
        lines.push(line);
      },
    });

    for (let index: number = 0; index < 2048; index += 1) {
      splitter.push(chunk);
    }
    splitter.push('\n');
    spy.mockRestore();

    expect(lines[0]?.length).toBe(2048 * 1024);
    expect(Math.max(...scanned)).toBe(1024);
  });
});
