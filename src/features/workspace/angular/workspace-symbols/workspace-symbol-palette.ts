import { ComponentPortal } from '@angular/cdk/portal';
import { createGlobalPositionStrategy, createOverlayRef, OverlayRef } from '@angular/cdk/overlay';
import { ComponentRef, inject, Injector, Service } from '@angular/core';
import { QuickOpen } from '@shared/angular/components/go-to/quick-open/quick-open';
import { GoToSymbol, GoToTarget, symbolIcon } from '@shared/angular/services/go-to/go-to-model';
import { Log } from '@shared/angular/services/log/log';
import { LspClient, WorkspaceSymbolMatch } from '@shared/angular/services/lsp/lsp-client';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';

/**
 * How long typing must pause before the workspace is searched, so a name typed quickly is one
 * request rather than one per letter.
 */
const SEARCH_DEBOUNCE_MS: number = 120;

/**
 * Go to Symbol in Workspace (#1146): the quick-open box, in workspace mode, over the workspace in
 * front. What is typed is searched for across every language server the workspace runs; choosing a
 * symbol opens its file at its name. Provided per workspace, beside the language-server client whose
 * sessions it searches.
 */
@Service()
export class WorkspaceSymbolPalette {
  /**
   * Holds the workspace's injector, so the box is drawn in its window's overlay container.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the workspace's language-server client, whose servers are searched.
   */
  private readonly lspClient: LspClient = inject(LspClient);

  /**
   * Holds the navigation that opens a file and places the caret once its editor has registered.
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open box's overlay, or null when none is open.
   */
  private overlay: OverlayRef | null = null;

  /**
   * Holds the pending search's timer.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Counts the searches made, so an answer that arrives after a newer search began is dropped.
   */
  private searches: number = 0;

  /**
   * Opens the box; an open one is left as it is.
   */
  public open(): void {
    if (this.overlay !== null) {
      return;
    }
    const overlay: OverlayRef = createOverlayRef(this.injector, {
      positionStrategy: createGlobalPositionStrategy(this.injector)
        .centerHorizontally()
        .top('3.5rem'),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      disposeOnNavigation: true,
    });
    this.overlay = overlay;
    const box: ComponentRef<QuickOpen> = overlay.attach(
      new ComponentPortal(QuickOpen, null, this.injector),
    );
    box.setInput('mode', 'workspace');
    box.setInput('symbols', []);
    box.instance.searched.subscribe((query: string): void => this.search(box, query));
    box.instance.picked.subscribe((target: GoToTarget): void => this.go(target));
    box.instance.dismissed.subscribe((): void => this.close());
    overlay.backdropClick().subscribe((): void => this.close());
    this.log.info('workspace.symbols', 'Go to Symbol in Workspace opened');
  }

  /**
   * Searches for what was typed once typing pauses, handing the box what the servers answer.
   * @param box The open box.
   * @param query What was typed.
   */
  private search(box: ComponentRef<QuickOpen>, query: string): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    const search: number = ++this.searches;
    if (query.trim().length === 0) {
      box.setInput('symbols', []);
      return;
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.lspClient
        .workspaceSymbols(query)
        .then((matches: readonly WorkspaceSymbolMatch[]): void => {
          if (search === this.searches && this.overlay !== null) {
            box.setInput('symbols', matches.map(toGoToSymbol));
          }
        });
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Goes to a chosen symbol: closes the box, then opens its file at its name.
   * @param target Where the symbol is.
   */
  private go(target: GoToTarget): void {
    this.close();
    if (target.path === undefined) {
      return;
    }
    this.log.info('workspace.symbols', 'Going to symbol', target.path);
    void this.navigation.goTo(
      null,
      {
        path: target.path,
        range: {
          startLineNumber: target.line,
          startColumn: target.column,
          endLineNumber: target.endLine ?? target.line,
          endColumn: target.endColumn ?? target.column,
        },
      },
      true,
    );
  }

  /**
   * Closes the box, dropping any search still under way.
   */
  private close(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.searches += 1;
    this.overlay?.dispose();
    this.overlay = null;
  }
}

/**
 * Converts a symbol found in the workspace to a row of the box.
 * @param match The symbol.
 * @param index Its place in the answer, which keeps two symbols of one name apart.
 * @returns Returns the row's symbol.
 */
function toGoToSymbol(match: WorkspaceSymbolMatch, index: number): GoToSymbol {
  return {
    id: `${index}:${match.path}:${match.range.startLineNumber}:${match.range.startColumn}`,
    name: match.name,
    container: match.container,
    icon: symbolIcon(match.kind),
    target: {
      path: match.path,
      line: match.range.startLineNumber,
      column: match.range.startColumn,
      endLine: match.range.endLineNumber,
      endColumn: match.range.endColumn,
    },
  };
}
