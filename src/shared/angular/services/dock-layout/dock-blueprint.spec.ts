import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockNode, mkSplit, mkStack } from './dock-node';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockState } from './dock-state';
import { collectPanelIds } from './dock-tree';

/**
 * A stand-in panel body component; the registry only stores the type, so it is never instantiated.
 */
class StubPanel {}

/**
 * A blueprint with a distinctive layout and panel set, used to prove the dock honours it over the
 * built-in workspace default.
 */
const TEST_BLUEPRINT: DockBlueprint = {
  key: 'test',
  createLayout(): DockNode {
    return mkSplit('row', [mkStack('tool', ['alpha']), mkStack('document', [])], [1, 2]);
  },
  panels: [
    {
      id: 'alpha',
      title: 'Alpha',
      icon: Icon.SOURCE_CONTROL,
      role: 'tool',
      component: StubPanel,
    },
  ],
};

describe('Dock blueprint', () => {
  // The dock persists its layout under its blueprint key, and restores it on construction. Any
  // layout left behind — by an earlier case here, or by another spec sharing this environment —
  // would be restored instead of the blueprint's, so each case starts from a clean store.
  beforeEach(() => {
    localStorage.clear();
  });

  describe('when a blueprint is provided', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          DockState,
          DockPanelRegistry,
          { provide: DOCK_BLUEPRINT, useValue: TEST_BLUEPRINT },
        ],
      });
    });

    it('dockState_seedsTheBlueprintLayout', () => {
      const state: DockState = TestBed.inject(DockState);

      expect(collectPanelIds(state.layout())).toEqual(['alpha']);
    });

    it('registry_seedsTheBlueprintPanelsAndNotTheWorkspaceDefault', () => {
      const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);

      expect(registry.has('alpha')).toBe(true);
      expect(registry.has('files')).toBe(false);
    });

    it('reset_rebuildsTheBlueprintLayout', () => {
      const state: DockState = TestBed.inject(DockState);
      state.removeFromLayout('alpha');
      expect(collectPanelIds(state.layout())).toEqual([]);

      state.reset();

      expect(collectPanelIds(state.layout())).toEqual(['alpha']);
    });
  });

  describe('when no blueprint is provided', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [DockState, DockPanelRegistry] });
    });

    it('buildsTheDefaultLayoutButCataloguesNoPanels', () => {
      const state: DockState = TestBed.inject(DockState);
      const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);

      // DockState still falls back to the built-in default layout tree...
      expect(collectPanelIds(state.layout())).toContain('files');
      // ...but the registry names no panel of its own: every catalogue entry comes from a blueprint.
      expect(registry.has('files')).toBe(false);
    });
  });
});
