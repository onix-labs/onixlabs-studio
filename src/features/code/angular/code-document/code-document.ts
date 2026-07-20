import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  TextEditor,
  TextEditorCursor,
  TextEditorEol,
} from '@shared/angular/components/text-editor/text-editor';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Breakpoint, Breakpoints } from '@shared/angular/services/debug/breakpoints';
import { DebugLocation, Debugger } from '@shared/angular/services/debug/debugger';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { BreakpointGutter } from '@features/code/angular/breakpoints/breakpoint-gutter';
import { BreakpointGutterController } from '@features/code/angular/breakpoints/breakpoint-gutter-controller';

/**
 * Display name given to a new, unsaved code document (matching the markdown editor).
 */
const NEW_DOCUMENT_NAME: string = 'New Document';

/**
 * Editor options applied to the code editor: the glyph margin is enabled so the breakpoint gutter has a
 * lane to draw in (the shared text-editor leaves it off by default; only the code editor uses it). The
 * glyph-margin lane's width is fixed to the line height by Monaco and cannot be trimmed, so the left
 * gutter is tightened by the two lanes that can be: the line-number lane, whose default reserves room
 * for five digits (right-aligned, leaving a wide gap between the breakpoint dot and one- or two-digit
 * numbers) is floored at three digits (Monaco still grows it for larger files).
 *
 * The line-decorations lane (right of the line numbers) is shared by two things Monaco stacks as
 * overlapping, lane-filling elements: the change-margin bar (a `linesDecorationsClassName` decoration)
 * and the fold chevron (a `firstLineDecorationClassName`). Left at its narrow default they overlapped —
 * the chevron sat on top of the bar. The lane is widened to hold both side by side, and CSS pins the
 * bar to the left edge (against the line numbers) and the chevron to the right edge (against the code);
 * see `_change-margin.scss` and `_folding.scss`. The chevrons are shown always (not only on hover) so
 * the fold column reads as a stable gutter rather than appearing under the pointer.
 */
const CODE_EDITOR_OPTIONS: MonacoApi.editor.IEditorOptions = {
  glyphMargin: true,
  lineNumbersMinChars: 3,
  // Room for the change-margin bar (a 16px gap, a 4px bar, a 16px gap = 36px) plus the fold control box
  // to its right; see `_change-margin.scss` and `_folding.scss`.
  lineDecorationsWidth: 50,
  showFoldingControls: 'always',
};

/**
 * Represents the document-bound code editor: the shared {@link TextEditor} pane wired to its backing
 * document in the {@link Documents} service. This is the inner composition shared by the two code
 * leaves — the full code tab view and the lean document-well panel — owning exactly the concerns both
 * need: resolving the backing document, seeding the editor's content and language from it, recording
 * edits back to it, and tracking the active document over its lifecycle. It owns none of the
 * surrounding chrome (ribbon, docked panels, change-margin gutter, language-server sync, status), which
 * each leaf adds around it by reading the exposed document and driving the pane through its imperative
 * API.
 */
@Component({
  selector: 'app-code-document',
  imports: [TextEditor, TextField, Toggle],
  templateUrl: './code-document.html',
  styleUrl: './code-document.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeDocumentEditor implements OnInit, OnDestroy {
  /**
   * Holds the documents service owning the backing document's content, file association and dirty
   * state.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the breakpoint store the gutter draws from and clicks are recorded to. Breakpoints are keyed
   * by the document's absolute file path, so an unsaved document (no path) draws no gutter.
   */
  private readonly breakpoints: Breakpoints = inject(Breakpoints);

  /**
   * Holds the registry that attaches a breakpoint-gutter controller to this editor's Monaco instance.
   */
  private readonly breakpointGutter: BreakpointGutter = inject(BreakpointGutter);

  /**
   * Holds the app-level debugger seam, read for the current-execution-line marker so the editor
   * highlights the line the active workspace's debuggee is paused on.
   */
  private readonly debugger: Debugger = inject(Debugger);

  /**
   * Holds the decorations collection drawing the current-execution-line marker, or null before the
   * editor is ready.
   */
  private stoppedDecorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;

  /**
   * Holds the breakpoint-gutter controller once the pane's editor is ready, or null before then (and
   * when Monaco is unavailable). A signal so the render effect re-runs once the gutter is attached.
   */
  private readonly breakpointController: WritableSignal<BreakpointGutterController | null> =
    signal<BreakpointGutterController | null>(null);

  /**
   * Holds the shared text-editor pane this component drives, or undefined before the view initialises.
   */
  private readonly editor: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Holds the editor options bound to the pane, enabling the glyph margin for the breakpoint gutter.
   */
  protected readonly editorOptions: MonacoApi.editor.IEditorOptions = CODE_EDITOR_OPTIONS;

  /**
   * Holds the backing document, or null before initialisation.
   */
  private readonly backingDocument: WritableSignal<CodeDocument | null> =
    signal<CodeDocument | null>(null);

  /**
   * Holds the 1-based line whose breakpoint is being edited in the condition/logpoint overlay, or null
   * when the overlay is closed.
   */
  protected readonly editingLine: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the draft condition expression shown in the breakpoint editor overlay.
   */
  protected readonly editCondition: WritableSignal<string> = signal<string>('');

  /**
   * Holds the draft log message shown in the breakpoint editor overlay.
   */
  protected readonly editLogMessage: WritableSignal<string> = signal<string>('');

  /**
   * Holds the draft enabled flag shown in the breakpoint editor overlay.
   */
  protected readonly editEnabled: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets the identifier of the backing document, used to resolve the document and target edits at it.
   * For a standalone code tab this is the tab id; in a workspace's document well it is the well
   * document id.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the backing document is released when this component is destroyed. True for standalone
   * code tabs, whose destruction means the tab was closed. False inside the document well, where the
   * workspace owns the document's lifecycle and a destroy is a re-parent, not a close.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the owning leaf belongs to the active tab or well slot. Inactive
   * editors stay mounted so their state is preserved.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits once the pane's Monaco editor instance has been created, so the owning leaf can wire its
   * editor-dependent state.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the editor's text whenever the user edits the content, after it has been recorded to the
   * backing document.
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the editor's caret position whenever it moves, so the owning leaf can reflect it.
   */
  public readonly cursorChange: OutputEmitterRef<TextEditorCursor> = output<TextEditorCursor>();

  /**
   * Emits the model's end-of-line sequence whenever it changes, so the owning leaf can reflect it.
   */
  public readonly eolChange: OutputEmitterRef<TextEditorEol> = output<TextEditorEol>();

  /**
   * Holds the document id captured at initialisation, so teardown releases exactly the document that
   * was resolved without re-reading the required {@link documentId} input during destruction.
   */
  private registeredDocumentId: string | null = null;

  /**
   * Initialises the component, wiring the effect that focuses the documents service on this document
   * while the owning leaf is active.
   */
  public constructor() {
    effect((): void => {
      if (this.isActive()) {
        this.documents.setActiveDocument(this.documentId());
      }
    });
    // Redraw the breakpoint gutter whenever the controller attaches, the document's path changes, or the
    // store changes. An unsaved document (no path) draws nothing.
    effect((): void => {
      const controller: BreakpointGutterController | null = this.breakpointController();
      const document: CodeDocument | null = this.backingDocument();
      if (controller === null || document === null) {
        return;
      }
      const path: string | null = document.filePath();
      controller.render(path === null ? [] : this.breakpoints.forPath(path));
    });
    // Mark the current-execution line when the active workspace's debuggee is paused in this document.
    effect((): void => {
      const location: DebugLocation | null = this.debugger.stoppedLocation();
      const path: string | null = this.backingDocument()?.filePath() ?? null;
      const collection: MonacoApi.editor.IEditorDecorationsCollection | null =
        this.stoppedDecorations;
      if (collection === null) {
        return;
      }
      if (location !== null && path !== null && location.path === path) {
        collection.set([
          {
            range: {
              startLineNumber: location.line,
              startColumn: 1,
              endLineNumber: location.line,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: 'debug-current-line',
              glyphMarginClassName: 'debug-current-line-glyph',
            },
          },
        ]);
      } else {
        collection.clear();
      }
    });
  }

  /**
   * Resolves the backing document for the owning leaf, seeding a new code document with its display
   * name. An existing document (a file opened into the well) keeps its own name and content.
   */
  public ngOnInit(): void {
    this.registeredDocumentId = this.documentId();
    this.backingDocument.set(this.documents.ensure(this.documentId(), NEW_DOCUMENT_NAME));
  }

  /**
   * Clears the active-document focus and releases the backing document when this component owns its
   * lifecycle (a standalone tab). The pane disposes the Monaco editor itself. No-ops when the component
   * was never initialised (it has no resolved document to release).
   */
  public ngOnDestroy(): void {
    const id: string | null = this.registeredDocumentId;
    if (id === null) {
      return;
    }
    if (this.documents.activeDocumentId() === id) {
      this.documents.setActiveDocument(null);
    }
    if (this.removeOnDestroy()) {
      this.documents.remove(id);
    }
    const controller: BreakpointGutterController | null = this.breakpointController();
    if (controller !== null) {
      this.breakpointGutter.detach(controller);
      this.breakpointController.set(null);
    }
  }

  /**
   * Gets the backing document, so the owning leaf can drive its editor-instance features (change
   * margin, language-server sync, editor registration, status) from the document's signals.
   * @returns Returns the document, or null before initialisation.
   */
  public document(): CodeDocument | null {
    return this.backingDocument();
  }

  /**
   * Gets the shared text-editor pane, so the owning leaf can drive it through its imperative API.
   * @returns Returns the pane, or undefined before the view initialises.
   */
  public getPane(): TextEditor | undefined {
    return this.editor();
  }

  /**
   * Gets the backing document, exposed for the template's content and language bindings.
   * @returns Returns the document, or null before initialisation.
   */
  protected doc(): CodeDocument | null {
    return this.backingDocument();
  }

  /**
   * Attaches the breakpoint gutter to the now-ready Monaco editor and re-emits the pane's ready event to
   * the owning leaf.
   */
  protected onReady(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
      this.editor()?.getEditor() ?? null;
    if (editor !== null) {
      this.breakpointController.set(
        this.breakpointGutter.attach(
          editor,
          (line: number): void => this.toggleBreakpoint(line),
          (line: number): void => this.openBreakpointEditor(line),
        ),
      );
      this.stoppedDecorations = editor.createDecorationsCollection([]);
    }
    this.ready.emit();
  }

  /**
   * Toggles the breakpoint at a line, when the document has a file path. Closes the editor overlay so a
   * removal does not leave it open on a gone breakpoint.
   * @param line The 1-based line.
   */
  protected toggleBreakpoint(line: number): void {
    const path: string | null = this.backingDocument()?.filePath() ?? null;
    if (path === null) {
      return;
    }
    this.breakpoints.toggle(path, line);
    if (this.editingLine() === line) {
      this.closeBreakpointEdit();
    }
  }

  /**
   * Opens the condition/logpoint overlay for a line, seeding it with the breakpoint's current values and
   * creating a plain breakpoint first when the line has none. No-ops for an unsaved document.
   * @param line The 1-based line.
   */
  protected openBreakpointEditor(line: number): void {
    const path: string | null = this.backingDocument()?.filePath() ?? null;
    if (path === null) {
      return;
    }
    let existing: Breakpoint | undefined = this.breakpoints
      .forPath(path)
      .find((breakpoint: Breakpoint): boolean => breakpoint.line === line);
    if (existing === undefined) {
      this.breakpoints.add(path, line);
      existing = this.breakpoints
        .forPath(path)
        .find((breakpoint: Breakpoint): boolean => breakpoint.line === line);
    }
    this.editCondition.set(existing?.condition ?? '');
    this.editLogMessage.set(existing?.logMessage ?? '');
    this.editEnabled.set(existing?.enabled ?? true);
    this.editingLine.set(line);
  }

  /**
   * Applies the overlay's draft condition, log message and enabled flag to the edited breakpoint, then
   * closes the overlay.
   */
  protected saveBreakpointEdit(): void {
    const path: string | null = this.backingDocument()?.filePath() ?? null;
    const line: number | null = this.editingLine();
    if (path !== null && line !== null) {
      this.breakpoints.update(path, line, {
        condition: this.editCondition(),
        logMessage: this.editLogMessage(),
        enabled: this.editEnabled(),
      });
    }
    this.closeBreakpointEdit();
  }

  /**
   * Removes the edited breakpoint and closes the overlay.
   */
  protected removeBreakpointEdit(): void {
    const path: string | null = this.backingDocument()?.filePath() ?? null;
    const line: number | null = this.editingLine();
    if (path !== null && line !== null) {
      this.breakpoints.remove(path, line);
    }
    this.closeBreakpointEdit();
  }

  /**
   * Closes the breakpoint editor overlay without changing anything.
   */
  protected closeBreakpointEdit(): void {
    this.editingLine.set(null);
  }

  /**
   * Records the user's edit to the backing document and re-emits it to the owning leaf.
   * @param text The editor's new text.
   */
  protected onContentChange(text: string): void {
    this.documents.setContent(this.documentId(), text);
    this.contentChange.emit(text);
  }

  /**
   * Re-emits the pane's caret position to the owning leaf.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.cursorChange.emit(cursor);
  }

  /**
   * Re-emits the pane's end-of-line sequence to the owning leaf.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eolChange.emit(eol);
  }
}
