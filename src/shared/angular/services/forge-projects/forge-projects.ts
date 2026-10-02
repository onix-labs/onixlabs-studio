import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { ForgeRepositoryRef } from '@shared/api/forge-types';

/**
 * Describes an open workspace whose remote names a repository on a forge: one project in the
 * organisation view (epic #788).
 */
export interface ForgeProject {
  /**
   * Gets the project's identity: its repository's host, owner and name, lower-cased, so two
   * workspaces open on the same repository are one project.
   */
  readonly key: string;

  /**
   * Gets the repository on the forge.
   */
  readonly repository: ForgeRepositoryRef;

  /**
   * Gets the root of the first open workspace that published the project.
   */
  readonly root: string;

  /**
   * Gets the view scope of that workspace — the key its document well is published under — which an
   * agent working on the project names as its run owner, so its tools act on this workspace rather
   * than whichever one has focus.
   */
  readonly scope: string;
}

/**
 * One publication of a project: a workspace view announcing the repository its remotes name.
 */
interface Publication {
  /**
   * Gets the project the publication announces.
   */
  readonly project: ForgeProject;
}

/**
 * Derives a project's identity from its repository.
 * @param repository The repository on the forge.
 * @returns Returns the key, which is case-insensitive because the forge's names are.
 */
export function projectKey(repository: ForgeRepositoryRef): string {
  return `${repository.kind}:${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();
}

/**
 * The app-wide registry of open projects: every open workspace whose remotes name a repository on a
 * forge publishes it here, and the organisation views list them.
 *
 * Published rather than discovered, because only a workspace view knows its remotes, and the views
 * that list projects (Mission Control) live in another tab with no reach into a workspace's injector.
 * The same pattern {@link import('../agent-hosts/agent-hosts').AgentHosts} uses for live agents.
 *
 * Several workspaces may publish one repository — a worktree container's checkouts, or the same clone
 * opened twice — and they are one project: the first publication names its root, and the project
 * stays listed until the last one is withdrawn.
 */
@Service()
export class ForgeProjects {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every live publication, in the order they were made.
   */
  private readonly publications: WritableSignal<readonly Publication[]> = signal<
    readonly Publication[]
  >([]);

  /**
   * Gets the open projects, one per repository, in the order they were first published.
   */
  public readonly projects: Signal<readonly ForgeProject[]> = computed(
    (): readonly ForgeProject[] => {
      const seen: Map<string, ForgeProject> = new Map<string, ForgeProject>();
      for (const publication of this.publications()) {
        if (!seen.has(publication.project.key)) {
          seen.set(publication.project.key, publication.project);
        }
      }
      return [...seen.values()];
    },
    {
      // A publication that repeats a listed project changes nothing a reader sees, so it must not
      // re-run everything downstream of the list.
      equal: (left: readonly ForgeProject[], right: readonly ForgeProject[]): boolean =>
        left.length === right.length &&
        left.every((project: ForgeProject, index: number): boolean => project === right[index]),
    },
  );

  /**
   * Publishes a workspace's repository as an open project.
   * @param repository The repository the workspace's remotes name.
   * @param root The workspace's root folder.
   * @param scope The workspace's view scope.
   * @returns Returns a function that withdraws this publication, called when the workspace closes or
   * its remotes stop naming the repository.
   */
  public publish(repository: ForgeRepositoryRef, root: string, scope: string): () => void {
    const publication: Publication = {
      project: { key: projectKey(repository), repository, root, scope },
    };
    this.publications.update((current: readonly Publication[]): readonly Publication[] => [
      ...current,
      publication,
    ]);
    this.log.debug('ForgeProjects', 'Project published', publication.project.key);
    return (): void => {
      this.publications.update((current: readonly Publication[]): readonly Publication[] =>
        current.filter((existing: Publication): boolean => existing !== publication),
      );
      this.log.debug('ForgeProjects', 'Project withdrawn', publication.project.key);
    };
  }
}
