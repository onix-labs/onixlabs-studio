import type { WatchEventType } from 'node:fs';

/**
 * Receives a watcher's events in the shape `fs.watch` reports them: `rename` when an entry appeared or
 * went away, `change` when its contents changed, and the entry's path relative to the watched root,
 * or null when the watcher cannot say what changed and the subscriber should look again at everything.
 */
export type TreeWatchListener = (eventType: WatchEventType, filename: string | null) => void;

/**
 * Receives a watcher's failure, after which it reports nothing more: the root went away, or the
 * operating system refused to watch it.
 */
export type TreeWatchErrorListener = (error: Error) => void;

/**
 * Decides whether a polling watcher reads a directory's entries.
 */
export type PollDescent = (relativeDirectory: string) => boolean;

/**
 * A running watch on a folder, natively or by polling.
 */
export interface TreeWatch {
  /**
   * Stops watching. Nothing is reported afterwards.
   */
  close(): void;
}
