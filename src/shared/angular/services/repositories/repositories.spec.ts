import { TestBed } from '@angular/core/testing';

import { RepositoryInfo } from '@shared/api/source-control-channels';
import { Repositories } from './repositories';

/**
 * The repository stashed for the tab under test.
 */
const INFO: RepositoryInfo = { root: '/repos/studio', name: 'studio' };

describe('Repositories', () => {
  let repositories: Repositories;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    repositories = TestBed.inject(Repositories);
  });

  it('takeInitial_whenNothingWasStashed_returnsUndefined', () => {
    expect(repositories.takeInitial('tab-1')).toBeUndefined();
  });

  it('takeInitial_afterSetInitial_returnsTheStashedRepository', () => {
    repositories.setInitial('tab-1', INFO);

    expect(repositories.takeInitial('tab-1')).toEqual(INFO);
  });

  it('takeInitial_whenCalledTwice_consumesTheRepository', () => {
    repositories.setInitial('tab-1', INFO);

    repositories.takeInitial('tab-1');

    expect(repositories.takeInitial('tab-1')).toBeUndefined();
  });

  it('setInitial_whenSeveralTabsAreStashed_keepsThemIndependent', () => {
    const other: RepositoryInfo = { root: '/repos/other', name: 'other' };
    repositories.setInitial('tab-1', INFO);
    repositories.setInitial('tab-2', other);

    expect(repositories.takeInitial('tab-2')).toEqual(other);
    expect(repositories.takeInitial('tab-1')).toEqual(INFO);
  });
});
