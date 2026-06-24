import { TestBed } from '@angular/core/testing';

import { MarkdownPanels } from './markdown-panels';

describe('MarkdownPanels', () => {
  let panels: MarkdownPanels;

  beforeEach(() => {
    panels = TestBed.inject(MarkdownPanels);
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
});
