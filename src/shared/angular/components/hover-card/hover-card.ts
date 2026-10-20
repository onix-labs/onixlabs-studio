import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MarkdownRenderer } from '@shared/angular/components/markdown-renderer/markdown-renderer';
import { Icon } from '@shared/angular/icons/icon';
import {
  HoverCardContent,
  HoverProblem,
  MARKER_SEVERITY,
  problemDetail,
} from '@shared/angular/services/hover/hover-content';
import { Shell } from '@shared/angular/services/shell/shell';

/**
 * Holds the schemes a link in a card opens, in the operating system's browser.
 */
const EXTERNAL_LINK: RegExp = /^(?:https?|mailto):/i;

/**
 * Draws Studio's hover card (#1020), in place of Monaco's hover widget: the type and documentation of
 * the symbol under the pointer (or at the caret) as Studio markdown with highlighted code, the
 * problems on that spot — each with **Quick Fix…** and **Go to Problem** — and an actions row with
 * **Go to Definition** and **Find All References**. A gutter decoration's description shows through
 * the same card, alone.
 *
 * Shown by the {@link import('@shared/angular/services/hover/hover-cards').HoverCards} in a CDK
 * overlay of the editor's window; it only says what was chosen. The markdown is the transcript's
 * pipeline, sanitised; a link in it opens in the operating system's browser rather than the window.
 */
@Component({
  selector: 'app-hover-card',
  imports: [AppIcon, Button, MarkdownRenderer],
  templateUrl: './hover-card.html',
  styleUrl: './hover-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    'aria-label': 'Symbol information',
    '(click)': 'onClick($event)',
    '(keydown.escape)': 'dismissed.emit()',
  },
})
export class HoverCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets what the card shows.
   */
  public readonly content: InputSignal<HoverCardContent> = input.required<HoverCardContent>();

  /**
   * Raised with a problem when its Quick Fix… is chosen.
   */
  public readonly quickFix: OutputEmitterRef<HoverProblem> = output<HoverProblem>();

  /**
   * Raised with a problem when its Go to Problem is chosen.
   */
  public readonly goToProblem: OutputEmitterRef<HoverProblem> = output<HoverProblem>();

  /**
   * Raised when Go to Definition is chosen.
   */
  public readonly goToDefinition: OutputEmitterRef<void> = output<void>();

  /**
   * Raised when Find All References is chosen.
   */
  public readonly findReferences: OutputEmitterRef<void> = output<void>();

  /**
   * Raised when Escape is pressed in the card.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the shell a link opens through.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Resolves the icon a problem shows, by its severity.
   * @param problem The problem.
   * @returns Returns the icon.
   */
  protected iconFor(problem: HoverProblem): Icon {
    if (problem.severity >= MARKER_SEVERITY.error) {
      return Icon.ERROR_FILL;
    }
    if (problem.severity >= MARKER_SEVERITY.warning) {
      return Icon.WARNING_FILL;
    }
    return problem.severity >= MARKER_SEVERITY.info ? Icon.INFO_FILL : Icon.HINT;
  }

  /**
   * Resolves the colour a problem's icon shows in, by its severity.
   * @param problem The problem.
   * @returns Returns the CSS colour.
   */
  protected colorFor(problem: HoverProblem): string {
    if (problem.severity >= MARKER_SEVERITY.error) {
      return 'var(--error-color)';
    }
    if (problem.severity >= MARKER_SEVERITY.warning) {
      return 'var(--warning-color)';
    }
    return problem.severity >= MARKER_SEVERITY.info ? 'var(--info-color)' : 'muted';
  }

  /**
   * Says where a problem came from and its code, for the line under its message.
   * @param problem The problem.
   * @returns Returns the detail, or null.
   */
  protected detailOf(problem: HoverProblem): string | null {
    return problemDetail(problem);
  }

  /**
   * Keeps a click on a link in the markdown from navigating the window: a web or mail link opens in
   * the operating system's browser; any other link (a command of the language's, a file) opens
   * nothing.
   * @param event The click.
   */
  protected onClick(event: MouseEvent): void {
    const anchor: HTMLAnchorElement | null =
      event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor === null) {
      return;
    }
    event.preventDefault();
    const href: string = anchor.getAttribute('href') ?? '';
    if (EXTERNAL_LINK.test(href)) {
      void this.shell.openExternal(href);
    }
  }
}
