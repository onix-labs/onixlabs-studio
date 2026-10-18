import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Log } from '@shared/angular/services/log/log';
import { LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { CodeSymbol, qualifierFor } from '@shared/angular/services/lsp/lsp-symbols';
import { providedDocumentSymbols } from '@shared/angular/services/monaco/monaco-symbol-providers';
import { flattenSymbols, GoToSymbol } from './go-to-model';

/**
 * Reads the symbols Go to Symbol lists for an editor's document (#1009): the language server's when
 * one serves the document, else those of the symbol providers Monaco ships for its built-in languages
 * (the TypeScript, JavaScript, JSON and CSS workers) — flattened, in document order.
 */
@Service()
export class GoToSymbols {
  /**
   * Holds the injector the language-server features are resolved from as symbols are read. Resolved
   * then rather than injected here: those features inject the Monaco service, which injects the go-to
   * router this reader sits behind, so injecting them at construction would be a cycle.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Reads the symbols of the document an editor shows.
   * @param editor The editor.
   * @returns Returns the symbols, flattened, or empty when nothing reports any.
   */
  public async symbolsFor(editor: MonacoApi.editor.ICodeEditor): Promise<readonly GoToSymbol[]> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return [];
    }
    let symbols: readonly CodeSymbol[] | null = await this.injector
      .get(LspFeatures)
      .documentSymbols(model);
    let source: string = 'language server';
    if (symbols === null) {
      const monaco: typeof MonacoApi | undefined = this.instanceOf(editor);
      symbols = monaco === undefined ? null : await providedDocumentSymbols(monaco, model);
      source = 'Monaco provider';
    }
    if (symbols === null) {
      this.log.debug('goTo', 'No symbols for the document', model.getLanguageId());
      return [];
    }
    this.log.debug('goTo', `Read symbols from the ${source}`, model.getLanguageId());
    return flattenSymbols(symbols, qualifierFor(model.getLanguageId()));
  }

  /**
   * Resolves the Monaco instance an editor belongs to: the one loaded into its window, since each
   * window has its own.
   * @param editor The editor.
   * @returns Returns the instance, or undefined when its window has none.
   */
  private instanceOf(editor: MonacoApi.editor.ICodeEditor): typeof MonacoApi | undefined {
    const view: Window | null = editor.getContainerDomNode().ownerDocument.defaultView;
    return view?.monaco ?? window.monaco;
  }
}
