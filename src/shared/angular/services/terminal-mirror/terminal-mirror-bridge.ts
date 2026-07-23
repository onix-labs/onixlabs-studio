import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  MirrorAction,
  MirrorState,
  parseMirrorAction,
  TerminalMirrorChannel,
} from '@shared/api/terminal-mirror-channels';

/**
 * The renderer-side client of the terminal-mirror relay, used from both ends: the main window (the
 * owner) publishes state and listens for pop-out readiness and actions; a pop-out window (the
 * viewer) announces readiness, receives state, and sends strip actions. Outside Electron every
 * operation degrades to a safe no-op.
 */
@Service()
export class TerminalMirrorBridge {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Publishes the owner's session state to a pop-out window (owner side).
   * @param popoutId The pop-out's window identifier.
   * @param state The state to publish.
   */
  public publish(popoutId: number, state: MirrorState): void {
    this.bridge?.send(TerminalMirrorChannel.Publish, popoutId, state);
  }

  /**
   * Subscribes to pop-out readiness announcements (owner side).
   * @param listener Receives the ready pop-out's window identifier.
   * @returns Returns a function that removes the listener.
   */
  public onReady(listener: (popoutId: number) => void): () => void {
    return (
      this.bridge?.on(TerminalMirrorChannel.Ready, (...args: unknown[]): void => {
        if (typeof args[0] === 'number') {
          listener(args[0]);
        }
      }) ?? ((): void => undefined)
    );
  }

  /**
   * Subscribes to strip actions relayed from pop-out mirrors (owner side). Malformed actions are
   * dropped before the listener sees them.
   * @param listener Receives the acting pop-out's window identifier and the action.
   * @returns Returns a function that removes the listener.
   */
  public onAction(listener: (popoutId: number, action: MirrorAction) => void): () => void {
    return (
      this.bridge?.on(TerminalMirrorChannel.Action, (...args: unknown[]): void => {
        const action: MirrorAction | null = parseMirrorAction(args[1]);
        if (typeof args[0] === 'number' && action !== null) {
          listener(args[0], action);
        }
      }) ?? ((): void => undefined)
    );
  }

  /**
   * Announces that this pop-out window's mirror is listening (viewer side), prompting the owner to
   * publish its current state.
   */
  public ready(): void {
    this.bridge?.send(TerminalMirrorChannel.Ready);
  }

  /**
   * Sends a strip action to the owner (viewer side).
   * @param action The action to request.
   */
  public sendAction(action: MirrorAction): void {
    this.bridge?.send(TerminalMirrorChannel.Action, action);
  }

  /**
   * Subscribes to owner state (viewer side).
   * @param listener Receives the mirrored state.
   * @returns Returns a function that removes the listener.
   */
  public onState(listener: (state: MirrorState) => void): () => void {
    return (
      this.bridge?.on(TerminalMirrorChannel.State, (...args: unknown[]): void => {
        const state: unknown = args[0];
        if (typeof state === 'object' && state !== null && Array.isArray((state as MirrorState).sessions)) {
          listener(state as MirrorState);
        }
      }) ?? ((): void => undefined)
    );
  }
}
