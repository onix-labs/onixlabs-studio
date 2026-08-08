import {
  PackageEcosystem,
  PackageManagerModel,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from '@shared/api/package-management';

/**
 * A minimal HTTP response shape, so a package manager's registry queries do not depend on the DOM or
 * Node fetch types. Mirrors the shape the AI model-discovery layer injects, kept local so the two
 * capabilities stay decoupled.
 */
export interface HttpResponse {
  /**
   * Gets a value indicating whether the response status is in the success range.
   */
  readonly ok: boolean;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the response body as parsed JSON.
   * @returns Returns the parsed body.
   */
  json(): Promise<unknown>;
}

/**
 * A minimal fetch signature, injected so a package manager's registry queries are testable without a
 * network. The main process passes the real global fetch.
 */
export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

/**
 * Understands one ecosystem's notion of declared dependencies (for example npm's package.json plus its
 * lockfile) and turns a workspace root into a {@link PackageManagerModel}: the projects it holds and the
 * packages each declares, enriched with the latest version the ecosystem's registry offers. Deliberately
 * parallel to {@link import('../project-system/project-system').ProjectSystem}: a provider per
 * ecosystem, resolved through a registry so callers never hard-code one.
 */
export interface PackageManager {
  /**
   * Gets the ecosystem this manager models (for example `npm`).
   */
  readonly ecosystem: PackageEcosystem;

  /**
   * Determines whether this manager applies to a workspace root (its manifests are present).
   * @param root The absolute workspace root.
   * @returns Returns true when the root is one this manager understands.
   */
  detect(root: string): Promise<boolean>;

  /**
   * Builds the package model for a workspace root, resolving installed versions locally and latest
   * versions through the injected fetch.
   * @param root The absolute workspace root.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns the model, or null when the root has nothing this manager can model.
   */
  load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null>;

  /**
   * Lists the package sources available to browse/search for a workspace root. Optional: a manager that
   * does not support exploration omits it (the renderer then offers no Explore mode). Only source names
   * are returned — never credentials.
   * @param root The absolute workspace root.
   * @returns Returns the available sources.
   */
  listSources?(root: string): Promise<readonly PackageSourceInfo[]>;

  /**
   * Searches (or browses, with an empty query) a source's packages for a workspace root. Optional,
   * paired with {@link listSources}.
   * @param root The absolute workspace root.
   * @param sourceName The source to search, as named by {@link listSources}.
   * @param query The search text, or an empty string to browse the source's curated/full listing.
   * @param options The paging and prerelease options.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns a page of results.
   */
  search?(
    root: string,
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult>;
}

/**
 * Holds the registered package managers and resolves the one that applies to a workspace root. The
 * single seam through which package discovery is reached, so callers never hard-code an ecosystem.
 */
export class PackageManagerRegistry {
  /**
   * Holds the registered managers, keyed by ecosystem.
   */
  private readonly managers: Map<PackageEcosystem, PackageManager> = new Map<
    PackageEcosystem,
    PackageManager
  >();

  /**
   * Registers a package manager, replacing any previously registered for the same ecosystem.
   * @param manager The package manager to register.
   */
  public register(manager: PackageManager): void {
    this.managers.set(manager.ecosystem, manager);
  }

  /**
   * Resolves the first registered package manager that applies to a workspace root.
   * @param root The absolute workspace root.
   * @returns Returns the matching manager, or null when none applies.
   */
  public async match(root: string): Promise<PackageManager | null> {
    for (const manager of this.managers.values()) {
      if (await manager.detect(root)) {
        return manager;
      }
    }
    return null;
  }
}
