import { TestBed } from '@angular/core/testing';
import { DirectoryListing } from '@shared/api/workspace-channels';

import { WorkspaceAgentStart, Workspaces } from './workspaces';

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

  it('takeAgentStart_returnsTheStart_once_forItsOwnTab', () => {
    const start: WorkspaceAgentStart = { prompt: 'Hello.', brief: 'A new project.' };
    workspaces.setAgentStart('tab-1', start);

    expect(workspaces.takeAgentStart('tab-2')).toBeUndefined();
    expect(workspaces.takeAgentStart('tab-1')).toBe(start);
    expect(workspaces.takeAgentStart('tab-1')).toBeUndefined();
  });
});
