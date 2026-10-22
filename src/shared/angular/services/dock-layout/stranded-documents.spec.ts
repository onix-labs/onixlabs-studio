import { signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from './dock-panel';
import { strandedDocuments } from './stranded-documents';

/**
 * Builds a panel descriptor for the helper to judge.
 * @param id The panel identifier.
 * @param role The role the panel docks as.
 * @param dirty Whether it holds unsaved changes, or undefined for a panel that never does.
 * @returns Returns the panel.
 */
function panel(id: string, role: 'tool' | 'document', dirty?: boolean): DockPanel {
  return {
    id,
    title: id,
    icon: Icon.CODE,
    role,
    component: class {},
    ...(dirty === undefined ? {} : { dirty: signal<boolean>(dirty).asReadonly() }),
  };
}

describe('strandedDocuments', () => {
  const panels: readonly DockPanel[] = [
    panel('unsaved', 'document', true),
    panel('saved', 'document', false),
    panel('closed-on-purpose', 'document', true),
    panel('open-elsewhere', 'document', true),
    panel('tool', 'tool'),
  ];

  it('strandedDocuments_findsOnlyUnsavedDocumentsThatLeftWithoutBeingClosed', () => {
    const stranded: readonly string[] = strandedDocuments(
      panels,
      new Set<string>(['open-elsewhere']),
      (id: string): boolean => id === 'closed-on-purpose',
    );

    // An undo that drops an unsaved document must never be the end of it.
    expect(stranded).toEqual(['unsaved']);
  });

  it('strandedDocuments_whenEverythingIsOpen_findsNothing', () => {
    const everything: ReadonlySet<string> = new Set<string>(panels.map((p: DockPanel) => p.id));

    expect(strandedDocuments(panels, everything, (): boolean => false)).toEqual([]);
  });
});
