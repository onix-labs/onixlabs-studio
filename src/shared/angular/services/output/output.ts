import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * The identifier of the default output channel, which the legacy channel-less API writes to and the
 * panel selects on first open. Producers that predate multiplexed output (and generic workspace log
 * messages) land here.
 */
export const DEFAULT_CHANNEL: string = 'general';

/**
 * Describes a named output channel for display in the panel's channel selector.
 */
export interface OutputChannelInfo {
  /**
   * Gets the stable identifier of the channel.
   */
  readonly id: string;

  /**
   * Gets the channel's display label.
   */
  readonly label: string;
}

/**
 * The mutable state backing one channel: its display info, accumulated buffer, and the listeners a
 * panel subscribes with while the channel is the one it renders.
 */
interface ChannelState {
  /**
   * Holds the channel's display info.
   */
  readonly info: OutputChannelInfo;

  /**
   * Holds the accumulated output, replayed to a panel that switches to this channel.
   */
  buffer: string;

  /**
   * Holds the listeners notified with each appended chunk.
   */
  readonly writeListeners: Set<(chunk: string) => void>;

  /**
   * Holds the listeners notified when the channel is cleared.
   */
  readonly clearListeners: Set<() => void>;
}

/**
 * A handle to one named {@link Output} channel, so a producer holds its channel and writes to it
 * without repeating the identifier. The panel reads channels through the owning service; producers
 * write through their handle.
 */
export class OutputChannel {
  /**
   * Initializes a new instance of the {@link OutputChannel} class.
   * @param owner The owning output service the channel operations delegate to.
   * @param id The channel identifier.
   */
  public constructor(
    private readonly owner: Output,
    public readonly id: string,
  ) {}

  /**
   * Appends text to this channel.
   * @param text The text to append (may contain ANSI escape sequences).
   */
  public append(text: string): void {
    this.owner.appendTo(this.id, text);
  }

  /**
   * Appends a line of text, terminated with a carriage return and line feed for the terminal.
   * @param text The line to append.
   */
  public appendLine(text: string): void {
    this.append(`${text}\r\n`);
  }

  /**
   * Clears this channel's buffer.
   */
  public clear(): void {
    this.owner.clearChannel(this.id);
  }

  /**
   * Gets this channel's accumulated buffer.
   * @returns Returns the accumulated output.
   */
  public snapshot(): string {
    return this.owner.snapshotOf(this.id);
  }

  /**
   * Makes this the active channel, revealing it in the panel.
   */
  public reveal(): void {
    this.owner.setActive(this.id);
  }
}

/**
 * The workspace's write-only Output surface, multiplexed into named channels so the many producers a
 * language-agnostic workspace runs at once — build, run, per-DAP-session, per-LSP-server — each own a
 * distinct, selectable stream instead of sharing one undifferentiated log. Each channel accumulates its
 * own buffer (replayed when the panel switches to it) and carries raw text including ANSI escape
 * sequences, so colour is preserved. Provided per workspace, so channels are scoped to their tab.
 *
 * The channel-less API ({@link append}/{@link clear}/…) writes to the {@link DEFAULT_CHANNEL}, so
 * producers that predate multiplexing keep working unchanged.
 */
@Service()
export class Output {
  /**
   * Holds the channels by identifier, in creation order.
   */
  private readonly channelStates: Map<string, ChannelState> = new Map<string, ChannelState>();

  /**
   * Holds the channel list for the selector, kept in sync with {@link channelStates}.
   */
  private readonly channelList: WritableSignal<readonly OutputChannelInfo[]> = signal<
    readonly OutputChannelInfo[]
  >([]);

  /**
   * Holds the active channel the panel renders.
   */
  private readonly active: WritableSignal<string> = signal<string>(DEFAULT_CHANNEL);

  /**
   * Gets the channels available for selection, in creation order.
   */
  public readonly channels: Signal<readonly OutputChannelInfo[]> = this.channelList.asReadonly();

  /**
   * Gets the active channel the panel renders.
   */
  public readonly activeChannelId: Signal<string> = this.active.asReadonly();

  /**
   * Initializes the output surface with its default channel.
   */
  public constructor() {
    this.ensure(DEFAULT_CHANNEL, 'General');
  }

  /**
   * Gets — creating on first use — a handle to a named channel. A channel's label is fixed on
   * creation; a later call with a different label returns the existing channel unchanged.
   * @param id The channel identifier.
   * @param label The display label, defaulting to the identifier.
   * @returns Returns the channel handle.
   */
  public channel(id: string, label: string = id): OutputChannel {
    this.ensure(id, label);
    return new OutputChannel(this, id);
  }

  /**
   * Makes a channel the active one, creating it when unknown so a producer can reveal a channel it is
   * about to write to.
   * @param id The channel identifier.
   */
  public setActive(id: string): void {
    this.ensure(id, id);
    this.active.set(id);
  }

  /**
   * Removes a channel and its buffer. When the removed channel was active, selection falls back to the
   * default channel. The default channel cannot be removed.
   * @param id The channel identifier.
   */
  public remove(id: string): void {
    if (id === DEFAULT_CHANNEL || !this.channelStates.has(id)) {
      return;
    }
    this.channelStates.delete(id);
    this.channelList.set([...this.channelStates.values()].map((state: ChannelState) => state.info));
    if (this.active() === id) {
      this.active.set(DEFAULT_CHANNEL);
    }
  }

  /**
   * Appends text to a channel, notifying its listeners.
   * @param id The channel identifier.
   * @param text The text to append.
   */
  public appendTo(id: string, text: string): void {
    const state: ChannelState = this.ensure(id, id);
    state.buffer += text;
    for (const listener of state.writeListeners) {
      listener(text);
    }
  }

  /**
   * Clears a channel's buffer, notifying its listeners.
   * @param id The channel identifier.
   */
  public clearChannel(id: string): void {
    const state: ChannelState = this.ensure(id, id);
    state.buffer = '';
    for (const listener of state.clearListeners) {
      listener();
    }
  }

  /**
   * Gets a channel's accumulated buffer.
   * @param id The channel identifier.
   * @returns Returns the buffer, or an empty string when the channel is unknown.
   */
  public snapshotOf(id: string): string {
    return this.channelStates.get(id)?.buffer ?? '';
  }

  /**
   * Subscribes to a channel's appended chunks.
   * @param id The channel identifier.
   * @param listener Receives each appended chunk.
   * @returns Returns a function that removes the listener.
   */
  public onWriteTo(id: string, listener: (chunk: string) => void): () => void {
    const state: ChannelState = this.ensure(id, id);
    state.writeListeners.add(listener);
    return (): void => {
      state.writeListeners.delete(listener);
    };
  }

  /**
   * Subscribes to a channel's clear events.
   * @param id The channel identifier.
   * @param listener Invoked when the channel is cleared.
   * @returns Returns a function that removes the listener.
   */
  public onClearOf(id: string, listener: () => void): () => void {
    const state: ChannelState = this.ensure(id, id);
    state.clearListeners.add(listener);
    return (): void => {
      state.clearListeners.delete(listener);
    };
  }

  /**
   * Appends text to the default channel.
   * @param text The text to append (may contain ANSI escape sequences).
   */
  public append(text: string): void {
    this.appendTo(DEFAULT_CHANNEL, text);
  }

  /**
   * Appends a line of text to the default channel, terminated with a carriage return and line feed.
   * @param text The line to append.
   */
  public appendLine(text: string): void {
    this.append(`${text}\r\n`);
  }

  /**
   * Clears the default channel.
   */
  public clear(): void {
    this.clearChannel(DEFAULT_CHANNEL);
  }

  /**
   * Gets the default channel's accumulated buffer.
   * @returns Returns the accumulated output.
   */
  public snapshot(): string {
    return this.snapshotOf(DEFAULT_CHANNEL);
  }

  /**
   * Subscribes to the default channel's appended chunks.
   * @param listener Receives each appended chunk.
   * @returns Returns a function that removes the listener.
   */
  public onWrite(listener: (chunk: string) => void): () => void {
    return this.onWriteTo(DEFAULT_CHANNEL, listener);
  }

  /**
   * Subscribes to the default channel's clear events.
   * @param listener Invoked when the channel is cleared.
   * @returns Returns a function that removes the listener.
   */
  public onClear(listener: () => void): () => void {
    return this.onClearOf(DEFAULT_CHANNEL, listener);
  }

  /**
   * Gets — creating on first use — the state for a channel, publishing the channel list when a new
   * channel is created.
   * @param id The channel identifier.
   * @param label The display label used when the channel is created.
   * @returns Returns the channel state.
   */
  private ensure(id: string, label: string): ChannelState {
    let state: ChannelState | undefined = this.channelStates.get(id);
    if (state === undefined) {
      state = {
        info: { id, label },
        buffer: '',
        writeListeners: new Set<(chunk: string) => void>(),
        clearListeners: new Set<() => void>(),
      };
      this.channelStates.set(id, state);
      this.channelList.set(
        [...this.channelStates.values()].map((each: ChannelState) => each.info),
      );
    }
    return state;
  }
}
