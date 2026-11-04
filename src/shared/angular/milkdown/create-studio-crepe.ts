import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { editorViewOptionsCtx } from '@milkdown/kit/core';
import { historyProviderConfig } from '@milkdown/kit/plugin/history';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { CursorBlinkingStyle } from '@shared/angular/services/settings/settings';
import type {
  MarkdownDefaultPaste,
  MarkdownOpenLinks,
  MarkdownRichPaste,
} from '@shared/angular/services/settings/settings-registry';
import { blockReorderPlugin } from './block-reorder-plugin';
import { createCaretPlugin } from './caret-plugin';
import { collapsePlugin } from './collapse-plugin';
import { colorPreviewPlugin } from './color-preview-plugin';
import { dividerSelectPlugin } from './divider-select-plugin';
import { emojiPlugin } from './emoji-plugin';
import { footnotePlugin } from './footnote-plugin';
import { blockquoteToAlertPlugin, githubAlertPlugin } from './github-alert-plugin';
import { htmlImagePlugin, htmlImageNode } from './html-image-plugin';
import { imageTitlePlugin } from './image-title-plugin';
import { createLinkOpenPlugin } from './link-open-plugin';
import {
  basicRichPastePlugin,
  imageFilesOf,
  insertImage,
  pasteClipboardText,
} from './markdown-paste';
import { fileToDataUrl } from './media-source';
import { mermaidPlugin } from './mermaid-plugin';
import { createMonacoCodeBlockPlugin, MonacoCodeBlockDeps } from './monaco-code-block-plugin';
import { pasteCleanPlugin } from './paste-clean-plugin';
import { searchPlugin } from './search-plugin';
import { smartPunctuationPlugin } from './smart-punctuation-plugin';
import {
  subscriptSuperscriptInputPlugin,
  subscriptSuperscriptPlugin,
} from './subscript-superscript-plugin';

/**
 * Holds the choices that shape the editor as it is built, from Markdown's settings. Changing one means
 * building the editor again.
 */
export interface StudioCrepeBehaviour {
  /**
   * Gets whether emoji shortcodes show as their emoji.
   */
  readonly convertEmoji: boolean;

  /**
   * Gets whether a quote turns into an alert as its marker is typed.
   */
  readonly convertAlerts: boolean;

  /**
   * Gets whether `~` and `^` turn text into subscript and superscript as it is typed.
   */
  readonly subSuperscriptShortcuts: boolean;

  /**
   * Gets whether a colour in inline code shows a swatch.
   */
  readonly colourSwatches: boolean;

  /**
   * Gets whether formatting buttons float above selected text.
   */
  readonly floatingToolbar: boolean;

  /**
   * Gets whether a block shows its drag and add handle.
   */
  readonly blockHandles: boolean;

  /**
   * Gets whether a slash opens the block menu.
   */
  readonly slashMenu: boolean;

  /**
   * Gets whether quotes, dots and hyphens are made typographic as they are typed.
   */
  readonly smartPunctuation: boolean;

  /**
   * Gets how many steps Undo can go back.
   */
  readonly undoHistory: number;

  /**
   * Gets whether raw HTML renders through the sanitiser, rather than showing as text.
   */
  readonly renderHtmlBlocks: boolean;

  /**
   * Gets whether code blocks number their lines.
   */
  readonly codeBlockLineNumbers: boolean;

  /**
   * Gets whether a math block shows its equation until it is entered.
   */
  readonly mathPreview: boolean;

  /**
   * Gets how the caret blinks.
   */
  readonly cursorBlinking: CursorBlinkingStyle;

  /**
   * Gets what opens a link.
   */
  readonly openLinks: MarkdownOpenLinks;

  /**
   * Gets how clipboard text pastes.
   */
  readonly defaultPaste: MarkdownDefaultPaste;

  /**
   * Gets how much of a rich clipboard's formatting a paste keeps.
   */
  readonly richPaste: MarkdownRichPaste;
}

/**
 * Holds what Markdown's settings default to, for an editor built without them.
 */
export const DEFAULT_CREPE_BEHAVIOUR: StudioCrepeBehaviour = {
  convertEmoji: true,
  convertAlerts: true,
  subSuperscriptShortcuts: true,
  colourSwatches: true,
  floatingToolbar: false,
  blockHandles: true,
  slashMenu: true,
  smartPunctuation: false,
  undoHistory: 100,
  renderHtmlBlocks: true,
  codeBlockLineNumbers: false,
  mathPreview: true,
  cursorBlinking: 'blink',
  openLinks: 'modifier',
  defaultPaste: 'markdown',
  richPaste: 'keep',
};

/**
 * The options for building the application's Crepe editor.
 */
export interface StudioCrepeOptions {
  /**
   * Gets the element the editor mounts into.
   */
  readonly root: HTMLElement;

  /**
   * Gets the markdown the editor is initialised with.
   */
  readonly defaultValue: string;

  /**
   * Gets whether Crepe's resizable image block is enabled (the `imageSizing` setting is `sizable`).
   */
  readonly resizableImages: boolean;

  /**
   * Gets the Monaco services threaded into the Monaco code-block node view.
   */
  readonly monaco: MonacoCodeBlockDeps['monaco'];

  /**
   * Gets the shared colorizer threaded into the Monaco code-block node view.
   */
  readonly highlighter: MonacoCodeBlockDeps['highlighter'];

  /**
   * Gets Studio's completion list and signature card threaded into each fence's editor (#1021), or
   * undefined for fences with neither.
   */
  readonly assist?: MonacoCodeBlockDeps['assist'];

  /**
   * Gets the choices that shape the editor, or undefined for the settings' defaults.
   */
  readonly behaviour?: StudioCrepeBehaviour;

  /**
   * Opens a link's address, or undefined for a document whose links do not open.
   */
  readonly openLink?: (href: string) => void;

  /**
   * Stores a pasted or dropped image and resolves to its source, or undefined to embed it.
   */
  readonly storeImage?: (file: File) => Promise<string>;
}

/**
 * Pastes an image file at a position, once it has been stored.
 * @param view The editor view.
 * @param files The image files.
 * @param store Stores an image and resolves to its source.
 * @param position The position to insert at, or undefined for the selection.
 */
function placeImages(
  view: EditorView,
  files: readonly File[],
  store: (file: File) => Promise<string>,
  position?: number,
): void {
  for (const file of files) {
    void store(file).then((source: string): void => {
      insertImage(view, source, file.name, position);
    });
  }
}

/**
 * Leaves one part out of a group of plugins.
 * @param plugins The group.
 * @param left The part to leave out, or null to keep them all.
 * @returns Returns the plugins to use.
 */
function without(
  plugins: readonly MilkdownPlugin[],
  left: MilkdownPlugin | null,
): MilkdownPlugin[] {
  return plugins.filter((plugin: MilkdownPlugin): boolean => plugin !== left);
}

/**
 * Builds the application's Crepe editor: the feature set, the feature configuration, and the full
 * custom plugin registration. This is the single definition of what "the markdown editor" is — the
 * shared markdown-editor component builds its editor through it, and the markdown feature specs boot
 * the very same editor, so a configuration change cannot drift between the app and its tests.
 *
 * The caller owns the returned instance: wiring listeners, calling `create()`, and `destroy()`.
 * @param options The editor options.
 * @returns Returns the configured (not yet created) Crepe instance.
 */
export function createStudioCrepe(options: StudioCrepeOptions): Crepe {
  const behaviour: StudioCrepeBehaviour = options.behaviour ?? DEFAULT_CREPE_BEHAVIOUR;
  const store: (file: File) => Promise<string> = options.storeImage ?? fileToDataUrl;
  // The browser's caret blinks one way, so any other style draws its own, which also stands in for the
  // virtual cursor Crepe shows at the edge of a mark.
  const drawsCaret: boolean = behaviour.cursorBlinking !== 'blink';
  const crepe: Crepe = new Crepe({
    root: options.root,
    defaultValue: options.defaultValue,
    features: {
      [Crepe.Feature.BlockEdit]: behaviour.blockHandles || behaviour.slashMenu,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.ImageBlock]: options.resizableImages,
      [Crepe.Feature.Latex]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Table]: true,
      // The app provides a fixed formatting ribbon; the inline toolbar is the user's to add to it.
      [Crepe.Feature.Toolbar]: behaviour.floatingToolbar,
    },
    featureConfigs: {
      // One feature carries both. The handle stops showing, and a menu with no items closes itself.
      [Crepe.Feature.BlockEdit]: {
        ...(behaviour.blockHandles ? {} : { blockHandle: { shouldShow: (): boolean => false } }),
        ...(behaviour.slashMenu ? {} : { textGroup: null, listGroup: null, advancedGroup: null }),
      },
      [Crepe.Feature.Cursor]: { virtual: !drawsCaret },
      [Crepe.Feature.Placeholder]: { text: 'Start writing...' },
      [Crepe.Feature.CodeMirror]: { previewOnlyByDefault: true },
      // Embed a pasted or dropped image as a self-contained data URL so it persists across a save
      // and reopen; Crepe's default blob URL is discarded when the editor is torn down.
      [Crepe.Feature.ImageBlock]: {
        onUpload: (file: File): Promise<string> => store(file),
      },
    },
  });

  crepe.editor.config((ctx: Ctx): void => {
    ctx.update(historyProviderConfig.key, (previous: object): object => ({
      ...previous,
      depth: behaviour.undoHistory,
    }));
    // View props run ahead of every plugin's, so the choices here come before the editor's own paste.
    ctx.update(editorViewOptionsCtx, (previous: object): object => ({
      ...previous,
      handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
        const clipboard: DataTransfer | null = event.clipboardData;
        if (clipboard === null) {
          return false;
        }
        const images: readonly File[] = imageFilesOf(clipboard);
        if (images.length > 0 && clipboard.getData('text/plain').length === 0) {
          placeImages(view, images, store);
          return true;
        }
        return pasteClipboardText(view, clipboard, behaviour.defaultPaste, behaviour.richPaste);
      },
      handleDrop: (view: EditorView, event: DragEvent): boolean => {
        const images: readonly File[] =
          event.dataTransfer === null ? [] : imageFilesOf(event.dataTransfer);
        if (images.length === 0) {
          return false;
        }
        const at: { pos: number } | null = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        placeImages(view, images, store, at?.pos);
        return true;
      },
    }));
  });

  crepe.editor.use(pasteCleanPlugin);
  if (behaviour.richPaste === 'basic') {
    crepe.editor.use(basicRichPastePlugin);
  }
  // Registered after Crepe's features have loaded, so its Monaco code_block node view overrides
  // CodeMirror's (which stays enabled for the Latex feature that depends on it).
  crepe.editor.use(
    createMonacoCodeBlockPlugin({
      monaco: options.monaco,
      highlighter: options.highlighter,
      assist: options.assist,
      lineNumbers: behaviour.codeBlockLineNumbers,
      mathPreview: behaviour.mathPreview,
    }),
  );
  crepe.editor.use(
    without(
      subscriptSuperscriptPlugin,
      behaviour.subSuperscriptShortcuts ? null : subscriptSuperscriptInputPlugin,
    ),
  );
  // Without its parsing step the node never appears, and raw HTML stays the text the file holds.
  crepe.editor.use(behaviour.renderHtmlBlocks ? htmlImagePlugin : [htmlImageNode]);
  crepe.editor.use(imageTitlePlugin);
  crepe.editor.use(collapsePlugin);
  crepe.editor.use(
    without(githubAlertPlugin, behaviour.convertAlerts ? null : blockquoteToAlertPlugin),
  );
  if (behaviour.colourSwatches) {
    crepe.editor.use(colorPreviewPlugin);
  }
  crepe.editor.use(mermaidPlugin);
  crepe.editor.use(footnotePlugin);
  if (behaviour.convertEmoji) {
    crepe.editor.use(emojiPlugin);
  }
  crepe.editor.use(blockReorderPlugin);
  if (behaviour.smartPunctuation) {
    crepe.editor.use(smartPunctuationPlugin);
  }
  if (drawsCaret) {
    crepe.editor.use(createCaretPlugin(behaviour.cursorBlinking));
  }
  if (options.openLink !== undefined) {
    crepe.editor.use(createLinkOpenPlugin(behaviour.openLinks, options.openLink));
  }
  crepe.editor.use(dividerSelectPlugin);
  crepe.editor.use(searchPlugin);

  return crepe;
}
