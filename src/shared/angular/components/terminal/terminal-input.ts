import type { TerminalQuestion } from '@shared/angular/services/terminal-confirmation/terminal-confirmation';

/**
 * Holds how many of the lines about to be pasted the question shows.
 */
const PREVIEW_LINES: number = 8;

/**
 * Holds how long the visual bell's flash lasts, in milliseconds.
 */
export const BELL_FLASH_MS: number = 150;

/**
 * Splits pasted text into its lines, ignoring the one empty line a trailing newline leaves.
 * @param text The pasted text.
 * @returns Returns the lines.
 */
function lines(text: string): readonly string[] {
  const split: string[] = text.split(/\r\n|\r|\n/);
  if (split.length > 1 && split[split.length - 1] === '') {
    split.pop();
  }
  return split;
}

/**
 * Determines whether pasting text needs asking about first: it holds more than one line, which a shell
 * may run one by one as it arrives. A single line ending in a newline counts too — it runs on paste.
 * @param text The pasted text.
 * @returns Returns true when the paste is more than one line, or a line that runs.
 */
export function isMultiLinePaste(text: string): boolean {
  return /\r|\n/.test(text.trimStart()) && text.trim().length > 0;
}

/**
 * Builds the question asked before a multi-line paste, showing the first lines of what is pasted.
 * @param text The pasted text.
 * @returns Returns the question.
 */
export function multiLinePasteQuestion(text: string): TerminalQuestion {
  const all: readonly string[] = lines(text);
  const shown: string = all.slice(0, PREVIEW_LINES).join('\n');
  const more: number = all.length - PREVIEW_LINES;
  return {
    title: all.length === 1 ? 'Paste a Line That Runs?' : `Paste ${all.length} Lines?`,
    body:
      all.length === 1
        ? 'The text ends in a new line, so the shell runs it as soon as it is pasted.'
        : 'The shell may run each line as soon as it arrives, before you can look it over.',
    detail: more > 0 ? `${shown}\n… and ${more} more` : shown,
    confirmLabel: 'Paste',
    setting: 'Warn Before Multi-Line Paste: On',
  };
}

/**
 * Plays a short, quiet tone for the terminal bell. Nothing plays where audio is unavailable.
 */
export function ringBell(): void {
  const AudioContextType: typeof AudioContext | undefined = window.AudioContext;
  if (AudioContextType === undefined) {
    return;
  }
  try {
    const context: AudioContext = new AudioContextType();
    const tone: OscillatorNode = context.createOscillator();
    const gain: GainNode = context.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.12);
    tone.onended = (): void => void context.close();
  } catch {
    // No audio device: the bell stays silent.
  }
}
