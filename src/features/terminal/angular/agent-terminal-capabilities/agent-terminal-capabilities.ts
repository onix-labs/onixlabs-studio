import { inject, Service } from '@angular/core';
import { READ_TERMINAL_OUTPUT, WRITE_TERMINAL_INPUT } from '@shared/api/ai-types';
import { TerminalReplay } from '@shared/api/terminal-channels';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { Terminals } from '@shared/angular/services/terminals/terminals';

/**
 * Holds the maximum number of output lines a read returns, so a long-running session does not flood
 * the model's context. Only the most recent lines are kept.
 */
const MAX_OUTPUT_LINES: number = 200;

/**
 * Matches the terminal control sequences a raw pty stream carries (OSC titles, CSI styling and
 * cursor movement, and two-character escapes), so scrollback read through the replay fallback comes
 * back as plain text. Composed from character codes because a literal escape in a regex trips the
 * no-control-regex lint rule.
 */
const CONTROL_SEQUENCE_PATTERN: RegExp = new RegExp(
  `${String.fromCharCode(27)}(?:\\][^${String.fromCharCode(7)}${String.fromCharCode(27)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)?|\\[[0-9;?]*[0-9A-Za-z]|.)`,
  'g',
);

/**
 * Holds how long (ms) to wait after sending input before reading the terminal back, so the shell has
 * a moment to echo the command and emit its first output.
 */
const SETTLE_DELAY_MS: number = 400;

/**
 * The result of the read-terminal-output capability.
 */
interface ReadResult {
  /**
   * Gets a value indicating whether a terminal was available to read.
   */
  readonly available: boolean;

  /**
   * Gets the recent terminal output (empty when none was available).
   */
  readonly text: string;
}

/**
 * The result of the write-terminal-input capability.
 */
interface WriteResult {
  /**
   * Gets a value indicating whether the input was sent to the terminal.
   */
  readonly ok: boolean;

  /**
   * Gets the terminal output after the input settled, when sent.
   */
  readonly output?: string;
}

/**
 * Registers the terminal agent's in-app capabilities with the {@link AiRuntime} registry: reading the
 * owning terminal's recent output and sending input/commands to it. The main-process agent providers
 * invoke these by name over the renderer bridge for a terminal-surface run. Instantiated eagerly at
 * start-up (see the app initializer) so the capabilities are available whenever an agent runs.
 */
@Service()
export class AgentTerminalCapabilities {
  /**
   * Holds the agent runtime the capabilities register with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the registry resolving a terminal's output by identifier.
   */
  private readonly terminals: Terminals = inject(Terminals);

  /**
   * Holds the terminal bridge the input capability writes through.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Initializes a new instance of the {@link AgentTerminalCapabilities} class, registering the
   * terminal capabilities.
   */
  public constructor() {
    this.runtime.registerCapability(
      READ_TERMINAL_OUTPUT,
      (input: unknown): Promise<ReadResult> => this.readOutput(input),
    );
    this.runtime.registerCapability(
      WRITE_TERMINAL_INPUT,
      (input: unknown): Promise<WriteResult> => this.writeInput(input),
    );
  }

  /**
   * Reads the recent output of the terminal identified by the run's owning `tabId`, capped to the most
   * recent lines.
   * @param input The capability input, carrying the owning `tabId`.
   * @returns Returns the {@link ReadResult}.
   */
  private async readOutput(input: unknown): Promise<ReadResult> {
    const tabId: string | null = this.extractString(input, 'tabId');
    const text: string | null = tabId === null ? null : await this.readSessionText(tabId);
    if (text === null) {
      return { available: false, text: '' };
    }
    return { available: true, text: this.cap(text) };
  }

  /**
   * Reads a session's on-screen text: from this window's pane when one is mounted here, otherwise
   * from the main-process scrollback — the session's pane may live in another window (a popped-out
   * terminal panel), whose rendered buffer this renderer cannot reach.
   * @param tabId The terminal identifier.
   * @returns Returns the session's text, or null when no pane nor scrollback exists for it.
   */
  private async readSessionText(tabId: string): Promise<string | null> {
    const rendered: string | null = this.terminals.readText(tabId);
    if (rendered !== null) {
      return rendered;
    }
    const replay: TerminalReplay = await this.bridge.replay(tabId);
    if (replay.data.length === 0 && replay.exitCode === null) {
      return null;
    }
    return replay.data
      .replace(CONTROL_SEQUENCE_PATTERN, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  /**
   * Sends input to the terminal identified by the run's owning `tabId`, then returns the terminal's
   * output once it has settled so the model sees the result in one call.
   * @param input The capability input, carrying the owning `tabId`, the `text`, and an optional
   * `submit` flag (defaults to true; false sends raw input without a carriage return).
   * @returns Returns the {@link WriteResult}.
   */
  private async writeInput(input: unknown): Promise<WriteResult> {
    const tabId: string | null = this.extractString(input, 'tabId');
    const text: string | null = this.extractString(input, 'text');
    const submit: boolean = !(input !== null && typeof input === 'object'
      ? (input as Record<string, unknown>)['submit'] === false
      : false);
    if (tabId === null || text === null) {
      return { ok: false };
    }
    const sent: boolean = await this.bridge.write(tabId, submit ? `${text}\r` : text);
    if (!sent) {
      return { ok: false };
    }
    await this.delay(SETTLE_DELAY_MS);
    const output: string | null = await this.readSessionText(tabId);
    return { ok: true, output: output === null ? '' : this.cap(output) };
  }

  /**
   * Caps text to the most recent {@link MAX_OUTPUT_LINES} lines, joined with newlines.
   * @param text The full text.
   * @returns Returns the capped text.
   */
  private cap(text: string): string {
    return text.split(/\r?\n/).slice(-MAX_OUTPUT_LINES).join('\n');
  }

  /**
   * Resolves after a delay.
   * @param ms The delay in milliseconds.
   * @returns Returns a promise that resolves once the delay elapses.
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Extracts a string field from a capability input.
   * @param input The capability input.
   * @param key The field to read.
   * @returns Returns the string value, or null when absent or malformed.
   */
  private extractString(input: unknown, key: string): string | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const value: unknown = (input as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }
}
