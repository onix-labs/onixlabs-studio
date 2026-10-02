import { TestBed } from '@angular/core/testing';

import { ForgeRepositoryRef } from '@shared/api/forge-types';
import { ForgeProject, ForgeProjects, projectKey } from './forge-projects';

/**
 * The repository most tests publish.
 */
const STUDIO: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * A second repository.
 */
const POWER_C: ForgeRepositoryRef = { ...STUDIO, name: 'onixlabs-power-c' };

/**
 * Reads the listed projects' roots, which says both which projects are listed and which publication
 * each one came from.
 * @param projects The registry.
 * @returns Returns the roots, in order.
 */
function roots(projects: ForgeProjects): readonly string[] {
  return projects.projects().map((project: ForgeProject): string => project.root);
}

describe('projectKey', () => {
  it('ignoresCase_becauseTheForgeDoes', () => {
    expect(projectKey({ ...STUDIO, owner: 'ONIX-Labs', name: 'OnixLabs-Studio' })).toBe(
      projectKey(STUDIO),
    );
  });

  it('distinguishesHosts', () => {
    expect(projectKey({ ...STUDIO, host: 'git.example.com' })).not.toBe(projectKey(STUDIO));
  });
});

describe('ForgeProjects', () => {
  let projects: ForgeProjects;

  beforeEach(() => {
    projects = TestBed.inject(ForgeProjects);
  });

  it('listsNothing_untilAWorkspacePublishes', () => {
    expect(projects.projects()).toEqual([]);
  });

  it('listsPublishedProjects_inPublicationOrder', () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    projects.publish(POWER_C, '/dev/power-c', 'tab-1');

    expect(roots(projects)).toEqual(['/dev/studio', '/dev/power-c']);
  });

  it('listsARepositoryOnce_whenSeveralWorkspacesPublishIt', () => {
    // A worktree container's checkouts are one project, named by the first to publish it.
    projects.publish(STUDIO, '/dev/studio/a', 'tab-1');
    projects.publish({ ...STUDIO, owner: 'ONIX-Labs' }, '/dev/studio/b', 'tab-1');

    expect(roots(projects)).toEqual(['/dev/studio/a']);
  });

  it('keepsAProjectListed_untilItsLastPublicationIsWithdrawn', () => {
    const first: () => void = projects.publish(STUDIO, '/dev/studio/a', 'tab-1');
    const second: () => void = projects.publish(STUDIO, '/dev/studio/b', 'tab-1');

    first();
    expect(roots(projects)).toEqual(['/dev/studio/b']);

    second();
    expect(roots(projects)).toEqual([]);
  });

  it('withdrawsOnlyItsOwnPublication', () => {
    const studio: () => void = projects.publish(STUDIO, '/dev/studio', 'tab-1');
    projects.publish(POWER_C, '/dev/power-c', 'tab-1');

    studio();
    studio();

    expect(roots(projects)).toEqual(['/dev/power-c']);
  });

  it('keepsTheListIdentical_whenAPublicationChangesNothingVisible', () => {
    projects.publish(STUDIO, '/dev/studio/a', 'tab-1');
    const before: readonly ForgeProject[] = projects.projects();

    projects.publish(STUDIO, '/dev/studio/b', 'tab-1');

    expect(projects.projects()).toBe(before);
  });
});
