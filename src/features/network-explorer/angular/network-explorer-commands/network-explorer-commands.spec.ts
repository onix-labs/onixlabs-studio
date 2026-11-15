import { signal, Signal, WritableSignal } from '@angular/core';
import {
  NetworkExplorerCommandHandler,
  NetworkExplorerCommands,
} from './network-explorer-commands';

/**
 * A handler that records what it was asked to do.
 */
class RecordingHandler implements NetworkExplorerCommandHandler {
  /**
   * Gets the commands received, in order.
   */
  public readonly calls: string[] = [];

  /**
   * Holds whether idle interfaces are listed.
   */
  private readonly idle: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether idle interfaces are listed.
   */
  public readonly showIdleInterfaces: Signal<boolean> = this.idle.asReadonly();

  /**
   * Gets whether loopback connections are listed.
   */
  public readonly showLoopback: Signal<boolean> = signal<boolean>(true).asReadonly();

  /**
   * Records a refresh.
   */
  public refresh(): void {
    this.calls.push('refresh');
  }

  /**
   * Flips the idle interfaces and records it.
   */
  public toggleIdleInterfaces(): void {
    this.idle.update((shown: boolean): boolean => !shown);
    this.calls.push('idle');
  }

  /**
   * Records a loopback toggle.
   */
  public toggleLoopback(): void {
    this.calls.push('loopback');
  }

  /**
   * Records opening a capture.
   * @returns Returns a resolved promise.
   */
  public openCapture(): Promise<void> {
    this.calls.push('open');
    return Promise.resolve();
  }
}

describe('NetworkExplorerCommands', () => {
  it('forwardsToTheRegisteredHandler_andReadsItsState', () => {
    const commands: NetworkExplorerCommands = new NetworkExplorerCommands();
    const handler: RecordingHandler = new RecordingHandler();
    commands.register(handler);

    commands.refresh();
    commands.toggleIdleInterfaces();
    commands.toggleLoopback();
    commands.openCapture();

    expect(handler.calls).toEqual(['refresh', 'idle', 'loopback', 'open']);
    expect(commands.showIdleInterfaces()).toBe(true);
    expect(commands.showLoopback()).toBe(true);
  });

  it('doesNothing_withNoHandler', () => {
    const commands: NetworkExplorerCommands = new NetworkExplorerCommands();

    commands.refresh();

    expect(commands.showLoopback()).toBe(false);
  });

  it('clear_ignoresAStaleHandler', () => {
    const commands: NetworkExplorerCommands = new NetworkExplorerCommands();
    const first: RecordingHandler = new RecordingHandler();
    const second: RecordingHandler = new RecordingHandler();
    commands.register(first);
    commands.register(second);

    commands.clear(first);
    commands.refresh();

    expect(second.calls).toEqual(['refresh']);
  });
});
