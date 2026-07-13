import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * A reusable prompt in the user's library, offered by the composer's `/` popup: picking it inserts
 * its text into the draft.
 */
export interface AgentPrompt {
  /**
   * Gets the prompt's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the name the prompt is invoked by (shown as `/name` in the popup).
   */
  readonly name: string;

  /**
   * Gets the prompt text inserted into the composer.
   */
  readonly text: string;
}

/**
 * The persistence key the library is stored under.
 */
const STORE_KEY: string = 'agent.prompts';

/**
 * Owns the user's reusable-prompt library: named prompt texts offered by the composer's `/` popup
 * alongside the built-in commands, persisted through the shared settings store so they survive
 * restarts.
 */
@Service()
export class AgentPrompts {
  /**
   * Holds the settings store the library persists through.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the library, seeded from the store.
   */
  private readonly promptsState: WritableSignal<readonly AgentPrompt[]> = signal<
    readonly AgentPrompt[]
  >(this.load());

  /**
   * Gets the library, in saved order.
   */
  public readonly prompts: Signal<readonly AgentPrompt[]> = this.promptsState.asReadonly();

  /**
   * Saves a prompt. A name that already exists is overwritten (names are the invocation key), and
   * names are normalised to a slug so they type cleanly after `/`.
   * @param name The name to invoke the prompt by.
   * @param text The prompt text.
   * @returns Returns true when saved; false when the name or text is blank.
   */
  public save(name: string, text: string): boolean {
    const slug: string = this.slugify(name);
    const trimmed: string = text.trim();
    if (slug.length === 0 || trimmed.length === 0) {
      return false;
    }
    this.promptsState.update((prompts: readonly AgentPrompt[]): readonly AgentPrompt[] => {
      const existing: AgentPrompt | undefined = prompts.find(
        (prompt: AgentPrompt): boolean => prompt.name === slug,
      );
      if (existing !== undefined) {
        return prompts.map(
          (prompt: AgentPrompt): AgentPrompt =>
            prompt.name === slug ? { ...prompt, text: trimmed } : prompt,
        );
      }
      return [...prompts, { id: crypto.randomUUID(), name: slug, text: trimmed }];
    });
    this.persist();
    return true;
  }

  /**
   * Deletes a prompt from the library.
   * @param id The prompt's identifier.
   */
  public delete(id: string): void {
    this.promptsState.update((prompts: readonly AgentPrompt[]): readonly AgentPrompt[] =>
      prompts.filter((prompt: AgentPrompt): boolean => prompt.id !== id),
    );
    this.persist();
  }

  /**
   * Normalises a prompt name to a slug that types cleanly after `/`: lower-case, with runs of
   * non-alphanumerics collapsed to single hyphens.
   * @param name The raw name.
   * @returns Returns the slug (possibly empty).
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Loads the library from the store, dropping malformed entries.
   * @returns Returns the persisted prompts.
   */
  private load(): readonly AgentPrompt[] {
    const raw: readonly unknown[] = this.store.get<readonly unknown[]>(STORE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry: unknown): entry is AgentPrompt => {
      if (entry === null || typeof entry !== 'object') {
        return false;
      }
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      return (
        typeof record['id'] === 'string' &&
        typeof record['name'] === 'string' &&
        record['name'].length > 0 &&
        typeof record['text'] === 'string' &&
        record['text'].length > 0
      );
    });
  }

  /**
   * Persists the library through the store.
   */
  private persist(): void {
    this.store.set(STORE_KEY, this.promptsState());
  }
}
