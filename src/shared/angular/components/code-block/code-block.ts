import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';

/**
 * The info-string languages a fenced code block is treated as a runnable shell command. A block in one
 * of these grows a play button that runs it in a terminal.
 */
const SHELL_LANGUAGES: ReadonlySet<string> = new Set<string>([
  'sh',
  'bash',
  'shell',
  'shell-session',
  'console',
  'zsh',
  'fish',
  'ps',
  'ps1',
  'pwsh',
  'powershell',
  'cmd',
  'bat',
  'batch',
]);

/**
 * How long, in milliseconds, the copy button shows its confirmed state after a successful copy.
 */
const COPIED_FEEDBACK_MS: number = 1500;

/**
 * Renders one fenced code block from a markdown bubble: a header with the language label, a copy-to-
 * clipboard action, and — for a shell command — a play action that runs it in a new terminal tab, over
 * the (escaped, non-executed) code. Reusable, but shaped for the agent bubbles it renders in.
 */
@Component({
  selector: 'app-code-block',
  imports: [AppIcon, Button],
  templateUrl: './code-block.html',
  styleUrl: './code-block.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeBlock {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the code content of the block.
   */
  public readonly code: InputSignal<string> = input.required<string>();

  /**
   * Gets the fence's info string (language), or an empty string when none was given.
   */
  public readonly lang: InputSignal<string> = input<string>('');

  /**
   * Holds the terminal sessions the play action launches into — the hosting view's when one is in
   * scope, otherwise the app-wide instance.
   */
  private readonly terminals: TerminalSessions | null = inject(TerminalSessions, { optional: true });

  /**
   * Holds whether the copy action is showing its confirmed state.
   */
  protected readonly copied: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the language label shown in the header (the info string's first word, lower-cased), or an
   * empty string when the fence declared no language.
   */
  protected readonly label: Signal<string> = computed((): string =>
    this.lang().trim().split(/\s+/, 1)[0].toLowerCase(),
  );

  /**
   * Gets whether the block is a runnable shell command whose command can actually be shown, so the play
   * action appears: a shell language, in a surface with a terminal-hosting view (not, say, a Mission
   * Control mirror, whose app-wide sessions have no dock to reveal).
   */
  protected readonly runnable: Signal<boolean> = computed(
    (): boolean => SHELL_LANGUAGES.has(this.label()) && (this.terminals?.isRooted() ?? false),
  );

  /**
   * Copies the block's code to the clipboard, briefly confirming on success.
   */
  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code());
      this.copied.set(true);
      setTimeout((): void => this.copied.set(false), COPIED_FEEDBACK_MS);
    } catch {
      // A denied or unavailable clipboard leaves the button unchanged rather than throwing.
    }
  }

  /**
   * Runs the block's command in a new interactive terminal tab, revealing the terminal. A no-op when no
   * terminal host is in scope.
   */
  protected run(): void {
    const command: string = this.code().trim();
    if (this.terminals === null || command.length === 0) {
      return;
    }
    void this.terminals.launch({ name: this.terminalName(command), kind: 'run', command });
  }

  /**
   * Builds a concise terminal tab name from a command: its first line, trimmed to a readable length.
   * @param command The command being run.
   * @returns Returns the tab name.
   */
  private terminalName(command: string): string {
    const firstLine: string = command.split('\n', 1)[0].trim();
    const clipped: string = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
    return `Run: ${clipped}`;
  }
}
