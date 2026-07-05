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
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/preset-commonmark';
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
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { MarkdownDocument } from '@features/markdown/angular/markdown-document/markdown-document';
import {
  MarkdownBlockType,
  MarkdownCommandHandler,
  MarkdownCommands,
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
import { OutlineScrollSpy } from './outline-scroll-spy';
import { buildMarkdownCommandHandler } from './build-command-handler';

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
    PanelLayout,
    Panel,
    MarkdownDocument,
    MarkdownOutlinePanel,
    MarkdownReviewPanel,
    MarkdownAgentPanel,
    MarkdownReaderPanel,
  ],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
   * Holds the outline scroll-spy: heading extraction, active-heading tracking, and scroll-to-heading.
   * It owns the scroll listener over the shared container the view captures in {@link onReady}.
   */
  private readonly outline: OutlineScrollSpy = new OutlineScrollSpy(
    (): MarkdownEditor | undefined => this.pane(),
    this.commands,
    this.zone,
    (): boolean => this.isActive(),
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
   * Holds the width of the open tool panel, in pixels. Two-way bound to the panel's resize splitter.
   */
  protected readonly panelSize: WritableSignal<number> = signal<number>(DEFAULT_PANEL_SIZE);

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
   * Holds the editor's scroll container, captured once here and shared with the outline scroll-spy and
   * the review and read collaborators (the outline owns the scroll listener over it).
   */
  private scrollContainer: HTMLElement | null = null;

  /**
   * Holds a value indicating whether the pane's editor instance has been created.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the command handler registered with the {@link MarkdownCommands} registry while active.
   */
  private commandHandler: MarkdownCommandHandler | null = null;

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
    this.outline.detach();
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
   * Wires the editor-dependent feature state once the pane's editor exists (and again after it is
   * recreated for external content): attaches the outline scroll-spy and, on a recreate while active,
   * refreshes the outline and read model for the new document.
   */
  protected onReady(): void {
    const scroller: HTMLElement | null = this.pane()?.getScrollContainer() ?? null;
    if (scroller !== null && scroller !== this.scrollContainer) {
      this.scrollContainer = scroller;
      this.outline.attach(scroller);
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
      this.outline.refresh();
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
    this.commandHandler = buildMarkdownCommandHandler({
      clipboard: this.clipboard,
      outline: this.outline,
      paneOf: (): MarkdownEditor | undefined => this.pane(),
      setBlockType: (blockType: MarkdownBlockType): void => this.applyBlockType(blockType),
    });

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
    this.outline.refresh();
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
