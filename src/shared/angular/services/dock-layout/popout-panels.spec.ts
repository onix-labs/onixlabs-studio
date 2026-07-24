import { PopoutPanels } from './popout-panels';

describe('PopoutPanels', () => {
  it('whenEmpty_reportsNoPanelAsPoppedOrPoppable', () => {
    const panels: PopoutPanels = new PopoutPanels();
    expect(panels.isPopped('terminal')).toBe(false);
    expect(panels.canPopOut()).toBe(false);
  });

  it('markPopped_recordsThePanelAndRoutesFocusToItsWindow', () => {
    const panels: PopoutPanels = new PopoutPanels();
    let focused: number = 0;
    panels.markPopped('terminal', (): void => {
      focused++;
    });
    expect(panels.isPopped('terminal')).toBe(true);
    expect(panels.isPopped('errors')).toBe(false);
    panels.focusPopped('terminal');
    expect(focused).toBe(1);
  });

  it('focusPopped_ofAPanelThatIsNotPopped_isANoOp', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.focusPopped('terminal');
    expect(panels.isPopped('terminal')).toBe(false);
  });

  it('clear_removesThePanel', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.markPopped('terminal', (): void => undefined);
    panels.clear('terminal');
    expect(panels.isPopped('terminal')).toBe(false);
  });

  it('register_makesPanelsPoppableAndRoutesTheActionWithThePanelId', () => {
    const panels: PopoutPanels = new PopoutPanels();
    const calls: string[] = [];
    panels.register((panelId: string): void => {
      calls.push(panelId);
    });
    expect(panels.canPopOut()).toBe(true);
    panels.popOut('errors');
    panels.popOut('terminal');
    expect(calls).toEqual(['errors', 'terminal']);
  });

  it('popOut_withoutAHandler_isANoOp', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.popOut('terminal');
    expect(panels.canPopOut()).toBe(false);
  });

  it('register_disposer_removesTheHandlerUnlessReplaced', () => {
    const panels: PopoutPanels = new PopoutPanels();
    const dispose: () => void = panels.register((): void => undefined);
    dispose();
    expect(panels.canPopOut()).toBe(false);

    const stale: () => void = panels.register((): void => undefined);
    panels.register((): void => undefined);
    stale();
    expect(panels.canPopOut()).toBe(true);
  });
});
