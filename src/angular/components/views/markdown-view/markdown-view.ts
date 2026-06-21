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
import { Slice, type Node as ProseMirrorNode, type NodeType } from '@milkdown/kit/prose/model';
import { type Selection, TextSelection } from '@milkdown/kit/prose/state';
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
import { mermaidPlugin, renderMermaidDiagram } from '../../../milkdown/mermaid-plugin';
import { pasteCleanPlugin } from '../../../milkdown/paste-clean-plugin';
import { subscriptSuperscriptPlugin } from '../../../milkdown/subscript-superscript-plugin';
import { Milkdown } from '../../../services/milkdown/milkdown';
import {
  MarkdownBlockType,
  MarkdownCommandHandler,
  MarkdownCommands,
} from '../../../services/markdown-commands/markdown-commands';
import { ImageSizing, MarginSize, Settings } from '../../../services/settings/settings';

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
 * Represents the markdown editor view, hosting a Milkdown Crepe WYSIWYG editor with the application's
 * custom plugins, theming and ribbon command integration.
 */
@Component({
  selector: 'app-markdown-view',
  imports: [],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownView implements AfterViewInit, OnChanges, OnDestroy {
  /**
   * Holds the service resolving markdown editor styles from settings.
   */
  private readonly milkdown: Milkdown = inject(Milkdown);

  /**
   * Holds the settings service supplying the markdown editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the markdown command registry the ribbon routes formatting commands through.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

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
   * Holds the Crepe editor instance, or null before creation and after destruction.
   */
  private crepe: Crepe | null = null;

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
        this.refreshActiveBlockType();
        this.focusEditor();
      } else if (this.commandHandler !== null) {
        this.commands.unregister(this.commandHandler);
        this.commandHandler = null;
      }
    });
  }

  /**
   * Creates the editor once the view's elements are available.
   */
  public ngAfterViewInit(): void {
    void this.createEditor();
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
   * Destroys the editor when the component is torn down.
   */
  public ngOnDestroy(): void {
    void this.destroyEditor();
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
        api.markdownUpdated((_ctx: Ctx, markdown: string): void => {
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
          if (!this.isActive()) {
            return;
          }
          const blockType: MarkdownBlockType = this.resolveActiveBlockType(selection);
          this.zone.run((): void => {
            this.commands.setActiveBlockType(blockType);
          });
        });
      });

      this.crepe = crepe;
      await crepe.create();

      if (this.readOnly()) {
        crepe.setReadonly(true);
      }

      this.applyEditorStyles();

      container.addEventListener('click', this.boundHtmlImageClickHandler);
      container.addEventListener('click', this.boundMermaidClickHandler);
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
    const container: HTMLDivElement | undefined = this.editorContainer()?.nativeElement;
    if (container !== undefined) {
      container.removeEventListener('click', this.boundHtmlImageClickHandler);
      container.removeEventListener('click', this.boundMermaidClickHandler);
    }

    const wrapper: HTMLDivElement | undefined = this.editorWrapper()?.nativeElement;
    wrapper?.removeEventListener('mousedown', this.boundBackdropMousedownHandler);

    this.closeHtmlImageEditor();
    this.closeMermaidEditor();

    if (this.commandHandler !== null) {
      this.commands.unregister(this.commandHandler);
      this.commandHandler = null;
    }

    if (this.crepe !== null) {
      await this.crepe.destroy();
      this.crepe = null;
      this.isEditorReady.set(false);
    }

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
      toggleBold: (): void => this.run(crepe, callCommand(toggleStrongCommand.key)),
      toggleItalic: (): void => this.run(crepe, callCommand(toggleEmphasisCommand.key)),
      toggleStrikethrough: (): void => this.run(crepe, callCommand(toggleStrikethroughCommand.key)),
      toggleInlineCode: (): void => this.run(crepe, callCommand(toggleInlineCodeCommand.key)),
      toggleBulletList: (): void => this.run(crepe, callCommand(wrapInBulletListCommand.key)),
      toggleOrderedList: (): void => this.run(crepe, callCommand(wrapInOrderedListCommand.key)),
      insertTable: (): void => this.run(crepe, callCommand(insertTableCommand.key)),
      insertHorizontalRule: (): void => this.run(crepe, callCommand(insertHrCommand.key)),
      setBlockType: (blockType: MarkdownBlockType): void => this.applyBlockType(crepe, blockType),
    };

    this.commands.register(this.commandHandler);
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
