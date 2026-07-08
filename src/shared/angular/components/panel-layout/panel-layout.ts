import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { PanelArrangements } from './panel-arrangements';
import { Panel } from './panel';
import { PANEL_LAYOUT_CONTEXT, PanelLayoutContext } from './panel-layout-context';
import { PanelLayoutDrag } from './panel-layout-drag';
import { PanelLayoutOverlay } from './panel-layout-overlay';
import {
  movePanel,
  PANEL_EDGES,
  PanelArrangement,
  PanelEdge,
  PanelPlacement,
  resizeEdgePanels,
} from './panel-types';

/**
 * The smallest main-axis length, in pixels, a divider drag can squeeze a stacked panel to.
 */
const MINIMUM_STACK_LENGTH: number = 60;

/**
 * Represents the shared panel layout: a central main area surrounded by edge-docked {@link Panel}s.
 * Left and right edges span the full height; top and bottom edges fit between them. Panels sharing
 * an edge stack along it, each keeping its own header.
 *
 * This is the lightweight layout that single-surface feature views compose (an editor or terminal
 * in the centre, with terminal/agent/tool panels on the edges) — a simplified dock: the main
 * content is always front-and-centre, and dragging a panel by its header shows edge guides and a
 * landing preview, so the user chooses which edge each panel lives on. There are no tab groups and
 * no floating; the four edges are the only targets.
 *
 * The arrangement (each panel's edge, order and size) is resolved through {@link PanelArrangements}
 * when a {@link layoutKey} is set, so it persists per view type and syncs across that view type's
 * open tabs; without a key the arrangement lives in memory, which keeps simple hosts and specs
 * self-contained.
 *
 * Panels are projected once and then re-homed into their edge's wrapper by moving their host
 * elements — Angular tracks views logically, so bindings, lifecycles and injectors survive the
 * move, and a live session (a terminal, an editor) is preserved when its panel docks elsewhere.
 */
@Component({
  selector: 'app-panel-layout',
  imports: [PanelLayoutOverlay],
  templateUrl: './panel-layout.html',
  styleUrl: './panel-layout.scss',
  providers: [PanelLayoutDrag, { provide: PANEL_LAYOUT_CONTEXT, useExisting: PanelLayout }],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelLayout implements PanelLayoutContext {
  /**
   * Holds the document the grip and divider drag listeners attach to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the layout's host element, measured as the drag workspace.
   */
  private readonly elementRef: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the persisted arrangements keyed layouts resolve through.
   */
  private readonly arrangements: PanelArrangements = inject(PanelArrangements);

  /**
   * Holds this layout's drag coordinator.
   */
  private readonly drag: PanelLayoutDrag = inject(PanelLayoutDrag);

  /**
   * Gets the key the layout's arrangement is stored under, shared by every tab of one view type
   * (for example `markdown` or `code`). Null keeps the arrangement in memory only.
   */
  public readonly layoutKey: InputSignal<string | null> = input<string | null>(null);

  /**
   * Holds the projected panels.
   */
  private readonly panels: Signal<readonly Panel[]> = contentChildren<Panel>(Panel);

  /**
   * Holds the wrapper element of each edge, keyed by the wrapper's `data-edge` attribute.
   */
  private readonly leftWrapper: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('leftWrapper');

  /**
   * Holds the right edge's wrapper element.
   */
  private readonly rightWrapper: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('rightWrapper');

  /**
   * Holds the top edge's wrapper element.
   */
  private readonly topWrapper: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('topWrapper');

  /**
   * Holds the bottom edge's wrapper element.
   */
  private readonly bottomWrapper: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('bottomWrapper');

  /**
   * Holds the in-memory arrangement used when the layout has no key.
   */
  private readonly localArrangement: WritableSignal<PanelArrangement> = signal<PanelArrangement>(
    {},
  );

  /**
   * Holds the main-axis flex shares of the layout's panels. Deliberately not persisted: the
   * persisted schema stays edge + order + size, and stack balance resets to equal shares per
   * session.
   */
  private readonly stackShares: WritableSignal<Readonly<Record<string, number>>> = signal<
    Readonly<Record<string, number>>
  >({});

  /**
   * Holds the identifier of the panel whose leading divider is being dragged, or null when none
   * is.
   */
  private readonly draggedDivider: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the edge whose grip is being dragged, or null when none is.
   */
  private readonly draggedGrip: WritableSignal<PanelEdge | null> = signal<PanelEdge | null>(null);

  /**
   * Holds the transient cross-axis size of the edge being grip-dragged, displayed live and
   * committed to the arrangement on release so persistence is written once per drag.
   */
  private readonly gripOverride: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets the layout's live arrangement: the persisted arrangement of its key, or the in-memory one
   * when the layout has no key.
   */
  public readonly arrangement: Signal<PanelArrangement> = computed((): PanelArrangement => {
    const key: string | null = this.layoutKey();
    return key !== null ? this.arrangements.arrangement(key)() : this.localArrangement();
  });

  /**
   * Gets the main-axis flex shares of the layout's panels.
   */
  public readonly shares: Signal<Readonly<Record<string, number>>> = this.stackShares.asReadonly();

  /**
   * Gets the identifier of the panel whose leading divider is being dragged.
   */
  public readonly activeDivider: Signal<string | null> = this.draggedDivider.asReadonly();

  /**
   * Gets the edge whose grip is being dragged, exposed for the grips' accent styling.
   */
  protected readonly activeGrip: Signal<PanelEdge | null> = this.draggedGrip.asReadonly();

  /**
   * Gets the mounted panels of each edge, in stack order. Hidden panels stay in their stack (they
   * remain mounted, only collapsed); visibility is applied where it matters.
   */
  private readonly edgeStacks: Signal<Readonly<Record<PanelEdge, readonly Panel[]>>> = computed(
    (): Readonly<Record<PanelEdge, readonly Panel[]>> => {
      const arrangement: PanelArrangement = this.arrangement();
      const stacks: Record<PanelEdge, Panel[]> = { left: [], right: [], top: [], bottom: [] };
      for (const panel of this.panels()) {
        stacks[placementOf(panel, arrangement).edge].push(panel);
      }
      for (const edge of PANEL_EDGES) {
        stacks[edge].sort(
          (a: Panel, b: Panel): number =>
            placementOf(a, arrangement).order - placementOf(b, arrangement).order,
        );
      }
      return stacks;
    },
  );

  /**
   * Gets the visible panels of each edge, in stack order, keyed by identifier.
   */
  private readonly visibleStacks: Signal<Readonly<Record<PanelEdge, readonly string[]>>> = computed(
    (): Readonly<Record<PanelEdge, readonly string[]>> => {
      const stacks: Readonly<Record<PanelEdge, readonly Panel[]>> = this.edgeStacks();
      const visible: Record<PanelEdge, readonly string[]> = {
        left: [],
        right: [],
        top: [],
        bottom: [],
      };
      for (const edge of PANEL_EDGES) {
        visible[edge] = stacks[edge]
          .filter((panel: Panel): boolean => panel.visible())
          .map((panel: Panel): string => panel.panelId());
      }
      return visible;
    },
  );

  /**
   * Gets the rendered cross-axis size of each edge: zero when the edge has no visible panel, the
   * live grip override while its grip is dragged, and otherwise the stack's stored size clamped to
   * its members' bounds.
   */
  protected readonly edgeSizes: Signal<Readonly<Record<PanelEdge, number>>> = computed(
    (): Readonly<Record<PanelEdge, number>> => {
      const sizes: Record<PanelEdge, number> = { left: 0, right: 0, top: 0, bottom: 0 };
      for (const edge of PANEL_EDGES) {
        const members: readonly Panel[] = this.edgeStacks()[edge].filter((panel: Panel): boolean =>
          panel.visible(),
        );
        if (members.length === 0) {
          continue;
        }
        const override: number | null = this.draggedGrip() === edge ? this.gripOverride() : null;
        const stored: number = Math.max(
          ...members.map((panel: Panel): number => panel.placement().size),
        );
        sizes[edge] = this.clampEdgeSize(members, override ?? stored);
      }
      return sizes;
    },
  );

  /**
   * Gets the edges, in render order.
   */
  protected readonly edges: readonly PanelEdge[] = PANEL_EDGES;

  public constructor() {
    // Declare the mounted panels' defaults into the arrangement whenever the panel set changes, so
    // panels that mount later (behind an @if) merge in when they first appear.
    effect((): void => {
      const defaults: Record<string, PanelPlacement> = {};
      for (const panel of this.panels()) {
        defaults[panel.panelId()] = {
          edge: panel.defaultEdge(),
          order: panel.placement().order,
          size: panel.defaultSize(),
        };
      }
      const key: string | null = this.layoutKey();
      if (key !== null) {
        this.arrangements.initialize(key, defaults);
      } else {
        this.localArrangement.update((current: PanelArrangement): PanelArrangement => {
          const merged: Record<string, PanelPlacement> = { ...current };
          for (const [id, placement] of Object.entries(defaults)) {
            if (!(id in merged)) {
              merged[id] = placement;
            }
          }
          return merged;
        });
      }
    });

    // Re-home each panel's host element into its edge's wrapper, in stack order. Only out-of-place
    // elements are moved, so an unrelated change (a panel mounting elsewhere) never disturbs the
    // DOM — and the focus or selection — of panels already in place.
    afterRenderEffect((): void => {
      const stacks: Readonly<Record<PanelEdge, readonly Panel[]>> = this.edgeStacks();
      for (const edge of PANEL_EDGES) {
        const wrapper: HTMLElement = this.wrapperOf(edge);
        stacks[edge].forEach((panel: Panel, index: number): void => {
          const element: HTMLElement = panel.hostElement;
          const current: Element | undefined = wrapper.children[index];
          if (current !== element) {
            wrapper.insertBefore(element, current ?? null);
          }
        });
      }
    });

    this.drag.attach(this.elementRef.nativeElement, (panelId: string, edge: PanelEdge): void =>
      this.onDrop(panelId, edge),
    );
  }

  /**
   * Gets the visible panels stacked on an edge, in order.
   * @param edge The edge to read.
   * @returns Returns the visible panel identifiers on the edge.
   */
  public visibleStack(edge: PanelEdge): readonly string[] {
    return this.visibleStacks()[edge];
  }

  /**
   * Begins a divider drag between a panel and its predecessor in the stack, rebalancing the two
   * panels' main-axis shares as the pointer moves. Every visible member's share is first pinned to
   * its measured length, so the rest of the stack holds still while the pair rebalances.
   * @param panelId The identifier of the panel whose leading divider was pressed.
   * @param event The originating mouse event.
   */
  public beginDividerDrag(panelId: string, event: MouseEvent): void {
    const edge: PanelEdge | undefined = PANEL_EDGES.find((candidate: PanelEdge): boolean =>
      this.visibleStacks()[candidate].includes(panelId),
    );
    if (edge === undefined) {
      return;
    }
    const stack: readonly Panel[] = this.edgeStacks()[edge].filter((panel: Panel): boolean =>
      panel.visible(),
    );
    const index: number = stack.findIndex((panel: Panel): boolean => panel.panelId() === panelId);
    if (index <= 0) {
      return;
    }
    event.preventDefault();

    const vertical: boolean = edge === 'left' || edge === 'right';
    const lengthOf: (panel: Panel) => number = (panel: Panel): number => {
      const rect: DOMRect = panel.hostElement.getBoundingClientRect();
      return vertical ? rect.height : rect.width;
    };
    const lengths: Record<string, number> = {};
    for (const panel of stack) {
      lengths[panel.panelId()] = lengthOf(panel);
    }
    const previousId: string = stack[index - 1].panelId();
    const previousLength: number = lengths[previousId];
    const panelLength: number = lengths[panelId];
    const start: number = vertical ? event.clientY : event.clientX;
    this.draggedDivider.set(panelId);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const current: number = vertical ? move.clientY : move.clientX;
      const delta: number = clamp(
        current - start,
        MINIMUM_STACK_LENGTH - previousLength,
        panelLength - MINIMUM_STACK_LENGTH,
      );
      this.stackShares.set({
        ...lengths,
        [previousId]: previousLength + delta,
        [panelId]: panelLength - delta,
      });
    };
    const onUp: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onUp);
      this.draggedDivider.set(null);
    };
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onUp);
  }

  /**
   * Begins an edge grip drag, resizing the whole edge's stack as the pointer moves. The size is
   * shown live through {@link edgeSizes} and committed to the arrangement once on release. The
   * drag direction follows the edge so dragging toward the layout's centre always shrinks the
   * stack.
   * @param edge The edge whose grip was pressed.
   * @param event The pointer-down event that started the drag.
   */
  protected onGripDown(edge: PanelEdge, event: MouseEvent): void {
    event.preventDefault();
    const vertical: boolean = edge === 'left' || edge === 'right';
    const grows: number = edge === 'right' || edge === 'bottom' ? -1 : 1;
    const start: number = vertical ? event.clientX : event.clientY;
    const startSize: number = this.edgeSizes()[edge];
    const members: readonly Panel[] = this.edgeStacks()[edge].filter((panel: Panel): boolean =>
      panel.visible(),
    );
    this.draggedGrip.set(edge);
    this.gripOverride.set(startSize);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const current: number = vertical ? move.clientX : move.clientY;
      this.gripOverride.set(this.clampEdgeSize(members, startSize + (current - start) * grows));
    };
    const onUp: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onUp);
      const size: number | null = this.gripOverride();
      this.draggedGrip.set(null);
      this.gripOverride.set(null);
      if (size !== null && size !== startSize) {
        this.resizeEdge(edge, size);
      }
    };
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onUp);
  }

  /**
   * Gets the ARIA orientation of an edge's grip: vertical for left/right edges (they resize
   * horizontally), horizontal for top/bottom edges.
   * @param edge The edge the grip resizes.
   * @returns Returns the grip's orientation.
   */
  protected gripOrientation(edge: PanelEdge): 'horizontal' | 'vertical' {
    return edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal';
  }

  /**
   * Commits a dropped panel to its targeted edge. The panel's flex share is cleared so it takes an
   * equal share of its new stack.
   * @param panelId The identifier of the dropped panel.
   * @param edge The edge the panel was dropped on.
   */
  private onDrop(panelId: string, edge: PanelEdge): void {
    const key: string | null = this.layoutKey();
    if (key !== null) {
      this.arrangements.move(key, panelId, edge);
    } else {
      this.localArrangement.update(
        (current: PanelArrangement): PanelArrangement => movePanel(current, panelId, edge),
      );
    }
    this.stackShares.update(
      (shares: Readonly<Record<string, number>>): Readonly<Record<string, number>> => {
        const next: Record<string, number> = { ...shares };
        delete next[panelId];
        return next;
      },
    );
  }

  /**
   * Commits a new cross-axis size for an edge's stack.
   * @param edge The edge to resize.
   * @param size The new size in pixels.
   */
  private resizeEdge(edge: PanelEdge, size: number): void {
    const key: string | null = this.layoutKey();
    if (key !== null) {
      this.arrangements.resizeEdge(key, edge, size);
    } else {
      this.localArrangement.update(
        (current: PanelArrangement): PanelArrangement => resizeEdgePanels(current, edge, size),
      );
    }
  }

  /**
   * Clamps an edge size to its visible members' bounds: no member is squeezed below its minimum
   * nor stretched past its maximum, with the minimum winning when the two conflict.
   * @param members The edge's visible panels.
   * @param size The candidate size.
   * @returns Returns the clamped size.
   */
  private clampEdgeSize(members: readonly Panel[], size: number): number {
    const low: number = Math.max(...members.map((panel: Panel): number => panel.minSize()));
    const high: number = Math.min(...members.map((panel: Panel): number => panel.maxSize()));
    return Math.max(low, Math.min(high, size));
  }

  /**
   * Resolves the wrapper element of an edge.
   * @param edge The edge to resolve.
   * @returns Returns the edge's wrapper element.
   */
  private wrapperOf(edge: PanelEdge): HTMLElement {
    switch (edge) {
      case 'left':
        return this.leftWrapper().nativeElement;
      case 'right':
        return this.rightWrapper().nativeElement;
      case 'top':
        return this.topWrapper().nativeElement;
      case 'bottom':
        return this.bottomWrapper().nativeElement;
    }
  }
}

/**
 * Resolves a panel's placement within an arrangement, falling back to its declared defaults.
 * @param panel The panel to resolve.
 * @param arrangement The arrangement to resolve through.
 * @returns Returns the panel's placement.
 */
function placementOf(panel: Panel, arrangement: PanelArrangement): PanelPlacement {
  return (
    arrangement[panel.panelId()] ?? {
      edge: panel.defaultEdge(),
      order: 0,
      size: panel.defaultSize(),
    }
  );
}

/**
 * Clamps a value to an inclusive range.
 * @param value The value to clamp.
 * @param low The lower bound.
 * @param high The upper bound.
 * @returns Returns the clamped value.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
