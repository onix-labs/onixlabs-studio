import { CatalogModel, CatalogQuery } from '@shared/api/model-catalog-types';
import { CURATED_MODELS, CuratedEntry, curatedToModel } from './curated-models';
import { ModelCatalogSource } from './model-catalog';

/**
 * The curated catalogue source: Studio's own list of well-known Ollama-library models.
 *
 * Entirely offline — it is a bundled list — which is what makes the manager useful with no network,
 * and why it is queried first. An empty search returns the whole list, so the view opens on something
 * browsable instead of an empty box.
 */
export class CuratedCatalogSource implements ModelCatalogSource {
  /**
   * The stable source identifier.
   */
  public readonly id: string = 'curated';

  /**
   * The entries this source offers.
   */
  private readonly entries: readonly CuratedEntry[];

  /**
   * Initializes a new instance of the {@link CuratedCatalogSource} class.
   * @param entries The entries to offer; defaults to the bundled curated list.
   */
  public constructor(entries: readonly CuratedEntry[] = CURATED_MODELS) {
    this.entries = entries;
  }

  /**
   * Searches the curated list by name, reference and description.
   * @param query The query to run.
   * @returns Returns the matching models.
   */
  public search(query: CatalogQuery): Promise<CatalogModel[]> {
    const needle: string = query.text.trim().toLowerCase();
    const matched: readonly CuratedEntry[] =
      needle.length === 0
        ? this.entries
        : this.entries.filter((entry: CuratedEntry): boolean =>
            `${entry.name} ${entry.ref} ${entry.description}`.toLowerCase().includes(needle),
          );
    return Promise.resolve(matched.slice(0, query.limit).map(curatedToModel));
  }
}
