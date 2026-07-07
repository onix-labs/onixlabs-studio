import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  NgZone,
  OnChanges,
  OnDestroy,
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
import { type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { AllSelection, type Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { ListenerManager } from '@milkdown/plugin-listener';
import type { Parser } from '@milkdown/transformer';
import { blockReorderPlugin } from '@shared/angular/milkdown/block-reorder-plugin';
import { colorPreviewPlugin } from '@shared/angular/milkdown/color-preview-plugin';
import { emojiPlugin } from '@shared/angular/milkdown/emoji-plugin';
import { footnotePlugin } from '@shared/angular/milkdown/footnote-plugin';
import { githubAlertPlugin } from '@shared/angular/milkdown/github-alert-plugin';
import { htmlImagePlugin } from '@shared/angular/milkdown/html-image-plugin';
import { fileToDataUrl, installImageResolver } from '@shared/angular/milkdown/media-source';
import { mermaidPlugin, renderMermaidDiagram } from '@shared/angular/milkdown/mermaid-plugin';
import { pasteCleanPlugin } from '@shared/angular/milkdown/paste-clean-plugin';
import { searchPlugin } from '@shared/angular/milkdown/search-plugin';
import { subscriptSuperscriptPlugin } from '@shared/angular/milkdown/subscript-superscript-plugin';
import { Milkdown } from '@shared/angular/services/milkdown/milkdown';
import {
  ImageAlignment,
  ImageSizing,
  MarginSize,
  Settings,
} from '@shared/angular/services/settings/settings';

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
 * Delay in milliseconds for deferring an action to the next event-loop tick.
 */
const NEXT_TICK_DELAY: number = 0;

/**
 * Represents the shared markdown-editor pane: a single Milkdown Crepe (ProseMirror) WYSIWYG editor
 * instance bound to a markdown content string, with the application's custom plugins, theming, image
 * pipeline, and atom-block (HTML image / mermaid) editors. It owns the editor instance and only the
 * instance — its creation and disposal, live style application, content synchronisation, and
 * change/selection/save reporting. It has no tool panels, no ribbon, no document model, and no
 * outline/review/reader logic: a composing feature view drives those by binding the inputs, listening
 * to the outputs, and reaching the instance through {@link getCrepe} / {@link getEditorView} /
 * {@link getScrollContainer}.
 */
@Component({
  selector: 'app-markdown-editor',
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditor implements AfterViewInit, OnChanges, OnDestroy {
  /**
   * Holds the service resolving markdown editor styles from settings.
   */
  private readonly milkdown: Milkdown = inject(Milkdown);

  /**
   * Holds the settings service supplying the markdown editor preferences, watched to re-apply styles.
   */
  private readonly settings: Settings = inject(Settings);

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
   * Gets the markdown content the editor is initialised with. Setting it externally replaces the
   * editor content (by recreating the editor) without raising {@link contentChange}.
   */
  public readonly content: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the editor is read-only.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the pane belongs to the active tab. The active pane is focused.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the absolute directory a relative image source resolves against (the backing document's
   * directory), or the empty string when the document has no path yet.
   */
  public readonly baseDirectory: InputSignal<string> = input<string>('');

  /**
   * Emits once the Crepe editor instance has been created and its listeners are wired. Re-emits each
   * time the editor is recreated to load new external content.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the serialised markdown whenever the user edits the content (not when {@link content} is
   * set externally).
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the editor selection whenever it changes, so the host can reflect the active block type and
   * history state.
   */
  public readonly selectionChange: OutputEmitterRef<Selection> = output<Selection>();

  /**
   * Emits when the editor's save shortcut (Cmd/Ctrl+S) is pressed, so the host can save the document.
   */
  public readonly saveRequested: OutputEmitterRef<void> = output<void>();

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
   * Holds the editor view, exposed so the host can derive the outline, map scroll coordinates, and
   * read selection state. Null before creation.
   */
  private editorView: EditorView | null = null;

  /**
   * Holds the editor's scroll container, exposed so the host can attach its scroll-spy and reveal
   * ranges. Null before the view initialises.
   */
  private scrollContainer: HTMLElement | null = null;

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
   * Initialises the pane, wiring effects that re-apply editor styles on settings changes and focus the
   * editor when the pane becomes active.
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
      if (this.isEditorReady() && this.crepe !== null && active) {
        this.focusEditor();
      }
    });
  }

  /**
   * Creates the editor once the view's elements are available, and captures the scroll container.
   */
  public ngAfterViewInit(): void {
    void this.createEditor();
    this.scrollContainer =
      this.editorContainer().nativeElement.closest<HTMLElement>('.editor-scroll');
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
   * Destroys the editor when the pane is torn down.
   */
  public ngOnDestroy(): void {
    void this.destroyEditor();
    this.scrollContainer = null;
  }

  /**
   * Gets the underlying Crepe editor instance, or null before creation and after disposal. The host
   * uses it to run editor commands and clipboard/format actions.
   * @returns Returns the Crepe instance, or null.
   */
  public getCrepe(): Crepe | null {
    return this.crepe;
  }

  /**
   * Gets the underlying ProseMirror editor view, or null before creation and after disposal. The host
   * uses it to derive the outline, map scroll coordinates, and read selection/history state.
   * @returns Returns the editor view, or null.
   */
  public getEditorView(): EditorView | null {
    return this.editorView;
  }

  /**
   * Gets the editor's scroll container, or null before the view initialises. The host uses it to drive
   * the outline scroll-spy and to reveal review/read ranges.
   * @returns Returns the scroll container, or null.
   */
  public getScrollContainer(): HTMLElement | null {
    return this.scrollContainer;
  }

  /**
   * Gets the editor's serialised markdown.
   * @returns Returns the markdown, or the empty string before creation.
   */
  public getMarkdown(): string {
    return this.crepe?.getMarkdown() ?? '';
  }

  /**
   * Focuses the editor's ProseMirror view, if present.
   */
  public focusEditor(): void {
    const prosemirror: HTMLElement | null | undefined =
      this.editorContainer()?.nativeElement.querySelector<HTMLElement>('.ProseMirror');
    prosemirror?.focus();
  }

  /**
   * Moves the selection to the end of the document and focuses the editor.
   */
  public focusAtEnd(): void {
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
   * Focuses the editor, then runs a Crepe editor action. Exposed so the host's command/format glue
   * runs each action against the focused editor.
   * @param action The action to run.
   */
  public run(action: (ctx: Ctx) => unknown): void {
    const crepe: Crepe | null = this.crepe;
    if (crepe === null) {
      return;
    }
    this.focusEditor();
    crepe.editor.action(action);
  }

  /**
   * Replaces the editor's entire content by parsing the given markdown and swapping the document in a
   * single, undoable transaction. Backs the agent's replace-document capability and the review apply.
   * @param markdown The new markdown source.
   */
  public replaceAll(markdown: string): void {
    if (this.crepe === null) {
      return;
    }
    this.run((ctx: Ctx): void => {
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
   * Creates the Crepe editor, registers the application's plugins, and wires its listeners. Runs
   * outside the Angular zone so the editor's own DOM churn does not trigger change detection.
   * @returns Returns a promise that resolves once the editor has been created.
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
      crepe.editor.use(searchPlugin);

      crepe.on((api: ListenerManager): void => {
        api.markdownUpdated((_ctx: Ctx, markdown: string): void => {
          // The very first update fires while the editor is still being created (the initial content
          // load); doing work here breaks that init, so skip it. The host derives the initial outline
          // and read model on the deferred ready emit instead.
          if (!this.hasReceivedFirstUpdate) {
            this.hasReceivedFirstUpdate = true;
            return;
          }
          this.zone.run((): void => {
            this.ignoreNextChange = true;
            this.contentChange.emit(markdown);
          });
        });

        api.selectionUpdated((_ctx: Ctx, selection: Selection): void => {
          this.zone.run((): void => this.selectionChange.emit(selection));
        });
      });

      this.crepe = crepe;
      await crepe.create();

      // Capture the editor view so the host can derive the outline from the document model and map
      // screen coordinates to document positions for its scroll-spy.
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
        this.baseDirectory(),
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
        this.ready.emit();
      });
    });
  }

  /**
   * Destroys the Crepe editor, removing listeners and the image resolver.
   * @returns Returns a promise that resolves once the editor has been destroyed.
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

    if (this.crepe !== null) {
      await this.crepe.destroy();
      this.crepe = null;
      this.isEditorReady.set(false);
    }

    this.editorView = null;
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
   * Handles keydown events within the editor, requesting a save on Cmd/Ctrl+S and suppressing the
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
    // Stop the handled chord here so it does not also reach the application keybinding router on
    // window (which would save a second time). The editor owns Cmd/Ctrl+S; the host saves via
    // saveRequested.
    event.stopPropagation();
    this.zone.run((): void => this.saveRequested.emit());
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
