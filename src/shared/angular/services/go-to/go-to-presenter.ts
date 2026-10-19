import {
  ComponentRef,
  inject,
  Injector,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { createGlobalPositionStrategy, createOverlayRef, OverlayRef } from '@angular/cdk/overlay';
import type * as MonacoApi from 'monaco-editor';
import { QuickOpen } from '@shared/angular/components/go-to/quick-open/quick-open';
import { Log } from '@shared/angular/services/log/log';
import { GoToStyle, Settings } from '@shared/angular/services/settings/settings';
import { GoToMode, GoToSurfaceMode, GoToSymbol, GoToTarget, revealTarget } from './go-to-model';
import { GoToSymbols } from './go-to-symbols';

/**
 * Describes one Go to, asked of an editor.
 */
export interface GoToRequest {
  /**
   * Gets the editor to go somewhere in.
   */
  readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Gets what is asked for: a symbol, or a line.
   */
  readonly mode: GoToMode;

  /**
   * Gets the injector of the component the editor is in, which decides the window the quick-open box
   * is drawn in, or null for the main window's.
   */
  readonly injector: Injector | null;
}

/**
 * Describes one request for a symbol's new name (#1015), asked of an editor.
 */
export interface RenamePromptRequest {
  /**
   * Gets the editor the symbol is in, which gets focus back when the prompt closes.
   */
  readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Gets the symbol's name as it stands, which the prompt opens holding.
   */
  readonly currentName: string;

  /**
   * Gets the injector of the component the editor is in, which decides the window the quick-open box
   * is drawn in, or null for the main window's.
   */
  readonly injector: Injector | null;
}

/**
 * Describes the Go to dialog the dialog host shows, while one is open.
 */
export interface GoToDialog {
  /**
   * Gets what the dialog asks for: a symbol, a line, or a new name.
   */
  readonly mode: GoToSurfaceMode;

  /**
   * Gets the name of the symbol being renamed, for a rename dialog; empty otherwise.
   */
  readonly currentName: string;

  /**
   * Gets the number of lines in the document.
   */
  readonly lineCount: number;

  /**
   * Gets the document's symbols, or null while they are being read.
   */
  readonly symbols: Signal<readonly GoToSymbol[] | null>;
}

/**
 * Presents a Go to the way the user chose (#1009) — the "Go to style" setting, read as each one opens,
 * so a change applies to the next: the quick-open box, drawn in a CDK overlay near the top of the
 * editor's window, or a dialog, shown by the dialog host mounted at the application root. Either way
 * it reads the document's symbols for Go to Symbol, and goes where the user picks: the place is
 * selected, centred and focused in the editor the request came from.
 *
 * Rename Symbol asks for a symbol's new name the same way (#1015), through {@link promptRename}: the
 * quick-open box or a dialog, by the same setting.
 *
 * One Go to is open at a time; opening another closes the first.
 */
@Service()
export class GoToPresenter {
  /**
   * Holds the settings service, whose Go to style decides the surface.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the symbol reader Go to Symbol lists from.
   */
  private readonly symbols: GoToSymbols = inject(GoToSymbols);

  /**
   * Holds the root injector, for a quick-open box opened from an editor with no injector of its own.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open dialog, or null when none is.
   */
  private readonly dialogState: WritableSignal<GoToDialog | null> = signal<GoToDialog | null>(null);

  /**
   * Gets the Go to dialog to show, or null when none is open. Read by the dialog host.
   */
  public readonly dialog: Signal<GoToDialog | null> = this.dialogState.asReadonly();

  /**
   * Holds the editor the open Go to came from, or null when none is open.
   */
  private editor: MonacoApi.editor.ICodeEditor | null = null;

  /**
   * Holds the open quick-open box's overlay, or null when none is showing.
   */
  private overlay: OverlayRef | null = null;

  /**
   * Answers the open rename prompt with the new name, or null when it closes without one; null when
   * no rename prompt is open.
   */
  private answer: ((name: string | null) => void) | null = null;

  /**
   * Presents a Go to for an editor, closing any already open.
   * @param request The Go to.
   */
  public present(request: GoToRequest): void {
    const model: MonacoApi.editor.ITextModel | null = request.editor.getModel();
    if (model === null) {
      return;
    }
    this.close();
    this.editor = request.editor;
    const lineCount: number = model.getLineCount();
    const style: GoToStyle = this.settings.textEditorGoToStyle();
    this.log.info('goTo', `Present Go to ${request.mode}`, style);
    if (style === 'dialogs') {
      this.openDialog(request, lineCount);
    } else {
      this.openQuickOpen(request, lineCount);
    }
  }

  /**
   * Asks for a symbol's new name the way the user chose (#1015) — the quick-open box or a dialog, as
   * the "Go to style" setting says — closing any Go to already open.
   * @param request The prompt.
   * @returns Returns a promise resolving to the new name, or null when the prompt closes without one.
   */
  public promptRename(request: RenamePromptRequest): Promise<string | null> {
    this.close();
    this.editor = request.editor;
    const style: GoToStyle = this.settings.textEditorGoToStyle();
    this.log.info('goTo', 'Present Rename Symbol', style);
    const answer: Promise<string | null> = new Promise<string | null>(
      (resolve: (name: string | null) => void): void => {
        this.answer = resolve;
      },
    );
    if (style === 'dialogs') {
      this.dialogState.set({
        mode: 'rename',
        currentName: request.currentName,
        lineCount: 0,
        symbols: signal<readonly GoToSymbol[] | null>(null).asReadonly(),
      });
    } else {
      this.openQuickOpen(
        { editor: request.editor, mode: 'rename', injector: request.injector },
        0,
        request.currentName,
      );
    }
    return answer;
  }

  /**
   * Answers the open rename prompt with the new name, closes it, and gives its editor focus back.
   * @param name The new name.
   */
  public completeRename(name: string): void {
    const answer: ((name: string | null) => void) | null = this.answer;
    this.answer = null;
    const editor: MonacoApi.editor.ICodeEditor | null = this.editor;
    this.close();
    editor?.focus();
    answer?.(name);
  }

  /**
   * Goes where the user picked, in the editor the open Go to came from, and closes it.
   * @param target Where to go.
   */
  public complete(target: GoToTarget): void {
    const editor: MonacoApi.editor.ICodeEditor | null = this.editor;
    this.close();
    if (editor !== null) {
      this.log.debug('goTo', 'Go to', `${target.line}:${target.column}`);
      revealTarget(editor, target);
    }
  }

  /**
   * Closes the open Go to without going anywhere, giving its editor focus back.
   */
  public cancel(): void {
    const editor: MonacoApi.editor.ICodeEditor | null = this.editor;
    this.close();
    editor?.focus();
  }

  /**
   * Opens the quick-open box in the editor's window, and fills its symbols once they are read.
   * @param request The Go to, or the rename prompt as one.
   * @param lineCount The number of lines in the document.
   * @param currentName The name of the symbol being renamed, for a rename box.
   */
  private openQuickOpen(
    request: Omit<GoToRequest, 'mode'> & { readonly mode: GoToSurfaceMode },
    lineCount: number,
    currentName: string = '',
  ): void {
    // Built from the functional API with the editor's own injector, so a box opened from an editor in
    // a popped-out window is drawn in that window's overlay container, not the main window's.
    const injector: Injector = request.injector ?? this.injector;
    const overlay: OverlayRef = createOverlayRef(injector, {
      positionStrategy: createGlobalPositionStrategy(injector).centerHorizontally().top('3.5rem'),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      disposeOnNavigation: true,
    });
    this.overlay = overlay;
    const box: ComponentRef<QuickOpen> = overlay.attach(
      new ComponentPortal(QuickOpen, null, injector),
    );
    box.setInput('mode', request.mode);
    box.setInput('lineCount', lineCount);
    box.setInput('symbols', null);
    box.setInput('currentName', currentName);
    box.instance.picked.subscribe((target: GoToTarget): void => this.complete(target));
    box.instance.renamed.subscribe((name: string): void => this.completeRename(name));
    box.instance.dismissed.subscribe((): void => this.cancel());
    overlay.backdropClick().subscribe((): void => this.cancel());
    if (request.mode === 'symbol') {
      void this.symbols.symbolsFor(request.editor).then((symbols: readonly GoToSymbol[]): void => {
        // The box may have closed, or another opened in its place, while the symbols were read.
        if (this.overlay === overlay) {
          box.setInput('symbols', symbols);
        }
      });
    }
  }

  /**
   * Opens a dialog through the dialog host, and fills its symbols once they are read.
   * @param request The Go to.
   * @param lineCount The number of lines in the document.
   */
  private openDialog(request: GoToRequest, lineCount: number): void {
    const symbols: WritableSignal<readonly GoToSymbol[] | null> = signal<
      readonly GoToSymbol[] | null
    >(null);
    const dialog: GoToDialog = {
      mode: request.mode,
      currentName: '',
      lineCount,
      symbols: symbols.asReadonly(),
    };
    this.dialogState.set(dialog);
    if (request.mode === 'symbol') {
      void this.symbols.symbolsFor(request.editor).then((read: readonly GoToSymbol[]): void => {
        if (this.dialogState() === dialog) {
          symbols.set(read);
        }
      });
    }
  }

  /**
   * Closes whatever Go to is open, answering an open rename prompt with no name.
   */
  private close(): void {
    this.overlay?.dispose();
    this.overlay = null;
    this.dialogState.set(null);
    this.editor = null;
    const answer: ((name: string | null) => void) | null = this.answer;
    this.answer = null;
    answer?.(null);
  }
}
