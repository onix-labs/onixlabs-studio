import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Forge } from '@shared/angular/services/forge/forge';
import { ForgeProjects, projectKey } from '@shared/angular/services/forge-projects/forge-projects';
import { ForgeRepositoryRef, ForgeResult, ForgeWorkItem } from '@shared/api/forge-types';
import { MissionControlWorkItems, WORK_ITEMS_REFRESH_MS } from './work-items';

/**
 * The repository the tests open.
 */
const STUDIO: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * The project's key.
 */
const KEY: string = projectKey(STUDIO);

/**
 * Builds a childless open work item.
 * @param number The issue number.
 * @returns Returns the work item.
 */
function item(number: number): ForgeWorkItem {
  return {
    number,
    title: `Issue ${number}`,
    url: '',
    labels: [],
    type: null,
    assignees: [],
    parent: null,
    children: { total: 0, completed: 0 },
    blockedBy: 0,
    authorTrusted: true,
    updatedAt: '',
  };
}

/**
 * A forge whose work-item reads the test answers one at a time.
 */
class FakeForge {
  /**
   * Holds the repositories read, in order.
   */
  public readonly reads: ForgeRepositoryRef[] = [];

  /**
   * Holds the answers waiting to be given, oldest first.
   */
  private readonly pending: ((result: ForgeResult<readonly ForgeWorkItem[]>) => void)[] = [];

  public workItems(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeWorkItem[]>> {
    this.reads.push(repository);
    return new Promise<ForgeResult<readonly ForgeWorkItem[]>>((resolve) => {
      this.pending.push(resolve);
    });
  }

  /**
   * Answers the oldest outstanding read.
   * @param result The answer.
   */
  public async answer(result: ForgeResult<readonly ForgeWorkItem[]>): Promise<void> {
    this.pending.shift()?.(result);
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('MissionControlWorkItems', () => {
  let forge: FakeForge;
  let projects: ForgeProjects;
  let workItems: MissionControlWorkItems;

  beforeEach(() => {
    vi.useFakeTimers();
    forge = new FakeForge();
    TestBed.configureTestingModule({ providers: [{ provide: Forge, useValue: forge }] });
    projects = TestBed.inject(ForgeProjects);
    workItems = TestBed.inject(MissionControlWorkItems);
  });

  afterEach(() => {
    workItems.setWatching(false);
    vi.useRealTimers();
  });

  it('readsNothing_whileNothingWatches', () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();

    expect(forge.reads).toEqual([]);
    expect(workItems.stateFor(KEY).loaded).toBe(false);
  });

  it('readsEveryProject_whenWatchingStarts_andBuildsItsTree', async () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();

    workItems.setWatching(true);
    expect(workItems.stateFor(KEY).loading).toBe(true);
    await forge.answer({ ok: true, value: [item(1), item(2)] });

    expect(forge.reads).toEqual([STUDIO]);
    expect(workItems.stateFor(KEY)).toMatchObject({ loaded: true, loading: false, error: null });
    expect(workItems.stateFor(KEY).tree).toHaveLength(2);
  });

  it('readsAProjectThatOpens_whileWatching', () => {
    workItems.setWatching(true);

    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();

    expect(forge.reads).toEqual([STUDIO]);
  });

  it('rereadsOnATimer_onlyWhileWatching', async () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);
    await forge.answer({ ok: true, value: [] });

    vi.advanceTimersByTime(WORK_ITEMS_REFRESH_MS);
    await forge.answer({ ok: true, value: [] });
    expect(forge.reads).toHaveLength(2);

    workItems.setWatching(false);
    vi.advanceTimersByTime(WORK_ITEMS_REFRESH_MS * 3);
    expect(forge.reads).toHaveLength(2);
  });

  it('neverStacksReads_forOneProject', () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);

    workItems.refreshAll();
    workItems.refreshAll();

    expect(forge.reads).toHaveLength(1);
  });

  it('keepsTheLastTree_whenARereadFails', async () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);
    await forge.answer({ ok: true, value: [item(1)] });

    workItems.refreshAll();
    await forge.answer({ ok: false, error: 'Offline', unauthorized: false });

    expect(workItems.stateFor(KEY)).toMatchObject({ loaded: true, error: 'Offline' });
    expect(workItems.stateFor(KEY).tree).toHaveLength(1);
  });

  it('reportsAnUnauthorizedFailure', async () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);

    await forge.answer({ ok: false, error: 'Sign in', unauthorized: true });

    expect(workItems.stateFor(KEY)).toMatchObject({ unauthorized: true, error: 'Sign in' });
  });

  it('leavesARateLimitedProjectAlone_untilTheLimitLifts', async () => {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);
    await forge.answer({
      ok: false,
      error: 'Rate limited',
      unauthorized: false,
      retryAt: Date.now() + WORK_ITEMS_REFRESH_MS * 2,
    });

    vi.advanceTimersByTime(WORK_ITEMS_REFRESH_MS);
    expect(forge.reads).toHaveLength(1);

    vi.advanceTimersByTime(WORK_ITEMS_REFRESH_MS);
    expect(forge.reads).toHaveLength(2);
  });

  it('forgetsAProjectThatCloses_evenMidRead', async () => {
    const withdraw: () => void = projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    workItems.setWatching(true);

    withdraw();
    TestBed.tick();
    await forge.answer({ ok: true, value: [item(1)] });

    expect(workItems.states().has(KEY)).toBe(false);
  });
});
