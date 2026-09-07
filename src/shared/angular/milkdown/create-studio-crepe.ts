import { Crepe } from '@milkdown/crepe';
import { blockReorderPlugin } from './block-reorder-plugin';
import { collapsePlugin } from './collapse-plugin';
import { colorPreviewPlugin } from './color-preview-plugin';
import { emojiPlugin } from './emoji-plugin';
import { footnotePlugin } from './footnote-plugin';
import { githubAlertPlugin } from './github-alert-plugin';
import { htmlImagePlugin } from './html-image-plugin';
import { fileToDataUrl } from './media-source';
import { mermaidPlugin } from './mermaid-plugin';
import { createMonacoCodeBlockPlugin, MonacoCodeBlockDeps } from './monaco-code-block-plugin';
import { pasteCleanPlugin } from './paste-clean-plugin';
import { searchPlugin } from './search-plugin';
import { subscriptSuperscriptPlugin } from './subscript-superscript-plugin';

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
  const crepe: Crepe = new Crepe({
    root: options.root,
    defaultValue: options.defaultValue,
    features: {
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.ImageBlock]: options.resizableImages,
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
  // Registered after Crepe's features have loaded, so its Monaco code_block node view overrides
  // CodeMirror's (which stays enabled for the Latex feature that depends on it).
  crepe.editor.use(
    createMonacoCodeBlockPlugin({ monaco: options.monaco, highlighter: options.highlighter }),
  );
  crepe.editor.use(subscriptSuperscriptPlugin);
  crepe.editor.use(htmlImagePlugin);
  crepe.editor.use(collapsePlugin);
  crepe.editor.use(githubAlertPlugin);
  crepe.editor.use(colorPreviewPlugin);
  crepe.editor.use(mermaidPlugin);
  crepe.editor.use(footnotePlugin);
  crepe.editor.use(emojiPlugin);
  crepe.editor.use(blockReorderPlugin);
  crepe.editor.use(searchPlugin);

  return crepe;
}
