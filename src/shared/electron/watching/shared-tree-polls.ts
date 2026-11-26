import * as path from 'node:path';
import { PollingTreeWatcher } from './polling-tree-watcher';
import type {
  PollDescent,
  TreeWatch,
  TreeWatchErrorListener,
  TreeWatchListener,
} from './tree-watch';

/**
 * Describes one consumer of a shared poll.
 */
interface PollSubscriber {
  /**
   * Gets which directories this consumer wants read.
   */
  readonly descend: PollDescent;

  /**
   * Gets the callback that receives the changes this consumer can see.
   */
  readonly listener: TreeWatchListener;

  /**
   * Gets the callback told when the poll fails.
   */
  readonly onError: TreeWatchErrorListener;
}

/**
 * Describes one running shared poll.
 */
interface SharedPoll {
  /**
   * Gets the poller.
   */
  readonly poller: PollingTreeWatcher;

  /**
   * Gets the consumers holding it open.
   */
  readonly subscribers: Set<PollSubscriber>;
}

/**
 * Runs one poll per folder however many watchers want it (#1254). The explorers, every language
 * server on the workspace and anything else watching the same root would otherwise each read the
 * whole tree over the share on every pass.
 *
 * A poll is keyed by its root, whether it is recursive, and its interval, and is closed when its last
 * consumer leaves. It reads every directory any consumer wants read, and each consumer hears only of
 * the changes inside directories it wants itself, so a language server that asked about `obj` does
 * not make the explorers hear about build output.
 */
export class SharedTreePolls {
  /**
   * Holds the running polls, by key.
   */
  private readonly polls: Map<string, SharedPoll> = new Map<string, SharedPoll>();

  /**
   * Gets how many polls are running, for diagnostics and specs.
   */
  public get size(): number {
    return this.polls.size;
  }

  /**
   * Joins (or starts) the poll of a folder.
   * @param root The absolute folder.
   * @param intervalMs How long to wait between polls.
   * @param recursive Whether everything beneath the root is polled.
   * @param descend Which directories this consumer wants read.
   * @param listener Called with each change this consumer can see.
   * @param onError Called once if the poll fails.
   * @returns Returns the consumer's hold on the poll; closing it leaves the poll.
   */
  public subscribe(
    root: string,
    intervalMs: number,
    recursive: boolean,
    descend: PollDescent,
    listener: TreeWatchListener,
    onError: TreeWatchErrorListener,
  ): TreeWatch {
    const key: string = `${recursive ? 'tree' : 'folder'}:${intervalMs}:${root}`;
    const subscriber: PollSubscriber = { descend, listener, onError };
    let poll: SharedPoll | undefined = this.polls.get(key);
    if (poll === undefined) {
      const subscribers: Set<PollSubscriber> = new Set<PollSubscriber>();
      const started: SharedPoll = {
        subscribers,
        poller: new PollingTreeWatcher(
          root,
          {
            intervalMs,
            recursive,
            descend: (relative: string): boolean =>
              [...subscribers].some((each: PollSubscriber): boolean => each.descend(relative)),
          },
          (eventType: 'rename' | 'change', filename: string | null): void => {
            for (const each of [...subscribers]) {
              if (filename === null || sees(each, filename)) {
                each.listener(eventType, filename);
              }
            }
          },
          (error: Error): void => {
            if (this.polls.get(key) === started) {
              this.polls.delete(key);
            }
            for (const each of [...subscribers]) {
              each.onError(error);
            }
          },
        ),
      };
      this.polls.set(key, started);
      poll = started;
    }
    const joined: SharedPoll = poll;
    joined.subscribers.add(subscriber);
    return {
      close: (): void => {
        if (!joined.subscribers.delete(subscriber) || joined.subscribers.size > 0) {
          return;
        }
        joined.poller.close();
        if (this.polls.get(key) === joined) {
          this.polls.delete(key);
        }
      },
    };
  }
}

/**
 * Determines whether a consumer can see a change: every directory above it is one it wants read.
 * @param subscriber The consumer.
 * @param relative The changed entry's path relative to the root.
 * @returns Returns true when the consumer should hear of it.
 */
function sees(subscriber: PollSubscriber, relative: string): boolean {
  for (let directory: string = path.dirname(relative); directory !== '.';) {
    if (!subscriber.descend(directory)) {
      return false;
    }
    const parent: string = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return true;
}
