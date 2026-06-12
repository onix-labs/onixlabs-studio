import { Service } from '@angular/core';

/**
 * Represents the application's shared Output channel: a write-only, append-only log that the Output
 * panel renders. Producers (such as opening files or, later, build and run tasks) push text here;
 * the panel replays the accumulated buffer when it mounts and writes subsequent chunks live. Carries
 * raw text, including ANSI escape sequences, so colour is preserved by the terminal renderer.
 */
@Service()
export class Output {
  /**
   * Holds the accumulated output, replayed to a panel that mounts after writes have occurred.
   */
  private buffer: string = '';

  /**
   * Holds the listeners notified with each appended chunk.
   */
  private readonly writeListeners: Set<(chunk: string) => void> = new Set<
    (chunk: string) => void
  >();

  /**
   * Holds the listeners notified when the channel is cleared.
   */
  private readonly clearListeners: Set<() => void> = new Set<() => void>();

  /**
   * Appends text to the channel, notifying listeners with the chunk.
   * @param text The text to append (may contain ANSI escape sequences).
   */
  public append(text: string): void {
    this.buffer += text;
    for (const listener of this.writeListeners) {
      listener(text);
    }
  }

  /**
   * Appends a line of text, terminated with a carriage return and line feed for the terminal.
   * @param text The line to append.
   */
  public appendLine(text: string): void {
    this.append(`${text}\r\n`);
  }

  /**
   * Clears the channel, emptying the buffer and notifying listeners.
   */
  public clear(): void {
    this.buffer = '';
    for (const listener of this.clearListeners) {
      listener();
    }
  }

  /**
   * Gets the accumulated buffer, used to replay history into a freshly-mounted panel.
   * @returns Returns the accumulated output.
   */
  public snapshot(): string {
    return this.buffer;
  }

  /**
   * Subscribes to appended chunks.
   * @param listener Receives each appended chunk.
   * @returns Returns a function that removes the listener.
   */
  public onWrite(listener: (chunk: string) => void): () => void {
    this.writeListeners.add(listener);
    return (): void => {
      this.writeListeners.delete(listener);
    };
  }

  /**
   * Subscribes to clear events.
   * @param listener Invoked when the channel is cleared.
   * @returns Returns a function that removes the listener.
   */
  public onClear(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return (): void => {
      this.clearListeners.delete(listener);
    };
  }
}
