import { TestBed } from '@angular/core/testing';

import { Tab, TabType } from './tab';
import { MAIN_WINDOW_ID, Tabs } from './tabs';

describe('Tabs', () => {
  let service: Tabs;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Tabs);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('open_whenCalled_addsAndActivatesTheTab', () => {
    const tab: Tab = service.open('code');

    expect(service.activeTabId()).toBe(tab.id);
  });

  it('open_inTheBackground_addsTheTabWithoutActivatingIt', () => {
    // An agent's open: the user stays on the tab they are working in.
    const working: Tab = service.open('code');

    const opened: Tab = service.open('markdown', undefined, { background: true });

    expect(service.tabs().map((tab: Tab): string => tab.id)).toContain(opened.id);
    expect(service.activeTabId()).toBe(working.id);
  });

  it('open_inTheBackgroundWithNoActiveTab_activatesIt', () => {
    const opened: Tab = service.open('markdown', undefined, { background: true });

    expect(service.activeTabId()).toBe(opened.id);
  });

  it('open_inTheBackgroundForAnOpenResource_leavesTheActiveTabAlone', () => {
    service.open('binary', '/ws/a.bin');
    const working: Tab = service.open('code');

    service.open('binary', '/ws/a.bin', { background: true });

    expect(service.activeTabId()).toBe(working.id);
  });

  it('open_whenCalledRepeatedly_appendsTabsInOrder', () => {
    service.open('code');
    service.open('terminal');

    const types: readonly TabType[] = service.tabs().map((tab: Tab): TabType => tab.type);
    expect(types).toEqual(['code', 'terminal']);
  });

  it('open_whenSettingsAlreadyOpen_activatesTheExistingSettingsTab', () => {
    const first: Tab = service.open('settings');
    service.open('code');

    const second: Tab = service.open('settings');

    expect(second.id).toBe(first.id);
  });

  it('open_whenSettingsOpenedTwice_doesNotCreateADuplicate', () => {
    service.open('settings');
    service.open('settings');

    const settingsTabs: readonly Tab[] = service
      .tabs()
      .filter((tab: Tab): boolean => tab.type === 'settings');
    expect(settingsTabs.length).toBe(1);
  });

  it('open_whenOpeningSettings_pinsItToTheFront', () => {
    service.open('code');

    service.open('settings');

    expect(service.tabs()[0].type).toBe('settings');
  });

  it('activeTab_whenAnotherTabActivated_returnsThatTab', () => {
    const first: Tab = service.open('code');
    service.open('markdown');

    service.activate(first.id);

    expect(service.activeTab()?.id).toBe(first.id);
  });

  it('activate_whenIdentifierUnknown_leavesTheActiveTabUnchanged', () => {
    const tab: Tab = service.open('code');

    service.activate('does-not-exist');

    expect(service.activeTabId()).toBe(tab.id);
  });

  it('close_whenClosingTheActiveTab_activatesTheNeighbour', () => {
    const first: Tab = service.open('code');
    const second: Tab = service.open('markdown');

    service.close(second.id);

    expect(service.activeTabId()).toBe(first.id);
  });

  it('close_whenClosingTheLastRemainingTab_clearsTheActiveSelection', () => {
    const tab: Tab = service.open('code');

    service.close(tab.id);

    expect(service.activeTabId()).toBeUndefined();
  });

  it('close_whenClosingAnInactiveTab_keepsTheActiveSelection', () => {
    const first: Tab = service.open('code');
    const second: Tab = service.open('markdown');

    service.close(first.id);

    expect(service.activeTabId()).toBe(second.id);
  });

  it('reorder_whenIndicesValid_movesTheTabToTheNewPosition', () => {
    service.open('code');
    service.open('markdown');
    service.open('terminal');

    service.reorder(0, 2);

    const types: readonly TabType[] = service.tabs().map((tab: Tab): TabType => tab.type);
    expect(types).toEqual(['markdown', 'terminal', 'code']);
  });

  it('reorder_whenIndexOutOfRange_leavesTheOrderUnchanged', () => {
    service.open('code');
    service.open('markdown');

    service.reorder(0, 5);

    const types: readonly TabType[] = service.tabs().map((tab: Tab): TabType => tab.type);
    expect(types).toEqual(['code', 'markdown']);
  });

  it('reorder_whenMovingThePinnedSettingsTab_leavesItAtTheFront', () => {
    service.open('code');
    service.open('settings');

    service.reorder(0, 1);

    const types: readonly TabType[] = service.tabs().map((tab: Tab): TabType => tab.type);
    expect(types).toEqual(['settings', 'code']);
  });

  it('reorder_whenMovingAnotherTabAheadOfSettings_keepsSettingsPinnedToTheFront', () => {
    service.open('code');
    service.open('markdown');
    service.open('settings');

    service.reorder(2, 0);

    const types: readonly TabType[] = service.tabs().map((tab: Tab): TabType => tab.type);
    expect(types).toEqual(['settings', 'markdown', 'code']);
  });

  it('isSettingsOpen_whenSettingsTabOpen_returnsTrue', () => {
    service.open('settings');

    expect(service.isSettingsOpen()).toBe(true);
  });

  /**
   * Reads a tab's attention flag by id.
   * @param id The tab identifier.
   * @returns Returns the flag, or undefined when the tab carries none.
   */
  function attentionOf(id: string): boolean | undefined {
    return service.tabs().find((candidate: Tab): boolean => candidate.id === id)?.attention;
  }

  it('setAttention_whenTabExists_flagsTheTab', () => {
    const tab: Tab = service.open('code');

    service.setAttention(tab.id, 'agent', true);

    expect(attentionOf(tab.id)).toBe(true);
  });

  it('setAttention_whenClearedAgain_unflagsTheTab', () => {
    const tab: Tab = service.open('code');
    service.setAttention(tab.id, 'agent', true);

    service.setAttention(tab.id, 'agent', false);

    expect(attentionOf(tab.id)).toBe(false);
  });

  it('setAttention_whileAnotherReasonStillClaimsIt_staysFlagged', () => {
    // The two sources sweep independently — the conflict watcher clears every tab without a conflict
    // on each pass — so a cleared conflict must not put out a dot the agent is still asking for. This
    // is the race that left a document tab's agent dot showing once and then never again.
    const tab: Tab = service.open('markdown');
    service.setAttention(tab.id, 'agent', true);
    service.setAttention(tab.id, 'conflict', true);

    service.setAttention(tab.id, 'conflict', false);

    expect(attentionOf(tab.id)).toBe(true);
  });

  it('setAttention_whenTheLastReasonClears_unflagsTheTab', () => {
    const tab: Tab = service.open('markdown');
    service.setAttention(tab.id, 'agent', true);
    service.setAttention(tab.id, 'conflict', true);

    service.setAttention(tab.id, 'agent', false);
    service.setAttention(tab.id, 'conflict', false);

    expect(attentionOf(tab.id)).toBe(false);
  });

  it('setAttention_whenStateUnchanged_keepsTheSameTabReference', () => {
    const tab: Tab = service.open('code');
    const before: Tab | undefined = service.tabs().find((c: Tab): boolean => c.id === tab.id);

    service.setAttention(tab.id, 'agent', false);

    expect(service.tabs().find((c: Tab): boolean => c.id === tab.id)).toBe(before);
  });

  it('setAttention_whenARaisedClaimIsRepeated_keepsTheSameTabReference', () => {
    const tab: Tab = service.open('code');
    service.setAttention(tab.id, 'agent', true);
    const before: Tab | undefined = service.tabs().find((c: Tab): boolean => c.id === tab.id);

    service.setAttention(tab.id, 'agent', true);

    expect(service.tabs().find((c: Tab): boolean => c.id === tab.id)).toBe(before);
  });

  it('setAttention_whenIdentifierUnknown_isIgnored', () => {
    service.open('code');

    expect((): void => service.setAttention('does-not-exist', 'agent', true)).not.toThrow();
  });

  it('setAttention_afterTheTabIsReopened_startsFromNoClaims', () => {
    // Claims are dropped with the tab, so a stale one cannot outlive it and light a later tab.
    const tab: Tab = service.open('code');
    service.setAttention(tab.id, 'agent', true);
    service.close(tab.id);

    const reopened: Tab = service.open('code');
    service.setAttention(reopened.id, 'agent', true);
    service.setAttention(reopened.id, 'agent', false);

    expect(attentionOf(reopened.id)).toBe(false);
  });

  it('open_withResourceKey_storesTheKeyOnTheTab', () => {
    const tab: Tab = service.open('directory', '/ws');

    expect(tab.resourceKey).toBe('/ws');
  });

  it('open_whenResourceAlreadyOpenForType_activatesTheExistingTab', () => {
    const first: Tab = service.open('directory', '/ws');
    const second: Tab = service.open('directory', '/ws');

    expect(second.id).toBe(first.id);
    expect(service.tabs()).toHaveLength(1);
    expect(service.activeTabId()).toBe(first.id);
  });

  it('open_whenSameResourceDifferentType_opensASeparateTab', () => {
    service.open('directory', '/ws');
    service.open('markdown', '/ws');

    expect(service.tabs()).toHaveLength(2);
  });

  it('open_whenDifferentResource_opensAnotherTab', () => {
    service.open('directory', '/ws');
    service.open('directory', '/other');

    expect(service.tabs()).toHaveLength(2);
  });

  it('findByResource_returnsTheMatchingTabOrUndefined', () => {
    const tab: Tab = service.open('directory', '/ws');

    expect(service.findByResource('directory', '/ws')?.id).toBe(tab.id);
    expect(service.findByResource('directory', '/missing')).toBeUndefined();
    expect(service.findByResource('markdown', '/ws')).toBeUndefined();
  });

  describe('with several windows (#1587)', () => {
    /**
     * Lists a window's tabs by id.
     * @param windowId The window.
     * @returns Returns the ids, in strip order.
     */
    function idsIn(windowId: string): string[] {
      return service
        .tabsIn(windowId)()
        .map((tab: Tab): string => tab.id);
    }

    it('everyTab_startsInTheFirstWindow', () => {
      const tab: Tab = service.open('code');

      expect(service.windowOf(tab.id)).toBe(MAIN_WINDOW_ID);
      expect(idsIn(MAIN_WINDOW_ID)).toEqual([tab.id]);
      expect(service.focusedWindow()).toBe(MAIN_WINDOW_ID);
    });

    it('aTabOpenedForAWindow_opensThere_andBringsItToTheFront', () => {
      const first: Tab = service.open('code');

      const second: Tab = service.open('terminal', undefined, { windowId: 'w2' });

      expect(idsIn(MAIN_WINDOW_ID)).toEqual([first.id]);
      expect(idsIn('w2')).toEqual([second.id]);
      expect(service.focusedWindow()).toBe('w2');
      expect(service.activeTabId()).toBe(second.id);
      // The first window keeps its own active tab.
      expect(service.activeTabIdIn(MAIN_WINDOW_ID)()).toBe(first.id);
    });

    it('aNewTab_opensInTheWindowInFront', () => {
      service.open('code', undefined, { windowId: 'w2' });

      const tab: Tab = service.open('markdown');

      expect(service.windowOf(tab.id)).toBe('w2');
    });

    it('theActiveTab_isTheActiveTabOfTheWindowInFront', () => {
      const first: Tab = service.open('code');
      const second: Tab = service.open('terminal', undefined, { windowId: 'w2' });

      service.focusWindow(MAIN_WINDOW_ID);

      expect(service.activeTabId()).toBe(first.id);
      expect(service.activeTab()?.id).toBe(first.id);
      service.focusWindow('w2');
      expect(service.activeTabId()).toBe(second.id);
    });

    it('activatingATabInAnotherWindow_bringsThatWindowToTheFront', () => {
      const first: Tab = service.open('code');
      service.open('terminal', undefined, { windowId: 'w2' });

      service.activate(first.id);

      expect(service.focusedWindow()).toBe(MAIN_WINDOW_ID);
      expect(service.activeTabId()).toBe(first.id);
    });

    it('askingForASingletonOpenInAnotherWindow_bringsThatWindowForward', () => {
      const settings: Tab = service.open('settings');
      service.open('code', undefined, { windowId: 'w2' });

      expect(service.open('settings')).toBe(settings);

      expect(service.focusedWindow()).toBe(MAIN_WINDOW_ID);
      expect(service.activeTabId()).toBe(settings.id);
    });

    it('closingAWindowsActiveTab_activatesItsNeighbourThere_andLeavesTheOtherWindowAlone', () => {
      const a: Tab = service.open('code');
      const b: Tab = service.open('code', undefined, { windowId: 'w2' });
      const c: Tab = service.open('markdown', undefined, { windowId: 'w2' });
      service.activate(b.id);

      service.close(b.id);

      expect(service.activeTabIdIn('w2')()).toBe(c.id);
      expect(service.activeTabIdIn(MAIN_WINDOW_ID)()).toBe(a.id);
      expect(idsIn('w2')).toEqual([c.id]);
    });

    it('closingAWindowsLastTab_leavesItWithNoActiveTab', () => {
      const tab: Tab = service.open('code', undefined, { windowId: 'w2' });

      service.close(tab.id);

      expect(service.activeTabIdIn('w2')()).toBeUndefined();
      expect(service.windowOf(tab.id)).toBe(MAIN_WINDOW_ID);
    });

    it('reorder_movesWithinTheWindowsStrip_andLeavesTheOtherWindowsTabsInPlace', () => {
      const a: Tab = service.open('code');
      const b: Tab = service.open('code', undefined, { windowId: 'w2' });
      const c: Tab = service.open('markdown', undefined, { windowId: MAIN_WINDOW_ID });
      const d: Tab = service.open('terminal', undefined, { windowId: 'w2' });
      const e: Tab = service.open('agent', undefined, { windowId: 'w2' });

      service.reorder(2, 0, 'w2');

      expect(idsIn('w2')).toEqual([e.id, b.id, d.id]);
      expect(idsIn(MAIN_WINDOW_ID)).toEqual([a.id, c.id]);
    });

    it('moveToWindow_makesItTheActiveTabThere_andTheWindowItLeftActivatesItsNeighbour', () => {
      const a: Tab = service.open('code');
      const b: Tab = service.open('markdown');
      service.activate(a.id);

      service.moveToWindow(a.id, 'w2');

      expect(idsIn('w2')).toEqual([a.id]);
      expect(service.activeTabIdIn('w2')()).toBe(a.id);
      expect(service.activeTabIdIn(MAIN_WINDOW_ID)()).toBe(b.id);
    });

    it('moveToWindow_back_toTheFirstWindow', () => {
      const a: Tab = service.open('code');
      service.moveToWindow(a.id, 'w2');

      service.moveToWindow(a.id, MAIN_WINDOW_ID);

      expect(service.windowOf(a.id)).toBe(MAIN_WINDOW_ID);
      expect(idsIn('w2')).toEqual([]);
      expect(service.activeTabIdIn('w2')()).toBeUndefined();
    });

    it('moveToWindow_ignoresAnUnknownTab_andAMoveToItsOwnWindow', () => {
      const a: Tab = service.open('code');

      service.moveToWindow('tab-nope', 'w2');
      service.moveToWindow(a.id, MAIN_WINDOW_ID);

      expect(idsIn('w2')).toEqual([]);
      expect(service.activeTabId()).toBe(a.id);
    });

    it('openingInTheBackground_inAWindowWithNoTabs_makesItThatWindowsActiveTab', () => {
      service.open('code');

      const tab: Tab = service.open('markdown', undefined, { background: true, windowId: 'w2' });

      expect(service.activeTabIdIn('w2')()).toBe(tab.id);
      expect(service.focusedWindow()).toBe(MAIN_WINDOW_ID);
    });
  });
});
