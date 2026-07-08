import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { PanelArrangements } from './panel-arrangements';
import { PanelArrangement } from './panel-types';

const DEFAULTS: PanelArrangement = {
  agent: { edge: 'right', order: 0, size: 360 },
  terminal: { edge: 'bottom', order: 0, size: 240 },
};

describe('PanelArrangements', () => {
  let arrangements: PanelArrangements;
  let store: SettingsStore;

  beforeEach(() => {
    localStorage.clear();
    arrangements = TestBed.inject(PanelArrangements);
    store = TestBed.inject(SettingsStore);
  });

  it('initialize_seedsDefaultsForUnknownPanelsWithoutPersisting', () => {
    arrangements.initialize('spec', DEFAULTS);

    expect(arrangements.arrangement('spec')()).toEqual(DEFAULTS);
    // Merging defaults is not a user mutation, so nothing is written to the store.
    expect(store.get<unknown>('panel-layout.spec', null)).toBeNull();
  });

  it('initialize_neverOverwritesARestoredPlacement', () => {
    store.set('panel-layout.spec', { agent: { edge: 'left', order: 0, size: 500 } });

    arrangements.initialize('spec', DEFAULTS);

    expect(arrangements.arrangement('spec')()['agent']).toEqual({
      edge: 'left',
      order: 0,
      size: 500,
    });
    expect(arrangements.arrangement('spec')()['terminal']).toEqual(DEFAULTS['terminal']);
  });

  it('initialize_calledAgainWithALatePanel_mergesItIn', () => {
    arrangements.initialize('spec', { agent: DEFAULTS['agent'] });

    arrangements.initialize('spec', DEFAULTS);

    expect(arrangements.arrangement('spec')()['terminal']).toEqual(DEFAULTS['terminal']);
  });

  it('arrangement_returnsTheSameSignalForEveryCallerWithOneKey', () => {
    // Two open tabs of one view type must observe the same arrangement instance to stay in sync.
    expect(arrangements.arrangement('spec')).toBe(arrangements.arrangement('spec'));
  });

  it('move_docksThePanelAtTheEndOfTheTargetEdgeAndPersists', () => {
    arrangements.initialize('spec', DEFAULTS);

    arrangements.move('spec', 'agent', 'bottom');

    const current: PanelArrangement = arrangements.arrangement('spec')();
    expect(current['agent'].edge).toBe('bottom');
    expect(current['agent'].order).toBe(1);
    expect(store.get<PanelArrangement | null>('panel-layout.spec', null)).toEqual(current);
  });

  it('resizeEdge_writesEveryPanelOnTheEdgeAndPersists', () => {
    arrangements.initialize('spec', DEFAULTS);
    arrangements.move('spec', 'agent', 'bottom');

    arrangements.resizeEdge('spec', 'bottom', 300);

    const current: PanelArrangement = arrangements.arrangement('spec')();
    expect(current['terminal'].size).toBe(300);
    expect(current['agent'].size).toBe(300);
    expect(store.get<PanelArrangement | null>('panel-layout.spec', null)).toEqual(current);
  });

  it('arrangement_restoresAPersistedArrangementOnFirstAccess', () => {
    store.set('panel-layout.restored', {
      agent: { edge: 'top', order: 0, size: 200 },
      garbage: { edge: 'nowhere', order: 0, size: 1 },
    });

    const restored: PanelArrangement = arrangements.arrangement('restored')();

    expect(restored['agent']).toEqual({ edge: 'top', order: 0, size: 200 });
    expect('garbage' in restored).toBe(false);
  });
});
