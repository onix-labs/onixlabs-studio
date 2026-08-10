import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import {
  UNSAVED_WORK,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';

/**
 * The set of unsaved-work sources the close flows walk. It merges the always-present static
 * contributions (the root text documents, the binary editor — registered through
 * {@link import('./unsaved-work').provideUnsavedWork}) with view-scoped sources that register
 * themselves at runtime.
 *
 * A workspace tab's document well is backed by a per-view
 * {@link import('../documents/documents').Documents} instance the root injector cannot see through the
 * static {@link UNSAVED_WORK} multi-provider. It registers here for its lifetime instead — without
 * which closing the tab (or the window) would silently discard its unsaved well documents.
 */
@Service()
export class UnsavedWorkRegistry {
  /**
   * Holds the always-present sources contributed through the static multi-provider.
   */
  private readonly staticSources: readonly UnsavedWorkSource[] =
    inject(UNSAVED_WORK, { optional: true }) ?? [];

  /**
   * Holds the view-scoped sources registered at runtime, in registration order.
   */
  private readonly dynamicSources: Set<UnsavedWorkSource> = new Set<UnsavedWorkSource>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers a view-scoped source for its lifetime, so the close flows include its unsaved work.
   * @param source The source to include.
   * @returns Returns a function that unregisters it.
   */
  public register(source: UnsavedWorkSource): () => void {
    this.dynamicSources.add(source);
    this.log.trace('UnsavedWorkRegistry', 'Registered unsaved-work source', this.dynamicSources.size);
    return (): void => {
      this.dynamicSources.delete(source);
      this.log.trace(
        'UnsavedWorkRegistry',
        'Unregistered unsaved-work source',
        this.dynamicSources.size,
      );
    };
  }

  /**
   * Gets every unsaved-work source to walk: the static contributions first, then the registered
   * view-scoped ones.
   * @returns Returns the sources in walk order.
   */
  public sources(): readonly UnsavedWorkSource[] {
    return [...this.staticSources, ...this.dynamicSources];
  }
}
