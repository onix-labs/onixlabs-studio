import { TestBed } from '@angular/core/testing';

import { Tab, TabType } from './tab';
import { Tabs } from './tabs';

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
});
