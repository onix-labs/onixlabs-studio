import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabDocks } from '@shared/angular/services/dock-layout/tab-docks';

import { MarkdownPanels } from './markdown-panels';

/**
 * Registers a tab's dock that only remembers which panels are open.
 * @param tabId The tab.
 */
function registerDock(tabId: string): void {
  const open: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(new Set<string>());
  const set: (panelId: string, isOpen: boolean) => void = (
    panelId: string,
    isOpen: boolean,
  ): void =>
    open.update(
      (panels: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>(
          isOpen
            ? [...panels, panelId]
            : [...panels].filter((other: string): boolean => other !== panelId),
        ),
    );
  TestBed.inject(TabDocks).register(tabId, {
    isOpen: (panelId: string): boolean => open().has(panelId),
    open: (panelId: string): void => set(panelId, true),
    close: (panelId: string): void => set(panelId, false),
    toggle: (panelId: string): void => set(panelId, !open().has(panelId)),
  });
}

describe('MarkdownPanels', () => {
  let panels: MarkdownPanels;

  beforeEach(() => {
    panels = TestBed.inject(MarkdownPanels);
    registerDock('doc-1');
    registerDock('doc-2');
    // The ribbon's no-argument commands act on the focused document; set one for these tests.
    panels.setActiveDocument('doc-1');
  });

  it('active_whenInitial_isEmpty', () => {
    expect(panels.active().size).toBe(0);
  });

  it('toggle_opensAndClosesThePanelInTheFocusedDocumentsDock', () => {
    panels.toggle('outline');
    expect(panels.active().has('outline')).toBe(true);

    panels.toggle('outline');
    expect(panels.active().has('outline')).toBe(false);
  });

  it('close_whenSeveralOpen_closesOnlyThatPanel', () => {
    panels.open('reader');
    panels.open('outline');
    panels.close('reader');
    expect([...panels.active()]).toEqual(['outline']);
  });

  it('active_followsTheFocusedDocument_soEachTabKeepsItsOwnPanels', () => {
    panels.toggle('agent');
    panels.setActiveDocument('doc-2');
    panels.toggle('outline');
    expect([...panels.active()]).toEqual(['outline']);

    panels.setActiveDocument('doc-1');
    expect([...panels.active()]).toEqual(['agent']);
  });

  it('nothingIsOpen_andNothingOpens_withNoDocumentFocused', () => {
    panels.setActiveDocument(undefined);
    panels.toggle('agent');
    expect(panels.active().size).toBe(0);
  });
});
