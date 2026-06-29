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
  viewChild,
  WritableSignal,
} from '@angular/core';
import { CodeTerminals } from '../../../../services/code-terminals/code-terminals';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';

/**
 * Holds the prefix used to derive a code tab's run-terminal identifier from its tab id.
 */
const RUN_TERMINAL_PREFIX: string = 'run-';

/**
 * Represents the docked run terminal for a code tab: a small toolbar over an embedded terminal whose
 * session is keyed by the owning tab. Queued run commands are written once the terminal is ready.
 */
@Component({
  selector: 'app-code-terminal-panel',
  imports: [Terminal, AppIcon],
  templateUrl: './code-terminal-panel.html',
  styleUrl: './code-terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeTerminalPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the docked-terminal panel state.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Holds the embedded terminal pane this panel drives, or undefined before the view initialises.
   */
  private readonly pane: Signal<Terminal | undefined> = viewChild<Terminal>(Terminal);

  /**
   * Gets the identifier of the owning code tab. Always supplied by the host; the empty default lets
   * the panel be constructed before its input binding is applied.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the identifier of the run terminal's session, derived from the tab id.
   */
  protected readonly runTerminalId: Signal<string> = computed(
    (): string => `${RUN_TERMINAL_PREFIX}${this.tabId()}`,
  );

  /**
   * Holds a value indicating whether the embedded terminal is ready to receive input.
   */
  private readonly ready: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Initialises the panel, writing any queued run command once the terminal becomes ready.
   */
  public constructor() {
    effect((): void => {
      const tabId: string = this.tabId();
      if (tabId === '') {
        return;
      }
      const pending: string | null = this.codeTerminals.pending(tabId);
      if (this.ready() && pending !== null) {
        // Clear and write outside the reactive context to avoid writing signals during the effect.
        queueMicrotask((): void => this.flushPending());
      }
    });
  }

  /**
   * Records that the embedded terminal is ready.
   */
  protected onReady(): void {
    this.ready.set(true);
  }

  /**
   * Toggles the editor/terminal layout between stacked and side-by-side.
   */
  protected onLayout(): void {
    this.codeTerminals.toggleLayout(this.tabId());
  }

  /**
   * Cuts the terminal buffer to the clipboard.
   */
  protected onCut(): void {
    this.pane()?.cut();
  }

  /**
   * Copies the terminal selection to the clipboard.
   */
  protected onCopy(): void {
    this.pane()?.copy();
  }

  /**
   * Clears the terminal screen.
   */
  protected onClear(): void {
    this.pane()?.clear();
  }

  /**
   * Hides the terminal panel, leaving its session mounted so it can be reopened.
   */
  protected onClose(): void {
    this.codeTerminals.hide(this.tabId());
  }

  /**
   * Writes the tab's pending run command to the terminal, then clears it.
   */
  private flushPending(): void {
    const command: string | null = this.codeTerminals.takePending(this.tabId());
    if (command !== null) {
      this.pane()?.runCommand(command);
    }
  }
}
