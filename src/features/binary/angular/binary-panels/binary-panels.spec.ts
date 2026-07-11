import { TestBed } from '@angular/core/testing';
import { BinaryPanels } from './binary-panels';

describe('BinaryPanels', () => {
  let panels: BinaryPanels;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    panels = TestBed.inject(BinaryPanels);
  });

  it('defaults_aFreshTabHasNoVisibleOrMountedPanels', () => {
    expect(panels.isVisible('tab-1', 'disassembly')).toBe(false);
    expect(panels.isVisible('tab-1', 'inspector')).toBe(false);
    expect(panels.isVisible('tab-1', 'agent')).toBe(false);
    expect(panels.isMounted('tab-1', 'disassembly')).toBe(false);
  });

  it('toggle_showsAndMountsThePanel', () => {
    panels.toggle('tab-1', 'inspector');
    expect(panels.isVisible('tab-1', 'inspector')).toBe(true);
    expect(panels.isMounted('tab-1', 'inspector')).toBe(true);
  });

  it('toggle_twiceHidesThePanelButKeepsItMounted', () => {
    panels.toggle('tab-1', 'disassembly');
    panels.toggle('tab-1', 'disassembly');
    expect(panels.isVisible('tab-1', 'disassembly')).toBe(false);
    expect(panels.isMounted('tab-1', 'disassembly')).toBe(true);
  });

  it('hide_hidesAVisiblePanelButKeepsItMounted', () => {
    panels.toggle('tab-1', 'agent');
    panels.hide('tab-1', 'agent');
    expect(panels.isVisible('tab-1', 'agent')).toBe(false);
    expect(panels.isMounted('tab-1', 'agent')).toBe(true);
  });

  it('state_isIndependentPerTabAndPerKind', () => {
    panels.toggle('tab-1', 'inspector');
    expect(panels.isVisible('tab-1', 'disassembly')).toBe(false);
    expect(panels.isVisible('tab-2', 'inspector')).toBe(false);
    expect(panels.isVisible('tab-1', 'inspector')).toBe(true);
  });

  it('remove_clearsEveryPanelKindForTheTab', () => {
    panels.toggle('tab-1', 'disassembly');
    panels.toggle('tab-1', 'inspector');
    panels.toggle('tab-1', 'agent');
    panels.toggle('tab-2', 'inspector');

    panels.remove('tab-1');

    expect(panels.isMounted('tab-1', 'disassembly')).toBe(false);
    expect(panels.isMounted('tab-1', 'inspector')).toBe(false);
    expect(panels.isMounted('tab-1', 'agent')).toBe(false);
    // Another tab's state is untouched.
    expect(panels.isVisible('tab-2', 'inspector')).toBe(true);
  });
});
