import { TestBed } from '@angular/core/testing';
import { DirectoryListing } from '@shared/api/workspace-channels';

import { Workspaces } from './workspaces';

const LISTING: DirectoryListing = { path: '/ws', name: 'ws', entries: [] };

describe('Workspaces', () => {
  let workspaces: Workspaces;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workspaces = TestBed.inject(Workspaces);
  });

  it('takeInitial_whenStashed_returnsTheListing', () => {
    workspaces.setInitial('tab-1', LISTING);
    expect(workspaces.takeInitial('tab-1')).toBe(LISTING);
  });

  it('takeInitial_whenConsumed_returnsUndefinedOnTheSecondCall', () => {
    workspaces.setInitial('tab-1', LISTING);
    workspaces.takeInitial('tab-1');
    expect(workspaces.takeInitial('tab-1')).toBeUndefined();
  });

  it('takeInitial_whenNothingStashed_returnsUndefined', () => {
    expect(workspaces.takeInitial('absent')).toBeUndefined();
  });
});
