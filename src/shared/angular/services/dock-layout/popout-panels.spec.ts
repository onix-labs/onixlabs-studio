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
});
