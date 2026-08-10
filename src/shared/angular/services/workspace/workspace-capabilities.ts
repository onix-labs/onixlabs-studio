import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectCapabilities, ProjectModel } from '@shared/api/project-system';
import { Log } from '@shared/angular/services/log/log';

/**
 * Routes the active workspace's project model to the root ribbon and the Configure dialog, exposing the
 * declared {@link ProjectCapabilities} (so the Tier-2 ribbon controls gate themselves from data) and the
 * provider kind (so a newly-created run configuration is bound to the active ecosystem).
 *
 * Each workspace's model lives on its per-tab project model; the directory view registers that model
 * signal while its tab is active, and consumers read the exposed values (or null when no workspace is
 * active). This mirrors the {@link import('../tasks/builds').Builds} seam.
 */
@Service()
export class WorkspaceCapabilities {
  /**
   * Holds the active workspace's project-model source, or null when no workspace is active.
   */
  private readonly source: WritableSignal<Signal<ProjectModel | null> | null> =
    signal<Signal<ProjectModel | null> | null>(null);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the active workspace's declared capabilities, or null when none are available.
   */
  public readonly capabilities: Signal<ProjectCapabilities | null> = computed(
    (): ProjectCapabilities | null => this.source()?.()?.capabilities ?? null,
  );

  /**
   * Gets the active workspace's project-system kind (for example `dotnet`), or null when unavailable.
   */
  public readonly kind: Signal<string | null> = computed(
    (): string | null => this.source()?.()?.kind ?? null,
  );

  /**
   * Registers the active workspace's project-model source.
   * @param model The active workspace's project-model signal.
   */
  public register(model: Signal<ProjectModel | null>): void {
    this.source.set(model);
    this.log.debug('WorkspaceCapabilities', 'Registered active project model', model()?.kind);
  }

  /**
   * Unregisters the given model source, if it is the currently registered one.
   * @param model The model signal to unregister.
   */
  public unregister(model: Signal<ProjectModel | null>): void {
    if (this.source() === model) {
      this.source.set(null);
      this.log.debug('WorkspaceCapabilities', 'Unregistered active project model');
    }
  }
}
