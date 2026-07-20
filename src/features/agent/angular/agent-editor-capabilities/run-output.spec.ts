import { describe, expect, it } from 'vitest';
import { parseRunOutput, RunOutputParse } from './run-output';

/**
 * A realistic run-terminal buffer for the marker prefix `__STUDIO_RUN_1_`: a shell prompt echoing the
 * run command (with the literal `%s` sentinel), the program output, then the printed sentinel line
 * carrying the exit code, then the next prompt. The printf emits a leading newline, so a blank line
 * precedes the sentinel.
 * @param exitCode The exit code the sentinel prints.
 * @param output The program output lines.
 * @returns Returns the buffer text.
 */
function buffer(exitCode: number, output: string): string {
  return [
    `matthew@mac repo % python3 "/tmp/run.py"; printf '\\n__STUDIO_RUN_1_%s__\\n' "$?"`,
    output,
    '',
    `__STUDIO_RUN_1_${exitCode}__`,
    'matthew@mac repo % ',
  ].join('\n');
}

describe('parseRunOutput', () => {
  const prefix: string = '__STUDIO_RUN_1_';

  it('captures the output and a zero exit code on success', () => {
    const result: RunOutputParse = parseRunOutput(buffer(0, 'hello world'), prefix, 400);
    expect(result.found).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('hello world');
  });

  it('captures a non-zero exit code on failure', () => {
    const result: RunOutputParse = parseRunOutput(
      buffer(1, 'Traceback (most recent call last):'),
      prefix,
      400,
    );
    expect(result.found).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('Traceback (most recent call last):');
  });

  it('parses a negative exit code (signal-terminated)', () => {
    const result: RunOutputParse = parseRunOutput(buffer(-9, 'partial'), prefix, 400);
    expect(result.exitCode).toBe(-9);
  });

  it('does not treat the echoed command line as completion (it carries %s, not digits)', () => {
    const echoOnly: string = `matthew@mac repo % python3 "/tmp/run.py"; printf '\\n__STUDIO_RUN_1_%s__\\n' "$?"\nrunning…`;
    const result: RunOutputParse = parseRunOutput(echoOnly, prefix, 400);
    expect(result.found).toBe(false);
    expect(result.exitCode).toBeNull();
    // Still returns whatever output has appeared after the echoed command so far.
    expect(result.output).toBe('running…');
  });

  it('excludes prior buffer content before the echoed command', () => {
    const withHistory: string = `some old output\nmatthew@mac repo % ls\nfile.txt\n${buffer(0, 'fresh output')}`;
    const result: RunOutputParse = parseRunOutput(withHistory, prefix, 400);
    expect(result.output).toBe('fresh output');
    expect(result.output).not.toContain('old output');
    expect(result.output).not.toContain('file.txt');
  });

  it('keeps multi-line program output between the markers', () => {
    const result: RunOutputParse = parseRunOutput(buffer(0, 'line 1\nline 2\nline 3'), prefix, 400);
    expect(result.output).toBe('line 1\nline 2\nline 3');
  });

  it('caps the output to the most recent lines', () => {
    const many: string = Array.from(
      { length: 10 },
      (_v: unknown, i: number): string => `line ${i}`,
    ).join('\n');
    const result: RunOutputParse = parseRunOutput(buffer(0, many), prefix, 3);
    expect(result.output.split('\n')).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it("does not confuse a different run's sentinel (unique prefix per run)", () => {
    // A stale sentinel from a prior run (prefix _2_) must not satisfy a parse for run _1_.
    const stale: string = `__STUDIO_RUN_2_0__\n${buffer(3, 'output')}`;
    const result: RunOutputParse = parseRunOutput(stale, prefix, 400);
    expect(result.exitCode).toBe(3);
    expect(result.output).toBe('output');
  });
});
