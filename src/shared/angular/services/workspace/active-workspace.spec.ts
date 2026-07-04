import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ActiveWorkspace } from './active-workspace';

describe('ActiveWorkspace', () => {
  let activeWorkspace: ActiveWorkspace;
  let activeTabId: WritableSignal<string | undefined>;

  beforeEach(() => {
    activeTabId = signal<string | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [ActiveWorkspace, { provide: Tabs, useValue: { activeTabId } }],
    });
    activeWorkspace = TestBed.inject(ActiveWorkspace);
  });

  it('rootPath_whenNoActiveTab_isNull', () => {
    expect(activeWorkspace.rootPath()).toBeNull();
  });

  it('rootPath_reflectsTheActiveTabsPublishedRoot', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeWorkspace.setRoot('tab-2', '/projects/beta');

    activeTabId.set('tab-2');

    expect(activeWorkspace.rootPath()).toBe('/projects/beta');
  });

  it('rootPath_whenActiveTabHasNoPublishedRoot_isNull', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeTabId.set('tab-other');

    expect(activeWorkspace.rootPath()).toBeNull();
  });

  it('clearRoot_dropsThePublishedRoot', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeTabId.set('tab-1');
    activeWorkspace.clearRoot('tab-1');

    expect(activeWorkspace.rootPath()).toBeNull();
  });
});
