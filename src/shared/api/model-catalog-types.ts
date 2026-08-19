/**
 * The model-catalogue payload contract shared between the main-process backend and the renderer. The
 * catalogue is the *available* half of the manager's installed-vs-available split: models the user
 * could pull, as opposed to the ones already on disk.
 */

/**
 * Where a catalogue entry came from.
 *
 * `curated` is Studio's own hand-checked list of well-known Ollama-library models — the names users
 * recognise, with sensible default quantisations. `huggingface` is the long tail, searched live on the
 * Hugging Face Hub. Ollama's library has no public search API, which is why the recognisable models
 * are a curated list rather than a query.
 */
export type CatalogSource = 'curated' | 'huggingface';

/**
 * Roughly what a model is for, used to group the curated list. Hugging Face results are not
 * classified — the Hub's tags do not map onto this cleanly enough to be worth guessing.
 */
export type CatalogCategory =
  | 'general'
  | 'coding'
  | 'reasoning'
  | 'vision'
  | 'embedding'
  | 'small'
  | 'other';

/**
 * One model the user could install.
 */
export interface CatalogModel {
  /**
   * The reference to pull, exactly as the runtime expects it — `llama3.2:3b` for a library model, or
   * `hf.co/{user}/{repo}` for a Hugging Face one. This is passed to the pull unchanged, so the
   * catalogue never has to be understood by the code that installs.
   */
  readonly ref: string;

  /**
   * The human-readable name.
   */
  readonly name: string;

  /**
   * Which source the entry came from.
   */
  readonly source: CatalogSource;

  /**
   * Roughly what the model is for.
   */
  readonly category: CatalogCategory;

  /**
   * A one-line description, or an empty string when the source offers none.
   */
  readonly description: string;

  /**
   * The human-readable parameter count (for example `3.2B`), or an empty string when unknown.
   */
  readonly parameterSize: string;

  /**
   * The download size in bytes, or 0 when the source does not report one. Hugging Face entries
   * generally do not, because the size depends on which quantisation is pulled.
   */
  readonly sizeBytes: number;

  /**
   * How many times the model has been downloaded, or 0 when unreported. Used to rank Hugging Face
   * results, where popularity is the only quality signal available.
   */
  readonly downloads: number;

  /**
   * A page describing the model, or an empty string when there is none.
   */
  readonly url: string;
}

/**
 * A catalogue query.
 */
export interface CatalogQuery {
  /**
   * The free-text search. Empty returns the curated list as a browsable default, rather than nothing:
   * the manager opens on something useful instead of an empty search box.
   */
  readonly text: string;

  /**
   * The most results to return per source.
   */
  readonly limit?: number;
}

/**
 * A catalogue query's outcome. Sources are reported individually because one failing (the Hub being
 * unreachable, say) must not discard the results of the other — the curated list works offline.
 */
export interface CatalogResult {
  /**
   * The models found, best first.
   */
  readonly models: readonly CatalogModel[];

  /**
   * The ids of sources that failed, so the view can say the results are partial rather than silently
   * showing fewer.
   */
  readonly failedSources: readonly string[];
}
