import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { MonacoHighlighter } from '@shared/angular/services/monaco/monaco-highlighter';
import { Theme } from '@shared/angular/services/theme/theme';

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
 * Escapes the HTML-significant characters in text so raw code can be bound as trusted HTML without
 * being interpreted as markup. Used for the plain-text fallback shown before Monaco has highlighted
 * the block.
 * @param text The raw text.
 * @returns Returns the escaped text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Renders one fenced code block from a markdown bubble: the (escaped, non-executed, Monaco-
 * highlighted) code over a footer carrying the language label at the leading edge and, at the trailing
 * edge, a copy-to-clipboard action and — for a shell command — a play action that runs it in a new
 * terminal tab. Reusable, but shaped for the agent bubbles it renders in.
 */
@Component({
  selector: 'app-code-block',
  imports: [Button],
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
   * Holds the Monaco loader, read for its ready signal so the block re-highlights once Monaco arrives.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the shared colorizer that turns the code into syntax-highlighted HTML.
   */
  private readonly highlighter: MonacoHighlighter = inject(MonacoHighlighter);

  /**
   * Holds the theme service, read for its resolved mode so the block re-highlights when the user
   * switches between light and dark (Monaco's token colours are mode-specific).
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the sanitizer used to bind Monaco's (already-escaped) highlighted HTML as trusted.
   */
  private readonly sanitizer: DomSanitizer = inject(DomSanitizer);

  /**
   * Identifies the most recent highlight request, so a slower earlier colorize cannot overwrite a
   * later one when the code, language or theme changes in quick succession.
   */
  private highlightRequest: number = 0;

  /**
   * Holds the Monaco-highlighted HTML, or null before it is available (Monaco still loading, or under
   * the test runner), in which case the escaped-plain-text fallback is shown instead.
   */
  private readonly highlighted: WritableSignal<SafeHtml | null> = signal<SafeHtml | null>(null);

  /**
   * Holds whether the copy action is showing its confirmed state.
   */
  protected readonly copied: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the HTML rendered into the code panel: Monaco's highlighted output once available, otherwise
   * the raw code escaped and shown as plain text so the block is legible immediately.
   */
  protected readonly body: Signal<SafeHtml> = computed(
    (): SafeHtml =>
      this.highlighted() ?? this.sanitizer.bypassSecurityTrustHtml(escapeHtml(this.code())),
  );

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
   * Constructs the block, wiring the effect that (re-)highlights the code whenever the code, its
   * language, the light/dark mode or Monaco's readiness changes. Before Monaco is ready the effect
   * clears the highlight so the plain-text fallback shows; a stale in-flight colorize is discarded.
   */
  public constructor() {
    effect((): void => {
      const code: string = this.code();
      const lang: string = this.lang();
      // Read as dependencies so the block re-highlights when Monaco finishes loading and when the
      // user toggles light/dark (which changes the token colours Monaco emits).
      const ready: boolean = this.monaco.isLoaded();
      this.theme.resolvedMode();
      const request: number = ++this.highlightRequest;
      if (!ready) {
        this.highlighted.set(null);
        return;
      }
      void this.highlighter
        .colorize(code, lang)
        .then((html: string): void => {
          if (this.highlightRequest === request) {
            this.highlighted.set(html.length > 0 ? this.sanitizer.bypassSecurityTrustHtml(html) : null);
          }
        })
        .catch((): void => {
          if (this.highlightRequest === request) {
            this.highlighted.set(null);
          }
        });
    });
  }

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
