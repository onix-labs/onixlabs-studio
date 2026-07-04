import { Service } from '@angular/core';
import { StackRole } from './dock-node';
import { Rect } from './dock-legality';

/**
 * A group hovered during a drag: the stack it renders and its live rectangle.
 */
export interface DockGroupHit {
  /**
   * Gets the identifier of the hovered stack.
   */
  readonly stackId: string;

  /**
   * Gets the role of the hovered stack.
   */
  readonly role: StackRole;

  /**
   * Gets the hovered group's rectangle.
   */
  readonly rect: Rect;
}

/**
 * A registered tab group, holding the element whose live rectangle is hit-tested during a drag.
 */
interface DockGroupRegistration {
  /**
   * Gets the role of the registered stack.
   */
  readonly role: StackRole;

  /**
   * Gets the element whose rectangle is hit-tested.
   */
  readonly element: HTMLElement;
}

/**
 * Tracks the live geometry of the dock: a registry of tab-group elements hit-tested during a drag,
 * and the workspace element whose rectangle bounds edge docking. Rectangles are read on demand so
 * they always reflect the current layout.
 */
@Service()
export class DockGeometry {
  /**
   * Holds the registered tab groups, keyed by stack identifier.
   */
  private readonly groups: Map<string, DockGroupRegistration> = new Map<
    string,
    DockGroupRegistration
  >();

  /**
   * Holds the workspace element edge docking is measured against.
   */
  private workspace: HTMLElement | null = null;

  /**
   * Registers a tab group so it can be hit-tested during a drag.
   * @param stackId The identifier of the stack.
   * @param role The role of the stack.
   * @param element The group element to hit-test.
   */
  public registerGroup(stackId: string, role: StackRole, element: HTMLElement): void {
    this.groups.set(stackId, { role, element });
  }

  /**
   * Removes a tab group from the registry.
   * @param stackId The identifier of the stack to remove.
   */
  public unregisterGroup(stackId: string): void {
    this.groups.delete(stackId);
  }

  /**
   * Sets the workspace element edge docking is measured against.
   * @param element The workspace element.
   */
  public setWorkspace(element: HTMLElement): void {
    this.workspace = element;
  }

  /**
   * Gets the workspace rectangle, or null when no workspace is registered.
   * @returns Returns the workspace rectangle, or null.
   */
  public workspaceRect(): Rect | null {
    return this.workspace !== null ? toRect(this.workspace.getBoundingClientRect()) : null;
  }

  /**
   * Gets the live rectangle of a registered group.
   * @param stackId The identifier of the stack.
   * @returns Returns the group's rectangle, or null when it is not registered.
   */
  public rectOf(stackId: string): Rect | null {
    const registration: DockGroupRegistration | undefined = this.groups.get(stackId);
    return registration !== undefined ? toRect(registration.element.getBoundingClientRect()) : null;
  }

  /**
   * Finds the registered group whose rectangle contains the given point.
   * @param x The viewport x coordinate.
   * @param y The viewport y coordinate.
   * @returns Returns the hovered group, or null when no group contains the point.
   */
  public groupAt(x: number, y: number): DockGroupHit | null {
    for (const [stackId, registration] of this.groups) {
      const rect: Rect = toRect(registration.element.getBoundingClientRect());
      if (
        x >= rect.left &&
        x <= rect.left + rect.width &&
        y >= rect.top &&
        y <= rect.top + rect.height
      ) {
        return { stackId, role: registration.role, rect };
      }
    }
    return null;
  }
}

/**
 * Converts a DOM rectangle to the plain {@link Rect} used by the docking engine.
 * @param domRect The DOM rectangle to convert.
 * @returns Returns the equivalent rectangle.
 */
function toRect(domRect: DOMRect): Rect {
  return { left: domRect.left, top: domRect.top, width: domRect.width, height: domRect.height };
}
