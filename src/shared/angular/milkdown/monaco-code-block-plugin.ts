/**
 * Milkdown plugin that renders fenced code blocks with Monaco.
 *
 * By default Crepe edits code fences in an embedded CodeMirror instance. This plugin replaces that
 * with Monaco so a fence is highlighted by, and edited in, the very same engine as the code-editor
 * tabs and the agent bubbles (via {@link MonacoHighlighter}). Because a Monaco editor is far heavier
 * than a CodeMirror one, a document is not allowed to hold one per fence: every idle fence is a cheap
 * static block of `colorize` HTML, and a fence only becomes a live, editable Monaco editor while it
 * has focus — mounted on entry, torn back down to the highlighted placeholder on blur. So a document
 * with fifteen fences shows fifteen highlighted blocks but, at most, one live editor.
 *
 * The node-view contract (selection escape at the edges, backspace-to-paragraph on an empty block,
 * external-change reconciliation, mod-enter to exit) mirrors Crepe's own CodeMirror node view so the
 * fence behaves the way the rest of the editor already taught the user to expect.
 *
 * Crepe's CodeMirror feature stays enabled (its Latex feature hard-depends on it), so this plugin
 * does not remove Crepe's own `code_block` node view — it overrides it. Milkdown builds the editor's
 * node views with `Object.fromEntries(nodeViewCtx)`, where the last registration for a node id wins,
 * and this plugin is registered after the features load, so its Monaco view replaces the CodeMirror
 * one while every other CodeMirror-dependent feature keeps working.
 */

import { $view } from '@milkdown/kit/utils';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Selection, Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import type * as MonacoApi from 'monaco-editor';
import type { Monaco } from '@shared/angular/services/monaco/monaco';
import type { MonacoHighlighter } from '@shared/angular/services/monaco/monaco-highlighter';

/**
 * The services a {@link MonacoCodeBlockView} needs: the Monaco loader/theme service and the shared
 * colorizer. They are threaded in from the Angular component that builds the editor, since a Milkdown
 * node view runs outside Angular's dependency injection.
 */
export interface MonacoCodeBlockDeps {
  /**
   * Gets the Monaco loader and theme service.
   */
  readonly monaco: Monaco;

  /**
   * Gets the shared colorizer, used for the idle placeholder and to resolve fence info-strings to
   * Monaco language identifiers.
   */
  readonly highlighter: MonacoHighlighter;
}

/**
 * The delay, in milliseconds, between a fence's editor losing focus and its teardown back to the
 * static placeholder, so a transient blur (for example clicking the language field and back) does not
 * thrash the editor.
 */
const TEARDOWN_DELAY_MS: number = 150;

/**
 * The minimum height, in pixels, of a mounted fence editor, so an empty or one-line fence still
 * presents a comfortable target.
 */
const MIN_EDITOR_HEIGHT_PX: number = 32;

/**
 * The line-height (as a multiple of the font size) shared by the placeholder and the mounted editor,
 * so a fence keeps the same line spacing whether it is being viewed or edited.
 */
const FENCE_LINE_HEIGHT: number = 1.5;

/**
 * Computes the single contiguous change between two strings as a code-space `{ from, to, text }`, or
 * null when they are identical. Used to reconcile an external document change into the mounted editor
 * with a minimal edit (preserving the cursor), matching Crepe's own reconciliation.
 * @param oldValue The current value.
 * @param newValue The desired value.
 * @returns Returns the change, or null when there is none.
 */
function computeChange(
  oldValue: string,
  newValue: string,
): { from: number; to: number; text: string } | null {
  if (oldValue === newValue) {
    return null;
  }
  let start: number = 0;
  let oldEnd: number = oldValue.length;
  let newEnd: number = newValue.length;
  while (start < oldEnd && oldValue.charCodeAt(start) === newValue.charCodeAt(start)) {
    ++start;
  }
  while (
    oldEnd > start &&
    newEnd > start &&
    oldValue.charCodeAt(oldEnd - 1) === newValue.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return { from: start, to: oldEnd, text: newValue.slice(start, newEnd) };
}

/**
 * Escapes the HTML-significant characters in text, for the placeholder shown before Monaco has
 * colorized the fence.
 * @param text The raw text.
 * @returns Returns the escaped text.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The Monaco-backed node view for one `code_block`. Idle, it is a lightweight, static block of
 * `colorize`d HTML — no editor is created; focused, it mounts a live Monaco editor whose edits are
 * forwarded to the ProseMirror document and whose edges hand navigation back to the surrounding
 * document, torn back down to the static block on blur. The editor uses the same syntactic colours as
 * the placeholder, so the two states match, and long documents stay cheap.
 */
class MonacoCodeBlockView implements NodeView {
  /**
   * Gets the node view's outer element, handed to ProseMirror.
   */
  public readonly dom: HTMLElement;

  /**
   * Holds the body element that swaps between the placeholder and the mounted editor.
   */
  private readonly body: HTMLElement;

  /**
   * Holds the language field, letting the author read and change the fence's language.
   */
  private readonly languageInput: HTMLInputElement;

  /**
   * Holds the current node, kept in step with the document.
   */
  private node: ProseMirrorNode;

  /**
   * Holds the live editor while the fence is focused, or null while it shows the placeholder.
   */
  private editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  /**
   * Holds the disposables tied to the live editor, released on teardown.
   */
  private editorDisposers: MonacoApi.IDisposable[] = [];

  /**
   * Holds whether a mount is in flight, so two near-simultaneous triggers (a click and a selection,
   * say) do not both create an editor while Monaco loads.
   */
  private mounting: boolean = false;

  /**
   * Holds whether an edit is being applied to the editor from the document, so the editor's own
   * change handler does not echo it straight back and loop.
   */
  private applyingRemoteEdit: boolean = false;

  /**
   * Holds the pending teardown timer id, or null when none is scheduled.
   */
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Identifies the most recent placeholder colorize request, so a slower earlier one cannot overwrite
   * a later render.
   */
  private placeholderRequest: number = 0;

  /**
   * Constructs the node view.
   * @param node The code-block node.
   * @param view The editor view.
   * @param getPos Resolves the node's current document position.
   * @param deps The Monaco services.
   */
  public constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly deps: MonacoCodeBlockDeps,
  ) {
    this.node = node;

    this.dom = document.createElement('div');
    this.dom.className = 'milkdown-monaco-code-block';

    const header: HTMLElement = document.createElement('div');
    header.className = 'milkdown-monaco-code-block__header';
    this.languageInput = document.createElement('input');
    this.languageInput.className = 'milkdown-monaco-code-block__language';
    this.languageInput.setAttribute('spellcheck', 'false');
    this.languageInput.placeholder = 'plain text';
    this.languageInput.value = this.languageAttr();
    this.languageInput.addEventListener('change', (): void =>
      this.setLanguage(this.languageInput.value),
    );
    // Committing the language on Enter keeps focus off the editor mount, so a fence stays in its
    // placeholder state until the code area itself is entered.
    this.languageInput.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.setLanguage(this.languageInput.value);
        this.languageInput.blur();
      }
    });
    header.appendChild(this.languageInput);

    this.body = document.createElement('div');
    this.body.className = 'milkdown-monaco-code-block__body';
    // Entering the code area promotes the lightweight static placeholder to a live editor. Guard on
    // the document being editable so a read-only surface stays a static, highlighted block.
    this.body.addEventListener('mousedown', (event: MouseEvent): void => {
      if (this.editor === null && this.view.editable) {
        event.preventDefault();
        void this.mountEditor(true);
      }
    });

    this.dom.appendChild(header);
    this.dom.appendChild(this.body);

    this.renderPlaceholder();
  }

  /**
   * Reconciles an updated node into the view: it must be the same node type; a mounted editor takes a
   * minimal edit, an idle one re-renders its placeholder. Rejecting a different type lets ProseMirror
   * rebuild the view.
   * @param node The updated node.
   * @returns Returns whether the update was absorbed.
   */
  public update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    if (this.applyingRemoteEdit) {
      return true;
    }
    const languageChanged: boolean = node.attrs['language'] !== this.node.attrs['language'];
    this.node = node;

    if (document.activeElement !== this.languageInput) {
      this.languageInput.value = this.languageAttr();
    }

    if (this.editor === null) {
      this.renderPlaceholder();
      return true;
    }

    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (model === null) {
      return true;
    }
    if (languageChanged) {
      this.deps.monaco.getMonaco()?.editor.setModelLanguage(model, this.resolvedLanguageId());
    }
    const change: { from: number; to: number; text: string } | null = computeChange(
      model.getValue(),
      node.textContent,
    );
    if (change !== null) {
      const monaco: typeof MonacoApi | undefined = this.deps.monaco.getMonaco();
      if (monaco !== undefined) {
        this.applyingRemoteEdit = true;
        model.applyEdits([
          {
            range: monaco.Range.fromPositions(
              model.getPositionAt(change.from),
              model.getPositionAt(change.to),
            ),
            text: change.text,
          },
        ]);
        this.applyingRemoteEdit = false;
      }
    }
    return true;
  }

  /**
   * Places the selection inside the fence, mounting the editor first if needed. Called by ProseMirror
   * when navigation carries the selection into the node.
   * @param anchor The anchor offset within the node's content.
   * @param head The head offset within the node's content.
   */
  public setSelection(anchor: number, head: number): void {
    void this.mountEditor(false).then((): void => {
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      const monaco: typeof MonacoApi | undefined = this.deps.monaco.getMonaco();
      const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
      if (editor === null || monaco === undefined || model === null) {
        return;
      }
      editor.focus();
      this.applyingRemoteEdit = true;
      editor.setSelection(
        monaco.Range.fromPositions(model.getPositionAt(anchor), model.getPositionAt(head)),
      );
      this.applyingRemoteEdit = false;
    });
  }

  /**
   * Mounts the editor and focuses it when the whole node is selected, so typing replaces it.
   */
  public selectNode(): void {
    if (this.view.editable) {
      void this.mountEditor(true);
    }
  }

  /**
   * Keeps ProseMirror from handling events inside the fence; the mounted editor owns them, and the
   * placeholder's own mousedown listener handles promotion to an editor.
   * @returns Returns true.
   */
  public stopEvent(): boolean {
    return true;
  }

  /**
   * Keeps ProseMirror from reading the fence's DOM, which Monaco mutates freely.
   * @returns Returns true.
   */
  public ignoreMutation(): boolean {
    return true;
  }

  /**
   * Tears the view down, releasing the editor and any timers.
   */
  public destroy(): void {
    this.cancelTeardown();
    this.disposeEditor();
  }

  /**
   * Renders the idle placeholder: a lightweight, static block of the fence's code, escaped
   * immediately and then, once Monaco is ready, replaced with its (syntactic) colorized HTML. No
   * editor is created until the fence is entered.
   */
  private renderPlaceholder(): void {
    const request: number = ++this.placeholderRequest;
    const code: string = this.node.textContent;
    this.body.innerHTML = `<pre class="milkdown-monaco-code-block__placeholder"><code>${escapeHtml(code)}</code></pre>`;
    const placeholder: HTMLElement | null = this.body.querySelector(
      '.milkdown-monaco-code-block__placeholder',
    );
    if (placeholder !== null) {
      this.applyCodeFont(placeholder);
    }
    void this.deps.highlighter
      .colorize(code, this.languageAttr())
      .then((html: string): void => {
        if (request !== this.placeholderRequest || this.editor !== null || html.length === 0) {
          return;
        }
        const codeElement: HTMLElement | null = this.body.querySelector(
          '.milkdown-monaco-code-block__placeholder code',
        );
        if (codeElement !== null) {
          codeElement.innerHTML = html;
        }
      })
      .catch((): void => undefined);
  }

  /**
   * Mounts the live editor over the fence, if not already mounted and Monaco can load. Replaces the
   * static placeholder, wires the change/height/blur/keyboard handlers, and optionally focuses.
   * @param focus Whether to focus the editor once mounted.
   * @returns Returns a promise that resolves once the mount attempt completes.
   */
  private async mountEditor(focus: boolean): Promise<void> {
    this.cancelTeardown();
    if (this.editor !== null) {
      if (focus) {
        this.editor.focus();
      }
      return;
    }
    if (!this.view.editable || this.mounting) {
      return;
    }
    this.mounting = true;
    try {
      await this.deps.monaco.ensureLoaded();
    } finally {
      this.mounting = false;
    }
    const monaco: typeof MonacoApi | undefined = this.deps.monaco.getMonaco();
    // The node view may have been torn down, or another mount may have won, while Monaco loaded.
    if (monaco === undefined || this.editor !== null || !this.dom.isConnected) {
      return;
    }

    this.body.innerHTML = '';
    const host: HTMLElement = document.createElement('div');
    host.className = 'milkdown-monaco-code-block__editor';
    this.body.appendChild(host);

    const model: MonacoApi.editor.ITextModel = monaco.editor.createModel(
      this.node.textContent,
      this.resolvedLanguageId(),
    );
    this.editor = monaco.editor.create(host, {
      // The font (family and size) comes from the code-editor settings, exactly as the placeholder is
      // styled, so entering a fence does not resize its text.
      ...this.deps.monaco.getEditorOptions(this.resolvedLanguageId()),
      model,
      // Colour with the syntactic (Monarch) tokenizer only — the same colours `colorize` gives the
      // static placeholder and the agent bubbles — not the semantic tokens the code-editor tabs add,
      // so the fence looks identical entered and idle, and stays cheap on long documents.
      'semanticHighlighting.enabled': false,
      // A value in (0, 8) is a multiplier of the font size; match the placeholder's line height.
      lineHeight: FENCE_LINE_HEIGHT,
      // A fence is a compact, chromeless surface, not a full page: no line numbers, gutter, minimap,
      // folding or ruler, and it grows to fit its content rather than scrolling internally. The
      // decorations lane is widened a little to give the code some breathing room from the left edge.
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 12,
      lineNumbersMinChars: 0,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 0,
      renderLineHighlight: 'none',
      wordWrap: 'on',
      padding: { top: 8, bottom: 8 },
      scrollbar: { alwaysConsumeMouseWheel: false, vertical: 'hidden' },
      // Keep the suggest/hover widgets from being clipped by the fence's overflow.
      fixedOverflowWidgets: true,
      automaticLayout: true,
    });

    this.editorDisposers = [
      model,
      this.editor,
      this.editor.onDidChangeModelContent(
        (event: MonacoApi.editor.IModelContentChangedEvent): void => this.forwardEdit(event),
      ),
      this.editor.onDidContentSizeChange((): void => this.syncHeight()),
      this.editor.onDidBlurEditorWidget((): void => this.scheduleTeardown()),
      this.editor.onKeyDown((event: MonacoApi.IKeyboardEvent): void => this.onKeyDown(event)),
    ];

    this.syncHeight();
    if (focus) {
      this.editor.focus();
    }
  }

  /**
   * Forwards an editor content change to the ProseMirror document as a minimal transaction, and keeps
   * the document selection in step. Ignores echoes of document-driven edits and changes made while
   * the editor is not focused.
   * @param event The Monaco content-change event, whose changes are ordered high offset first.
   */
  private forwardEdit(event: MonacoApi.editor.IModelContentChangedEvent): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const pos: number | undefined = this.getPos();
    if (this.applyingRemoteEdit || editor === null || pos === undefined || !editor.hasTextFocus()) {
      return;
    }
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return;
    }
    const offset: number = pos + 1;
    const tr: Transaction = this.view.state.tr;
    // The changes arrive ordered from the highest offset down, so each edit's pre-change offsets stay
    // valid as the earlier (higher) edits are applied to the transaction.
    for (const change of event.changes) {
      const from: number = offset + change.rangeOffset;
      const to: number = from + change.rangeLength;
      if (change.text.length > 0) {
        tr.replaceWith(from, to, this.view.state.schema.text(change.text));
      } else {
        tr.delete(from, to);
      }
    }
    const selection: MonacoApi.Selection | null = editor.getSelection();
    if (selection !== null) {
      const selFrom: number = offset + model.getOffsetAt(selection.getStartPosition());
      const selTo: number = offset + model.getOffsetAt(selection.getEndPosition());
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
    }
    this.view.dispatch(tr);
  }

  /**
   * Handles the editor's edge keys: navigating out of the fence at its boundaries, exiting on
   * mod-enter, and collapsing an emptied single-line fence back to a paragraph.
   * @param event The Monaco keyboard event.
   */
  private onKeyDown(event: MonacoApi.IKeyboardEvent): void {
    const monaco: typeof MonacoApi | undefined = this.deps.monaco.getMonaco();
    if (monaco === undefined) {
      return;
    }
    switch (event.keyCode) {
      case monaco.KeyCode.UpArrow:
        this.maybeEscape('line', -1, event);
        break;
      case monaco.KeyCode.LeftArrow:
        this.maybeEscape('char', -1, event);
        break;
      case monaco.KeyCode.DownArrow:
        this.maybeEscape('line', 1, event);
        break;
      case monaco.KeyCode.RightArrow:
        this.maybeEscape('char', 1, event);
        break;
      case monaco.KeyCode.Enter:
        if (event.ctrlKey || event.metaKey) {
          this.exitToDocument(event);
        }
        break;
      case monaco.KeyCode.Backspace:
        this.maybeCollapse(event);
        break;
      default:
        break;
    }
  }

  /**
   * Moves the selection out of the fence when the caret is at the corresponding edge, so arrow keys
   * step into the surrounding document rather than stopping at the fence.
   * @param unit Whether the boundary is the fence's edge line or its edge character.
   * @param direction -1 to leave before the fence, 1 to leave after it.
   * @param event The originating key event, consumed when navigation is taken over.
   */
  private maybeEscape(
    unit: 'line' | 'char',
    direction: -1 | 1,
    event: MonacoApi.IKeyboardEvent,
  ): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const selection: MonacoApi.Selection | null = editor?.getSelection() ?? null;
    const pos: number | undefined = this.getPos();
    if (editor === null || model === null || selection === null || pos === undefined) {
      return;
    }
    if (!selection.isEmpty()) {
      return;
    }
    const position: MonacoApi.Position = selection.getStartPosition();
    const atStart: boolean =
      unit === 'line' ? position.lineNumber === 1 : model.getOffsetAt(position) === 0;
    const atEnd: boolean =
      unit === 'line'
        ? position.lineNumber === model.getLineCount()
        : model.getOffsetAt(position) === model.getValueLength();
    if (direction < 0 ? !atStart : !atEnd) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target: number = pos + (direction < 0 ? 0 : this.node.nodeSize);
    const nextSelection: Selection = TextSelection.near(
      this.view.state.doc.resolve(target),
      direction,
    );
    this.view.dispatch(this.view.state.tr.setSelection(nextSelection).scrollIntoView());
    this.view.focus();
  }

  /**
   * Exits the fence on mod-enter, placing the selection just after it.
   * @param event The originating key event.
   */
  private exitToDocument(event: MonacoApi.IKeyboardEvent): void {
    const pos: number | undefined = this.getPos();
    if (pos === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target: number = pos + this.node.nodeSize;
    const selection: Selection = TextSelection.near(this.view.state.doc.resolve(target), 1);
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
    this.view.focus();
  }

  /**
   * Collapses the fence to a paragraph when backspace is pressed at the very start of an empty,
   * single-line block, matching how the surrounding editor deletes an empty block.
   * @param event The originating key event.
   */
  private maybeCollapse(event: MonacoApi.IKeyboardEvent): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const selection: MonacoApi.Selection | null = editor?.getSelection() ?? null;
    const pos: number | undefined = this.getPos();
    if (editor === null || model === null || selection === null || pos === undefined) {
      return;
    }
    if (!selection.isEmpty() || model.getOffsetAt(selection.getStartPosition()) > 0) {
      return;
    }
    if (model.getLineCount() >= 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const state: EditorState = this.view.state;
    const paragraph: ProseMirrorNode = state.schema.nodes['paragraph'].createChecked(
      {},
      this.node.content,
    );
    const tr: Transaction = state.tr.replaceWith(pos, pos + this.node.nodeSize, paragraph);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * Sizes the fence to its content, so the editor grows and shrinks with the code instead of
   * scrolling within a fixed box.
   */
  private syncHeight(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    const height: number = Math.max(MIN_EDITOR_HEIGHT_PX, editor.getContentHeight());
    const host: HTMLElement = editor.getContainerDomNode();
    host.style.height = `${height}px`;
    editor.layout({ width: host.clientWidth, height });
  }

  /**
   * Schedules a teardown of the editor shortly after it loses focus, reverting to the static
   * placeholder, unless focus has since returned to the fence (for example to the language field).
   */
  private scheduleTeardown(): void {
    this.cancelTeardown();
    this.teardownTimer = setTimeout((): void => {
      this.teardownTimer = null;
      if (this.editor?.hasTextFocus() === true) {
        return;
      }
      if (this.dom.contains(document.activeElement)) {
        return;
      }
      this.disposeEditor();
      this.renderPlaceholder();
    }, TEARDOWN_DELAY_MS);
  }

  /**
   * Cancels a pending teardown, if any.
   */
  private cancelTeardown(): void {
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
  }

  /**
   * Disposes the live editor and its listeners and model, leaving the body empty for a placeholder.
   */
  private disposeEditor(): void {
    for (const disposer of this.editorDisposers) {
      disposer.dispose();
    }
    this.editorDisposers = [];
    this.editor = null;
  }

  /**
   * Records a new fence language on the node, from which the placeholder, editor language and field
   * are reconciled through {@link update}.
   * @param language The language info-string.
   */
  private setLanguage(language: string): void {
    const pos: number | undefined = this.getPos();
    if (pos === undefined || language === this.languageAttr()) {
      return;
    }
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'language', language));
  }

  /**
   * Styles an element with the code-editor's configured font — the same family, size and line height
   * the mounted Monaco editor uses — so the placeholder and the editor render the code identically.
   * @param element The element to style (the placeholder).
   */
  private applyCodeFont(element: HTMLElement): void {
    const options: MonacoApi.editor.IStandaloneEditorConstructionOptions =
      this.deps.monaco.getEditorOptions(this.resolvedLanguageId());
    if (typeof options.fontFamily === 'string') {
      element.style.fontFamily = options.fontFamily;
    }
    if (typeof options.fontSize === 'number') {
      element.style.fontSize = `${options.fontSize}px`;
    }
    element.style.lineHeight = String(FENCE_LINE_HEIGHT);
  }

  /**
   * Gets the fence's declared language info-string, or an empty string.
   * @returns Returns the language attribute.
   */
  private languageAttr(): string {
    const language: unknown = this.node.attrs['language'];
    return typeof language === 'string' ? language : '';
  }

  /**
   * Resolves the fence's info-string to a Monaco language identifier.
   * @returns Returns the Monaco language identifier.
   */
  private resolvedLanguageId(): string {
    return this.deps.highlighter.resolveLanguageId(this.languageAttr());
  }
}

/**
 * Builds the Milkdown plugin that registers the Monaco `code_block` node view. Must be used after the
 * Crepe features load so it overrides (rather than races) their CodeMirror node view via Milkdown's
 * last-registration-wins node-view merge.
 * @param deps The Monaco services the node view needs.
 * @returns Returns the Milkdown plugin.
 */
export function createMonacoCodeBlockPlugin(deps: MonacoCodeBlockDeps): MilkdownPlugin {
  return $view(
    codeBlockSchema.node,
    (): NodeViewConstructor =>
      (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView =>
        new MonacoCodeBlockView(node, view, getPos, deps),
  );
}
