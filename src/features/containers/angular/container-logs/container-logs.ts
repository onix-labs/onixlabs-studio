import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type { ContainerLogs } from '@shared/api/container-engine-protocol';
import { Settings } from '@shared/angular/services/settings/settings';
import { ContainersClient } from '../client/containers-client';

/**
 * The timestamp the engine starts each line with.
 */
const LINE_TIMESTAMP: RegExp = /^\d{4}-\d{2}-\d{2}T\S+\s/;

/**
 * A container's logs, read through the engine's plugin and drawn by Studio (#973) — no terminal and no
 * engine CLI needed. The most recent lines are read again every Log Refresh while the tab is showing,
 * so it follows the container as `logs -f` did; it stays at the bottom unless the user has scrolled up
 * to read.
 */
@Component({
  selector: 'app-container-logs',
  template: `
    <div #scroller class="container-logs" role="log" aria-live="off">
      @if (shown().length === 0) {
        <p class="container-logs__empty">{{ loaded() ? 'No log output yet.' : 'Reading logs…' }}</p>
      } @else {
        <pre class="container-logs__lines">{{ shown().join('\\n') }}</pre>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      block-size: 100%;
      min-block-size: 0;
    }

    .container-logs {
      block-size: 100%;
      overflow: auto;
      padding: 0.5rem 0.75rem;
      box-sizing: border-box;
    }

    .container-logs__lines {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .container-logs__empty {
      margin: 0;
      font-size: 0.8rem;
      color: var(--settings-muted-foreground-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerLogsPane {
  /**
   * Gets the container whose logs are shown.
   */
  public readonly containerId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the tab is showing; the lines are read only while it is.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the lines read last.
   */
  protected readonly lines: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /**
   * Holds the settings, which decide how much is read, how often, and how it is shown.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the lines as they are shown: with the engine's timestamps, or without them.
   */
  protected readonly shown: Signal<readonly string[]> = computed((): readonly string[] =>
    this.settings.value('containers.logTimestamps')()
      ? this.lines()
      : this.lines().map((line: string): string => line.replace(LINE_TIMESTAMP, '')),
  );

  /**
   * Holds whether a read has finished, so an empty log reads as empty rather than as loading.
   */
  protected readonly loaded: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the scrolling element.
   */
  private readonly scroller: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * Holds the engine client the lines are read through.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds whether the view was at the bottom before the last update, so it can stay there.
   */
  private pinned: boolean = true;

  /**
   * Starts and stops the reading with the tab's visibility, and keeps the view at the bottom.
   */
  public constructor() {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop: () => void = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    effect((): void => {
      const active: boolean = this.isActive();
      const seconds: number = this.settings.value('containers.logRefreshSeconds')();
      this.settings.value('containers.logLines')();
      untracked((): void => {
        stop();
        if (active) {
          void this.read();
          timer = setInterval((): void => void this.read(), seconds * 1000);
        }
      });
    });
    inject(DestroyRef).onDestroy(stop);
    afterRenderEffect((): void => {
      this.shown();
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (element !== undefined && this.pinned) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  /**
   * Reads the most recent lines.
   * @returns Resolves once they are shown.
   */
  private async read(): Promise<void> {
    const element: HTMLElement | undefined = this.scroller()?.nativeElement;
    this.pinned =
      element === undefined || element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    const logs: ContainerLogs = await this.client.logs(
      this.containerId(),
      this.settings.get('containers.logLines'),
    );
    this.lines.set(logs.lines);
    this.loaded.set(true);
  }
}
