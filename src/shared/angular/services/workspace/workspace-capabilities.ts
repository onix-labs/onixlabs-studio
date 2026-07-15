import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectCapabilities } from '@shared/api/project-system';

/**
 * Routes the active workspace's declared {@link ProjectCapabilities} to the root ribbon, so the Tier-2
 * ribbon controls (Build/Clean/Rebuild, the build-configuration and target selectors) can gate
 * themselves from data rather than hard-coded assumptions.
 *
 * Each workspace's capabilities live on its per-tab project model; the directory view registers that
 * model's capabilities signal while its tab is active, and the ribbon reads the exposed value (or null
 * when no workspace is active or the active one declares none). This mirrors the {@link
 * import('../tasks/builds').Builds} seam.
 */
@Service()
export class WorkspaceCapabilities {
  /**
   * Holds the active workspace's capabilities source, or null when no workspace is active.
   */
  private readonly source: WritableSignal<Signal<ProjectCapabilities | null> | null> = signal<Signal<
    ProjectCapabilities | null
  > | null>(null);

  /**
   * Gets the active workspace's declared capabilities, or null when none are available.
   */
  public readonly capabilities: Signal<ProjectCapabilities | null> = computed(
    (): ProjectCapabilities | null => this.source()?.() ?? null,
  );

  /**
   * Registers the active workspace's capabilities source.
   * @param capabilities The active workspace's capabilities signal.
   */
  public register(capabilities: Signal<ProjectCapabilities | null>): void {
    this.source.set(capabilities);
  }

  /**
   * Unregisters the given capabilities source, if it is the currently registered one.
   * @param capabilities The capabilities signal to unregister.
   */
  public unregister(capabilities: Signal<ProjectCapabilities | null>): void {
    if (this.source() === capabilities) {
      this.source.set(null);
    }
  }
}
