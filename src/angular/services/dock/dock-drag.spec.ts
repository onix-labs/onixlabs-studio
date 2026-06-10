import { TestBed } from '@angular/core/testing';
import { DockDrag } from './dock-drag';
import { DockPanel } from './dock-panel';

describe('DockDrag', () => {
  let drag: DockDrag;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    drag = TestBed.inject(DockDrag);
  });

  it('active_whenIdle_isFalse', () => {
    expect(drag.active()).toBe(false);
    expect(drag.panel()).toBeNull();
  });

  it('begin_whenStartingAToolPanel_activatesTheDragAndEnablesEdgeGuides', () => {
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));

    expect(drag.active()).toBe(true);
    expect(drag.panel()?.id).toBe('output');
    expect(drag.showEdges()).toBe(true);
    expect(drag.ghost()).not.toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(drag.active()).toBe(false);
  });

  it('begin_whenStartingADocumentPanel_disablesEdgeGuides', () => {
    drag.begin('doc1', new MouseEvent('mousedown', { clientX: 50, clientY: 50 }));

    expect(drag.showEdges()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('begin_whenAlreadyDragging_isIgnored', () => {
    drag.begin('output', new MouseEvent('mousedown'));
    const panel: DockPanel | null = drag.panel();

    drag.begin('solution', new MouseEvent('mousedown'));

    expect(drag.panel()).toBe(panel);
    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('begin_whenPanelUnknown_doesNotActivate', () => {
    drag.begin('absent', new MouseEvent('mousedown'));

    expect(drag.active()).toBe(false);
  });
});
