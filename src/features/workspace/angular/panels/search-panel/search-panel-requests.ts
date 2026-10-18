import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { FindRequest } from '@shared/angular/components/find-panel/find-request';

/**
 * A find request on its way to the Search panel, with what had to be read when it was made.
 */
export interface SearchPanelRequest {
  /**
   * Gets the request.
   */
  readonly request: FindRequest;

  /**
   * Gets whether it was made from a diff of the file rather than the file's own editor — read when it
   * was made, as focus moves to the panel straight after.
   */
  readonly fromDiff: boolean;
}

/**
 * Carries find requests from a workspace to its Search panel (#1007).
 *
 * The workspace reveals the panel and posts the request here; the panel takes it when it is ready —
 * at once when it is already open, or as soon as revealing it has created it. Taking it clears it, so
 * a panel closed and opened again later does not replay a find nobody asked for twice. Provided per
 * workspace view, beside the panel's other per-view services.
 */
@Service()
export class SearchPanelRequests {
  /**
   * Holds the request waiting for the panel, or null when there is none.
   */
  private readonly pendingState: WritableSignal<SearchPanelRequest | null> =
    signal<SearchPanelRequest | null>(null);

  /**
   * Gets the request waiting for the panel, or null when there is none.
   */
  public readonly pending: Signal<SearchPanelRequest | null> = this.pendingState.asReadonly();

  /**
   * Posts a request for the panel, replacing any it has not taken yet.
   * @param request The request.
   * @param fromDiff Whether it was made from a diff of the file.
   */
  public post(request: FindRequest, fromDiff: boolean): void {
    this.pendingState.set({ request, fromDiff });
  }

  /**
   * Takes the waiting request, clearing it.
   * @returns Returns the request, or null when there was none.
   */
  public take(): SearchPanelRequest | null {
    const pending: SearchPanelRequest | null = this.pendingState();
    this.pendingState.set(null);
    return pending;
  }
}
