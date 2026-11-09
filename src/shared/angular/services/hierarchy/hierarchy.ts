import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import type { CodeLocation } from '@shared/angular/services/references/reference-list';

/**
 * Names the hierarchies a symbol has (#1153): who calls a member and what it calls, or a type's base
 * types and the types derived from it.
 */
export type HierarchyKind = 'calls' | 'types';

/**
 * Names the way a hierarchy is walked from its root: a member's callers or callees, or a type's base
 * or derived types.
 */
export type HierarchyDirection = 'callers' | 'callees' | 'supertypes' | 'subtypes';

/**
 * Gets the directions each hierarchy can be walked in, the first the one it opens in.
 */
export const HIERARCHY_DIRECTIONS: Readonly<Record<HierarchyKind, readonly HierarchyDirection[]>> =
  {
    calls: ['callers', 'callees'],
    types: ['supertypes', 'subtypes'],
  };

/**
 * Describes one symbol in a hierarchy: a member, or a type.
 */
export interface HierarchyNode {
  /**
   * Gets the symbol's name, as the server shows it (`FormalGreeter.Greet(string)`).
   */
  readonly name: string;

  /**
   * Gets what qualifies the name — the containing type or namespace — or undefined.
   */
  readonly detail?: string;

  /**
   * Gets the symbol's kind, a protocol `SymbolKind`.
   */
  readonly kind: number;

  /**
   * Gets where the symbol is declared: its name's span.
   */
  readonly location: CodeLocation;

  /**
   * Gets the server's own item for the symbol, handed back to it, untouched, to walk further.
   */
  readonly item: unknown;
}

/**
 * Describes a hierarchy to show: its roots — the symbol at the caret, or each of them where the
 * caret names several — and how to walk from any node, one level at a time.
 */
export interface HierarchySource {
  /**
   * Gets which hierarchy it is.
   */
  readonly kind: HierarchyKind;

  /**
   * Gets its roots.
   */
  readonly roots: readonly HierarchyNode[];

  /**
   * Walks one level from a node.
   * @param node The node.
   * @param direction The way to walk.
   * @returns Returns the nodes one level away, or null when they could not be found.
   */
  readonly children: (
    node: HierarchyNode,
    direction: HierarchyDirection,
  ) => Promise<readonly HierarchyNode[] | null>;
}

/**
 * Shows a hierarchy in a workspace's Hierarchy panel.
 */
export type HierarchyReveal = (source: HierarchySource) => void;

/**
 * Routes Show Call Hierarchy and Show Type Hierarchy to the active workspace (#1153): its directory view
 * registers how it reveals its Hierarchy panel while it is in front, and the editor's commands show
 * what they find through here. With no workspace in front there is no panel, and the commands are not
 * offered.
 */
@Service()
export class HierarchyRouter {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the active workspace's reveal callback, or null when no workspace is in front.
   */
  private readonly handler: WritableSignal<HierarchyReveal | null> = signal<HierarchyReveal | null>(
    null,
  );

  /**
   * Holds the active workspace's reader of its active document, or null when none is in front.
   */
  private activeDocument: (() => string | null) | null = null;

  /**
   * Gets whether a workspace is in front to show a hierarchy.
   */
  public readonly available: Signal<boolean> = computed((): boolean => this.handler() !== null);

  /**
   * Registers the active workspace's reveal callback, and how to read the document it is editing —
   * each workspace tab keeps its own, which the Edit menu's hierarchy items act on.
   * @param reveal The callback.
   * @param activeDocument Reads the id of the document the workspace is editing, or null.
   */
  public register(
    reveal: HierarchyReveal,
    activeDocument: () => string | null = (): null => null,
  ): void {
    this.activeDocument = activeDocument;
    this.handler.set(reveal);
  }

  /**
   * Gets the id of the document the active workspace is editing.
   * @returns Returns it, or null when no workspace is in front or it is editing none.
   */
  public activeDocumentId(): string | null {
    return this.activeDocument?.() ?? null;
  }

  /**
   * Unregisters a reveal callback, if it is the one registered.
   * @param reveal The callback.
   */
  public unregister(reveal: HierarchyReveal): void {
    if (this.handler() === reveal) {
      this.activeDocument = null;
      this.handler.set(null);
    }
  }

  /**
   * Shows a hierarchy in the active workspace's Hierarchy panel.
   * @param source The hierarchy.
   * @returns Returns true when a workspace showed it.
   */
  public show(source: HierarchySource): boolean {
    const reveal: HierarchyReveal | null = this.handler();
    if (reveal === null) {
      this.log.debug('hierarchy', 'No workspace shows this hierarchy', source.kind);
      return false;
    }
    this.log.debug('hierarchy', 'Show hierarchy', source.kind, source.roots.length);
    reveal(source);
    return true;
  }
}
