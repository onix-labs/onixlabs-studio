import { CatalogModel, CatalogQuery } from '@shared/api/model-catalog-types';
import { ModelCatalogSource } from './model-catalog';

/**
 * The Hub's model-search endpoint. Public and unauthenticated for public models, so the catalogue
 * needs no credentials.
 */
const HUB_SEARCH: string = 'https://huggingface.co/api/models';

/**
 * The raw model shape the Hub's search returns. It carries no file list, so no quantisation — which is
 * why the pull reference omits a tag and lets the runtime pick its default.
 */
interface RawHubModel {
  readonly id?: string;
  readonly downloads?: number;
  readonly likes?: number;
  readonly gated?: boolean | string;
  readonly tags?: readonly string[];
}

/**
 * A minimal response shape, so this source does not depend on DOM or Node fetch types.
 */
export interface HubResponse {
  /**
   * Whether the status is in the success range.
   */
  readonly ok: boolean;

  /**
   * The HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the body as parsed JSON.
   * @returns Returns the parsed body.
   */
  json(): Promise<unknown>;
}

/**
 * A minimal fetch signature, injected so the source is testable without a network. Mirrors the seam
 * the package-management registries use.
 */
export type HubFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<HubResponse>;

/**
 * The Hugging Face catalogue source: the long tail of GGUF models, searched live on the Hub.
 *
 * Ollama can pull straight from the Hub with an `hf.co/{user}/{repo}` reference, so a result here is
 * installable with no extra machinery. The reference deliberately carries **no quantisation tag** —
 * the search endpoint does not list a repo's files, and fetching them would cost one request per
 * result; omitting the tag lets Ollama pick its own default rather than having Studio guess one.
 *
 * Gated repositories are dropped: they need Hub credentials Studio does not hold, so offering them
 * would produce a pull that fails with an authorisation error the user cannot act on from here.
 */
export class HuggingFaceCatalogSource implements ModelCatalogSource {
  /**
   * The stable source identifier.
   */
  public readonly id: string = 'huggingface';

  /**
   * The fetch used to query the Hub.
   */
  private readonly http: HubFetch;

  /**
   * Initializes a new instance of the {@link HuggingFaceCatalogSource} class.
   * @param http The fetch to query with.
   */
  public constructor(http: HubFetch) {
    this.http = http;
  }

  /**
   * Searches the Hub for GGUF models.
   * @param query The query to run.
   * @param signal Abandons the search when signalled.
   * @returns Returns the matching models.
   */
  public async search(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogModel[]> {
    const text: string = query.text.trim();
    // With no search text the Hub would return its most-downloaded GGUF repos, which are enormous
    // quantisations of models the curated list already covers. The curated list is the better default,
    // so this source stays quiet until the user actually searches.
    if (text.length === 0) {
      return [];
    }

    const url: string = `${HUB_SEARCH}?${new URLSearchParams({
      filter: 'gguf',
      search: text,
      sort: 'downloads',
      direction: '-1',
      limit: String(query.limit ?? 25),
    }).toString()}`;

    const response: HubResponse = await this.http(url, { signal });
    if (!response.ok) {
      throw new Error(`Hugging Face search failed: ${response.status}`);
    }

    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) {
      throw new Error('Hugging Face search returned an unexpected body');
    }

    return (raw as RawHubModel[])
      .filter((model: RawHubModel): boolean => typeof model.id === 'string' && model.id.length > 0)
      .filter((model: RawHubModel): boolean => !isGated(model))
      .map((model: RawHubModel): CatalogModel => toCatalogModel(model));
  }
}

/**
 * Whether a repo is gated, and so needs Hub credentials to download. The Hub reports this as `false`
 * or as a string naming the gate kind (`auto`, `manual`). Exported for unit testing.
 * @param model The raw model.
 * @returns Returns true when the repo is gated.
 */
export function isGated(model: { readonly gated?: boolean | string }): boolean {
  return model.gated !== undefined && model.gated !== false;
}

/**
 * Adapts one raw Hub model to the shared catalogue shape.
 * @param model The raw model.
 * @returns Returns the catalogue model.
 */
function toCatalogModel(model: RawHubModel): CatalogModel {
  const id: string = model.id ?? '';
  return {
    ref: `hf.co/${id}`,
    name: id,
    source: 'huggingface',
    // The Hub's tags do not map onto the curated categories cleanly enough to guess from.
    category: 'other',
    description: '',
    parameterSize: parameterSizeFromId(id),
    // The size depends on which quantisation Ollama resolves, which the search does not reveal.
    sizeBytes: 0,
    downloads: model.downloads ?? 0,
    url: `https://huggingface.co/${id}`,
  };
}

/**
 * Guesses a parameter count from a repo name, which is where the Hub's conventions put it (for
 * example `Qwen2.5-Coder-7B-Instruct-GGUF`). Returns an empty string when the name does not say, since
 * a wrong number is worse than none. Exported for unit testing.
 * @param id The repo id.
 * @returns Returns the parameter size, or an empty string.
 */
export function parameterSizeFromId(id: string): string {
  const match: RegExpExecArray | null = /[-_/](\d+(?:\.\d+)?)\s*([BM])\b/i.exec(id);
  return match === null ? '' : `${match[1]}${match[2].toUpperCase()}`;
}
