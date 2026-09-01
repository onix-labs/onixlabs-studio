import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * A saved one-line reply, offered by the composer's quick-response menu: picking it answers the agent
 * without typing the same few words again.
 */
export interface QuickResponse {
  /**
   * Gets the response's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the reply text, always a single line.
   */
  readonly text: string;
}

/**
 * The persistence key the list is stored under.
 */
const STORE_KEY: string = 'agent.quickResponses';

/**
 * Owns the user's quick responses: short replies to an agent, kept in the order the user arranged
 * them — new ones land at the end until dragged elsewhere — and persisted through the shared settings
 * store so both the list and its order survive a restart.
 *
 * A response is one line by design. It is picked from a menu that never wraps, and a saved paragraph
 * would be neither quick to read there nor distinguishable from the prompt library, which is where
 * longer reusable text belongs.
 */
@Service()
export class AgentQuickResponses {
  /**
   * Holds the settings store the list persists through.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the list, seeded from the store.
   */
  private readonly responsesState: WritableSignal<readonly QuickResponse[]> = signal<
    readonly QuickResponse[]
  >(this.load());

  /**
   * Gets the responses, in saved order.
   */
  public readonly responses: Signal<readonly QuickResponse[]> = this.responsesState.asReadonly();

  /**
   * Adds a response to the end of the list. The text is flattened to a single line, and a response
   * that repeats one already saved is refused rather than duplicated — the menu is picked from by
   * sight, so two identical rows would be a choice between the same thing twice.
   * @param text The reply text.
   * @returns Returns true when added; false when the text is blank or already saved.
   */
  public add(text: string): boolean {
    const line: string = AgentQuickResponses.flatten(text);
    if (line.length === 0) {
      return false;
    }
    if (this.responsesState().some((response: QuickResponse): boolean => response.text === line)) {
      return false;
    }
    this.responsesState.update((responses: readonly QuickResponse[]): readonly QuickResponse[] => [
      ...responses,
      { id: crypto.randomUUID(), text: line },
    ]);
    this.persist();
    this.log.info('AgentQuickResponses', 'Quick response added');
    return true;
  }

  /**
   * Deletes a response from the list.
   * @param id The response's identifier.
   */
  public remove(id: string): void {
    this.responsesState.update((responses: readonly QuickResponse[]): readonly QuickResponse[] =>
      responses.filter((response: QuickResponse): boolean => response.id !== id),
    );
    this.persist();
    this.log.info('AgentQuickResponses', 'Quick response deleted', id);
  }

  /**
   * Moves the response identified by {@link sourceId} to the position of the one identified by
   * {@link targetId}, preserving the order of the others. The menu is picked from by sight, so the
   * replies used most belong where they can be reached without reading the whole list — which is a
   * judgement only the user can make. A no-op when either id is unknown or the two are the same.
   * @param sourceId The id of the response being moved.
   * @param targetId The id of the response whose position it should take.
   */
  public reorder(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      return;
    }
    const current: readonly QuickResponse[] = this.responsesState();
    const from: number = current.findIndex(
      (response: QuickResponse): boolean => response.id === sourceId,
    );
    const to: number = current.findIndex(
      (response: QuickResponse): boolean => response.id === targetId,
    );
    if (from < 0 || to < 0) {
      return;
    }
    const next: QuickResponse[] = [...current];
    const [moved]: QuickResponse[] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.responsesState.set(next);
    this.persist();
    this.log.info('AgentQuickResponses', 'Quick response reordered', sourceId);
  }

  /**
   * Flattens text to the single line a quick response is: runs of whitespace — newlines included —
   * collapse to one space, and the ends are trimmed.
   * @param text The raw text.
   * @returns Returns the single line (possibly empty).
   */
  private static flatten(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Loads the list from the store, dropping malformed entries. Nothing is stocked in advance: the
   * replies worth keeping are the ones a person actually types, so the list starts empty and the menu
   * says so.
   * @returns Returns the persisted responses.
   */
  private load(): readonly QuickResponse[] {
    const raw: readonly unknown[] = this.store.get<readonly unknown[]>(STORE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry: unknown): entry is QuickResponse => {
      if (entry === null || typeof entry !== 'object') {
        return false;
      }
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      return (
        typeof record['id'] === 'string' &&
        typeof record['text'] === 'string' &&
        record['text'].length > 0
      );
    });
  }

  /**
   * Persists the list through the store.
   */
  private persist(): void {
    this.store.set(STORE_KEY, this.responsesState());
  }
}
