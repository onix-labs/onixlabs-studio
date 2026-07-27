import { TestBed } from '@angular/core/testing';

import { DEFAULT_CHANNEL, Output, OutputChannel, OutputChannelInfo } from './output';

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

  it('startsWithOnlyTheDefaultChannelActive', () => {
    expect(output.channels().map((c: OutputChannelInfo): string => c.id)).toEqual([
      DEFAULT_CHANNEL,
    ]);
    expect(output.activeChannelId()).toBe(DEFAULT_CHANNEL);
  });

  it('channel_registersTheChannelForSelection', () => {
    output.channel('build', 'Build');
    output.channel('run', 'Run');
    expect(output.channels().map((c: OutputChannelInfo): string => c.label)).toEqual([
      'General',
      'Build',
      'Run',
    ]);
  });

  it('channels_keepSeparateBuffers', () => {
    const build: OutputChannel = output.channel('build', 'Build');
    const run: OutputChannel = output.channel('run', 'Run');
    build.appendLine('compiling');
    run.appendLine('serving');

    expect(build.snapshot()).toBe('compiling\r\n');
    expect(run.snapshot()).toBe('serving\r\n');
    // The default channel is untouched by writes to named channels.
    expect(output.snapshot()).toBe('');
  });

  it('reveal_makesTheChannelActive', () => {
    const build: OutputChannel = output.channel('build', 'Build');
    build.reveal();
    expect(output.activeChannelId()).toBe('build');
  });

  it('onWriteTo_receivesOnlyThatChannelsChunks', () => {
    const chunks: string[] = [];
    output.onWriteTo('build', (chunk: string): void => {
      chunks.push(chunk);
    });
    output.appendTo('run', 'other');
    output.appendTo('build', 'mine');
    expect(chunks).toEqual(['mine']);
  });

  it('remove_dropsTheChannelAndFallsBackToDefaultWhenActive', () => {
    const debug: OutputChannel = output.channel('debug', 'Debug');
    debug.reveal();
    expect(output.activeChannelId()).toBe('debug');

    output.remove('debug');
    expect(output.channels().map((c: OutputChannelInfo): string => c.id)).toEqual([
      DEFAULT_CHANNEL,
    ]);
    expect(output.activeChannelId()).toBe(DEFAULT_CHANNEL);
  });

  it('remove_ignoresTheDefaultChannel', () => {
    output.remove(DEFAULT_CHANNEL);
    expect(output.channels().map((c: OutputChannelInfo): string => c.id)).toEqual([
      DEFAULT_CHANNEL,
    ]);
  });
});
