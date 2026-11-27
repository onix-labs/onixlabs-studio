import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Says whether an editor takes the keyboard when its pane becomes the active one.
 *
 * An editor focuses itself as its pane is activated, which is right when the user opened the document
 * to work in it — and wrong when they only clicked a file to look at it, with the keyboard still in the
 * explorer they are moving through. The editors ask here before focusing. The instance every editor
 * finds by default always says yes; a host that knows better — a document panel, for a document shown
 * as a preview — provides its own and tells it what to follow.
 */
@Service()
export class ActivationFocus {
  /**
   * Holds what decides the answer; yes, until a host says what to follow.
   */
  private readonly source: WritableSignal<() => boolean> = signal<() => boolean>(
    (): boolean => true,
  );

  /**
   * Gets whether an editor may take the keyboard as its pane becomes active.
   */
  public readonly allowed: Signal<boolean> = computed((): boolean => this.source()());

  /**
   * Sets what decides the answer.
   * @param source Reads whether focus may be taken; signals read in it are followed.
   */
  public follow(source: () => boolean): void {
    this.source.set(source);
  }
}
