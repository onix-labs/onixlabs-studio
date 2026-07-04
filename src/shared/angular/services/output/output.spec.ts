import { TestBed } from '@angular/core/testing';

import { Output } from './output';

describe('Output', () => {
  let output: Output;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    output = TestBed.inject(Output);
  });

  it('append_whenCalled_accumulatesInTheSnapshot', () => {
    output.append('a');
    output.append('b');
    expect(output.snapshot()).toBe('ab');
  });

  it('appendLine_whenCalled_terminatesWithCarriageReturnLineFeed', () => {
    output.appendLine('line');
    expect(output.snapshot()).toBe('line\r\n');
  });

  it('clear_whenCalled_emptiesTheBuffer', () => {
    output.append('something');
    output.clear();
    expect(output.snapshot()).toBe('');
  });

  it('onWrite_whenTextAppended_receivesTheChunk', () => {
    const chunks: string[] = [];
    output.onWrite((chunk: string): void => {
      chunks.push(chunk);
    });
    output.append('hello');
    expect(chunks).toEqual(['hello']);
  });

  it('onWrite_whenUnsubscribed_stopsReceivingChunks', () => {
    const chunks: string[] = [];
    const unsubscribe: () => void = output.onWrite((chunk: string): void => {
      chunks.push(chunk);
    });
    unsubscribe();
    output.append('hello');
    expect(chunks).toEqual([]);
  });

  it('onClear_whenCleared_isNotified', () => {
    let cleared: boolean = false;
    output.onClear((): void => {
      cleared = true;
    });
    output.clear();
    expect(cleared).toBe(true);
  });
});
