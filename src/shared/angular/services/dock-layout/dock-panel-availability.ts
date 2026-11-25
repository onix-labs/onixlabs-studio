import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';
import { firstStackOfRole } from './dock-tree';

/**
 * Holds the availability of each panel a dock can hold: false while the thing behind the panel does
 * not exist (a Solution Explorer without a recognised project system, Packages without a package
 * ecosystem, the source-control trio without a repository).
 *
 * A layout is a BEST CASE, not a demand. It names every panel the user wants when everything it
 * mentions is there, and the dock simply skips the ones that are not — the panel is passed over at
 * render time and reappears in its authored place the moment its backing arrives. The layout tree is
 * never rewritten to match, which is the whole point: a saved layout that mentions the Solution
 * Explorer still mentions it after being applied to a plain folder, so saving from that session
 * cannot quietly lose it.
 *
 * A panel the view declares in its template is available while it is declared, and passed over the rest
 * of the time.
 *
 * In a dock that keeps its closed panels' places ({@link import('./dock-blueprint').DockBlueprint.startsOpen})
 * a closed panel is passed over the same way.
 *
 * An unlisted panel is available. Availability is a per-view fact (it depends on what that tab has
 * open), so this service is scoped alongside {@link import('./dock-state').DockState} and the view
 * pushes its own map in.
 */
@Service()
export class DockPanelAvailability {
  /**
   * Holds the registered panels, which a panel declared in a template is one of only while it is declared.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the blueprint specialising the dock, or null when none was provided.
   */
  private readonly blueprint: DockBlueprint | null = inject(DOCK_BLUEPRINT, { optional: true });

  /**
   * Holds the identifiers of the panels the view declares in its template.
   */
  private readonly templatePanels: ReadonlySet<string> = new Set<string>(
    this.blueprint?.templatePanels ?? [],
  );

  /**
   * Gets whether the dock keeps its closed panels' places, so closing one is recorded here rather than
   * taking it out of the layout.
   */
  public readonly keepsPlaces: boolean;

  /**
   * Holds the closed panels of a dock that keeps their places.
   */
  private readonly closed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the availability of each panel that depends on something existing.
   */
  private readonly map: WritableSignal<Readonly<Record<string, boolean>>> = signal<
    Readonly<Record<string, boolean>>
  >({});

  /**
   * Gets the availability of each panel that depends on something existing. A panel absent from the
   * map has nothing to depend on and is always available.
   */
  public readonly availability: Signal<Readonly<Record<string, boolean>>> = this.map.asReadonly();

  public constructor() {
    this.keepsPlaces = this.blueprint?.startsOpen !== undefined;
    this.reset();
  }

  /**
   * Opens the panels the dock starts with, and closes the others. Does nothing in a dock that does not
   * keep its closed panels' places.
   */
  public reset(): void {
    const blueprint: DockBlueprint | null = this.blueprint;
    if (blueprint?.startsOpen === undefined) {
      return;
    }
    const open: ReadonlySet<string> = new Set<string>([
      ...blueprint.startsOpen,
      ...(firstStackOfRole(blueprint.createLayout(), 'main')?.panels ?? []),
    ]);
    this.closed.set(
      new Set<string>(
        [
          ...blueprint.panels.map((panel: DockPanel): string => panel.id),
          ...(blueprint.templatePanels ?? []),
        ].filter((id: string): boolean => !open.has(id)),
      ),
    );
  }

  /**
   * Records a panel as closed.
   * @param id The panel identifier.
   */
  public close(id: string): void {
    this.closed.update(
      (closed: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...closed, id]),
    );
  }

  /**
   * Records a panel as open.
   * @param id The panel identifier.
   */
  public open(id: string): void {
    this.closed.update(
      (closed: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([...closed].filter((other: string): boolean => other !== id)),
    );
  }

  /**
   * Determines whether a panel has been closed, in a dock that keeps its place.
   * @param id The panel identifier.
   * @returns Returns true when it has.
   */
  public isClosed(id: string): boolean {
    return this.closed().has(id);
  }

  /**
   * Replaces the availability map.
   * @param availability The availability of each panel that depends on something existing.
   */
  public set(availability: Readonly<Record<string, boolean>>): void {
    this.map.set(availability);
  }

  /**
   * Determines whether a panel can be shown.
   * @param id The panel identifier.
   * @returns Returns true when the panel has what it depends on, or depends on nothing; otherwise,
   * false.
   */
  public isAvailable(id: string): boolean {
    return (
      this.map()[id] !== false &&
      !this.isClosed(id) &&
      (!this.templatePanels.has(id) || this.registry.get(id) !== undefined)
    );
  }
}
