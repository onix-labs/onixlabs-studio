import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * The AI Manager's library sections: the ones listing things the user writes.
 */
export type AiLibrarySection = 'persona' | 'skills';

/**
 * What a library section does for the ribbon. Mirrors the Model Manager's handler: the section
 * registers while it is shown, and the ribbon's buttons call through it, because what a new entry is
 * and which one is then selected belong to the section.
 */
export interface AiLibraryCommandHandler {
  /**
   * Starts a new entry and selects it.
   */
  add(): void;

  /**
   * Starts a new core entry and selects it, in a section that has a core (the persona).
   */
  addCore?(): void;

  /**
   * Imports an entry from disk, when the section supports it.
   */
  importFrom?(): void;
}

/**
 * The registry the AI Manager ribbon calls the shown library section through.
 */
@Service()
export class AiLibraryCommands {
  /**
   * Holds the shown section's handler, keyed by section.
   */
  private readonly handlers: WritableSignal<
    ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler>
  > = signal<ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler>>(new Map());

  /**
   * Gets the sections that have registered a handler.
   */
  public readonly registered: Signal<ReadonlySet<AiLibrarySection>> = computed(
    (): ReadonlySet<AiLibrarySection> => new Set<AiLibrarySection>(this.handlers().keys()),
  );

  /**
   * Registers a section's handler.
   * @param section The section.
   * @param handler The handler.
   */
  public register(section: AiLibrarySection, handler: AiLibraryCommandHandler): void {
    this.handlers.update(
      (
        current: ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler>,
      ): ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler> =>
        new Map<AiLibrarySection, AiLibraryCommandHandler>(current).set(section, handler),
    );
  }

  /**
   * Clears a section's handler, if it is still the one registered.
   * @param section The section.
   * @param handler The handler.
   */
  public unregister(section: AiLibrarySection, handler: AiLibraryCommandHandler): void {
    if (this.handlers().get(section) !== handler) {
      return;
    }
    this.handlers.update(
      (
        current: ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler>,
      ): ReadonlyMap<AiLibrarySection, AiLibraryCommandHandler> => {
        const next: Map<AiLibrarySection, AiLibraryCommandHandler> = new Map<
          AiLibrarySection,
          AiLibraryCommandHandler
        >(current);
        next.delete(section);
        return next;
      },
    );
  }

  /**
   * Starts a new entry in a section.
   * @param section The section.
   */
  public add(section: AiLibrarySection): void {
    this.handlers().get(section)?.add();
  }

  /**
   * Starts a new core entry in a section that has a core.
   * @param section The section.
   */
  public addCore(section: AiLibrarySection): void {
    this.handlers().get(section)?.addCore?.();
  }

  /**
   * Imports an entry into a section.
   * @param section The section.
   */
  public importFrom(section: AiLibrarySection): void {
    this.handlers().get(section)?.importFrom?.();
  }
}
