import { PluginContribution } from '@shared/api/plugin-channels';
import { logger } from '../../logger';

/**
 * Describes a change to what is installed: a plugin installed (including an update over an older
 * version), or removed.
 */
export interface PluginInstallChange {
  /**
   * Gets the plugin identifier.
   */
  readonly pluginId: string;

  /**
   * Gets whether the plugin is now installed (a first install or an update) or gone.
   */
  readonly kind: 'installed' | 'removed';

  /**
   * Gets every implementation the change touches — what the version that left contributed, and what
   * the version that arrived contributes — so a host can find its own by slot and identifier.
   */
  readonly contributions: readonly PluginContribution[];
}

/**
 * Tells the main process's plugin hosts that what is installed changed (#881).
 *
 * Without it nothing did. The Plugin Manager replaced or deleted a plugin's files and updated its
 * record, while the process each host had already started went on serving: a removed GitHub kept
 * answering for pull requests, and an update was not used until Studio restarted. A host listens here
 * and stops what the change left behind; the next request starts whatever is installed now, or is
 * refused because nothing is.
 */
export class PluginInstallEvents {
  /**
   * Holds the listeners told about every change.
   */
  private readonly listeners: Set<(change: PluginInstallChange) => void> = new Set<
    (change: PluginInstallChange) => void
  >();

  /**
   * Registers a listener for changes to what is installed.
   * @param listener The listener.
   * @returns Returns a function that removes the listener.
   */
  public on(listener: (change: PluginInstallChange) => void): () => void {
    this.listeners.add(listener);
    return (): void => void this.listeners.delete(listener);
  }

  /**
   * Tells every listener about a change. A listener that throws is logged and skipped, so one host
   * failing to stop its plugin cannot leave the others serving theirs.
   * @param change The change.
   */
  public emit(change: PluginInstallChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error: unknown) {
        logger.error(
          'PluginInstallEvents',
          `A listener failed on ${change.pluginId} ${change.kind}`,
          error,
        );
      }
    }
  }
}

/**
 * Holds the one event source for the application.
 */
let events: PluginInstallEvents | null = null;

/**
 * Gets the event source the Plugin Manager announces installs on and the hosts listen to.
 *
 * **One instance, shared**, for the reason the install store is: the Plugin Manager arrives as a
 * contribution and the hosts are wired in `main.ts`, so neither can hand the other a callback.
 * @returns Returns the event source.
 */
export function pluginInstallEvents(): PluginInstallEvents {
  events ??= new PluginInstallEvents();
  return events;
}
