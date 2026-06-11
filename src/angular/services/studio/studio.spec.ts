import { TestBed } from '@angular/core/testing';

import { Studio } from './studio';

describe('Studio', () => {
  let service: Studio;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Studio);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('platform_whenRunningOutsideElectron_returnsBrowser', () => {
    expect(service.platform).toBe('browser');
  });

  it('showWindowControls_whenRunningOutsideElectron_isFalse', () => {
    expect(service.showWindowControls).toBe(false);
  });

  it('minimizeWindow_whenBridgeAbsent_doesNotThrow', () => {
    expect((): void => service.minimizeWindow()).not.toThrow();
  });
});
