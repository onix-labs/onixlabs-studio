import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  viewChild,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { ITheme, Terminal } from '@xterm/xterm';
import { DockPanel } from '../../../services/dock/dock-panel';
import { Output } from '../../../services/output/output';
import { AccentColor, Theme } from '@shared/angular/services/theme/theme';

/**
 * Holds the opacity applied to the accent colour when used as the selection background.
 */
const SELECTION_ALPHA: number = 0.3;

/**
 * Renders the shared {@link Output} channel as the body of the Output dock panel: a read-only,
 * write-only terminal (xterm, no PTY and no input) that replays the channel's buffer on mount and
 * writes subsequent chunks live. The dock chrome supplies the title bar. Like the interactive
 * terminal, the xterm canvas is only created inside Electron; elsewhere a fallback message is shown.
 */
@Component({
  selector: 'app-output-panel',
  imports: [],
  templateUrl: './output-panel.html',
  styleUrl: './output-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPanel implements AfterViewInit, OnDestroy {
  /**
   * Holds the shared output channel rendered by this panel.
   */
  private readonly output: Output = inject(Output);

  /**
   * Holds the theme service used to keep the terminal colours in sync with the application theme.
   */
  private readonly themeService: Theme = inject(Theme);

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets a value indicating whether the panel belongs to the active dock tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the container element that hosts the xterm canvas.
   */
  private readonly container: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('container');

  /**
   * Holds a value indicating whether a real Studio bridge is available (running in Electron).
   */
  private readonly isElectron: boolean = window.studio !== undefined;

  /**
   * Holds the xterm instance, or null before initialisation or outside Electron.
   */
  private xterm: Terminal | null = null;

  /**
   * Holds the fit addon used to size the terminal to its container.
   */
  private fitAddon: FitAddon | null = null;

  /**
   * Holds the observer that re-fits the terminal when its container resizes.
   */
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Holds the function that removes the output write listener, or null when not subscribed.
   */
  private cleanupOnWrite: (() => void) | null = null;

  /**
   * Holds the function that removes the output clear listener, or null when not subscribed.
   */
  private cleanupOnClear: (() => void) | null = null;

  /**
   * Initializes a new instance of the {@link OutputPanel} class, wiring the theme and relayout
   * effects.
   */
  public constructor() {
    effect((): void => {
      const theme: ITheme = this.buildTheme();
      if (this.xterm !== null) {
        this.xterm.options.theme = theme;
      }
    });

    effect((): void => {
      if (this.isActive() && this.xterm !== null && this.fitAddon !== null) {
        this.handleResize();
      }
    });
  }

  /**
   * Creates the read-only terminal and starts streaming the output channel into it.
   */
  public ngAfterViewInit(): void {
    if (!this.isElectron) {
      this.container().nativeElement.textContent =
        'Output is only available when running inside Electron.';
      return;
    }

    const host: HTMLDivElement = this.container().nativeElement;
    const xterm: Terminal = new Terminal({
      fontFamily: '"JetBrains Mono", "Menlo", "Consolas", monospace',
      fontSize: 13,
      theme: this.buildTheme(),
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fitAddon: FitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    this.xterm = xterm;
    this.fitAddon = fitAddon;
    this.handleResize();

    xterm.write(this.output.snapshot());
    this.cleanupOnWrite = this.output.onWrite((chunk: string): void => {
      this.xterm?.write(chunk);
    });
    this.cleanupOnClear = this.output.onClear((): void => {
      this.xterm?.clear();
    });

    this.resizeObserver = new ResizeObserver((): void => this.handleResize());
    this.resizeObserver.observe(host);
  }

  /**
   * Tears down the listeners, observer, and xterm instance on destroy.
   */
  public ngOnDestroy(): void {
    this.cleanupOnWrite?.();
    this.cleanupOnClear?.();
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;
  }

  /**
   * Re-fits the terminal to its container, ignoring the error fit throws when the host has zero size.
   */
  private handleResize(): void {
    try {
      this.fitAddon?.fit();
    } catch {
      // Fit throws when the host has zero size (e.g. while hidden); ignore.
    }
  }

  /**
   * Builds the xterm theme from the application's palette primitives, keyed by the current resolved
   * mode and accent so the output panel stays in sync with the appearance settings.
   * @returns Returns the xterm theme.
   */
  private buildTheme(): ITheme {
    const styles: CSSStyleDeclaration = getComputedStyle(document.documentElement);
    const read: (name: string) => string = (name: string): string =>
      styles.getPropertyValue(name).trim();
    const dark: boolean = this.themeService.resolvedMode() === 'dark';
    const accent: AccentColor = this.themeService.accent();
    const light: string = read('--gray-100');
    const ink: string = read('--gray-900');
    return {
      background: dark ? ink : light,
      foreground: dark ? light : ink,
      cursor: read(`--accent-${accent}`),
      cursorAccent: dark ? ink : light,
      selectionBackground: `rgba(${read(`--accent-${accent}-rgb`)}, ${SELECTION_ALPHA})`,
    };
  }
}
