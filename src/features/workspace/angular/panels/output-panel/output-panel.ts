import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { ITheme, Terminal } from '@xterm/xterm';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Log } from '@shared/angular/services/log/log';
import { Output, OutputChannelInfo } from '@shared/angular/services/output/output';
import { Theme } from '@shared/angular/services/theme/theme';

/**
 * Holds the opacity applied to the accent colour when used as the selection background.
 */
const SELECTION_ALPHA: number = 0.3;

/**
 * Renders the workspace {@link Output} surface as the body of the Output dock panel: a channel selector
 * over a read-only, write-only terminal (xterm, no PTY and no input) that replays the selected channel's
 * buffer and writes its subsequent chunks live. Switching channels re-renders from the target channel's
 * buffer, so each stream (build, run, debug, …) is preserved independently. The selector is hidden while
 * only the default channel exists, so a quiet workspace looks unchanged. The dock chrome supplies the
 * title bar. Like the interactive terminal, the xterm canvas is only created inside Electron; elsewhere
 * a fallback message is shown.
 */
@Component({
  selector: 'app-output-panel',
  imports: [Button, Dropdown, PanelToolbar],
  templateUrl: './output-panel.html',
  styleUrl: './output-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPanel implements AfterViewInit, OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the workspace output surface rendered by this panel.
   */
  private readonly output: Output = inject(Output);

  /**
   * Holds the structured logger for output panel actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the active channel rendered by the terminal.
   */
  public readonly activeChannelId: Signal<string> = this.output.activeChannelId;

  /**
   * Gets the channels as dropdown options for the tool-strip selector.
   */
  protected readonly channelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.output.channels().map(
        (channel: OutputChannelInfo): DropdownOption => ({
          value: channel.id,
          label: channel.label,
        }),
      ),
  );

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
   * Holds a value indicating whether a real bridge is available (running in Electron).
   */
  private readonly isElectron: boolean = window.bridge !== undefined;

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
   * Holds whether the xterm has been created, so the channel-streaming effect waits for it.
   */
  private readonly ready: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Initializes a new instance of the {@link OutputPanel} class, wiring the theme, relayout, and
   * channel-streaming effects.
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

    // Stream the active channel into the terminal: re-runs whenever the selection changes (and once the
    // xterm is ready), replaying the target channel's buffer and subscribing to its live chunks.
    effect((): void => {
      const channelId: string = this.output.activeChannelId();
      if (this.ready() && this.xterm !== null) {
        this.showChannel(channelId);
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

    // Signal the streaming effect to render the active channel now that the terminal exists.
    this.ready.set(true);

    this.resizeObserver = new ResizeObserver((): void => this.handleResize());
    this.resizeObserver.observe(host);
  }

  /**
   * Selects a channel from the tool-strip selector, revealing it in the terminal.
   * @param channelId The chosen channel identifier.
   */
  protected selectChannel(channelId: string): void {
    this.log.debug('workspace.output', 'Select output channel', channelId);
    this.output.setActive(channelId);
  }

  /**
   * Clears the active channel's buffer.
   */
  protected clear(): void {
    this.log.info('workspace.output', 'Clear output channel', this.activeChannelId());
    this.output.clearChannel(this.activeChannelId());
  }

  /**
   * Renders a channel into the terminal: unsubscribes from the previous channel, replays the target
   * channel's buffer, and subscribes to its live writes and clears.
   * @param channelId The channel to render.
   */
  private showChannel(channelId: string): void {
    this.cleanupOnWrite?.();
    this.cleanupOnClear?.();
    this.xterm?.clear();
    this.xterm?.write(this.output.snapshotOf(channelId));
    this.cleanupOnWrite = this.output.onWriteTo(channelId, (chunk: string): void => {
      this.xterm?.write(chunk);
    });
    this.cleanupOnClear = this.output.onClearOf(channelId, (): void => {
      this.xterm?.clear();
    });
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
    const light: string = read('--gray-100');
    const ink: string = read('--gray-900');
    return {
      // Match the panel's own background so the terminal reads as part of the panel rather than a
      // darker inset element; the padding gutter around the canvas then blends in.
      background: read('--dock-tab-background-color--active'),
      foreground: dark ? light : ink,
      cursor: this.themeService.accentHex(),
      cursorAccent: dark ? ink : light,
      selectionBackground: `rgba(${this.themeService.accentRgb()}, ${SELECTION_ALPHA})`,
    };
  }
}
