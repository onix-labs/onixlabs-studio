import type { TerminalQuestion } from '@shared/angular/services/terminal-confirmation/terminal-confirmation';
import { isMultiLinePaste, multiLinePasteQuestion, ringBell } from './terminal-input';

describe('isMultiLinePaste', () => {
  it('asksAboutSeveralLines_andALineThatRunsOnPaste', () => {
    expect(isMultiLinePaste('npm ci\nnpm test')).toBe(true);
    expect(isMultiLinePaste('rm -rf build\n')).toBe(true);
    expect(isMultiLinePaste('a\r\nb')).toBe(true);
  });

  it('letsOneLine_andBlankText_through', () => {
    expect(isMultiLinePaste('ls -la')).toBe(false);
    expect(isMultiLinePaste('\n\n')).toBe(false);
    expect(isMultiLinePaste('\nls')).toBe(false);
  });
});

describe('multiLinePasteQuestion', () => {
  it('countsTheLines_andShowsThem', () => {
    const question: TerminalQuestion = multiLinePasteQuestion('npm ci\nnpm test\n');

    expect(question.title).toBe('Paste 2 Lines?');
    expect(question.detail).toBe('npm ci\nnpm test');
    expect(question.confirmLabel).toBe('Paste');
  });

  it('aSingleLineThatRuns_saysSo', () => {
    expect(multiLinePasteQuestion('make deploy\n').title).toBe('Paste a Line That Runs?');
  });

  it('showsTheFirstEightLines_andCountsTheRest', () => {
    const text: string = Array.from(
      { length: 12 },
      (_value: unknown, index: number) => `line ${index}`,
    ).join('\n');

    const detail: string = multiLinePasteQuestion(text).detail ?? '';

    expect(detail.split('\n')).toHaveLength(9);
    expect(detail).toContain('line 7');
    expect(detail).not.toContain('line 8');
    expect(detail).toMatch(/… and 4 more$/);
  });
});

describe('ringBell', () => {
  it('staysSilent_whereThereIsNoAudio', () => {
    const original: typeof AudioContext | undefined = window.AudioContext;
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    try {
      expect(() => ringBell()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'AudioContext', { value: original, configurable: true });
    }
  });
});
