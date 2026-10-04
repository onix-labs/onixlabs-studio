import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { WorktreeDescriptor } from '@shared/api/worktree';
import type { Agent } from '@shared/angular/services/agent/agent';
import { Worktrees } from '@shared/angular/services/worktree/worktrees';
import { WorktreeSession } from './worktree-session';

/**
 * A container with two checkouts.
 */
const DESCRIPTOR: WorktreeDescriptor = {
  root: '/repo',
  origin: null,
  checkouts: [
    { id: 'c1', path: '/repo/c1', exists: true, branch: 'main' },
    { id: 'c2', alias: 'Docs', path: '/repo/c2', exists: true, branch: 'agent/docs' },
  ],
};

/**
 * Creates a session over the two-checkout container, with no worktree client (outside Electron).
 * @returns Returns the session.
 */
function createSession(): WorktreeSession {
  TestBed.configureTestingModule({
    providers: [WorktreeSession, { provide: Worktrees, useValue: { client: undefined } }],
  });
  const session: WorktreeSession = TestBed.inject(WorktreeSession);
  session.initialize('/repo', DESCRIPTOR);
  return session;
}

describe('WorktreeSession', () => {
  it('registerAgent_publishesTheCheckoutsAgent_untilItsDisposerRuns', () => {
    const session: WorktreeSession = createSession();
    const agent: Agent = {} as Agent;

    const dispose: () => void = session.registerAgent('c2', agent);

    expect(session.agents().get('c2')).toBe(agent);
    dispose();
    expect(session.agents().has('c2')).toBe(false);
  });

  it('registerAgent_disposer_leavesASuccessorsRegistrationAlone', () => {
    const session: WorktreeSession = createSession();
    const first: Agent = {} as Agent;
    const second: Agent = {} as Agent;
    const disposeFirst: () => void = session.registerAgent('c2', first);
    session.registerAgent('c2', second);

    disposeFirst();

    expect(session.agents().get('c2')).toBe(second);
  });

  it('ensureLoaded_asksForEachCheckoutOnce', () => {
    const session: WorktreeSession = createSession();

    session.ensureLoaded('c2');
    session.ensureLoaded('c2');
    session.ensureLoaded('c1');

    expect(session.wanted()).toEqual(['c2', 'c1']);
  });

  it('pathOf_readsTheDescriptor', () => {
    const session: WorktreeSession = createSession();

    expect(session.pathOf('c2')).toBe('/repo/c2');
    expect(session.pathOf('missing')).toBeNull();
  });

  it('checkoutAt_findsTheCheckoutARootNames_toleratingATrailingSeparator', () => {
    const session: WorktreeSession = createSession();

    expect(session.checkoutAt('/repo/c1')).toBe('c1');
    expect(session.checkoutAt('/repo/c2/')).toBe('c2');
    expect(session.checkoutAt('/repo')).toBeNull();
    expect(session.checkoutAt('/elsewhere/c1')).toBeNull();
    expect(session.checkoutAt(null)).toBeNull();
  });
});
