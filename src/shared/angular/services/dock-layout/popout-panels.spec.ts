import { PopoutPanels } from './popout-panels';

describe('PopoutPanels', () => {
  it('whenEmpty_reportsNoPanelAsPoppedOrPoppable', () => {
    const panels: PopoutPanels = new PopoutPanels();
    expect(panels.isPopped('terminal')).toBe(false);
    expect(panels.canPopOut('terminal')).toBe(false);
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

  it('registerPopOut_makesThePanelPoppableAndRoutesTheAction', () => {
    const panels: PopoutPanels = new PopoutPanels();
    let popped: number = 0;
    panels.registerPopOut('terminal', (): void => {
      popped++;
    });
    expect(panels.canPopOut('terminal')).toBe(true);
    expect(panels.canPopOut('errors')).toBe(false);
    panels.popOut('terminal');
    expect(popped).toBe(1);
  });

  it('registerFallback_makesEveryPanelPoppable_butSpecificHandlersWin', () => {
    const panels: PopoutPanels = new PopoutPanels();
    const calls: string[] = [];
    panels.registerFallback((panelId: string): void => {
      calls.push(`fallback:${panelId}`);
    });
    panels.registerPopOut('terminal', (): void => {
      calls.push('specific:terminal');
    });

    expect(panels.canPopOut('errors')).toBe(true);
    expect(panels.canPopOut('terminal')).toBe(true);
    panels.popOut('errors');
    panels.popOut('terminal');
    expect(calls).toEqual(['fallback:errors', 'specific:terminal']);
  });

  it('registerFallback_disposer_removesTheFallbackUnlessReplaced', () => {
    const panels: PopoutPanels = new PopoutPanels();
    const dispose: () => void = panels.registerFallback((): void => undefined);
    dispose();
    expect(panels.canPopOut('errors')).toBe(false);
  });

  it('registerPopOut_disposer_removesTheHandlerUnlessReplaced', () => {
    const panels: PopoutPanels = new PopoutPanels();
    const dispose: () => void = panels.registerPopOut('terminal', (): void => undefined);
    dispose();
    expect(panels.canPopOut('terminal')).toBe(false);

    const stale: () => void = panels.registerPopOut('terminal', (): void => undefined);
    panels.registerPopOut('terminal', (): void => undefined);
    stale();
    expect(panels.canPopOut('terminal')).toBe(true);
  });
});
