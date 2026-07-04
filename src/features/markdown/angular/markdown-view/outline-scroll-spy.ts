import { NgZone } from '@angular/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import {
  MarkdownCommands,
  OutlineHeading,
} from '@shared/angular/services/markdown-commands/markdown-commands';

/**
 * Heading level for an H1 element, used as the fallback when a heading node carries no level.
 */
const HEADING_LEVEL_1: number = 1;

/**
 * Delay in milliseconds for deferring an action to the next event-loop tick.
 */
const NEXT_TICK_DELAY: number = 0;

/**
 * Distance in pixels below the top of the editor's scroll viewport of the reading line: the active
 * heading is the last whose top has crossed it, and clicking an outline entry lands that heading
 * exactly on it. The two must be the same value — were the click gap smaller than the activation
 * line, a clicked heading would land above the line with the next heading already past it, and the
 * Outline marker would jump ahead by one whenever a section is shorter than the gap between them.
 */
const READING_LINE_OFFSET: number = 56;

/**
 * Divisor applied to the viewport width to probe the reading line at the editor's horizontal centre,
 * where the centred document content always sits.
 */
const READING_PROBE_DIVISOR: number = 2;

/**
 * Pixels a clicked heading is parked above the reading line. Landing it on the line exactly leaves the
 * probe at the heading's top edge, where the hit-test is ambiguous (it can resolve to the previous
 * block); the small cushion puts the probe firmly inside the heading and absorbs the slack between the
 * smooth scroll's final event and its true resting position. Must stay below the shortest heading's
 * line height so the heading still owns the line.
 */
const HEADING_LAND_BIAS: number = 8;

/**
 * Drives the Outline panel's scroll-spy for one markdown editor: walks the document for headings and
 * publishes them, tracks which heading the reader is at as the editor scrolls, and jumps to a heading
 * on demand. Owns the scroll listener (attach/detach) but not the scroll container itself — the owning
 * view is the single place that captures the live scroller and hands it in, so the same element is
 * shared with the review and read collaborators. Reads the document (not the DOM) for the heading list,
 * so the outline and the active-heading marker share one source of truth and cannot drift apart.
 */
export class OutlineScrollSpy {
  /**
   * Holds the accessor for the live editor pane, re-read on every call.
   */
  private readonly paneOf: () => MarkdownEditor | undefined;

  /**
   * Holds the command registry the outline and active heading are published to.
   */
  private readonly commands: MarkdownCommands;

  /**
   * Holds the Angular zone, used to publish to the command registry from outside change detection.
   */
  private readonly zone: NgZone;

  /**
   * Holds the accessor for whether the owning view is active, gating publishes to the ribbon.
   */
  private readonly isActive: () => boolean;

  /**
   * Holds the scroll container the spy is currently attached to, or null when detached. Kept for the
   * scroll math and for removing the listener from the exact element it was added to.
   */
  private scroller: HTMLElement | null = null;

  /**
   * Holds the document position of each heading node, in document order, captured when the outline is
   * built. The scroll-spy maps a coordinate to a position and finds the last heading at or before it,
   * so the active index always refers to the same heading list the Outline panel renders.
   */
  private headingPositions: readonly number[] = [];

  /**
   * Holds the bound scroll handler driving the active-heading scroll-spy, retained for listener
   * cleanup.
   */
  private readonly boundScrollHandler: () => void = (): void => this.updateActiveHeading();

  /**
   * Initialises the scroll-spy over the given pane accessor, command registry, zone, and active gate.
   * @param paneOf The accessor for the live editor pane.
   * @param commands The command registry the outline is published to.
   * @param zone The Angular zone.
   * @param isActive The accessor for whether the owning view is active.
   */
  public constructor(
    paneOf: () => MarkdownEditor | undefined,
    commands: MarkdownCommands,
    zone: NgZone,
    isActive: () => boolean,
  ) {
    this.paneOf = paneOf;
    this.commands = commands;
    this.zone = zone;
    this.isActive = isActive;
  }

  /**
   * Attaches the scroll-spy to a scroll container, replacing any prior attachment. The listener is
   * passive, as the spy only reads layout and never blocks the scroll.
   * @param scroller The scroll container to track.
   */
  public attach(scroller: HTMLElement): void {
    this.detach();
    this.scroller = scroller;
    scroller.addEventListener('scroll', this.boundScrollHandler, { passive: true });
  }

  /**
   * Detaches the scroll-spy from its scroll container, removing the listener.
   */
  public detach(): void {
    this.scroller?.removeEventListener('scroll', this.boundScrollHandler);
    this.scroller = null;
  }

  /**
   * Walks the document model for heading nodes and publishes the resulting outline to the command
   * registry, so the Outline panel reflects the document's headings, capturing each heading's document
   * position for the scroll-spy. Both ATX and setext headings parse to the same heading node, so both
   * are captured. Reads the document (not the DOM), so the outline and the scroll-spy share one source
   * of truth — the same heading list, in the same order — and cannot drift apart.
   */
  public refresh(): void {
    // Deferred a tick so the document reflects the latest content. Reading the document is a pure read
    // that never touches the editor's plugins, so it cannot interfere with an in-flight transaction.
    setTimeout((): void => {
      const view: EditorView | null = this.paneOf()?.getEditorView() ?? null;
      if (!this.isActive() || view === null) {
        return;
      }
      const headings: OutlineHeading[] = [];
      const positions: number[] = [];
      view.state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
        if (node.type.name !== 'heading') {
          return true;
        }
        positions.push(pos);
        headings.push({
          id: `heading-${headings.length}`,
          level: (node.attrs['level'] as number) || HEADING_LEVEL_1,
          text: node.textContent,
          index: headings.length,
        });
        return false;
      });
      this.headingPositions = positions;
      this.zone.run((): void => {
        this.commands.setOutline(headings);
      });
      this.updateActiveHeading();
    }, NEXT_TICK_DELAY);
  }

  /**
   * Jumps the editor so the heading with the given ordinal lands just above the reading line. The jump
   * is instant rather than animated: a single scroll event fires at the exact resting position, so the
   * scroll-spy reads it once and unambiguously activates the clicked heading — an animated scroll's
   * easing tail fires its final event short of rest and settles a heading off. The marker still glides
   * to the heading through its own transition.
   * @param index The heading's zero-based ordinal among the document's headings.
   */
  public goToHeading(index: number): void {
    const view: EditorView | null = this.paneOf()?.getEditorView() ?? null;
    const scroller: HTMLElement | null = this.scroller;
    const pos: number | undefined = this.headingPositions[index];
    if (view === null || scroller === null || pos === undefined) {
      return;
    }
    const headingTop: number = view.coordsAtPos(pos).top;
    const offset: number =
      headingTop -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      READING_LINE_OFFSET +
      HEADING_LAND_BIAS;
    scroller.scrollTo({ top: offset, behavior: 'auto' });
  }

  /**
   * Recomputes which heading the reader is currently at and publishes its index, so the Outline panel
   * can move its active marker. Maps the reading line ({@link READING_LINE_OFFSET} below the viewport
   * top) to a document position through the editor's own hit-testing, then takes the last heading at or
   * before that position — robust against hidden, transformed, or asynchronously-rendered content that
   * a DOM-rectangle scan trips over. Reads layout synchronously on scroll (rather than deferring to an
   * animation frame, which can be suspended) so the marker never appears frozen.
   */
  private updateActiveHeading(): void {
    const view: EditorView | null = this.paneOf()?.getEditorView() ?? null;
    if (!this.isActive() || this.scroller === null || view === null) {
      return;
    }
    if (this.headingPositions.length === 0) {
      this.zone.run((): void => this.commands.setActiveHeading(0));
      return;
    }
    const viewport: DOMRect = this.scroller.getBoundingClientRect();
    const at: { pos: number } | null = view.posAtCoords({
      left: viewport.left + viewport.width / READING_PROBE_DIVISOR,
      top: viewport.top + READING_LINE_OFFSET,
    });
    if (at === null) {
      return;
    }
    let active: number = 0;
    for (let index: number = 0; index < this.headingPositions.length; index++) {
      if (this.headingPositions[index] <= at.pos) {
        active = index;
      } else {
        break;
      }
    }
    this.zone.run((): void => this.commands.setActiveHeading(active));
  }
}
