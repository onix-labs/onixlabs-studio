import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Log } from '@shared/angular/services/log/log';
import {
  DecoderPerf,
  WHOLE_FILE_DECODE_BUDGET_MS,
  WINDOWED_DECODE_BUDGET_MS,
} from './decoder-perf';

/**
 * A record of one log call, so a test can assert what the summary said and at what level.
 */
interface LogCall {
  readonly level: 'debug' | 'warn';
  readonly source: string;
  readonly message: string;
  readonly details: readonly unknown[];
}

/**
 * The probe under test together with the log records it emitted.
 */
interface Harness {
  readonly perf: DecoderPerf;
  readonly calls: LogCall[];
}

/**
 * Builds the probe over a recording logger.
 *
 * The probe only schedules its summary timer inside Studio, so `window.bridge` is stubbed for the
 * lifetime of the test — outside Electron every hook is deliberately a silent no-op, which is the
 * behaviour the last test here pins.
 * @param inStudio Whether to present the bridge that enables instrumentation.
 * @returns Returns the harness.
 */
function mount(inStudio: boolean = true): Harness {
  const calls: LogCall[] = [];
  const log: Pick<Log, 'debug' | 'warn'> = {
    debug: (source: string, message: string, ...details: unknown[]): void =>
      void calls.push({ level: 'debug', source, message, details }),
    warn: (source: string, message: string, ...details: unknown[]): void =>
      void calls.push({ level: 'warn', source, message, details }),
  };
  if (inStudio) {
    (window as unknown as { bridge?: unknown }).bridge = {};
  } else {
    delete (window as unknown as { bridge?: unknown }).bridge;
  }
  TestBed.configureTestingModule({ providers: [DecoderPerf, { provide: Log, useValue: log }] });
  return { perf: TestBed.inject(DecoderPerf), calls };
}

/**
 * Reads the single detail field with a name from a log call.
 * @param call The log call to read.
 * @param name The field name.
 * @returns Returns the field's value as written.
 */
function field(call: LogCall, name: string): string | undefined {
  const match: unknown = call.details.find(
    (detail: unknown): boolean => typeof detail === 'string' && detail.startsWith(`${name}=`),
  );
  return typeof match === 'string' ? match.slice(name.length + 1) : undefined;
}

describe('DecoderPerf', () => {
  it('summarise_withNoDecodes_saysNothing_soAQuietSessionStaysQuiet', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();

      vi.advanceTimersByTime(3_000);

      expect(harness.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarise_aggregatesWindowedDecodes_intoOneRecordPerSecond', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();
      harness.perf.decoded('elf/x64', 10, 4096, false, true);
      harness.perf.decoded('elf/x64', 30, 4096, false, true);

      vi.advanceTimersByTime(1_000);

      expect(harness.calls).toHaveLength(1);
      const call: LogCall = harness.calls[0];
      expect(call.source).toBe('perf.decoder');
      // Within budget, so the record is a debug note rather than a complaint.
      expect(call.level).toBe('debug');
      expect(field(call, 'windowed/s')).toBe('2');
      expect(field(call, 'avgWindowedMs')).toBe('20.00');
      expect(field(call, 'maxWindowedMs')).toBe('30.00');
      expect(field(call, 'format')).toBe('elf/x64');
      expect(field(call, 'kb')).toBe('8.0');
      expect(field(call, 'windowedOverBudget')).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarise_whenADecodeMissesItsBudget_warns_soTheAuditSaysSoWithoutArithmetic', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();
      harness.perf.decoded('elf/x64', WINDOWED_DECODE_BUDGET_MS + 1, 1024, false, true);

      vi.advanceTimersByTime(1_000);

      expect(harness.calls[0].level).toBe('warn');
      expect(field(harness.calls[0], 'windowedOverBudget')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarise_judgesWholeFileDecodes_againstTheirOwnLooserBudget', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();
      // Far past the windowed budget, but a whole-file decode happens once per edit rather than once
      // per scroll — judging it by the scroll budget would report a false problem.
      harness.perf.decoded('pe-managed', WINDOWED_DECODE_BUDGET_MS * 3, 1_000_000, true, true);

      vi.advanceTimersByTime(1_000);

      const call: LogCall = harness.calls[0];
      expect(call.level).toBe('debug');
      expect(field(call, 'wholeFile/s')).toBe('1');
      expect(field(call, 'windowed/s')).toBe('0');
      expect(field(call, 'wholeFileOverBudget')).toBe('0');

      harness.perf.decoded('pe-managed', WHOLE_FILE_DECODE_BUDGET_MS + 1, 1_000_000, true, true);
      vi.advanceTimersByTime(1_000);

      expect(harness.calls[1].level).toBe('warn');
      expect(field(harness.calls[1], 'wholeFileOverBudget')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarise_countsADecodeThatProducedNothing_separatelyFromItsLatency', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();
      // A fast null is not a fast decode: no decoder installed answers instantly and means nothing.
      harness.perf.decoded('elf/x64', 1, 512, false, false);

      vi.advanceTimersByTime(1_000);

      expect(field(harness.calls[0], 'empty')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarise_resetsBetweenWindows_soACountIsPerSecondNotCumulative', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount();
      harness.perf.decoded('elf/x64', 5, 1024, false, true);
      vi.advanceTimersByTime(1_000);
      harness.perf.decoded('elf/x64', 5, 1024, false, true);
      vi.advanceTimersByTime(1_000);

      expect(harness.calls).toHaveLength(2);
      expect(field(harness.calls[1], 'windowed/s')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('outsideStudio_schedulesNothing_soTheProbeCostsNothingInATest', () => {
    vi.useFakeTimers();
    try {
      const harness: Harness = mount(false);
      harness.perf.decoded('elf/x64', 999, 1024, false, true);

      vi.advanceTimersByTime(5_000);

      expect(harness.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
      (window as unknown as { bridge?: unknown }).bridge = {};
    }
  });
});
