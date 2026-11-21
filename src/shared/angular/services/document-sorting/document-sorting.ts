import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Log } from '@shared/angular/services/log/log';
import { LspCommandOutcome, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { Notifications } from '@shared/angular/services/notifications/notifications';

/**
 * Holds the key every Sort Document notification is raised under, so a newer one replaces an older one.
 */
const NOTIFICATION_KEY: string = 'sort-document';

/**
 * Sorts a document's keys (#1214), for the editor's right-click menu and the Edit menu: offered only
 * where the language server serving the document sorts it, which today is the JSON server alone. The
 * server's edits are applied as one step of undo; a sort that fails says why.
 */
@Service()
export class DocumentSorting {
  /**
   * Gets the command's name, as the right-click menu and the Edit menu show it.
   */
  public readonly label: string = $localize`:Editor command that sorts the keys of a JSON document alphabetically:Sort Document`;

  /**
   * Holds the injector the language-server features are resolved from as they are needed: they reach
   * into Monaco, whose menus reach back here.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the notifications a failed sort is told through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Determines whether Sort Document can run in an editor: it shows a document whose language server
   * sorts it.
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersSortDocument(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    return model !== null && this.injector.get(LspFeatures).servesDocumentSorting(model);
  }

  /**
   * Sorts the keys of the document an editor shows, as one step of undo. Does nothing in a read-only
   * editor; tells the user when the server could not sort it.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the document is sorted, or found not to be.
   */
  public async sortDocument(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null || editor.getRawOptions().readOnly === true) {
      return;
    }
    this.log.info('documentSorting', 'Sort Document', model.uri.toString());
    const outcome: LspCommandOutcome = await this.injector.get(LspFeatures).sortDocument(model);
    if (!outcome.ran) {
      this.log.warn('documentSorting', 'The document was not sorted', outcome.reason);
      this.notifications.notify({
        severity: 'warning',
        title: $localize`:Notification title when Sort Document fails:Couldn't sort the document`,
        detail: outcome.reason,
        key: NOTIFICATION_KEY,
      });
    }
  }
}
