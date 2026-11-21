import { inject, Injector, Service } from '@angular/core';
import { MergeToolPanel } from '@shared/angular/components/panels/merge-tool-panel/merge-tool-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { MergeTools } from './merge-tools';

/**
 * Opens a conflicted file in the merge tool (#1321): a document tab with the user's side and the
 * other side next to each other above the file itself, where each conflict is settled.
 *
 * The merge tool edits the file's own document, so the file is opened in the well first — behind,
 * where it is not already open — and the two tabs are one document: an edit in either is in both, and
 * saving either saves the file. The merge tool opens beside the file's tab.
 */
@Service()
export class MergeToolOpener {
  /**
   * Holds what each merge tool shows.
   */
  private readonly mergeTools: MergeTools = inject(MergeTools);

  /**
   * Holds the document model, which finds the file's document once it is open.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the dock layout the document well lives in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock focus tracker, so opening a merge tool accents its well.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock panel registry merge tools are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the injector the file opener is resolved from when a merge tool opens. Resolved late, as the
   * diff switch does, because the file opener is built from the same workspace providers.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens a file in the merge tool, or goes to the merge tool already open for it.
   * @param path The file's absolute path.
   * @param conflict The conflict to bring into view, counting from 0, or omitted for the first.
   * @returns Returns true once the merge tool is showing; false when the file could not be opened as
   * text or the workspace has no document well.
   */
  public async open(path: string, conflict?: number): Promise<boolean> {
    if (!(await this.injector.get(FileOpener).openPath(path, { background: true }))) {
      this.log.warn('MergeToolOpener', `Could not open '${path}' for the merge tool`);
      return false;
    }
    const documentId: string | undefined = this.documents.findIdByPath(path);
    const document: CodeDocument | undefined =
      documentId === undefined ? undefined : this.documents.get(documentId);
    if (documentId === undefined || document === undefined) {
      // A file that opened as something other than text — an image, a binary — has no conflicts to
      // show side by side.
      this.log.warn('MergeToolOpener', `'${path}' did not open as text; no merge tool`);
      return false;
    }
    const id: string = this.mergeTools.idForPath(path);
    this.mergeTools.put(id, path);
    if (!this.registry.has(id)) {
      const name: string = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
      this.registry.register({
        id,
        title: $localize`:Title of a merge tool tab; the placeholder is the file's name:${name}:name: (Merge)`,
        icon: Icon.GIT_MERGE,
        role: 'document',
        component: MergeToolPanel,
        // No dirty marker or close guard: the file's own tab holds the document and asks about unsaved
        // changes when it closes, so closing the merge tool loses nothing.
        save: (): Promise<boolean> => this.documents.save(documentId),
      });
    }
    const layout: DockNode = this.dockState.layout();
    const well: StackNode | null =
      findStackOfPanel(layout, id) ??
      findStackOfPanel(layout, documentId) ??
      firstStackOfRole(layout, 'document');
    if (well === null) {
      this.log.warn('MergeToolOpener', `Nowhere to open the merge tool for '${path}'`);
      return false;
    }
    if (well.panels.includes(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
    this.mergeTools.requestReveal(id, conflict ?? 0);
    this.log.info('MergeToolOpener', `Opened the merge tool for '${path}'`);
    return true;
  }
}
