import { TestBed } from '@angular/core/testing';

import { StatusBar, StatusSegment } from './status-bar';

describe('StatusBar', () => {
  let service: StatusBar;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StatusBar);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('setLeading_whenCalled_updatesTheLeadingSegments', () => {
    const segments: readonly StatusSegment[] = [{ id: 'line', text: 'Ln 1, Col 1' }];

    service.setLeading(segments);

    expect(service.leading()).toEqual(segments);
  });

  it('clear_whenCalled_removesAllSegments', () => {
    service.setLeading([{ id: 'line', text: 'Ln 1, Col 1' }]);
    service.setTrailing([{ id: 'encoding', text: 'UTF-8' }]);

    service.clear();

    expect(service.leading().length + service.trailing().length).toBe(0);
  });
});
