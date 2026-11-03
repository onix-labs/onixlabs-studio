import { TestBed } from '@angular/core/testing';
import { FindOptions } from './find-options';

describe('FindOptions', () => {
  it('startsAllOff_andKeepsEachSurfacesChoicesApart', () => {
    const options: FindOptions = TestBed.inject(FindOptions);
    expect(options.panel.caseSensitive()).toBe(false);
    expect(options.search.regexp()).toBe(false);

    options.panel.regexp.set(true);

    expect(TestBed.inject(FindOptions).panel.regexp()).toBe(true);
    expect(options.search.regexp()).toBe(false);
  });
});
