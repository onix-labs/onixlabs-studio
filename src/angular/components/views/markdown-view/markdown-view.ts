import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  SimpleChanges,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Slice, type Node as ProseMirrorNode, type NodeType } from '@milkdown/kit/prose/model';
import { AllSelection, type Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { ListenerManager } from '@milkdown/plugin-listener';
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
import type { Parser } from '@milkdown/transformer';
import { blockReorderPlugin } from '../../../milkdown/block-reorder-plugin';
import { colorPreviewPlugin } from '../../../milkdown/color-preview-plugin';
import { emojiPlugin } from '../../../milkdown/emoji-plugin';
import { footnotePlugin } from '../../../milkdown/footnote-plugin';
import {
  githubAlertPlugin,
  wrapInCautionAlertCommand,
  wrapInImportantAlertCommand,
  wrapInNoteAlertCommand,
  wrapInTipAlertCommand,
  wrapInWarningAlertCommand,
} from '../../../milkdown/github-alert-plugin';
import { htmlImagePlugin } from '../../../milkdown/html-image-plugin';
import { fileToDataUrl, installImageResolver } from '../../../milkdown/media-source';
import { mermaidPlugin, renderMermaidDiagram } from '../../../milkdown/mermaid-plugin';
import { pasteCleanPlugin } from '../../../milkdown/paste-clean-plugin';
import { subscriptSuperscriptPlugin } from '../../../milkdown/subscript-superscript-plugin';
import { Milkdown } from '../../../services/milkdown/milkdown';
import { Documents } from '../../../services/documents/documents';
import {
  MarkdownBlockType,
  MarkdownCommandHandler,
  MarkdownCommands,
  OutlineHeading,
} from '../../../services/markdown-commands/markdown-commands';
import {
  ImageAlignment,
  ImageSizing,
  MarginSize,
  PanelPosition,
  Settings,
} from '../../../services/settings/settings';
import {
  MarkdownPanel,
  MarkdownPanels,
} from '../../../services/markdown-panels/markdown-panels';
import { Review } from '../../../services/markdown-review/markdown-review';
import { ReviewIssue, ReviewSession } from '../../../services/markdown-review/review-types';
import { Reader } from '../../../services/markdown-reader/markdown-reader';
import { HighlightMode, ReadSession } from '../../../services/markdown-reader/reader-types';
import { buildReadModel, ReadModel } from '../../../services/markdown-reader/read-model';
import { ReadWord } from '../../../services/markdown-reader/read-tokenize';
import { MarkdownOutlinePanel } from './panels/markdown-outline-panel/markdown-outline-panel';
import { MarkdownReviewPanel } from './panels/markdown-review-panel/markdown-review-panel';
import { MarkdownAgentPanel } from './panels/markdown-agent-panel/markdown-agent-panel';
import { MarkdownReaderPanel } from './panels/markdown-reader-panel/markdown-reader-panel';

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
 * Minimum number of rows for the HTML image editor textarea.
 */
const HTML_IMAGE_EDITOR_MIN_ROWS: number = 3;

/**
 * Minimum number of rows for the mermaid editor textarea.
 */
const MERMAID_EDITOR_MIN_ROWS: number = 5;

/**
 * Number of extra rows added beyond a textarea's content line count.
 */
const TEXTAREA_EXTRA_ROWS: number = 1;

/**
 * Initial value for the mermaid diagram ID counter.
 */
const INITIAL_MERMAID_ID: number = 0;

/**
 * Sentinel returned by {@link String.indexOf} when no match is found.
 */
const NOT_FOUND: number = -1;

/**
 * Single-character step used when scanning rendered text for the next occurrence of a word.
 */
const WORD_STEP: number = 1;

/**
 * Minimum source length used when computing a review reveal's proportional position, guarding against
 * division by zero on an empty document.
 */
const MIN_SOURCE_LENGTH: number = 1;

/**
 * Divisor that centres a revealed review range within the scroll viewport.
 */
const REVEAL_CENTRE_DIVISOR: number = 2;

/**
 * CSS Custom Highlight registry name for a revealed review issue.
 */
const REVIEW_HIGHLIGHT_NAME: string = 'markdown-review-flag';

/**
 * Duration in milliseconds the review reveal highlight stays before it is cleared.
 */
const REVIEW_FLASH_DURATION: number = 1600;

/**
 * CSS Custom Highlight registry name for the read-along spoken word.
 */
const READ_HIGHLIGHT_WORD: string = 'markdown-read-word';

/**
 * CSS Custom Highlight registry name for the read-along spoken sentence.
 */
const READ_HIGHLIGHT_SENTENCE: string = 'markdown-read-sentence';

/**
 * Comfort margin in pixels from the viewport edges within which the spoken word is considered visible
 * and does not trigger a follow scroll.
 */
const READ_REVEAL_MARGIN: number = 120;

/**
 * Display name given to a new, unsaved markdown document.
 */
const NEW_MARKDOWN_DOCUMENT_NAME: string = 'New Document';

/**
 * Monaco language identifier applied to markdown documents, so a new document still serialises and
 * saves as markdown before it has a file extension.
 */
const MARKDOWN_LANGUAGE: string = 'markdown';

/**
 * Represents the markdown editor view, hosting a Milkdown Crepe WYSIWYG editor with the application's
 * custom plugins, theming and ribbon command integration.
 */
@Component({
  selector: 'app-markdown-view',
  imports: [MarkdownOutlinePanel, MarkdownReviewPanel, MarkdownAgentPanel, MarkdownReaderPanel],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.panels-left]': 'panelPosition() === "left"',
  },
})
export class MarkdownView implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  /**
   * Holds the service resolving markdown editor styles from settings.
   */
  private readonly milkdown: Milkdown = inject(Milkdown);

  /**
   * Holds the documents service owning the tab's content, file association and dirty state.
   */
  private readonly documents: Documents = inject(Documents);

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
   * Holds the review session registered with the {@link Review} service while active, or null.
   */
  private reviewSession: ReviewSession | null = null;

  /**
   * Holds the pending timer that clears the review reveal highlight, or null when none is scheduled.
   */
  private reviewFlashTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the reader service the editor publishes its read model and highlight seam to while active.
   */
  private readonly reader: Reader = inject(Reader);

  /**
   * Holds the read session registered with the {@link Reader} service while active, or null.
   */
  private readSession: ReadSession | null = null;

  /**
   * Holds the words of the current read model, in rendered-DOM order.
   */
  private readWords: readonly ReadWord[] = [];

  /**
   * Holds a DOM range per read-model word, aligned to {@link readWords} by index.
   */
  private readWordRanges: readonly Range[] = [];

  /**
   * Gets the tool panel currently open beside the editor, or `none` when none is open.
   */
  protected readonly activePanel: Signal<MarkdownPanel> = this.panels.active;

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
   * Holds the Angular zone, used to create the editor outside change detection.
   */
  private readonly zone: NgZone = inject(NgZone);

  /**
   * Holds a reference to the editor container element Crepe mounts into.
   */
  private readonly editorContainer: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('editorContainer');

  /**
   * Holds a reference to the editor wrapper element, used to capture clicks in the empty area below
   * the content so they focus the editor.
   */
  private readonly editorWrapper: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('editorWrapper');

  /**
   * Gets the identifier of the backing document, used to register the document and target saves at
   * it. For a standalone markdown tab this is the tab id; in a workspace's document well it is the
   * well document id.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the backing document is released when this view is destroyed. True for standalone
   * markdown tabs, whose destruction means the tab was closed. False inside the document well, where
   * the workspace owns the document's lifecycle and a destroy is a re-parent, not a close.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the markdown content the editor is initialised with.
   */
  public readonly content: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the editor is read-only.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the view belongs to the active tab. Inactive views stay mounted
   * so their editor state is preserved, but they do not own the ribbon command handler.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the serialised markdown whenever the user edits the content.
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the document margin size, bound to a max-width class on the wrapper.
   */
  protected readonly marginClass: Signal<MarginSize> = this.milkdown.marginSize;

  /**
   * Gets the image sizing behaviour, bound to a class that constrains rendered images.
   */
  protected readonly imageSizing: Signal<ImageSizing> = this.milkdown.imageSizing;

  /**
   * Gets the image alignment, bound to a class that horizontally aligns rendered images.
   */
  protected readonly imageAlignment: Signal<ImageAlignment> = this.milkdown.imageAlignment;

  /**
   * Holds the Crepe editor instance, or null before creation and after destruction.
   */
  private crepe: Crepe | null = null;

  /**
   * Holds the disposer that stops the local-image source resolver, or null when no editor is mounted.
   */
  private disposeImageResolver: (() => void) | null = null;

  /**
   * Holds a value indicating whether the next content input change should be ignored because it
   * originated from the user's own edit (which was just emitted).
   */
  private ignoreNextChange: boolean = false;

  /**
   * Holds a value indicating whether the first `markdownUpdated` event has been received. Milkdown
   * fires it after parsing the initial content (which may normalise it), so the first is ignored.
   */
  private hasReceivedFirstUpdate: boolean = false;

  /**
   * Holds a value indicating whether the editor is ready for interaction.
   */
  private readonly isEditorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the command handler registered with the {@link MarkdownCommands} registry while active.
   */
  private commandHandler: MarkdownCommandHandler | null = null;

  /**
   * Holds the bound HTML image click handler, retained for event-listener cleanup.
   */
  private readonly boundHtmlImageClickHandler: (event: Event) => void =
    this.handleHtmlImageClick.bind(this);

  /**
   * Holds the bound mermaid diagram click handler, retained for event-listener cleanup.
   */
  private readonly boundMermaidClickHandler: (event: Event) => void =
    this.handleMermaidClick.bind(this);

  /**
   * Holds the bound backdrop mousedown handler, retained for event-listener cleanup.
   */
  private readonly boundBackdropMousedownHandler: (event: Event) => void =
    this.handleBackdropMousedown.bind(this);

  /**
   * Holds the bound keydown handler backing the editor's save shortcut, retained for cleanup.
   */
  private readonly boundKeydownHandler: (event: KeyboardEvent) => void =
    this.handleKeydown.bind(this);

  /**
   * Holds the bound capture-phase handler for the progressive Select All chord, retained for cleanup.
   * Capture phase so it runs before ProseMirror's own Mod-a binding.
   */
  private readonly boundSelectAllHandler: (event: KeyboardEvent) => void =
    this.handleSelectAll.bind(this);

  /**
   * Holds the bound scroll handler driving the outline's active-heading scroll-spy, retained for
   * event-listener cleanup.
   */
  private readonly boundScrollHandler: () => void = (): void => this.updateActiveHeading();

  /**
   * Holds the editor's scroll container, to which the scroll-spy listener is attached.
   */
  private scrollContainer: HTMLElement | null = null;

  /**
   * Holds the editor view, used to derive the outline from the document model and to map the reading
   * line's screen coordinate to a document position for the scroll-spy. Null before creation.
   */
  private editorView: EditorView | null = null;

  /**
   * Holds the document position of each heading node, in document order, captured when the outline is
   * built. The scroll-spy maps a coordinate to a position and finds the last heading at or before it,
   * so the active index always refers to the same heading list the Outline panel renders.
   */
  private headingPositions: readonly number[] = [];

  /**
   * Holds the currently-editing HTML image block element, or null.
   */
  private currentHtmlImageBlock: HTMLElement | null = null;

  /**
   * Holds the active HTML image editor textarea, or null.
   */
  private htmlImageEditor: HTMLTextAreaElement | null = null;

  /**
   * Holds the currently-editing mermaid diagram block element, or null.
   */
  private currentMermaidBlock: HTMLElement | null = null;

  /**
   * Holds the active mermaid editor textarea, or null.
   */
  private mermaidEditor: HTMLTextAreaElement | null = null;

  /**
   * Holds a counter used to generate unique mermaid diagram IDs while editing.
   */
  private mermaidIdCounter: number = INITIAL_MERMAID_ID;

  /**
   * Initialises the view, wiring effects that re-apply editor styles on settings changes and
   * register or release the ribbon command handler as the view's active state changes.
   */
  public constructor() {
    effect((): void => {
      this.settings.markdownEditor();
      if (this.isEditorReady()) {
        this.applyEditorStyles();
      }
    });

    effect((): void => {
      const active: boolean = this.isActive();
      const ready: boolean = this.isEditorReady();
      if (!ready || this.crepe === null) {
        return;
      }

      if (active) {
        this.registerCommandHandler();
        this.registerReviewSession();
        this.registerReadSession();
        this.refreshActiveBlockType();
        this.documents.setActiveDocument(this.documentId());
        this.focusEditor();
      } else {
        if (this.commandHandler !== null) {
          this.commands.deactivate(this.documentId());
          this.commandHandler = null;
        }
        this.unregisterReviewSession();
        this.unregisterReadSession();
      }
    });
  }

  /**
   * Registers the backing document so the ribbon's save commands target it, seeding a new markdown
   * document with its display name and language. An existing document (a file opened into the well)
   * keeps its own name and content.
   */
  public ngOnInit(): void {
    this.documents.ensure(this.documentId(), NEW_MARKDOWN_DOCUMENT_NAME);
    this.documents.setLanguage(this.documentId(), MARKDOWN_LANGUAGE);
  }

  /**
   * Creates the editor once the view's elements are available and starts the outline scroll-spy.
   */
  public ngAfterViewInit(): void {
    void this.createEditor();
    this.scrollContainer =
      this.editorContainer().nativeElement.closest<HTMLElement>('.editor-scroll');
    this.scrollContainer?.addEventListener('scroll', this.boundScrollHandler, { passive: true });
  }

  /**
   * Handles input property changes, recreating the editor on external content updates and toggling
   * the read-only state.
   * @param changes The set of changed input properties.
   */
  public ngOnChanges(changes: SimpleChanges): void {
    if (this.crepe === null || !this.isEditorReady()) {
      return;
    }

    const contentChange: SimpleChanges[string] | undefined = changes['content'];
    if (contentChange !== undefined && !contentChange.firstChange) {
      if (this.ignoreNextChange) {
        this.ignoreNextChange = false;
      } else if (this.crepe.getMarkdown() !== this.content()) {
        void this.destroyEditor().then((): Promise<void> => this.createEditor());
      }
    }

    const readOnlyChange: SimpleChanges[string] | undefined = changes['readOnly'];
    if (readOnlyChange !== undefined && !readOnlyChange.firstChange) {
      this.crepe.setReadonly(this.readOnly());
    }
  }

  /**
   * Destroys the editor when the component is torn down, clearing the active-document focus and
   * releasing the backing document when this view owns its lifecycle (a standalone tab).
   */
  public ngOnDestroy(): void {
    this.scrollContainer?.removeEventListener('scroll', this.boundScrollHandler);
    this.scrollContainer = null;
    void this.destroyEditor();
    if (this.documents.activeDocumentId() === this.documentId()) {
      this.documents.setActiveDocument(null);
    }
    if (this.removeOnDestroy()) {
      this.documents.remove(this.documentId());
    }
  }

  /**
   * Gets the absolute directory of the backing document's file, against which a relative image source
   * resolves. Returns an empty string when the document has no path yet (an unsaved tab), in which case
   * relative images cannot be located until the document is saved.
   * @returns Returns the document's directory, or an empty string.
   */
  private documentDirectory(): string {
    const filePath: string | null = this.documents.get(this.documentId())?.filePath() ?? null;
    if (filePath === null) {
      return '';
    }
    const separator: number = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return separator < 0 ? '' : filePath.slice(0, separator);
  }

  /**
   * Creates the Crepe editor, registers the application's plugins, and wires its listeners. Runs
   * outside the Angular zone so the editor's own DOM churn does not trigger change detection.
   */
  private async createEditor(): Promise<void> {
    const container: HTMLDivElement = this.editorContainer().nativeElement;
    const imageSizing: ImageSizing = this.milkdown.imageSizing();

    await this.zone.runOutsideAngular(async (): Promise<void> => {
      const crepe: Crepe = new Crepe({
        root: container,
        defaultValue: this.content(),
        features: {
          [Crepe.Feature.BlockEdit]: true,
          [Crepe.Feature.CodeMirror]: true,
          [Crepe.Feature.Cursor]: true,
          [Crepe.Feature.ImageBlock]: imageSizing === 'sizable',
          [Crepe.Feature.Latex]: true,
          [Crepe.Feature.LinkTooltip]: true,
          [Crepe.Feature.ListItem]: true,
          [Crepe.Feature.Placeholder]: true,
          [Crepe.Feature.Table]: true,
          // The app provides a fixed formatting ribbon, so Crepe's inline toolbar is redundant.
          [Crepe.Feature.Toolbar]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: { text: 'Start writing...' },
          [Crepe.Feature.CodeMirror]: { previewOnlyByDefault: true },
          // Embed a pasted or dropped image as a self-contained data URL so it persists across a save
          // and reopen; Crepe's default blob URL is discarded when the editor is torn down.
          [Crepe.Feature.ImageBlock]: {
            onUpload: (file: File): Promise<string> => fileToDataUrl(file),
          },
        },
      });

      crepe.editor.use(pasteCleanPlugin);
      crepe.editor.use(subscriptSuperscriptPlugin);
      crepe.editor.use(htmlImagePlugin);
      crepe.editor.use(githubAlertPlugin);
      crepe.editor.use(colorPreviewPlugin);
      crepe.editor.use(mermaidPlugin);
      crepe.editor.use(footnotePlugin);
      crepe.editor.use(emojiPlugin);
      crepe.editor.use(blockReorderPlugin);

      crepe.on((api: ListenerManager): void => {
        api.markdownUpdated((ctx: Ctx, markdown: string): void => {
          // The very first update fires while the editor is still being created (the initial content
          // load); doing work here breaks that init, so skip it. The initial outline is instead
          // published on a deferred tick by refreshOutlineSoon once creation has settled.
          if (!this.hasReceivedFirstUpdate) {
            this.hasReceivedFirstUpdate = true;
            return;
          }
          this.zone.run((): void => {
            this.ignoreNextChange = true;
            this.contentChange.emit(markdown);
          });
          if (this.isActive()) {
            this.publishHistoryState(ctx.get(editorViewCtx));
            this.refreshOutline();
            this.zone.run((): void => this.review.notifySourceChanged());
            this.publishReadModel();
          }
        });

        api.selectionUpdated((ctx: Ctx, selection: Selection): void => {
          if (!this.isActive()) {
            return;
          }
          const blockType: MarkdownBlockType = this.resolveActiveBlockType(selection);
          this.zone.run((): void => {
            this.commands.setActiveBlockType(blockType);
          });
          this.publishHistoryState(ctx.get(editorViewCtx));
        });
      });

      this.crepe = crepe;
      await crepe.create();

      // Capture the editor view so the outline can be derived from the document model and the
      // scroll-spy can map screen coordinates to document positions (see updateActiveHeading).
      crepe.editor.action((ctx: Ctx): void => {
        this.editorView = ctx.get(editorViewCtx);
      });

      if (this.readOnly()) {
        crepe.setReadonly(true);
      }

      this.applyEditorStyles();

      // Rewrite local image sources to the media scheme so they load through the main process; remote,
      // data and blob sources are left untouched.
      this.disposeImageResolver = installImageResolver(container, (): string =>
        this.documentDirectory(),
      );

      container.addEventListener('click', this.boundHtmlImageClickHandler);
      container.addEventListener('click', this.boundMermaidClickHandler);
      container.addEventListener('keydown', this.boundKeydownHandler);
      container.addEventListener('keydown', this.boundSelectAllHandler, { capture: true });
      this.editorWrapper().nativeElement.addEventListener(
        'mousedown',
        this.boundBackdropMousedownHandler,
      );

      this.zone.run((): void => {
        this.isEditorReady.set(true);
      });
    });
  }

  /**
   * Destroys the Crepe editor, removing listeners and releasing the command handler.
   */
  private async destroyEditor(): Promise<void> {
    this.disposeImageResolver?.();
    this.disposeImageResolver = null;

    const container: HTMLDivElement | undefined = this.editorContainer()?.nativeElement;
    if (container !== undefined) {
      container.removeEventListener('click', this.boundHtmlImageClickHandler);
      container.removeEventListener('click', this.boundMermaidClickHandler);
      container.removeEventListener('keydown', this.boundKeydownHandler);
      container.removeEventListener('keydown', this.boundSelectAllHandler, { capture: true });
    }

    const wrapper: HTMLDivElement | undefined = this.editorWrapper()?.nativeElement;
    wrapper?.removeEventListener('mousedown', this.boundBackdropMousedownHandler);

    this.closeHtmlImageEditor();
    this.closeMermaidEditor();

    if (this.commandHandler !== null) {
      this.commands.forget(this.documentId());
      this.commandHandler = null;
    }
    this.unregisterReviewSession();
    this.unregisterReadSession();

    if (this.crepe !== null) {
      await this.crepe.destroy();
      this.crepe = null;
      this.isEditorReady.set(false);
    }

    this.editorView = null;
    this.headingPositions = [];
    this.hasReceivedFirstUpdate = false;
  }

  /**
   * Applies the resolved markdown CSS custom properties to the `.milkdown` element so the editor
   * honours the configured fonts and base size.
   */
  private applyEditorStyles(): void {
    const milkdownElement: HTMLElement | null | undefined =
      this.editorContainer()?.nativeElement.querySelector<HTMLElement>('.milkdown');
    if (milkdownElement === null || milkdownElement === undefined) {
      return;
    }
    const properties: Record<string, string> = this.milkdown.getCssCustomProperties();
    for (const [name, value] of Object.entries(properties)) {
      milkdownElement.style.setProperty(name, value);
    }
  }

  /**
   * Registers the ribbon command handler for this editor, mapping each command to a Crepe action.
   */
  private registerCommandHandler(): void {
    const crepe: Crepe | null = this.crepe;
    if (crepe === null) {
      return;
    }

    this.commandHandler = {
      cut: (): void => this.clipboardCommand('cut'),
      cutAsPlaintext: (): void => this.cutPlaintext(crepe),
      copy: (): void => this.clipboardCommand('copy'),
      copyAsPlaintext: (): void => this.copyPlaintext(crepe),
      paste: (): void => this.pasteMarkdown(crepe),
      pasteAsPlaintext: (): void => this.pastePlaintext(crepe),
      pasteAsCode: (): void => this.pasteCode(crepe),
      undo: (): void => this.run(crepe, callCommand(undoCommand.key)),
      redo: (): void => this.run(crepe, callCommand(redoCommand.key)),
      toggleBold: (): void => this.run(crepe, callCommand(toggleStrongCommand.key)),
      toggleItalic: (): void => this.run(crepe, callCommand(toggleEmphasisCommand.key)),
      toggleStrikethrough: (): void => this.run(crepe, callCommand(toggleStrikethroughCommand.key)),
      toggleInlineCode: (): void => this.run(crepe, callCommand(toggleInlineCodeCommand.key)),
      toggleBulletList: (): void => this.run(crepe, callCommand(wrapInBulletListCommand.key)),
      toggleOrderedList: (): void => this.run(crepe, callCommand(wrapInOrderedListCommand.key)),
      insertTable: (): void => this.run(crepe, callCommand(insertTableCommand.key)),
      insertHorizontalRule: (): void => this.run(crepe, callCommand(insertHrCommand.key)),
      insertMarkdown: (markdown: string): void => this.insertParsedBlock(crepe, markdown),
      insertInlineMarkdown: (markdown: string): void => this.insertParsedInline(crepe, markdown),
      insertText: (text: string): void => this.insertRawText(crepe, text),
      appendMarkdown: (markdown: string): void => this.appendParsedBlock(crepe, markdown),
      setBlockType: (blockType: MarkdownBlockType): void => this.applyBlockType(crepe, blockType),
      goToHeading: (index: number): void => this.scrollToHeading(index),
      readDocument: (): string => crepe.getMarkdown(),
      replaceDocument: (markdown: string): void => this.replaceDocument(markdown),
    };

    this.commands.register(this.documentId(), this.commandHandler);
  }

  /**
   * Focuses the editor, then runs a Crepe editor action.
   * @param crepe The editor instance.
   * @param action The action to run.
   */
  private run(crepe: Crepe, action: (ctx: Ctx) => unknown): void {
    this.focusEditor();
    crepe.editor.action(action);
  }

  /**
   * Focuses the editor and runs a native clipboard command (cut or copy) against its selection, so
   * the editor's own clipboard serialisation handles the formatted content.
   * @param command The clipboard command to execute.
   */
  private clipboardCommand(command: 'cut' | 'copy'): void {
    this.focusEditor();
    document.execCommand(command);
  }

  /**
   * Copies the current selection to the clipboard as unformatted plain text, discarding markdown
   * syntax. Blocks are joined with newlines so multi-paragraph selections survive as readable text.
   * @param crepe The editor instance.
   */
  private copyPlaintext(crepe: Crepe): void {
    crepe.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      const selection: Selection = view.state.selection;
      const text: string = view.state.doc.textBetween(selection.from, selection.to, '\n');
      void navigator.clipboard.writeText(text).catch((): void => undefined);
      view.focus();
    });
  }

  /**
   * Cuts the current selection to the clipboard as unformatted plain text, then deletes it.
   * @param crepe The editor instance.
   */
  private cutPlaintext(crepe: Crepe): void {
    crepe.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      const selection: Selection = view.state.selection;
      const text: string = view.state.doc.textBetween(selection.from, selection.to, '\n');
      void navigator.clipboard.writeText(text).catch((): void => undefined);
      view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
      view.focus();
    });
  }

  /**
   * Reads the clipboard text and, when it holds any, hands it to the given editor action. Browsers
   * block programmatic `paste`, so each paste variant reads the clipboard and inserts the text itself.
   * @param action The action to run with the clipboard text.
   */
  private withClipboardText(action: (text: string) => void): void {
    void navigator.clipboard
      .readText()
      .then((text: string): void => {
        if (text.length === 0) {
          return;
        }
        action(text);
      })
      .catch((): void => undefined);
  }

  /**
   * Pastes the clipboard contents at the selection, parsing them as markdown so formatting is
   * preserved.
   * @param crepe The editor instance.
   */
  private pasteMarkdown(crepe: Crepe): void {
    this.withClipboardText((text: string): void => {
      crepe.editor.action((ctx: Ctx): void => {
        const parser: Parser = ctx.get(parserCtx);
        const doc: ProseMirrorNode = parser(text);
        const view: EditorView = ctx.get(editorViewCtx);
        const slice: Slice = new Slice(doc.content, 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        view.focus();
      });
    });
  }

  /**
   * Pastes the clipboard contents at the selection as unformatted plain text.
   * @param crepe The editor instance.
   */
  private pastePlaintext(crepe: Crepe): void {
    this.withClipboardText((text: string): void => {
      crepe.editor.action((ctx: Ctx): void => {
        const view: EditorView = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        view.focus();
      });
    });
  }

  /**
   * Pastes the clipboard contents at the selection as a code block.
   * @param crepe The editor instance.
   */
  private pasteCode(crepe: Crepe): void {
    this.withClipboardText((text: string): void => {
      crepe.editor.action((ctx: Ctx): void => {
        const view: EditorView = ctx.get(editorViewCtx);
        const codeBlockType: NodeType | undefined = view.state.schema.nodes['code_block'];
        if (codeBlockType === undefined) {
          return;
        }
        const codeBlock: ProseMirrorNode = codeBlockType.create(null, view.state.schema.text(text));
        view.dispatch(view.state.tr.replaceSelectionWith(codeBlock).scrollIntoView());
        view.focus();
      });
    });
  }

  /**
   * Parses markdown and inserts it as block-level content at the cursor, replacing any selection.
   * @param crepe The editor instance.
   * @param markdown The markdown to parse and insert.
   */
  private insertParsedBlock(crepe: Crepe, markdown: string): void {
    this.run(crepe, (ctx: Ctx): void => {
      const parser: Parser = ctx.get(parserCtx);
      const doc: ProseMirrorNode = parser(markdown);
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Parses markdown and inserts its inline content at the cursor, replacing any selection. The parsed
   * document's first block holds the inline content (such as a link), which is spliced into the
   * current block rather than inserted as a new paragraph.
   * @param crepe The editor instance.
   * @param markdown The inline markdown to parse and insert.
   */
  private insertParsedInline(crepe: Crepe, markdown: string): void {
    this.run(crepe, (ctx: Ctx): void => {
      const parser: Parser = ctx.get(parserCtx);
      const doc: ProseMirrorNode = parser(markdown);
      const view: EditorView = ctx.get(editorViewCtx);
      const block: ProseMirrorNode | null = doc.content.firstChild;
      const inline: Slice = new Slice(block !== null ? block.content : doc.content, 0, 0);
      view.dispatch(view.state.tr.replaceSelection(inline).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Inserts raw text at the cursor, replacing any selection.
   * @param crepe The editor instance.
   * @param text The text to insert.
   */
  private insertRawText(crepe: Crepe, text: string): void {
    this.run(crepe, (ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Parses markdown and appends it as block-level content at the end of the document, leaving the
   * selection where it was. Used for content that lives apart from the cursor, such as a footnote
   * definition.
   * @param crepe The editor instance.
   * @param markdown The markdown to parse and append.
   */
  private appendParsedBlock(crepe: Crepe, markdown: string): void {
    this.run(crepe, (ctx: Ctx): void => {
      const parser: Parser = ctx.get(parserCtx);
      const doc: ProseMirrorNode = parser(markdown);
      const view: EditorView = ctx.get(editorViewCtx);
      const end: number = view.state.doc.content.size;
      view.dispatch(view.state.tr.insert(end, doc.content).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Applies a block type to the current block by dispatching the matching Crepe command.
   * @param crepe The editor instance.
   * @param blockType The block type to apply.
   */
  private applyBlockType(crepe: Crepe, blockType: MarkdownBlockType): void {
    this.focusEditor();
    switch (blockType) {
      case 'paragraph':
        crepe.editor.action(callCommand(turnIntoTextCommand.key));
        break;
      case 'blockquote':
        crepe.editor.action(callCommand(wrapInBlockquoteCommand.key));
        break;
      case 'code-block':
        crepe.editor.action(callCommand(createCodeBlockCommand.key));
        break;
      case 'heading-1':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_1));
        break;
      case 'heading-2':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_2));
        break;
      case 'heading-3':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_3));
        break;
      case 'heading-4':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_4));
        break;
      case 'heading-5':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_5));
        break;
      case 'heading-6':
        crepe.editor.action(callCommand(wrapInHeadingCommand.key, HEADING_LEVEL_6));
        break;
      case 'alert-note':
        crepe.editor.action(callCommand(wrapInNoteAlertCommand.key));
        break;
      case 'alert-tip':
        crepe.editor.action(callCommand(wrapInTipAlertCommand.key));
        break;
      case 'alert-important':
        crepe.editor.action(callCommand(wrapInImportantAlertCommand.key));
        break;
      case 'alert-warning':
        crepe.editor.action(callCommand(wrapInWarningAlertCommand.key));
        break;
      case 'alert-caution':
        crepe.editor.action(callCommand(wrapInCautionAlertCommand.key));
        break;
    }
  }

  /**
   * Reads the current selection and publishes its block type to the command registry, so the ribbon
   * reflects the cursor even when no selection-change event has fired (for example on activation).
   */
  private refreshActiveBlockType(): void {
    const crepe: Crepe | null = this.crepe;
    if (crepe === null || !this.isActive()) {
      return;
    }
    crepe.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      const blockType: MarkdownBlockType = this.resolveActiveBlockType(view.state.selection);
      this.zone.run((): void => {
        this.commands.setActiveBlockType(blockType);
      });
      this.publishHistoryState(view);
    });
    // Refresh the outline from the rendered DOM (deferred), so activating a tab whose content has not
    // changed still populates the Outline panel.
    this.refreshOutline();
  }

  /**
   * Publishes whether the editor currently has undoable and redoable edits to the command registry, so
   * the ribbon can enable or disable its Undo and Redo controls.
   * @param view The editor view to read the history depth from.
   */
  private publishHistoryState(view: EditorView): void {
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
      const view: EditorView | null = this.editorView;
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
    const view: EditorView | null = this.editorView;
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
    const view: EditorView | null = this.editorView;
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
   * Registers this view as the active review session, so the Review panel can read the live source,
   * apply suggestions, and reveal flagged ranges in this editor.
   */
  private registerReviewSession(): void {
    if (this.reviewSession !== null) {
      return;
    }
    this.reviewSession = {
      getSource: (): string => this.crepe?.getMarkdown() ?? '',
      applyEdit: (start: number, end: number, replacement: string): void =>
        this.applyReviewEdit(start, end, replacement),
      reveal: (issue: ReviewIssue): void => this.revealReviewIssue(issue),
    };
    this.review.registerSession(this.reviewSession);
  }

  /**
   * Unregisters this view's review session and clears any active reveal highlight.
   */
  private unregisterReviewSession(): void {
    if (this.reviewSession !== null) {
      this.review.unregisterSession(this.reviewSession);
      this.reviewSession = null;
    }
    this.clearReviewFlash();
  }

  /**
   * Applies a review suggestion by replacing the source range with the given text. The replacement is
   * computed against the serialised markdown (the same source the issue offsets were derived from),
   * then the whole document is re-parsed and swapped in a single, undoable transaction.
   * @param start The start offset of the range to replace.
   * @param end The end offset (exclusive) of the range to replace.
   * @param replacement The replacement text.
   */
  private applyReviewEdit(start: number, end: number, replacement: string): void {
    const crepe: Crepe | null = this.crepe;
    if (crepe === null) {
      return;
    }
    const source: string = crepe.getMarkdown();
    this.replaceDocumentContent(crepe, source.slice(0, start) + replacement + source.slice(end));
  }

  /**
   * Replaces the editor's entire content by parsing the given markdown and swapping the document in a
   * single, undoable transaction. Backs the agent's replace-document capability and the review
   * suggestion apply.
   * @param markdown The new markdown source.
   */
  private replaceDocument(markdown: string): void {
    if (this.crepe !== null) {
      this.replaceDocumentContent(this.crepe, markdown);
    }
  }

  /**
   * Parses markdown and replaces the whole document with it in one undoable transaction.
   * @param crepe The editor instance.
   * @param markdown The new markdown source.
   */
  private replaceDocumentContent(crepe: Crepe, markdown: string): void {
    this.run(crepe, (ctx: Ctx): void => {
      const parser: Parser = ctx.get(parserCtx);
      const doc: ProseMirrorNode = parser(markdown);
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).scrollIntoView(),
      );
      view.focus();
    });
  }

  /**
   * Scrolls the flagged text of a review issue into view and briefly highlights it. The flagged word
   * is located in the rendered text at the occurrence closest to the issue's proportional position in
   * the source (the rendered text differs from the markdown source, so this is an approximate match).
   * @param issue The issue to reveal.
   */
  private revealReviewIssue(issue: ReviewIssue): void {
    const container: HTMLDivElement | undefined = this.editorContainer()?.nativeElement;
    const root: HTMLElement | null | undefined =
      container?.querySelector<HTMLElement>('.ProseMirror');
    if (root === null || root === undefined || issue.word.length === 0) {
      return;
    }

    const walker: TreeWalker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments: { node: Text; start: number }[] = [];
    let rendered: string = '';
    let node: Node | null = walker.nextNode();
    while (node !== null) {
      const textNode: Text = node as Text;
      segments.push({ node: textNode, start: rendered.length });
      rendered += textNode.textContent ?? '';
      node = walker.nextNode();
    }

    const sourceLength: number = Math.max(MIN_SOURCE_LENGTH, this.reviewSourceLength());
    const target: number = (issue.start / sourceLength) * rendered.length;
    let best: number = NOT_FOUND;
    let bestDelta: number = Number.POSITIVE_INFINITY;
    let found: number = rendered.indexOf(issue.word);
    while (found !== NOT_FOUND) {
      const delta: number = Math.abs(found - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = found;
      }
      found = rendered.indexOf(issue.word, found + WORD_STEP);
    }
    if (best === NOT_FOUND) {
      return;
    }

    const range: Range | null = this.rangeFromRendered(segments, best, best + issue.word.length);
    if (range === null) {
      return;
    }
    this.scrollRangeIntoView(range, container);
    this.flashReviewRange(range);
  }

  /**
   * Gets the length of the editor's serialised markdown source, used to position a review reveal.
   * @returns Returns the source length, or zero when no editor is mounted.
   */
  private reviewSourceLength(): number {
    return this.crepe?.getMarkdown().length ?? 0;
  }

  /**
   * Scrolls the editor's scroll container so the given range is centred in view.
   * @param range The range to reveal.
   * @param container The editor container the range lives in.
   */
  private scrollRangeIntoView(range: Range, container: HTMLDivElement | undefined): void {
    const scroller: HTMLElement | null | undefined =
      container?.closest<HTMLElement>('.editor-scroll');
    if (scroller === null || scroller === undefined) {
      return;
    }
    const rect: DOMRect = range.getBoundingClientRect();
    const scrollerRect: DOMRect = scroller.getBoundingClientRect();
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (rect.top - scrollerRect.top) -
        scrollerRect.height / REVEAL_CENTRE_DIVISOR,
      behavior: 'smooth',
    });
  }

  /**
   * Builds a DOM range spanning the given rendered-text offsets.
   * @param segments The text-node segments with their start offsets.
   * @param start The start offset in the rendered text.
   * @param end The end offset (exclusive) in the rendered text.
   * @returns Returns the range, or null when it cannot be resolved.
   */
  private rangeFromRendered(
    segments: readonly { node: Text; start: number }[],
    start: number,
    end: number,
  ): Range | null {
    const startSegment: { node: Text; start: number } | undefined = this.segmentAt(segments, start);
    const endSegment: { node: Text; start: number } | undefined = this.segmentAt(
      segments,
      end - WORD_STEP,
    );
    if (startSegment === undefined || endSegment === undefined) {
      return null;
    }
    const range: Range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    return range;
  }

  /**
   * Finds the text-node segment containing a rendered-text offset.
   * @param segments The segments.
   * @param offset The rendered-text offset.
   * @returns Returns the containing segment, or undefined.
   */
  private segmentAt(
    segments: readonly { node: Text; start: number }[],
    offset: number,
  ): { node: Text; start: number } | undefined {
    let match: { node: Text; start: number } | undefined;
    for (const segment of segments) {
      if (segment.start <= offset) {
        match = segment;
      } else {
        break;
      }
    }
    return match;
  }

  /**
   * Briefly highlights a range using the CSS Custom Highlight API, which paints over the rendered text
   * without mutating the editor's DOM or document. Clears any prior flash first. No-ops where the API
   * is unavailable (such as under unit tests).
   * @param range The range to flash.
   */
  private flashReviewRange(range: Range): void {
    if (!this.supportsHighlight()) {
      return;
    }
    this.clearReviewFlash();
    CSS.highlights.set(REVIEW_HIGHLIGHT_NAME, new Highlight(range));
    this.reviewFlashTimer = setTimeout((): void => {
      this.clearReviewFlash();
    }, REVIEW_FLASH_DURATION);
  }

  /**
   * Clears the review reveal highlight and its pending timer, if any.
   */
  private clearReviewFlash(): void {
    if (this.reviewFlashTimer !== null) {
      clearTimeout(this.reviewFlashTimer);
      this.reviewFlashTimer = null;
    }
    if (this.supportsHighlight()) {
      CSS.highlights.delete(REVIEW_HIGHLIGHT_NAME);
    }
  }

  /**
   * Determines whether the CSS Custom Highlight API is available for review and read-along
   * highlighting.
   * @returns Returns true when the API can be used.
   */
  private supportsHighlight(): boolean {
    return (
      typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && Boolean(CSS.highlights)
    );
  }

  /**
   * Registers this view as the active read session and publishes its rendered word model, so the
   * Reader panel can speak the document and highlight the spoken word here.
   */
  private registerReadSession(): void {
    if (this.readSession !== null) {
      return;
    }
    this.readSession = {
      highlight: (index: number, mode: HighlightMode): void => this.highlightReadWord(index, mode),
      clearHighlight: (): void => this.clearReadHighlight(),
      revealWord: (index: number): void => this.revealReadWord(index),
    };
    this.reader.registerSession(this.readSession);
    this.publishReadModel();
  }

  /**
   * Clears any read-along highlight and unregisters this view as the read session.
   */
  private unregisterReadSession(): void {
    if (this.readSession === null) {
      return;
    }
    this.clearReadHighlight();
    this.reader.unregisterSession(this.readSession);
    this.readSession = null;
    this.readWords = [];
    this.readWordRanges = [];
  }

  /**
   * Builds the read-along model from the rendered document and publishes it to the reader, keeping the
   * local word ranges for in-document highlighting.
   */
  private publishReadModel(): void {
    if (this.readSession === null) {
      return;
    }
    const root: HTMLElement | null =
      this.editorContainer()?.nativeElement.querySelector<HTMLElement>('.ProseMirror') ?? null;
    const model: ReadModel = buildReadModel(root);
    this.readWords = model.document.words;
    this.readWordRanges = model.ranges;
    this.zone.run((): void => this.reader.setDocument(model.document));
  }

  /**
   * Highlights the read-along word at the given index, or its sentence, using the CSS Custom Highlight
   * API, which paints over the rendered text without mutating ProseMirror's DOM.
   * @param wordIndex The word to highlight.
   * @param mode Whether to highlight the single word or its sentence.
   */
  private highlightReadWord(wordIndex: number, mode: HighlightMode): void {
    if (!this.supportsHighlight()) {
      return;
    }
    const word: ReadWord | undefined = this.readWords[wordIndex];
    const wordRange: Range | undefined = this.readWordRanges[wordIndex];
    if (word === undefined || wordRange === undefined) {
      this.clearReadHighlight();
      return;
    }
    if (mode === 'sentence') {
      CSS.highlights.set(
        READ_HIGHLIGHT_SENTENCE,
        new Highlight(this.sentenceRange(wordIndex, word.sentenceIndex)),
      );
      CSS.highlights.delete(READ_HIGHLIGHT_WORD);
    } else {
      CSS.highlights.set(READ_HIGHLIGHT_WORD, new Highlight(wordRange));
      CSS.highlights.delete(READ_HIGHLIGHT_SENTENCE);
    }
  }

  /**
   * Builds a DOM range spanning every word in the given sentence.
   * @param wordIndex A word within the sentence.
   * @param sentenceIndex The sentence index to span.
   * @returns Returns the sentence range.
   */
  private sentenceRange(wordIndex: number, sentenceIndex: number): Range {
    let start: number = wordIndex;
    let end: number = wordIndex;
    while (
      start - WORD_STEP >= 0 &&
      this.readWords[start - WORD_STEP].sentenceIndex === sentenceIndex
    ) {
      start -= WORD_STEP;
    }
    while (
      end + WORD_STEP < this.readWords.length &&
      this.readWords[end + WORD_STEP].sentenceIndex === sentenceIndex
    ) {
      end += WORD_STEP;
    }
    const startRange: Range = this.readWordRanges[start];
    const endRange: Range = this.readWordRanges[end];
    const range: Range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);
    return range;
  }

  /**
   * Clears the read-along highlight from the document.
   */
  private clearReadHighlight(): void {
    if (!this.supportsHighlight()) {
      return;
    }
    CSS.highlights.delete(READ_HIGHLIGHT_WORD);
    CSS.highlights.delete(READ_HIGHLIGHT_SENTENCE);
  }

  /**
   * Smoothly scrolls the spoken word into view when it drifts near or past the viewport edges, keeping
   * the read-along position comfortably visible.
   * @param wordIndex The word to reveal.
   */
  private revealReadWord(wordIndex: number): void {
    const range: Range | undefined = this.readWordRanges[wordIndex];
    const scroller: HTMLElement | null | undefined =
      this.editorContainer()?.nativeElement.closest<HTMLElement>('.editor-scroll');
    if (range === undefined || scroller === null || scroller === undefined) {
      return;
    }
    const rect: DOMRect = range.getBoundingClientRect();
    const scrollerRect: DOMRect = scroller.getBoundingClientRect();
    const aboveComfort: boolean = rect.top < scrollerRect.top + READ_REVEAL_MARGIN;
    const belowComfort: boolean = rect.bottom > scrollerRect.bottom - READ_REVEAL_MARGIN;
    if (!aboveComfort && !belowComfort) {
      return;
    }
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (rect.top - scrollerRect.top) -
        scrollerRect.height / REVEAL_CENTRE_DIVISOR,
      behavior: 'smooth',
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

  /**
   * Handles keydown events within the editor, saving the document on Cmd/Ctrl+S and suppressing the
   * browser's own save action.
   * @param event The keydown event.
   */
  private handleKeydown(event: KeyboardEvent): void {
    const isSaveChord: boolean =
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 's';
    if (!isSaveChord) {
      return;
    }
    event.preventDefault();
    void this.documents.save(this.documentId());
  }

  /**
   * Handles the Select All chord (Cmd/Ctrl+A) progressively: the first press selects the current
   * block's content; a second press, when the block is already fully selected, selects the whole
   * document. Runs in the capture phase and stops the event so it pre-empts ProseMirror's own Mod-a
   * binding (which always selects the whole document).
   * @param event The keydown event.
   */
  private handleSelectAll(event: KeyboardEvent): void {
    const isSelectAllChord: boolean =
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'a';
    const view: EditorView | null = this.editorView;
    if (!isSelectAllChord || view === null) {
      return;
    }
    if (!view.hasFocus()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const selection: Selection = view.state.selection;
    const blockStart: number = selection.$from.start();
    const blockEnd: number = selection.$from.end();
    const coversBlock: boolean = selection.from <= blockStart && selection.to >= blockEnd;
    const next: Selection = coversBlock
      ? new AllSelection(view.state.doc)
      : TextSelection.create(view.state.doc, blockStart, blockEnd);
    view.dispatch(view.state.tr.setSelection(next));
  }

  /**
   * Focuses the editor's ProseMirror view, if present.
   */
  private focusEditor(): void {
    const prosemirror: HTMLElement | null | undefined =
      this.editorContainer()?.nativeElement.querySelector<HTMLElement>('.ProseMirror');
    prosemirror?.focus();
  }

  /**
   * Focuses the editor at the end of the document when the empty backdrop below the content is
   * clicked. Clicks within or above the content are left to ProseMirror.
   * @param event The mousedown event.
   */
  private handleBackdropMousedown(event: Event): void {
    const mouseEvent: MouseEvent = event as MouseEvent;
    const container: HTMLDivElement | undefined = this.editorContainer()?.nativeElement;
    const wrapper: HTMLDivElement | undefined = this.editorWrapper()?.nativeElement;
    if (container === undefined || this.crepe === null) {
      return;
    }

    const target: HTMLElement = mouseEvent.target as HTMLElement;
    const isBackdrop: boolean =
      target === wrapper || target === container || target.classList.contains('milkdown');
    if (!isBackdrop) {
      return;
    }

    const prosemirror: HTMLElement | null = container.querySelector<HTMLElement>('.ProseMirror');
    if (prosemirror === null || mouseEvent.clientY <= prosemirror.getBoundingClientRect().bottom) {
      return;
    }

    mouseEvent.preventDefault();
    this.focusAtEnd();
  }

  /**
   * Moves the selection to the end of the document and focuses the editor.
   */
  private focusAtEnd(): void {
    const crepe: Crepe | null = this.crepe;
    if (crepe === null) {
      return;
    }
    crepe.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      const selection: Selection = TextSelection.atEnd(view.state.doc);
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Handles clicks on rendered HTML image blocks, switching the block into a raw-HTML editor.
   * @param event The click event.
   */
  private handleHtmlImageClick(event: Event): void {
    const target: HTMLElement = event.target as HTMLElement;
    const block: HTMLElement | null = target.closest<HTMLElement>('.html-image-block.rendered');
    if (block === null || this.currentHtmlImageBlock === block) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.closeHtmlImageEditor();

    const rawHtml: string = block.getAttribute('data-value') ?? '';
    this.currentHtmlImageBlock = block;

    const content: HTMLElement | null = block.querySelector<HTMLElement>('.html-image-content');
    if (content !== null) {
      content.style.display = 'none';
    }

    const textarea: HTMLTextAreaElement = this.createBlockEditor(
      'html-image-editor',
      rawHtml,
      HTML_IMAGE_EDITOR_MIN_ROWS,
      block,
      (): void => this.saveHtmlImageEdit(),
      (): void => this.closeHtmlImageEditor(),
    );
    this.htmlImageEditor = textarea;
  }

  /**
   * Saves the edited HTML image markup, re-rendering the block and syncing the document.
   */
  private saveHtmlImageEdit(): void {
    const block: HTMLElement | null = this.currentHtmlImageBlock;
    const editor: HTMLTextAreaElement | null = this.htmlImageEditor;
    if (block === null || editor === null) {
      this.closeHtmlImageEditor();
      return;
    }

    const value: string = editor.value;
    block.setAttribute('data-value', value);
    const content: HTMLElement | null = block.querySelector<HTMLElement>('.html-image-content');
    if (content !== null) {
      content.innerHTML = value;
    }

    this.emitCurrentMarkdown();
    this.closeHtmlImageEditor();
  }

  /**
   * Closes the HTML image editor, restoring the rendered block.
   */
  private closeHtmlImageEditor(): void {
    this.closeBlockEditor(this.currentHtmlImageBlock, this.htmlImageEditor, '.html-image-content');
    this.htmlImageEditor = null;
    this.currentHtmlImageBlock = null;
  }

  /**
   * Handles clicks on rendered mermaid diagram blocks, switching the block into a raw-code editor.
   * @param event The click event.
   */
  private handleMermaidClick(event: Event): void {
    const target: HTMLElement = event.target as HTMLElement;
    const block: HTMLElement | null = target.closest<HTMLElement>('.mermaid-block.rendered');
    if (block === null || this.currentMermaidBlock === block) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.closeMermaidEditor();

    const rawCode: string = block.getAttribute('data-value') ?? '';
    this.currentMermaidBlock = block;

    const content: HTMLElement | null = block.querySelector<HTMLElement>('.mermaid-content');
    if (content !== null) {
      content.style.display = 'none';
    }

    const textarea: HTMLTextAreaElement = this.createBlockEditor(
      'mermaid-editor',
      rawCode,
      MERMAID_EDITOR_MIN_ROWS,
      block,
      (): void => this.saveMermaidEdit(),
      (): void => this.closeMermaidEditor(),
    );
    this.mermaidEditor = textarea;
  }

  /**
   * Saves the edited mermaid code, re-rendering the diagram and syncing the document.
   */
  private saveMermaidEdit(): void {
    const block: HTMLElement | null = this.currentMermaidBlock;
    const editor: HTMLTextAreaElement | null = this.mermaidEditor;
    if (block === null || editor === null) {
      this.closeMermaidEditor();
      return;
    }

    const value: string = editor.value;
    block.setAttribute('data-value', value);
    const content: HTMLElement | null = block.querySelector<HTMLElement>('.mermaid-content');
    if (content !== null) {
      const diagramId: string = `mermaid-edit-${++this.mermaidIdCounter}`;
      content.innerHTML = '<div class="mermaid-loading">Rendering...</div>';
      void renderMermaidDiagram(value, diagramId).then((svg: string): void => {
        content.innerHTML = svg;
      });
    }

    this.emitCurrentMarkdown();
    this.closeMermaidEditor();
  }

  /**
   * Closes the mermaid editor, restoring the rendered diagram.
   */
  private closeMermaidEditor(): void {
    this.closeBlockEditor(this.currentMermaidBlock, this.mermaidEditor, '.mermaid-content');
    this.mermaidEditor = null;
    this.currentMermaidBlock = null;
  }

  /**
   * Creates a textarea editor inside an atom block, breaking it out of ProseMirror's contenteditable
   * control and wiring blur-to-save and Escape-to-cancel.
   * @param className The CSS class applied to the textarea.
   * @param value The initial value.
   * @param minRows The minimum number of visible rows.
   * @param block The block element the editor is mounted into.
   * @param onSave Invoked when the editor loses focus.
   * @param onCancel Invoked when Escape is pressed.
   * @returns Returns the created textarea.
   */
  private createBlockEditor(
    className: string,
    value: string,
    minRows: number,
    block: HTMLElement,
    onSave: () => void,
    onCancel: () => void,
  ): HTMLTextAreaElement {
    const textarea: HTMLTextAreaElement = document.createElement('textarea');
    textarea.className = className;
    textarea.value = value;
    textarea.rows = Math.max(minRows, value.split('\n').length + TEXTAREA_EXTRA_ROWS);

    block.setAttribute('contenteditable', 'false');
    block.appendChild(textarea);
    block.classList.remove('rendered');
    block.classList.add('editing');

    const stopPropagation: (event: Event) => void = (event: Event): void => event.stopPropagation();
    for (const type of [
      'keydown',
      'keypress',
      'keyup',
      'input',
      'paste',
      'cut',
      'copy',
      'mousedown',
      'mouseup',
      'click',
    ]) {
      textarea.addEventListener(type, stopPropagation);
    }

    textarea.addEventListener('blur', onSave);
    textarea.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    });

    setTimeout((): void => {
      textarea.focus();
      textarea.select();
    }, NEXT_TICK_DELAY);

    return textarea;
  }

  /**
   * Removes a block editor textarea and restores the rendered content of its block.
   * @param block The block element being edited, or null.
   * @param editor The editor textarea, or null.
   * @param contentSelector The selector for the block's rendered-content element.
   */
  private closeBlockEditor(
    block: HTMLElement | null,
    editor: HTMLTextAreaElement | null,
    contentSelector: string,
  ): void {
    if (block === null || editor === null) {
      return;
    }
    editor.remove();
    const content: HTMLElement | null = block.querySelector<HTMLElement>(contentSelector);
    if (content !== null) {
      content.style.display = '';
    }
    block.removeAttribute('contenteditable');
    block.classList.remove('editing');
    block.classList.add('rendered');
  }

  /**
   * Serialises the current document and emits it, suppressing the resulting input change.
   */
  private emitCurrentMarkdown(): void {
    if (this.crepe === null) {
      return;
    }
    const markdown: string = this.crepe.getMarkdown();
    this.ignoreNextChange = true;
    this.contentChange.emit(markdown);
  }
}
