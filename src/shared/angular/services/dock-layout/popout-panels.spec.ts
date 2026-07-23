import { PopoutPanels } from './popout-panels';

describe('PopoutPanels', () => {
  it('whenEmpty_reportsNoPanelAsPopped', () => {
    const panels: PopoutPanels = new PopoutPanels();
    expect(panels.windowIdFor('terminal')).toBeNull();
  });

  it('markPopped_recordsThePanelAndItsWindow', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.markPopped('terminal', 7);
    expect(panels.windowIdFor('terminal')).toBe(7);
    expect(panels.windowIdFor('errors')).toBeNull();
  });

  it('markPopped_replacesAnEarlierWindowForTheSamePanel', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.markPopped('terminal', 7);
    panels.markPopped('terminal', 9);
    expect(panels.windowIdFor('terminal')).toBe(9);
  });

  it('clear_removesThePanel', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.markPopped('terminal', 7);
    panels.clear('terminal');
    expect(panels.windowIdFor('terminal')).toBeNull();
  });

  it('clear_ofAnUnknownPanel_isANoOp', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.clear('terminal');
    expect(panels.windowIdFor('terminal')).toBeNull();
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

  it('popOut_ofAPanelWithoutAHandler_isANoOp', () => {
    const panels: PopoutPanels = new PopoutPanels();
    panels.popOut('errors');
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
