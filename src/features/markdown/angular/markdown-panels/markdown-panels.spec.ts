import { TestBed } from '@angular/core/testing';

import { MarkdownPanels } from './markdown-panels';

describe('MarkdownPanels', () => {
  let panels: MarkdownPanels;

  beforeEach(() => {
    panels = TestBed.inject(MarkdownPanels);
    // The ribbon's no-argument commands act on the focused document; set one for these tests.
    panels.setActiveDocument('doc-1');
  });

  it('active_whenInitial_isEmpty', () => {
    expect(panels.active().size).toBe(0);
  });

  it('toggle_whenClosed_opensThePanel', () => {
    panels.toggle('outline');
    expect(panels.active().has('outline')).toBe(true);
  });

  it('toggle_whenAlreadyOpen_closesThePanel', () => {
    panels.toggle('outline');
    panels.toggle('outline');
    expect(panels.active().has('outline')).toBe(false);
  });

  it('toggle_whenAnotherPanelOpen_keepsBothOpen', () => {
    panels.toggle('outline');
    panels.toggle('agent');
    expect([...panels.active()].sort()).toEqual(['agent', 'outline']);
  });

  it('close_whenSeveralOpen_closesOnlyThatPanel', () => {
    panels.open('reader');
    panels.open('outline');
    panels.close('reader');
    expect(panels.active().has('reader')).toBe(false);
    expect(panels.active().has('outline')).toBe(true);
  });

  it('openFor_isPerDocument_soEachTabKeepsItsOwnPanels', () => {
    panels.toggle('agent'); // opens on doc-1 (the focused document)
    panels.setActiveDocument('doc-2');
    panels.toggle('outline'); // opens on doc-2

    expect([...panels.openFor('doc-1')]).toEqual(['agent']);
    expect([...panels.openFor('doc-2')]).toEqual(['outline']);
    // The active() set follows the focused document.
    expect([...panels.active()]).toEqual(['outline']);
  });

  it('remove_whenCalled_clearsThatDocumentsPanels', () => {
    panels.toggle('agent');
    panels.remove('doc-1');
    expect(panels.openFor('doc-1').size).toBe(0);
  });
});
