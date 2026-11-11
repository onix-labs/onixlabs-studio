import { inject, Service } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * The key the record is kept under: each workspace root, and the panels Studio has added to it on its
 * own.
 */
const STORE_KEY: string = 'workspace.autoAddedPanels';

/**
 * Remembers, per workspace, which panels Studio has already added on its own (#1253): Solution Explorer
 * when a project system is found, Packages when a package ecosystem is. The ruling is "add once, and
 * respect closing": a panel is added the first time a workspace qualifies and never again, so a user
 * who closed it, or applied a saved layout without it, keeps it closed.
 *
 * Kept as UI state, beside the layouts, rather than in the workspace's own files: it describes this
 * user's window, not the project.
 */
@Service()
export class AutoAddedPanels {
  /**
   * Holds where the record is kept.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Determines whether Studio has already added a panel to a workspace.
   * @param root The workspace's root.
   * @param panel The panel's id.
   * @returns Returns true when it has, so it must not be added again.
   */
  public has(root: string, panel: string): boolean {
    return (this.record()[root] ?? []).includes(panel);
  }

  /**
   * Records that a workspace has had a panel, whether Studio added it or the layout already held it,
   * so closing it from now on is respected.
   * @param root The workspace's root.
   * @param panel The panel's id.
   */
  public mark(root: string, panel: string): void {
    const record: Readonly<Record<string, readonly string[]>> = this.record();
    const panels: readonly string[] = record[root] ?? [];
    if (!panels.includes(panel)) {
      this.store.set(STORE_KEY, { ...record, [root]: [...panels, panel] });
    }
  }

  /**
   * Reads the record, dropping anything malformed rather than trusting it.
   * @returns Returns the panels added, by workspace root.
   */
  private record(): Readonly<Record<string, readonly string[]>> {
    const raw: unknown = this.store.get<unknown>(STORE_KEY, {});
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {};
    }
    const record: Record<string, readonly string[]> = {};
    for (const [root, panels] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(panels)) {
        record[root] = panels.filter(
          (panel: unknown): panel is string => typeof panel === 'string',
        );
      }
    }
    return record;
  }
}
