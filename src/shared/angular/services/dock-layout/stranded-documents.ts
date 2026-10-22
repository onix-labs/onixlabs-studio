import { DockPanel } from './dock-panel';

/**
 * Finds the documents with unsaved changes that have left the dock without being closed by choice:
 * undone or redone away, or dropped by a rebuilt tree. These must be put back rather than released —
 * a document with unsaved changes is never dropped.
 * @param panels The registered panels.
 * @param present The identifiers of the panels still open: docked, floating or popped out.
 * @param isReleased Determines whether a panel was closed by choice, its changes saved or discarded.
 * @returns Returns the identifiers of the stranded documents, in registration order.
 */
export function strandedDocuments(
  panels: readonly DockPanel[],
  present: ReadonlySet<string>,
  isReleased: (panelId: string) => boolean,
): readonly string[] {
  return panels
    .filter(
      (panel: DockPanel): boolean =>
        panel.role === 'document' &&
        !present.has(panel.id) &&
        panel.dirty?.() === true &&
        !isReleased(panel.id),
    )
    .map((panel: DockPanel): string => panel.id);
}
