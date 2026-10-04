import { computed, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import type { AiBridgeScope } from '@shared/api/ai-types';
import {
  MAX_ACTIVE_WORKERS,
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
  TEAM_INSTRUCT_WORKER,
  TEAM_POST_TO_BOARD,
  TEAM_READ_BOARD,
  TEAM_START_WORKER,
  TEAM_STOP_WORKER,
  TEAM_WORKER_STATUS,
  TeamToolReply,
} from '@shared/api/ai/ai-team-tools';
import type {
  WorktreeAddOptions,
  WorktreeCheckoutInfo,
  WorktreeOutcome,
} from '@shared/api/worktree';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import type { TeamWorkerView } from '@shared/angular/services/agent-team/agent-team-view';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { AgentTeam } from './agent-team';

/**
 * A stand-in for a checkout's live agent: just what the team reads and calls.
 */
interface FakeAgent {
  /**
   * Gets the agent's transcript, which a test fills with pending requests or messages.
   */
  readonly items: WritableSignal<readonly AgentItem[]>;

  /**
   * Gets whether the agent is running a turn.
   */
  readonly isRunning: WritableSignal<boolean>;

  /**
   * Records the messages sent to the agent.
   */
  readonly send: Mock;

  /**
   * Records the modes the agent is set to.
   */
  readonly setMode: Mock;

  /**
   * Records stops.
   */
  readonly stop: Mock;

  /**
   * Records permission answers.
   */
  readonly respondPermission: Mock;
}

/**
 * Makes a fake agent.
 * @returns Returns it.
 */
function fakeAgent(): FakeAgent {
  return {
    items: signal<readonly AgentItem[]>([]),
    isRunning: signal<boolean>(false),
    send: vi.fn(),
    setMode: vi.fn(),
    stop: vi.fn(),
    respondPermission: vi.fn(),
  };
}

/**
 * A stand-in for the tab's worktree session: a container of checkouts, each with its agent.
 */
class FakeSession {
  /**
   * Gets whether the tab is a container.
   */
  public readonly isContainer: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds each checkout's path, by id; the lead's checkout `c1` to begin with.
   */
  public readonly paths: Map<string, string> = new Map<string, string>([['c1', '/repo/c1']]);
  /**
   * Holds each checkout's branch, by id.
   */
  public readonly branches: Map<string, string> = new Map<string, string>([['c1', 'main']]);
  /**
   * Holds each checkout's agent, by id.
   */
  public readonly agentMap: WritableSignal<ReadonlyMap<string, Agent>> = signal<
    ReadonlyMap<string, Agent>
  >(new Map<string, Agent>());
  /**
   * Gets each checkout's agent, as the session publishes them.
   */
  public readonly agents: Signal<ReadonlyMap<string, Agent>> = this.agentMap.asReadonly();

  /**
   * Bumps when the branches change, so {@link takenBranches} re-reads them.
   */
  public readonly branchSignal: WritableSignal<number> = signal<number>(0);
  /**
   * Gets the branches the checkouts hold.
   */
  public readonly takenBranches: Signal<ReadonlySet<string>> = computed((): ReadonlySet<string> => {
    this.branchSignal();
    return new Set<string>(this.branches.values());
  });
  /**
   * Holds an outcome {@link add} returns instead of making a checkout, or null to make one.
   */
  public addResult: WorktreeOutcome<WorktreeCheckoutInfo> | null = null;
  /**
   * Holds whether loading a checkout registers an agent for it at once, as a mounted view would.
   */
  public registerOnLoad: boolean = true;

  /**
   * Holds the agents made for checkouts as they load, by id.
   */
  public readonly created: Map<string, FakeAgent> = new Map<string, FakeAgent>();
  /**
   * Makes a checkout, as a clone would.
   */
  public readonly add: Mock = vi.fn(
    (options: WorktreeAddOptions): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> => {
      if (this.addResult !== null) {
        return Promise.resolve(this.addResult);
      }
      const id: string = `c${this.paths.size + 1}`;
      const path: string = `/repo/${id}`;
      this.paths.set(id, path);
      this.branches.set(id, options.branch ?? 'main');
      this.branchSignal.update((value: number): number => value + 1);
      return Promise.resolve({
        ok: true,
        value: { id, path, exists: true, branch: options.branch ?? 'main' },
      });
    },
  );
  /**
   * Loads a checkout's view in the background, registering its agent when {@link registerOnLoad}.
   */
  public readonly ensureLoaded: Mock = vi.fn((id: string): void => {
    if (this.registerOnLoad) {
      const agent: FakeAgent = fakeAgent();
      this.created.set(id, agent);
      this.register(id, agent);
    }
  });
  /**
   * Records the checkouts shown.
   */
  public readonly activate: Mock = vi.fn();

  /**
   * Registers a checkout's agent.
   * @param id The checkout id.
   * @param agent The agent.
   */
  public register(id: string, agent: FakeAgent): void {
    const next: Map<string, Agent> = new Map<string, Agent>(this.agentMap());
    next.set(id, agent as unknown as Agent);
    this.agentMap.set(next);
  }

  /**
   * Gets a checkout's path.
   * @param id The checkout id.
   * @returns Returns the path, or null.
   */
  public pathOf(id: string): string | null {
    return this.paths.get(id) ?? null;
  }

  /**
   * Finds the checkout at a path.
   * @param path The path.
   * @returns Returns the checkout id, or null.
   */
  public checkoutAt(path: string | null): string | null {
    for (const [id, candidate] of this.paths) {
      if (candidate === path) {
        return id;
      }
    }
    return null;
  }
}

describe('AgentTeam', () => {
  let session: FakeSession;
  let lead: FakeAgent;
  let capabilities: Map<string, AiCapability>;
  let team: AgentTeam;

  /**
   * Calls a team tool as the run rooted at a checkout would.
   * @param capability The tool.
   * @param input Its input.
   * @param checkout The calling checkout.
   * @returns Returns the reply.
   */
  async function call(
    capability: string,
    input: unknown,
    checkout: string = 'c1',
  ): Promise<TeamToolReply> {
    const scope: AiBridgeScope = {
      owningTabId: 'tab-1',
      surface: 'workspace',
      workspaceRoot: session.pathOf(checkout) ?? `/nowhere/${checkout}`,
    };
    const handler: AiCapability | undefined = capabilities.get(capability);
    if (handler === undefined) {
      throw new Error(`No handler for ${capability}`);
    }
    return (await handler(input, scope)) as TeamToolReply;
  }

  /**
   * Starts a worker as the lead and returns its checkout's agent.
   * @param title The worker's title.
   * @param branch Its branch.
   * @returns Returns the reply and the worker's agent.
   */
  async function start(
    title: string = 'Schema',
    branch: string = 'agent/schema',
  ): Promise<{ reply: TeamToolReply; worker: FakeAgent | undefined; checkout: string }> {
    const before: number = session.paths.size;
    const reply: TeamToolReply = await call(TEAM_START_WORKER, {
      title,
      task: `Do ${title}.`,
      branch,
      base: 'main',
    });
    const checkout: string = `c${before + 1}`;
    return { reply, worker: session.created.get(checkout), checkout };
  }

  /**
   * Gets the worker views.
   * @returns Returns them.
   */
  function workers(): readonly TeamWorkerView[] {
    return team.workers();
  }

  beforeEach(() => {
    session = new FakeSession();
    lead = fakeAgent();
    session.register('c1', lead);
    capabilities = new Map<string, AiCapability>();
    const runtime: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        capabilities.set(name, handler);
        return (): void => undefined;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        AgentTeam,
        { provide: WorktreeSession, useValue: session },
        { provide: AiRuntime, useValue: runtime },
      ],
    });
    team = TestBed.inject(AgentTeam);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registersEveryTeamCapability', () => {
    expect([...capabilities.keys()].sort()).toEqual(
      [
        TEAM_START_WORKER,
        TEAM_WORKER_STATUS,
        TEAM_INSTRUCT_WORKER,
        TEAM_STOP_WORKER,
        TEAM_READ_BOARD,
        TEAM_POST_TO_BOARD,
        TEAM_COMPLETE_TASK,
        TEAM_FAIL_TASK,
      ].sort(),
    );
  });

  it('roleOf_isLeadForACheckoutItDidNotStart_andNothingOutsideAContainer', () => {
    expect(team.roleOf('c1')).toBe('lead');
    session.isContainer.set(false);
    expect(team.roleOf('c1')).toBeNull();
  });

  it('startWorker_clonesACheckoutOnTheBranch_opensItInTheBackground_andBriefsItsAgent', async () => {
    const { reply, worker, checkout } = await start('Schema', 'agent/schema');

    expect(reply.ok).toBe(true);
    expect(reply.text).toContain('w1');
    expect(session.add).toHaveBeenCalledWith({
      branch: 'agent/schema',
      base: 'main',
      alias: 'Schema',
    });
    expect(session.ensureLoaded).toHaveBeenCalledWith(checkout);
    expect(session.activate).not.toHaveBeenCalled();
    expect(worker?.setMode).toHaveBeenCalledWith('agent');
    expect(worker?.send).toHaveBeenCalledTimes(1);
    const brief: string = worker?.send.mock.calls[0][0] as string;
    expect(brief.startsWith('[Lead]')).toBe(true);
    expect(brief).toContain('Do Schema.');
    expect(brief).toContain('agent/schema');
    expect(brief).toContain('starts from main');
    expect(worker?.send.mock.calls[0][2]).toBe('workspace');
    expect(team.roleOf(checkout)).toBe('worker');
    expect(workers().map((view: TeamWorkerView): string => view.state)).toEqual(['idle']);
  });

  it('startWorker_refusesWhatTheContractRefuses', async () => {
    expect((await call(TEAM_START_WORKER, { title: 'T', task: 'X', branch: '--force' })).ok).toBe(
      false,
    );
    expect(session.add).not.toHaveBeenCalled();
  });

  it('startWorker_refusesABranchAlreadyCheckedOut', async () => {
    const reply: TeamToolReply = await call(TEAM_START_WORKER, {
      title: 'T',
      task: 'X',
      branch: 'main',
    });

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('already checked out');
  });

  it('startWorker_refusesATitleAlreadyRunning', async () => {
    await start('Schema', 'agent/a');

    const reply: TeamToolReply = (await start('schema', 'agent/b')).reply;

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('already running');
  });

  it('startWorker_holdsTheContainerToItsLimit', async () => {
    for (let index: number = 0; index < MAX_ACTIVE_WORKERS; index += 1) {
      expect((await start(`W${index}`, `agent/w${index}`)).reply.ok).toBe(true);
    }

    const reply: TeamToolReply = (await start('One more', 'agent/more')).reply;

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('already running');
  });

  it('startWorker_serialisesConcurrentStarts_soTheLimitHolds', async () => {
    const replies: readonly TeamToolReply[] = await Promise.all(
      Array.from(
        { length: MAX_ACTIVE_WORKERS + 2 },
        (_: unknown, index: number): Promise<TeamToolReply> =>
          call(TEAM_START_WORKER, { title: `P${index}`, task: 'X', branch: `agent/p${index}` }),
      ),
    );

    expect(replies.filter((reply: TeamToolReply): boolean => reply.ok)).toHaveLength(
      MAX_ACTIVE_WORKERS,
    );
  });

  it('startWorker_whenTheCheckoutCannotBeMade_failsTheWorkerAndSaysWhy', async () => {
    session.addResult = { ok: false, error: 'clone failed' };

    const reply: TeamToolReply = (await start()).reply;

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('clone failed');
    expect(workers()[0].state).toBe('failed');
  });

  it('startWorker_whenTheCheckoutNeverOpens_failsTheWorkerAfterWaiting', async () => {
    vi.useFakeTimers();
    session.registerOnLoad = false;

    const pending: Promise<TeamToolReply> = call(TEAM_START_WORKER, {
      title: 'T',
      task: 'X',
      branch: 'agent/t',
    });
    await vi.advanceTimersByTimeAsync(61_000);
    const reply: TeamToolReply = await pending;

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('did not open');
    expect(workers()[0].state).toBe('failed');
  });

  it('startWorker_waitsForACheckoutThatOpensLate', async () => {
    session.registerOnLoad = false;

    const pending: Promise<TeamToolReply> = call(TEAM_START_WORKER, {
      title: 'T',
      task: 'X',
      branch: 'agent/t',
    });
    await vi.waitFor((): void => expect(session.ensureLoaded).toHaveBeenCalled());
    const late: FakeAgent = fakeAgent();
    session.register('c2', late);
    TestBed.tick();
    const reply: TeamToolReply = await pending;

    expect(reply.ok).toBe(true);
    expect(late.send).toHaveBeenCalledTimes(1);
  });

  it('aWorker_mayNotDirectOthers_andALead_mayNotReport', async () => {
    const { checkout } = await start();

    expect(
      (await call(TEAM_START_WORKER, { title: 'X', task: 'Y', branch: 'z' }, checkout)).text,
    ).toContain('Only a lead');
    expect((await call(TEAM_COMPLETE_TASK, { summary: 'Done' })).text).toContain('Only a worker');
  });

  it('aRunOutsideTheContainer_isNotPartOfTheTeam', async () => {
    const reply: TeamToolReply = await call(TEAM_READ_BOARD, {}, 'elsewhere');

    expect(reply.ok).toBe(false);
    expect(reply.text).toContain('no team');
  });

  it('completeTask_recordsTheSummary_andWakesTheLead', async () => {
    const { checkout } = await start();

    const reply: TeamToolReply = await call(
      TEAM_COMPLETE_TASK,
      { summary: 'Added the schema.', pullRequest: 'https://example.test/pr/7' },
      checkout,
    );

    expect(reply.ok).toBe(true);
    expect(workers()[0].state).toBe('completed');
    expect(workers()[0].summary).toBe('Added the schema.');
    expect(lead.send).toHaveBeenCalledTimes(1);
    const wake: string = lead.send.mock.calls[0][0] as string;
    expect(wake).toContain('[Team]');
    expect(wake).toContain('completed');
    expect(wake).toContain('Added the schema.');
    expect(wake).toContain('https://example.test/pr/7');
    expect((await call(TEAM_COMPLETE_TASK, { summary: 'Again' }, checkout)).ok).toBe(false);
  });

  it('failTask_recordsTheReason_andWakesTheLead', async () => {
    const { checkout } = await start();

    await call(TEAM_FAIL_TASK, { reason: 'The base is missing.' }, checkout);

    expect(workers()[0].state).toBe('failed');
    expect(lead.send.mock.calls[0][0]).toContain('The base is missing.');
  });

  it('aWorkerWaitingOnTheUser_isInputRequired_andTheLeadSeesWhatFor', async () => {
    const { worker } = await start();
    const permission: AgentItem = {
      id: 'p1',
      kind: 'permission',
      text: '',
      permissionId: 'perm-1',
      permissionName: 'Bash',
      permissionDetail: 'npm test',
      permissionState: 'pending',
    };
    worker?.items.set([permission]);

    expect(workers()[0].state).toBe('input_required');
    expect(workers()[0].pending).toBe(permission);
    const status: TeamToolReply = await call(TEAM_WORKER_STATUS, {});
    expect(status.text).toContain('input_required');
    expect(status.text).toContain('permission to use Bash (npm test)');
  });

  it('aWorkerThatStopsWithoutReporting_wakesItsLead_withItsLastMessage', async () => {
    const { worker } = await start();
    worker?.isRunning.set(true);
    TestBed.tick();
    worker?.items.set([{ id: 'a1', kind: 'assistant', text: 'I need the API key.' }]);
    worker?.isRunning.set(false);
    TestBed.tick();

    expect(lead.send).toHaveBeenCalledTimes(1);
    const wake: string = lead.send.mock.calls[0][0] as string;
    expect(wake).toContain('stopped without reporting');
    expect(wake).toContain('I need the API key.');
  });

  it('aWorkerThatReportsBeforeItsTurnEnds_wakesItsLeadOnce', async () => {
    const { worker, checkout } = await start();
    worker?.isRunning.set(true);
    TestBed.tick();
    await call(TEAM_COMPLETE_TASK, { summary: 'Done.' }, checkout);
    worker?.isRunning.set(false);
    TestBed.tick();

    expect(lead.send).toHaveBeenCalledTimes(1);
  });

  it('instructWorker_sendsTheLeadsWords_andRefusesAFinishedWorker', async () => {
    const { worker, checkout } = await start();

    expect((await call(TEAM_INSTRUCT_WORKER, { worker: 'w1', text: ' Rebase. ' })).ok).toBe(true);
    expect(worker?.send.mock.calls[1][0]).toBe('[Lead] Rebase.');

    await call(TEAM_COMPLETE_TASK, { summary: 'Done.' }, checkout);
    const refused: TeamToolReply = await call(TEAM_INSTRUCT_WORKER, {
      worker: 'Schema',
      text: 'More.',
    });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain('completed');
  });

  it('stopWorker_stopsItsTurn_andCancelsIt_withoutWakingTheLead', async () => {
    const { worker } = await start();

    const reply: TeamToolReply = await call(TEAM_STOP_WORKER, { worker: 'schema' });

    expect(reply.ok).toBe(true);
    expect(worker?.stop).toHaveBeenCalled();
    expect(workers()[0].state).toBe('cancelled');
    expect(lead.send).not.toHaveBeenCalled();
  });

  it('stop_byTheUser_cancelsTheWorker_andTellsItsLead', async () => {
    await start();

    team.stop('w1');

    expect(workers()[0].state).toBe('cancelled');
    expect(lead.send.mock.calls[0][0]).toContain('The user stopped');
  });

  it('aWorkerWhoseCheckoutWasRemoved_isCancelled', async () => {
    const { checkout } = await start();

    session.paths.delete(checkout);
    session.register('c1', lead);

    expect(workers()[0].state).toBe('cancelled');
  });

  it('theBoard_takesPostsFromLeadAndWorkers_andReadsFromASequence', async () => {
    const { checkout } = await start();

    expect(
      (await call(TEAM_POST_TO_BOARD, { kind: 'claim', text: 'src/store/**' }, checkout)).text,
    ).toBe('Posted as #1.');
    await call(TEAM_POST_TO_BOARD, { kind: 'note', text: 'Land #1 first.' });
    expect((await call(TEAM_POST_TO_BOARD, { kind: 'shout', text: 'x' })).ok).toBe(false);

    const all: TeamToolReply = await call(TEAM_READ_BOARD, {}, checkout);
    expect(all.text).toBe('#1 Schema — claim: src/store/**\n#2 Lead — note: Land #1 first.');
    expect((await call(TEAM_READ_BOARD, { since: 1 })).text).toBe('#2 Lead — note: Land #1 first.');
    expect((await call(TEAM_READ_BOARD, { since: 2 })).text).toBe('Nothing new on the board.');
  });

  it('workersLedBy_showsALeadOnlyItsOwnWorkers', async () => {
    await start();
    const other: FakeAgent = fakeAgent();
    session.paths.set('c9', '/repo/c9');
    session.register('c9', other);

    expect(
      team.workersLedBy(lead as unknown as Agent).map((view: TeamWorkerView): string => view.id),
    ).toEqual(['w1']);
    expect(team.workersLedBy(other as unknown as Agent)).toEqual([]);
    expect(team.workersLedBy(fakeAgent() as unknown as Agent)).toEqual([]);
  });

  it('open_showsTheWorkersCheckout', async () => {
    const { checkout } = await start();

    team.open('w1');

    expect(session.activate).toHaveBeenCalledWith(checkout);
  });

  it('status_reportsOnlyTheCallersWorkers', async () => {
    expect((await call(TEAM_WORKER_STATUS, {})).text).toBe('You have started no workers.');
    await start();

    expect((await call(TEAM_WORKER_STATUS, { worker: 'nobody' })).ok).toBe(false);
    expect((await call(TEAM_WORKER_STATUS, { worker: 'w1' })).text).toContain(
      '"Schema" on agent/schema',
    );
  });
});
