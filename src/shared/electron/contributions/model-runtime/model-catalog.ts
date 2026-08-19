import { CatalogModel, CatalogQuery, CatalogResult } from '@shared/api/model-catalog-types';
import { logger } from '../../logger';

/**
 * How many results a source returns when the query does not say.
 */
const DEFAULT_LIMIT: number = 25;

/**
 * One place catalogue entries come from. Deliberately parallel to the package-management registries
 * (`npm-registry.ts`, `nuget-registry.ts`): a provider per source, resolved through
 * {@link ModelCatalog} so callers never hard-code one.
 */
export interface ModelCatalogSource {
  /**
   * Gets the stable source identifier, reported in {@link CatalogResult.failedSources}.
   */
  readonly id: string;

  /**
   * Searches this source.
   * @param query The query to run.
   * @param signal Abandons the search when signalled.
   * @returns Returns the matching models.
   */
  search(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogModel[]>;
}

/**
 * The model catalogue: the *available* half of the manager's installed-vs-available split, assembled
 * from one or more {@link ModelCatalogSource}s.
 *
 * Sources are queried concurrently and failures are isolated: one source being unreachable degrades
 * the result rather than emptying it, and is named in {@link CatalogResult.failedSources} so the view
 * can say the list is partial. That matters because the curated source works offline and the Hugging
 * Face one does not — losing the network should not leave the user with nothing.
 */
export class ModelCatalog {
  /**
   * The sources queried, in priority order — earlier sources win a tie when the same ref appears twice.
   */
  private readonly sources: readonly ModelCatalogSource[];

  /**
   * Initializes a new instance of the {@link ModelCatalog} class.
   * @param sources The sources to query, in priority order.
   */
  public constructor(sources: readonly ModelCatalogSource[]) {
    this.sources = sources;
  }

  /**
   * Searches every source and merges the results.
   * @param query The query to run.
   * @param signal Abandons the search when signalled.
   * @returns Returns the merged result.
   */
  public async search(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogResult> {
    const limit: number = query.limit ?? DEFAULT_LIMIT;
    const settled: PromiseSettledResult<CatalogModel[]>[] = await Promise.allSettled(
      this.sources.map(
        (source: ModelCatalogSource): Promise<CatalogModel[]> =>
          source.search({ ...query, limit }, signal),
      ),
    );

    const found: CatalogModel[] = [];
    const failedSources: string[] = [];
    settled.forEach((result: PromiseSettledResult<CatalogModel[]>, index: number): void => {
      const source: ModelCatalogSource | undefined = this.sources[index];
      if (result.status === 'fulfilled') {
        found.push(...result.value);
        return;
      }
      logger.warn(
        'ModelCatalog',
        `Source '${source?.id ?? index}' failed; returning partial results`,
        result.reason,
      );
      failedSources.push(source?.id ?? String(index));
    });

    return { models: dedupe(found), failedSources };
  }
}

/**
 * Removes duplicate refs, keeping the first occurrence — so a model in the curated list is not also
 * shown as a raw Hugging Face repo. Exported for unit testing.
 * @param models The models to deduplicate, in priority order.
 * @returns Returns the deduplicated models, order preserved.
 */
export function dedupe(models: readonly CatalogModel[]): CatalogModel[] {
  const seen: Set<string> = new Set<string>();
  const kept: CatalogModel[] = [];
  for (const model of models) {
    const key: string = model.ref.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(model);
  }
  return kept;
}
