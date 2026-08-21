import { TestBed } from '@angular/core/testing';

import { StatusBar } from './status-bar';
import { StatusSegment } from './status-segment';

describe('StatusBar', () => {
  let service: StatusBar;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StatusBar);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('contribute_whenCalled_publishesTheOwnersSegments', () => {
    const segments: readonly StatusSegment[] = [{ id: 'running', text: '2 running' }];

    service.contribute('containers', segments, 15);

    expect(service.segments()).toEqual(segments);
  });

  it('contribute_whenMultipleOwners_mergesByPriority', () => {
    service.contribute('late', [{ id: 'cwd', text: '/tmp' }], 20);
    service.contribute('early', [{ id: 'enc', text: 'UTF-8' }], 10);

    expect(service.segments().map((segment: StatusSegment): string => segment.id)).toEqual([
      'enc',
      'cwd',
    ]);
  });

  it('contribute_whenOwnerContributesAgain_replacesItsPreviousSegments', () => {
    service.contribute('containers', [{ id: 'running', text: '2 running' }], 15);
    service.contribute('containers', [{ id: 'running', text: '3 running' }], 15);

    expect(service.segments().map((segment: StatusSegment): string => segment.text)).toEqual([
      '3 running',
    ]);
  });

  it('clearOwner_whenCalled_removesOnlyThatOwnersSegments', () => {
    service.contribute('containers', [{ id: 'running', text: '2 running' }], 15);
    service.contribute('other', [{ id: 'cwd', text: '/tmp' }], 20);

    service.clearOwner('containers');

    expect(service.segments().map((segment: StatusSegment): string => segment.id)).toEqual(['cwd']);
  });

  it('clearOwner_whenOwnerIsUnknown_leavesTheStripUnchanged', () => {
    service.contribute('containers', [{ id: 'running', text: '2 running' }], 15);

    service.clearOwner('never-registered');

    expect(service.segments().length).toBe(1);
  });
});
