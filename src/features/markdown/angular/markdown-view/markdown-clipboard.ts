import type { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Slice, type Node as ProseMirrorNode, type NodeType } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Parser } from '@milkdown/transformer';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';

/**
 * Runs the markdown editor's clipboard and insertion commands against the live pane. Browsers block
 * programmatic `paste`, so each paste variant reads the clipboard itself and dispatches a ProseMirror
 * transaction; cut/copy delegate to the editor's own clipboard serialisation. Holds no state — it
 * reads the pane fresh on every call through the supplied accessor, so it stays correct across the
 * editor recreations that follow an external content load.
 */
export class MarkdownClipboard {
  /**
   * Holds the accessor for the live editor pane, re-read on every call so a recreated editor is never
   * addressed through a stale reference.
   */
  private readonly paneOf: () => MarkdownEditor | undefined;

  /**
   * Initialises the clipboard over the given pane accessor.
   * @param paneOf The accessor for the live editor pane.
   */
  public constructor(paneOf: () => MarkdownEditor | undefined) {
    this.paneOf = paneOf;
  }

  /**
   * Focuses the editor and runs a native clipboard command (cut or copy) against its selection, so
   * the editor's own clipboard serialisation handles the formatted content.
   * @param command The clipboard command to execute.
   */
  public clipboardCommand(command: 'cut' | 'copy'): void {
    this.paneOf()?.focusEditor();
    document.execCommand(command);
  }

  /**
   * Copies the current selection to the clipboard as unformatted plain text, discarding markdown
   * syntax. Blocks are joined with newlines so multi-paragraph selections survive as readable text.
   */
  public copyPlaintext(): void {
    const crepe: Crepe | null = this.paneOf()?.getCrepe() ?? null;
    if (crepe === null) {
      return;
    }
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
   */
  public cutPlaintext(): void {
    const crepe: Crepe | null = this.paneOf()?.getCrepe() ?? null;
    if (crepe === null) {
      return;
    }
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
   */
  public pasteMarkdown(): void {
    this.withClipboardText((text: string): void => {
      this.paneOf()?.run((ctx: Ctx): void => {
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
   */
  public pastePlaintext(): void {
    this.withClipboardText((text: string): void => {
      this.paneOf()?.run((ctx: Ctx): void => {
        const view: EditorView = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        view.focus();
      });
    });
  }

  /**
   * Pastes the clipboard contents at the selection as a code block.
   */
  public pasteCode(): void {
    this.withClipboardText((text: string): void => {
      this.paneOf()?.run((ctx: Ctx): void => {
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
   * @param markdown The markdown to parse and insert.
   */
  public insertParsedBlock(markdown: string): void {
    this.paneOf()?.run((ctx: Ctx): void => {
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
   * @param markdown The inline markdown to parse and insert.
   */
  public insertParsedInline(markdown: string): void {
    this.paneOf()?.run((ctx: Ctx): void => {
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
   * @param text The text to insert.
   */
  public insertRawText(text: string): void {
    this.paneOf()?.run((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      view.focus();
    });
  }

  /**
   * Parses markdown and appends it as block-level content at the end of the document, leaving the
   * selection where it was. Used for content that lives apart from the cursor, such as a footnote
   * definition.
   * @param markdown The markdown to parse and append.
   */
  public appendParsedBlock(markdown: string): void {
    this.paneOf()?.run((ctx: Ctx): void => {
      const parser: Parser = ctx.get(parserCtx);
      const doc: ProseMirrorNode = parser(markdown);
      const view: EditorView = ctx.get(editorViewCtx);
      const end: number = view.state.doc.content.size;
      view.dispatch(view.state.tr.insert(end, doc.content).scrollIntoView());
      view.focus();
    });
  }
}
