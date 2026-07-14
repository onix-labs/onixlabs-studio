import { TestBed } from '@angular/core/testing';

import { FontCatalog, SYSTEM_DEFAULT_FONT } from './font-catalog';

describe('FontCatalog', () => {
  let catalog: FontCatalog;

  beforeEach(() => {
    catalog = TestBed.inject(FontCatalog);
  });

  it('should be created', () => {
    expect(catalog).toBeTruthy();
  });

  it('monospaceFonts_alwaysIncludesTheBundledDefault', () => {
    const values: readonly string[] = catalog.monospaceFonts().map((option) => option.value);
    expect(values).toContain('JetBrains Mono');
  });

  it('sansFonts_alwaysIncludesSystemDefaultFirst', () => {
    expect(catalog.sansFonts()[0]?.value).toBe(SYSTEM_DEFAULT_FONT);
  });
});
