import { inject, Service, signal, WritableSignal } from '@angular/core';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';

/**
 * Holds the icons of the apps processes belong to, looked up from the backend once per app and kept
 * for every view that lists processes (the Processes view, the Network view's connections).
 */
@Service()
export class ProcessIcons {
  /**
   * Holds the backend, asked for each app's icon.
   */
  private readonly metrics: SystemMonitorMetrics = inject(SystemMonitorMetrics);

  /**
   * Holds each icon as looked up, by key: a data URL, or null for none of its own.
   */
  private readonly icons: WritableSignal<ReadonlyMap<string, string | null>> = signal<
    ReadonlyMap<string, string | null>
  >(new Map<string, string | null>());

  /**
   * Holds the keys asked for, so each is asked once.
   */
  private readonly asked: Set<string> = new Set<string>();

  /**
   * Gets the icon of the app a process belongs to, asking the backend for it the first time. Reads a
   * signal, so a template calling this updates when the icon arrives.
   * @param location The folder the process's executable is in, or undefined when unknown.
   * @param name The process's name.
   * @returns Returns the icon as a data URL, or null when it has none of its own or is not read yet.
   */
  public icon(location: string | undefined, name: string): string | null {
    if (location === undefined) {
      return null;
    }
    const key: string = `${location}\u0000${name}`;
    const icon: string | null | undefined = this.icons().get(key);
    if (icon === undefined && !this.asked.has(key)) {
      this.asked.add(key);
      void this.metrics.processIcon(location, name).then((read: string | null): void => {
        this.icons.update(
          (icons: ReadonlyMap<string, string | null>): ReadonlyMap<string, string | null> =>
            new Map<string, string | null>(icons).set(key, read),
        );
      });
    }
    return icon ?? null;
  }
}
