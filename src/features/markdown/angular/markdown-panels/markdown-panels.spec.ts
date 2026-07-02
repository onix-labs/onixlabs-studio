import { TestBed } from '@angular/core/testing';

import { MarkdownPanels } from './markdown-panels';

describe('MarkdownPanels', () => {
  let panels: MarkdownPanels;

  beforeEach(() => {
    panels = TestBed.inject(MarkdownPanels);
    // The ribbon's no-argument commands act on the focused document; set one for these tests.
    panels.setActiveDocument('doc-1');
  });

  it('active_whenInitial_isNone', () => {
    expect(panels.active()).toBe('none');
  });

  it('toggle_whenClosed_opensThePanel', () => {
    panels.toggle('outline');
    expect(panels.active()).toBe('outline');
  });

  it('toggle_whenAlreadyActive_closesThePanel', () => {
    panels.toggle('outline');
    panels.toggle('outline');
    expect(panels.active()).toBe('none');
  });

  it('toggle_whenAnotherPanelActive_switchesPanels', () => {
    panels.toggle('outline');
    panels.toggle('agent');
    expect(panels.active()).toBe('agent');
  });

  it('close_whenOpen_closesThePanel', () => {
    panels.open('reader');
    panels.close();
    expect(panels.active()).toBe('none');
  });

  it('activeFor_isPerDocument_soEachTabKeepsItsOwnPanel', () => {
    panels.toggle('agent'); // opens on doc-1 (the focused document)
    panels.setActiveDocument('doc-2');
    panels.toggle('outline'); // opens on doc-2

    expect(panels.activeFor('doc-1')).toBe('agent');
    expect(panels.activeFor('doc-2')).toBe('outline');
    // The active() panel follows the focused document.
    expect(panels.active()).toBe('outline');
  });

  it('remove_whenCalled_clearsThatDocumentsPanel', () => {
    panels.toggle('agent');
    panels.remove('doc-1');
    expect(panels.activeFor('doc-1')).toBe('none');
  });
});
