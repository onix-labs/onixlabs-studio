import { TestBed } from '@angular/core/testing';

import { DockTabContext } from './dock-tab-context';

describe('DockTabContext', () => {
  let context: DockTabContext;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    context = TestBed.inject(DockTabContext);
  });

  it('signals_beforeAnythingIsSet_reportTheDefaults', () => {
    expect(context.tabId()).toBe('');
    expect(context.root()).toBeNull();
  });

  it('setTabId_whenCalled_exposesTheOwningTab', () => {
    context.setTabId('tab-7');

    expect(context.tabId()).toBe('tab-7');
  });

  it('setRoot_whenAFolderOpens_exposesTheRootPath', () => {
    context.setRoot('/ws/project');

    expect(context.root()).toBe('/ws/project');
  });

  it('setRoot_whenTheFolderCloses_returnsToNull', () => {
    context.setRoot('/ws/project');

    context.setRoot(null);

    expect(context.root()).toBeNull();
  });
});
