import { Service, Signal, signal, WritableSignal } from '@angular/core';

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
 * An unlisted panel is available. Availability is a per-view fact (it depends on what that tab has
 * open), so this service is scoped alongside {@link import('./dock-state').DockState} and the view
 * pushes its own map in.
 */
@Service()
export class DockPanelAvailability {
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
    return this.map()[id] !== false;
  }
}
