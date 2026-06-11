import { TestBed } from '@angular/core/testing';
import { DockFloating, FloatWindow } from './dock-floating';
import { Rect } from './dock-legality';
import { StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

describe('DockFloating', () => {
  let floating: DockFloating;
  let state: DockState;
  const rect: Rect = { left: 100, top: 100, width: 360, height: 240 };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    floating = TestBed.inject(DockFloating);
    state = TestBed.inject(DockState);
  });

  it('float_whenCalled_detachesThePanelFromTheLayoutIntoAWindow', () => {
    floating.float('output', rect);

    expect(
      floating.floats().some((window: FloatWindow): boolean => window.panelId === 'output'),
    ).toBe(true);
    expect(findStackOfPanel(state.layout(), 'output')).toBeNull();
  });

  it('float_whenAlreadyFloating_bringsItToTheFrontWithoutDuplicating', () => {
    floating.float('output', rect);
    floating.float('errors', rect);
    const firstZ: number = floating.floats()[0].z;

    floating.float('output', rect);

    expect(
      floating.floats().filter((window: FloatWindow): boolean => window.panelId === 'output'),
    ).toHaveLength(1);
    const outputZ: number = floating
      .floats()
      .find((window: FloatWindow): boolean => window.panelId === 'output')!.z;
    expect(outputZ).toBeGreaterThan(firstZ);
  });

  it('resize_whenBelowTheMinimum_clampsToTheMinimumSize', () => {
    floating.float('output', rect);

    floating.resize('output', 10, 10);

    const window: FloatWindow = floating.floats()[0];
    expect(window.width).toBe(180);
    expect(window.height).toBe(120);
  });

  it('move_whenCalled_repositionsTheWindow', () => {
    floating.float('output', rect);

    floating.move('output', 250, 300);

    const window: FloatWindow = floating.floats()[0];
    expect(window.left).toBe(250);
    expect(window.top).toBe(300);
  });

  it('close_whenCalled_removesTheWindow', () => {
    floating.float('output', rect);

    floating.close('output');

    expect(floating.floats()).toHaveLength(0);
  });

  it('dockBack_whenTool_redocksToTheLayoutAndRemovesTheWindow', () => {
    floating.float('output', rect);

    floating.dockBack('output');

    expect(floating.floats()).toHaveLength(0);
    expect(findStackOfPanel(state.layout(), 'output')).not.toBeNull();
  });

  it('dockBack_whenDocument_returnsToADocumentWell', () => {
    floating.float('doc1', rect);

    floating.dockBack('doc1');

    const well: StackNode | null = findStackOfPanel(state.layout(), 'doc1');
    expect(well?.role).toBe('document');
  });
});
