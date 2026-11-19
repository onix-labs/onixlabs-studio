import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { Severity } from '@shared/api/log-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * The identifier of the default output channel, which the legacy channel-less API writes to and the
 * panel selects on first open. Producers that predate multiplexed output (and generic workspace log
 * messages) land here.
 */
export const DEFAULT_CHANNEL: string = 'general';

/**
 * The most characters a channel's retained buffer holds (~2 MB). Past it, the oldest half is dropped
 * at a line boundary — enough scrollback to diagnose from, without a chatty producer growing renderer
 * memory for the life of the workspace.
 */
const MAX_CHANNEL_BUFFER_LENGTH: number = 2_000_000;

/**
 * Describes a named output channel for display in the panel's channel selector.
 */
/**
 * Matches the terminal escape sequences a tool's output may carry (colours, cursor moves), which mean
 * nothing in a table.
 */
// eslint-disable-next-line no-control-regex
const ESCAPES: RegExp = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/**
 * One line of a channel's output, as the Logs panel lists it: when it was written, how severe it is,
 * which channel it came from, and what it said.
 */
export interface OutputEntry {
  /**
   * Gets the entry's identity, increasing in the order entries were written, across every channel.
   */
  readonly id: number;

  /**
   * Gets when it was written (epoch milliseconds).
   */
  readonly time: number;

  /**
   * Gets how severe it is: what its writer said, or `info` when it said nothing.
   */
  readonly level: Severity;

  /**
   * Gets the channel it was written to.
   */
  readonly channelId: string;

  /**
   * Gets what it said, without terminal escape sequences. A line written whole may span several.
   */
  readonly text: string;
}

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

  /**
   * Holds the channel's entries, oldest first.
   */
  entries: OutputEntry[];

  /**
   * Holds the start of a line written in pieces, until its end arrives.
   */
  partial: string;
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
   * Appends text to this channel; each complete line becomes an entry in the Logs panel.
   * @param text The text to append (may contain ANSI escape sequences).
   * @param level How severe its lines are; `info` when not said.
   */
  public append(text: string, level: Severity = 'info'): void {
    this.owner.appendTo(this.id, text, level);
  }

  /**
   * Appends a line of text, terminated with a carriage return and line feed for the terminal, as one
   * entry in the Logs panel however many lines it spans.
   * @param text The line to append.
   * @param level How severe it is; `info` when not said.
   */
  public appendLine(text: string, level: Severity = 'info'): void {
    this.owner.appendLineTo(this.id, text, level);
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
   * Holds how many times a channel has been asked to be shown, so the active workspace can bring its
   * Logs panel forward on each request.
   */
  private readonly showCount: WritableSignal<number> = signal<number>(0);

  /**
   * Holds a count that rises whenever an entry is written or a channel cleared, so the Logs panel's
   * computed rows re-read the entries; the entries themselves are not signals, to keep writes cheap.
   */
  private readonly revisionState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the id the next entry takes.
   */
  private nextEntryId: number = 1;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, for how many lines each channel keeps (Output Scrollback Lines).
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets how many times a channel has been asked to be shown — by the user choosing "Show log" on a
   * notification, say (#1134). The active workspace reveals its Logs panel each time it changes.
   */
  public readonly showRequests: Signal<number> = this.showCount.asReadonly();

  /**
   * Gets the channels available for selection, in creation order.
   */
  public readonly channels: Signal<readonly OutputChannelInfo[]> = this.channelList.asReadonly();

  /**
   * Gets the active channel the panel renders.
   */
  public readonly activeChannelId: Signal<string> = this.active.asReadonly();

  /**
   * Gets a count that rises whenever the entries change, to read them reactively.
   */
  public readonly revision: Signal<number> = this.revisionState.asReadonly();

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
    this.log.info('Output', 'Revealed output channel', id);
  }

  /**
   * Shows a channel: makes it the active one and asks the active workspace to bring its Logs panel
   * forward. For a user's explicit request — a producer writing to a channel never shows it unasked.
   * @param id The channel identifier.
   */
  public show(id: string): void {
    this.setActive(id);
    this.showCount.update((count: number): number => count + 1);
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
   * Appends text to a channel, notifying its listeners. The retained buffer is capped: a chatty
   * long-lived source (a language server's log stream) would otherwise grow it without bound for the
   * life of the workspace, so once past the cap the oldest half is dropped at a line boundary.
   * @param id The channel identifier.
   * @param text The text to append.
   * @param level How severe its lines are; `info` when not said.
   */
  public appendTo(id: string, text: string, level: Severity = 'info'): void {
    const state: ChannelState = this.ensure(id, id);
    this.record(state, text, level);
    this.write(state, text);
  }

  /**
   * Appends one whole line to a channel: one entry, however many lines its text spans (a server's
   * message often does).
   * @param id The channel.
   * @param text The line.
   * @param level How severe it is.
   */
  public appendLineTo(id: string, text: string, level: Severity = 'info'): void {
    const state: ChannelState = this.ensure(id, id);
    // A piece still waiting for its line end is finished first, so the order holds.
    if (state.partial.length > 0) {
      this.addEntry(state, state.partial, level);
      state.partial = '';
    }
    this.addEntry(state, text.replace(/\r\n?/g, '\n'), level);
    this.bump();
    this.write(state, `${text}\r\n`);
  }

  /**
   * Gets the entries of one channel, or of every channel in the order they were written.
   * @param id The channel, or null for all of them.
   * @returns Returns the entries, oldest first.
   */
  public entriesOf(id: string | null): readonly OutputEntry[] {
    if (id !== null) {
      return this.channelStates.get(id)?.entries ?? [];
    }
    return [...this.channelStates.values()]
      .flatMap((state: ChannelState): readonly OutputEntry[] => state.entries)
      .sort((a: OutputEntry, b: OutputEntry): number => a.id - b.id);
  }

  /**
   * Adds a channel's text to its buffer and tells the listeners.
   * @param state The channel.
   * @param text The text.
   */
  private write(state: ChannelState, text: string): void {
    state.buffer += text;
    if (state.buffer.length > MAX_CHANNEL_BUFFER_LENGTH) {
      const keepFrom: number = state.buffer.length - Math.floor(MAX_CHANNEL_BUFFER_LENGTH / 2);
      const lineStart: number = state.buffer.indexOf('\n', keepFrom);
      state.buffer = state.buffer.slice(lineStart === -1 ? keepFrom : lineStart + 1);
    }
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
    state.entries = [];
    state.partial = '';
    this.bump();
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
    this.appendLineTo(DEFAULT_CHANNEL, text);
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
   * Turns text written in pieces into entries: each complete line one entry, the unfinished end kept
   * until the rest of its line arrives. Blank lines are left out of the table.
   * @param state The channel.
   * @param text The text.
   * @param level How severe it is.
   */
  private record(state: ChannelState, text: string, level: Severity): void {
    const lines: string[] = `${state.partial}${text}`.split(/\r?\n/);
    state.partial = lines.pop() ?? '';
    let added: boolean = false;
    for (const line of lines) {
      added = this.addEntry(state, line, level) || added;
    }
    if (added) {
      this.bump();
    }
  }

  /**
   * Adds one entry, dropping the oldest past the number of lines the user keeps.
   * @param state The channel.
   * @param text The entry's text.
   * @param level How severe it is.
   * @returns Returns true when an entry was added (blank text adds none).
   */
  private addEntry(state: ChannelState, text: string, level: Severity): boolean {
    const clean: string = text.replace(ESCAPES, '').replace(/\r/g, '').trimEnd();
    if (clean.trim().length === 0) {
      return false;
    }
    state.entries.push({
      id: this.nextEntryId++,
      time: Date.now(),
      level,
      channelId: state.info.id,
      text: clean,
    });
    const keep: number = Math.max(this.settings.get('workspaces.outputScrollbackLines'), 100);
    if (state.entries.length > keep) {
      state.entries.splice(0, state.entries.length - keep);
    }
    return true;
  }

  /**
   * Tells readers of the entries that they changed.
   */
  private bump(): void {
    this.revisionState.update((revision: number): number => revision + 1);
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
        entries: [],
        partial: '',
      };
      this.channelStates.set(id, state);
      this.channelList.set([...this.channelStates.values()].map((each: ChannelState) => each.info));
      this.log.trace('Output', 'Created output channel', id, label);
    }
    return state;
  }
}
