import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  NgZone,
  OnDestroy,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history';
import { callCommand } from '@milkdown/utils';
import {
  wrapInCautionAlertCommand,
  wrapInImportantAlertCommand,
  wrapInNoteAlertCommand,
  wrapInTipAlertCommand,
  wrapInWarningAlertCommand,
} from '@shared/angular/milkdown/github-alert-plugin';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownDocument } from '@features/markdown/angular/markdown-document/markdown-document';
import {
  MarkdownBlockType,
  MarkdownCommandHandler,
  MarkdownCommands,
  OutlineHeading,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { PanelPosition, Settings } from '@shared/angular/services/settings/settings';
import {
  MarkdownPanel,
  MarkdownPanels,
} from '@features/markdown/angular/markdown-panels/markdown-panels';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import { Reader } from '@features/markdown/angular/markdown-reader/markdown-reader';
import { MarkdownOutlinePanel } from './panels/markdown-outline-panel/markdown-outline-panel';
import { MarkdownReviewPanel } from './panels/markdown-review-panel/markdown-review-panel';
import { MarkdownAgentPanel } from './panels/markdown-agent-panel/markdown-agent-panel';
import { MarkdownReaderPanel } from './panels/markdown-reader-panel/markdown-reader-panel';
import { MarkdownClipboard } from './markdown-clipboard';
import { ReadAlongHighlighter } from './read-along-highlighter';
import { ReviewReveal } from './review-reveal';

/**
 * Heading level for an H1 element.
 */
const HEADING_LEVEL_1: number = 1;

/**
 * Heading level for an H2 element.
 */
const HEADING_LEVEL_2: number = 2;

/**
 * Heading level for an H3 element.
 */
const HEADING_LEVEL_3: number = 3;

/**
 * Heading level for an H4 element.
 */
const HEADING_LEVEL_4: number = 4;

/**
 * Heading level for an H5 element.
 */
const HEADING_LEVEL_5: number = 5;

/**
 * Heading level for an H6 element.
 */
const HEADING_LEVEL_6: number = 6;

/**
 * Document root depth used as the lower bound when walking up the node tree from a selection.
 */
const ROOT_DEPTH: number = 0;

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
 * Minimum width of a markdown tool panel, in pixels.
 */
const MIN_PANEL_SIZE: number = 220;

/**
 * Maximum width of a markdown tool panel, in pixels.
 */
const MAX_PANEL_SIZE: number = 720;

/**
 * Default width of a markdown tool panel, in pixels.
 */
const DEFAULT_PANEL_SIZE: number = 320;

/**
 * Represents the markdown editor view: the shared {@link MarkdownEditor} pane bound to the owning
 * document, with optional Outline/Review/Agent/Reader tool panels beside it. It owns the markdown-tab
 * concerns the bare pane does not — the backing document and save target, the ribbon command handler,
 * the outline scroll-spy, the review and read sessions, and the docked tool panels and their splitter
 * — driving the pane through its imperative API.
 */
@Component({
  selector: 'app-markdown-view',
  imports: [
    MarkdownDocument,
    MarkdownOutlinePanel,
    MarkdownReviewPanel,
    MarkdownAgentPanel,
    MarkdownReaderPanel,
  ],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.panels-left]': 'panelPosition() === "left"',
  },
})
export class MarkdownView implements OnDestroy {
  /**
   * Holds the settings service supplying the markdown editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the markdown command registry the ribbon routes formatting commands through.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

  /**
   * Holds the tool-panel registry tracking which side panel (if any) is open.
   */
  private readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Holds the review service the editor registers its source, edit, and reveal seam with while active.
   */
  private readonly review: Review = inject(Review);

  /**
   * Holds the reader service the editor publishes its read model and highlight seam to while active.
   */
  private readonly reader: Reader = inject(Reader);

  /**
   * Holds the Angular zone, used to publish to the command registry from outside change detection.
   */
  private readonly zone: NgZone = inject(NgZone);

  /**
   * Holds the document-bound markdown editor this view drives, or undefined before the view
   * initialises.
   */
  private readonly documentCore: Signal<MarkdownDocument | undefined> =
    viewChild<MarkdownDocument>(MarkdownDocument);

  /**
   * Gets the shared markdown-editor pane through the document core, so this view can drive it through
   * its imperative API.
   * @returns Returns the pane, or undefined before the view initialises.
   */
  private pane(): MarkdownEditor | undefined {
    return this.documentCore()?.getPane();
  }

  /**
   * Holds the clipboard and insertion command runner, driving the pane through a live accessor so it
   * stays correct across the editor recreations that follow an external content load.
   */
  private readonly clipboard: MarkdownClipboard = new MarkdownClipboard(
    (): MarkdownEditor | undefined => this.pane(),
  );

  /**
   * Holds the review reveal collaborator: the review session seam and the flagged-issue reveal,
   * driving the pane and scroll container through live accessors.
   */
  private readonly reviewReveal: ReviewReveal = new ReviewReveal(
    (): MarkdownEditor | undefined => this.pane(),
    (): HTMLElement | null => this.scrollContainer,
    this.review,
  );

  /**
   * Holds the read-along collaborator: the read session and spoken-word highlighting, driving the pane
   * and scroll container through live accessors.
   */
  private readonly readAlong: ReadAlongHighlighter = new ReadAlongHighlighter(
    (): MarkdownEditor | undefined => this.pane(),
    (): HTMLElement | null => this.scrollContainer,
    this.zone,
    this.reader,
  );

  /**
   * Gets the tool panel currently open beside this document's editor, or `none` when none is open.
   * Read per document so each markdown tab keeps its own open panel (and its live Agent panel)
   * regardless of which tab is active.
   */
  protected readonly activePanel: Signal<MarkdownPanel> = computed(
    (): MarkdownPanel => this.panels.activeFor(this.tabId()),
  );

  /**
   * Gets which side of the editor the tool panels are shown on.
   */
  protected readonly panelPosition: Signal<PanelPosition> = computed(
    (): PanelPosition => this.settings.markdownEditor().panelPosition,
  );

  /**
   * Holds the width of the open tool panel, in pixels, adjusted by dragging the splitter.
   */
  protected readonly panelSize: WritableSignal<number> = signal<number>(DEFAULT_PANEL_SIZE);

  /**
   * Holds the pointer coordinate at the start of a panel-splitter drag.
   */
  private panelDragOrigin: number = 0;

  /**
   * Holds the panel width at the start of a panel-splitter drag.
   */
  private panelDragOriginSize: number = 0;

  /**
   * Gets the identifier of the tab this view represents, which is also the id of its backing document
   * (used to register the document and target saves at it). The document well uses the lean document
   * panel instead, so this view only ever backs a standalone markdown tab.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the view belongs to the active tab. Inactive views stay mounted
   * so their editor state is preserved, but they do not own the ribbon command handler.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the editor's scroll container, to which the scroll-spy listener is attached.
   */
  private scrollContainer: HTMLElement | null = null;

  /**
   * Holds the document position of each heading node, in document order, captured when the outline is
   * built. The scroll-spy maps a coordinate to a position and finds the last heading at or before it,
   * so the active index always refers to the same heading list the Outline panel renders.
   */
  private headingPositions: readonly number[] = [];

  /**
   * Holds a value indicating whether the pane's editor instance has been created.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the command handler registered with the {@link MarkdownCommands} registry while active.
   */
  private commandHandler: MarkdownCommandHandler | null = null;

  /**
   * Holds the bound scroll handler driving the outline's active-heading scroll-spy, retained for
   * event-listener cleanup.
   */
  private readonly boundScrollHandler: () => void = (): void => this.updateActiveHeading();

  /**
   * Initialises the view, wiring the effect that registers or releases the ribbon command handler and
   * review/read sessions as the view's active state changes.
   */
  public constructor() {
    effect((): void => {
      const active: boolean = this.isActive();
      if (!this.paneReady()) {
        return;
      }

      if (active) {
        this.registerCommandHandler();
        this.reviewReveal.register();
        this.readAlong.register();
        this.refreshActiveBlockType();
        this.panels.setActiveDocument(this.tabId());
      } else {
        if (this.commandHandler !== null) {
          this.commands.deactivate(this.tabId());
          this.commandHandler = null;
        }
        this.reviewReveal.unregister();
        this.readAlong.unregister();
      }
    });
  }

  /**
   * Releases the ribbon command handler and review/read sessions, detaches the scroll-spy, and drops
   * this document's tool-panel state. The document core releases the backing document and the pane
   * destroys the Crepe editor themselves.
   */
  public ngOnDestroy(): void {
    this.scrollContainer?.removeEventListener('scroll', this.boundScrollHandler);
    this.scrollContainer = null;
    if (this.commandHandler !== null) {
      this.commands.forget(this.tabId());
      this.commandHandler = null;
    }
    this.reviewReveal.unregister();
    this.readAlong.unregister();
    this.panels.remove(this.tabId());
  }

  /**
   * Begins a splitter drag that resizes the open tool panel. The drag direction is mirrored when the
   * panel is docked on the left so dragging towards the editor always shrinks the panel.
   * @param event The originating pointer event.
   */
  protected onPanelSplitterDown(event: MouseEvent): void {
    event.preventDefault();
    this.panelDragOrigin = event.clientX;
    this.panelDragOriginSize = this.panelSize();
    const sign: number = this.panelPosition() === 'left' ? -1 : 1;

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (this.panelDragOrigin - move.clientX) * sign;
      this.panelSize.set(
        Math.min(MAX_PANEL_SIZE, Math.max(MIN_PANEL_SIZE, this.panelDragOriginSize + delta)),
      );
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Wires the editor-dependent feature state once the pane's editor exists (and again after it is
   * recreated for external content): attaches the outline scroll-spy and, on a recreate while active,
   * refreshes the outline and read model for the new document.
   */
  protected onReady(): void {
    const scroller: HTMLElement | null = this.pane()?.getScrollContainer() ?? null;
    if (scroller !== null && scroller !== this.scrollContainer) {
      this.scrollContainer?.removeEventListener('scroll', this.boundScrollHandler);
      this.scrollContainer = scroller;
      scroller.addEventListener('scroll', this.boundScrollHandler, { passive: true });
    }

    const wasReady: boolean = this.paneReady();
    this.paneReady.set(true);
    // First creation is handled by the activation effect (triggered by paneReady). A recreate leaves
    // paneReady already true, so refresh the derived state for the new document here.
    if (wasReady && this.isActive()) {
      this.refreshActiveBlockType();
      this.review.notifySourceChanged();
      this.readAlong.publishModel();
    }
  }

  /**
   * Refreshes the history state, outline, review source, and read model when the user edits the
   * content while this view is active. The document core has already recorded the edit.
   */
  protected onContentChange(): void {
    if (this.isActive()) {
      this.publishHistoryState();
      this.refreshOutline();
      this.review.notifySourceChanged();
      this.readAlong.publishModel();
    }
  }

  /**
   * Reflects a selection change in the ribbon's active block type and history state, while active.
   * @param selection The editor's current selection.
   */
  protected onSelectionChange(selection: Selection): void {
    if (!this.isActive()) {
      return;
    }
    const blockType: MarkdownBlockType = this.resolveActiveBlockType(selection);
    this.commands.setActiveBlockType(blockType);
    this.publishHistoryState();
  }

  /**
   * Registers the ribbon command handler for this editor, mapping each command to a pane action.
   */
  private registerCommandHandler(): void {
    this.commandHandler = {
      cut: (): void => this.clipboard.clipboardCommand('cut'),
      cutAsPlaintext: (): void => this.clipboard.cutPlaintext(),
      copy: (): void => this.clipboard.clipboardCommand('copy'),
      copyAsPlaintext: (): void => this.clipboard.copyPlaintext(),
      paste: (): void => this.clipboard.pasteMarkdown(),
      pasteAsPlaintext: (): void => this.clipboard.pastePlaintext(),
      pasteAsCode: (): void => this.clipboard.pasteCode(),
      undo: (): void => this.pane()?.run(callCommand(undoCommand.key)),
      redo: (): void => this.pane()?.run(callCommand(redoCommand.key)),
      toggleBold: (): void => this.pane()?.run(callCommand(toggleStrongCommand.key)),
      toggleItalic: (): void => this.pane()?.run(callCommand(toggleEmphasisCommand.key)),
      toggleStrikethrough: (): void =>
        this.pane()?.run(callCommand(toggleStrikethroughCommand.key)),
      toggleInlineCode: (): void => this.pane()?.run(callCommand(toggleInlineCodeCommand.key)),
      toggleBulletList: (): void => this.pane()?.run(callCommand(wrapInBulletListCommand.key)),
      toggleOrderedList: (): void => this.pane()?.run(callCommand(wrapInOrderedListCommand.key)),
      insertTable: (): void => this.pane()?.run(callCommand(insertTableCommand.key)),
      insertHorizontalRule: (): void => this.pane()?.run(callCommand(insertHrCommand.key)),
      insertMarkdown: (markdown: string): void => this.clipboard.insertParsedBlock(markdown),
      insertInlineMarkdown: (markdown: string): void => this.clipboard.insertParsedInline(markdown),
      insertText: (text: string): void => this.clipboard.insertRawText(text),
      appendMarkdown: (markdown: string): void => this.clipboard.appendParsedBlock(markdown),
      setBlockType: (blockType: MarkdownBlockType): void => this.applyBlockType(blockType),
      goToHeading: (index: number): void => this.scrollToHeading(index),
      readDocument: (): string => this.pane()?.getMarkdown() ?? '',
      replaceDocument: (markdown: string): void => this.pane()?.replaceAll(markdown),
    };

    this.commands.register(this.tabId(), this.commandHandler);
  }

  /**
   * Applies a block type to the current block by dispatching the matching Crepe command.
   * @param blockType The block type to apply.
   */
  private applyBlockType(blockType: MarkdownBlockType): void {
    const pane: MarkdownEditor | undefined = this.pane();
    if (pane === undefined) {
      return;
    }
    switch (blockType) {
      case 'paragraph':
        pane.run(callCommand(turnIntoTextCommand.key));
        break;
      case 'blockquote':
        pane.run(callCommand(wrapInBlockquoteCommand.key));
        break;
      case 'code-block':
        pane.run(callCommand(createCodeBlockCommand.key));
        break;
      case 'heading-1':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_1));
        break;
      case 'heading-2':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_2));
        break;
      case 'heading-3':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_3));
        break;
      case 'heading-4':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_4));
        break;
      case 'heading-5':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_5));
        break;
      case 'heading-6':
        pane.run(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_6));
        break;
      case 'alert-note':
        pane.run(callCommand(wrapInNoteAlertCommand.key));
        break;
      case 'alert-tip':
        pane.run(callCommand(wrapInTipAlertCommand.key));
        break;
      case 'alert-important':
        pane.run(callCommand(wrapInImportantAlertCommand.key));
        break;
      case 'alert-warning':
        pane.run(callCommand(wrapInWarningAlertCommand.key));
        break;
      case 'alert-caution':
        pane.run(callCommand(wrapInCautionAlertCommand.key));
        break;
    }
  }

  /**
   * Reads the current selection and publishes its block type to the command registry, so the ribbon
   * reflects the cursor even when no selection-change event has fired (for example on activation).
   */
  private refreshActiveBlockType(): void {
    const view: EditorView | null = this.pane()?.getEditorView() ?? null;
    if (view === null || !this.isActive()) {
      return;
    }
    const blockType: MarkdownBlockType = this.resolveActiveBlockType(view.state.selection);
    this.zone.run((): void => {
      this.commands.setActiveBlockType(blockType);
    });
    this.publishHistoryState();
    // Refresh the outline from the rendered DOM (deferred), so activating a tab whose content has not
    // changed still populates the Outline panel.
    this.refreshOutline();
  }

  /**
   * Publishes whether the editor currently has undoable and redoable edits to the command registry, so
   * the ribbon can enable or disable its Undo and Redo controls.
   */
  private publishHistoryState(): void {
    const view: EditorView | null = this.pane()?.getEditorView() ?? null;
    if (view === null) {
      return;
    }
    let canUndo: boolean = false;
    let canRedo: boolean = false;
    try {
      // These read the history plugin's state, which is not yet available while the initial content
      // load transaction is applying; reading it then throws into the transaction and corrupts the
      // editor, so guard it and skip until the plugin is ready.
      canUndo = undoDepth(view.state) > 0;
      canRedo = redoDepth(view.state) > 0;
    } catch {
      return;
    }
    this.zone.run((): void => {
      this.commands.setHistoryState(canUndo, canRedo);
    });
  }

  /**
   * Walks the document model for heading nodes and publishes the resulting outline to the command
   * registry, so the Outline panel reflects the document's headings, capturing each heading's document
   * position for the scroll-spy. Both ATX and setext headings parse to the same heading node, so both
   * are captured. Reads the document (not the DOM), so the outline and the scroll-spy share one source
   * of truth — the same heading list, in the same order — and cannot drift apart.
   */
  private refreshOutline(): void {
    // Deferred a tick so the document reflects the latest content. Reading the document is a pure read
    // that never touches the editor's plugins, so it cannot interfere with an in-flight transaction.
    setTimeout((): void => {
      const view: EditorView | null = this.pane()?.getEditorView() ?? null;
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
   * Recomputes which heading the reader is currently at and publishes its index, so the Outline panel
   * can move its active marker. Maps the reading line ({@link READING_LINE_OFFSET} below the viewport
   * top) to a document position through the editor's own hit-testing, then takes the last heading at or
   * before that position — robust against hidden, transformed, or asynchronously-rendered content that
   * a DOM-rectangle scan trips over. Reads layout synchronously on scroll (rather than deferring to an
   * animation frame, which can be suspended) so the marker never appears frozen.
   */
  private updateActiveHeading(): void {
    const view: EditorView | null = this.pane()?.getEditorView() ?? null;
    if (!this.isActive() || this.scrollContainer === null || view === null) {
      return;
    }
    if (this.headingPositions.length === 0) {
      this.zone.run((): void => this.commands.setActiveHeading(0));
      return;
    }
    const viewport: DOMRect = this.scrollContainer.getBoundingClientRect();
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

  /**
   * Jumps the editor so the heading with the given ordinal lands just above the reading line. The jump
   * is instant rather than animated: a single scroll event fires at the exact resting position, so the
   * scroll-spy reads it once and unambiguously activates the clicked heading — an animated scroll's
   * easing tail fires its final event short of rest and settles a heading off. The marker still glides
   * to the heading through its own transition.
   * @param index The heading's zero-based ordinal among the document's headings.
   */
  private scrollToHeading(index: number): void {
    const view: EditorView | null = this.pane()?.getEditorView() ?? null;
    const scroller: HTMLElement | null = this.scrollContainer;
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
   * Determines the block type of the node containing a selection by walking up the document tree.
   * @param selection The current editor selection.
   * @returns Returns the block type at the selection.
   */
  private resolveActiveBlockType(selection: Selection): MarkdownBlockType {
    const from: Selection['$from'] = selection.$from;
    for (let depth: number = from.depth; depth >= ROOT_DEPTH; depth--) {
      const node: ProseMirrorNode = from.node(depth);
      const name: string = node.type.name;
      if (name === 'heading') {
        return `heading-${node.attrs['level'] as number}` as MarkdownBlockType;
      }
      if (name === 'code_block') {
        return 'code-block';
      }
      if (name === 'blockquote') {
        return 'blockquote';
      }
      if (name === 'alert_block') {
        return `alert-${node.attrs['alertType'] as string}` as MarkdownBlockType;
      }
    }
    return 'paragraph';
  }
}
