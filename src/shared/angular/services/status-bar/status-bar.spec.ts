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

  it('contribute_whenCalled_updatesTheLeadingSegments', () => {
    const segments: readonly StatusSegment[] = [{ id: 'line', text: 'Ln 1, Col 1' }];

    service.contribute('code', { leading: segments, trailing: [] }, 10);

    expect(service.leading()).toEqual(segments);
  });

  it('contribute_whenMultipleOwners_mergesByPriority', () => {
    service.contribute('terminal', { leading: [], trailing: [{ id: 'cwd', text: '/tmp' }] }, 20);
    service.contribute('code', { leading: [], trailing: [{ id: 'enc', text: 'UTF-8' }] }, 10);

    expect(service.trailing().map((segment: StatusSegment): string => segment.id)).toEqual([
      'enc',
      'cwd',
    ]);
  });

  it('clearOwner_whenCalled_removesOnlyThatOwnersSegments', () => {
    service.contribute('code', { leading: [{ id: 'path', text: 'a.ts' }], trailing: [] }, 10);
    service.contribute('terminal', { leading: [], trailing: [{ id: 'cwd', text: '/tmp' }] }, 20);

    service.clearOwner('code');

    expect(service.leading().length).toBe(0);
    expect(service.trailing().length).toBe(1);
  });
});
