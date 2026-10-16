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

  it('closeWindow_whenBridgeAbsent_doesNotThrow', () => {
    expect((): void => service.closeWindow()).not.toThrow();
  });

  it('setCaptionSymbolColor_whenRunningOutsideElectron_doesNotThrow', () => {
    expect((): void => service.setCaptionSymbolColor('#adb5bd')).not.toThrow();
  });
});
