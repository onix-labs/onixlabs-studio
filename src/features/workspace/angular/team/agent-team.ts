import {
  computed,
  DestroyRef,
  effect,
  inject,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { AgentSurface, AiBridgeScope } from '@shared/api/ai-types';
import {
  AgentTeamRole,
  boundedText,
  MAX_ACTIVE_WORKERS,
  parsePostToBoardInput,
  parseStartWorkerInput,
  PostToBoardInput,
  StartWorkerInput,
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
  TEAM_INSTRUCT_WORKER,
  TEAM_POST_TO_BOARD,
  TEAM_READ_BOARD,
  TEAM_START_WORKER,
  TEAM_STOP_WORKER,
  TEAM_WORKER_STATUS,
  TeamBoardEntry,
  TeamToolReply,
  TeamWorkerState,
} from '@shared/api/ai/ai-team-tools';
import type { WorktreeCheckoutInfo, WorktreeOutcome } from '@shared/api/worktree';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import {
  AgentTeamView,
  describeRequest,
  TeamWorkerView,
} from '@shared/angular/services/agent-team/agent-team-view';
import { Log } from '@shared/angular/services/log/log';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { AgentTeams } from './agent-teams';

/**
 * How long a new worker's checkout may take to open its view and register its agent once cloned.
 */
const AGENT_READY_TIMEOUT_MS: number = 60_000;

/**
 * The most of a worker's last message passed to its lead when it stops without reporting.
 */
const LAST_MESSAGE_CHARS: number = 600;

/**
 * The surface a worker's and a lead's turns run on: the workspace's own agent.
 */
const TEAM_SURFACE: AgentSurface = 'workspace';

/**
 * How a worker's task ended, once it has.
 */
type WorkerOutcome = 'completed' | 'failed' | 'cancelled';

/**
 * What the team records about one worker. Its live state — working, waiting on the user, idle — is
 * read from its agent rather than recorded, so it can never disagree with what the agent is doing.
 */
interface WorkerRecord {
  /**
   * Gets the worker's id: `w1`, `w2`, … in the order the team started them.
   */
  readonly id: string;

  /**
   * Gets the checkout of the lead that started it.
   */
  readonly leadCheckoutId: string;

  /**
   * Gets the worker's own checkout, or null while it is being cloned.
   */
  readonly checkoutId: string | null;

  /**
   * Gets the task's short name.
   */
  readonly title: string;

  /**
   * Gets the task.
   */
  readonly task: string;

  /**
   * Gets the branch it works on.
   */
  readonly branch: string;

  /**
   * Gets the branch its branch started from, when the lead named one.
   */
  readonly base: string | null;

  /**
   * Gets a value indicating whether it is still being prepared.
   */
  readonly starting: boolean;

  /**
   * Gets how its task ended, or null while it has not.
   */
  readonly outcome: WorkerOutcome | null;

  /**
   * Gets its summary, or why it failed or was stopped.
   */
  readonly summary: string | null;

  /**
   * Gets the pull request it reported opening.
   */
  readonly pullRequest: string | null;
}

/**
 * A team of agents in one worktree container (#788).
 *
 * Any checkout's agent can lead: offered the lead's tools, it starts workers, each a NEW checkout of
 * the container — a full clone on a branch of its own — whose own agent is briefed with the task. The
 * team is what the leads' and workers' tools reach across the bridge, and it decides everything they
 * ask: who is calling (from the run's stamped workspace root, never from what the model says), whether
 * that caller may, and whether the container's limits allow it.
 *
 * Workers coordinate through the team's board and report to their lead; nothing here lets one agent
 * talk to another directly. A lead is woken only when a worker completes, fails, or stops without
 * saying either — the last so a stalled worker never leaves its lead waiting in silence.
 *
 * ⚠️ Held in memory for the life of the tab: closing the container tab ends the team, though every
 * worker's checkout, branch and conversation remain.
 */
@Service({ autoProvided: false })
export class AgentTeam implements AgentTeamView {
  /**
   * Holds the container's checkouts and their agents.
   */
  private readonly session: WorktreeSession = inject(WorktreeSession);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the team's workers, in the order they were started.
   */
  private readonly workerSignal: WritableSignal<readonly WorkerRecord[]> = signal<
    readonly WorkerRecord[]
  >([]);

  /**
   * Holds the team's board.
   */
  private readonly boardSignal: WritableSignal<readonly TeamBoardEntry[]> = signal<
    readonly TeamBoardEntry[]
  >([]);

  /**
   * Holds the waiters for a checkout's agent to register, keyed by checkout id.
   */
  private readonly agentWaiters: Map<string, ((agent: Agent) => void)[]> = new Map<
    string,
    ((agent: Agent) => void)[]
  >();

  /**
   * Holds each worker's state as last seen, so a worker that stops without reporting is noticed.
   */
  private readonly lastSeen: Map<string, TeamWorkerState> = new Map<string, TeamWorkerState>();

  /**
   * Holds the messages waiting for each lead to finish its turn, keyed by the lead's checkout.
   */
  private readonly pendingWakesSignal: WritableSignal<ReadonlyMap<string, readonly string[]>> =
    signal<ReadonlyMap<string, readonly string[]>>(new Map<string, readonly string[]>());

  /**
   * Holds the chain that serialises worker starts: each clones and registers a checkout, and two
   * racing would both pass the limit and branch checks before either landed.
   */
  private starting: Promise<unknown> = Promise.resolve();

  /**
   * Holds the number of workers started, which names the next one.
   */
  private sequence: number = 0;

  /**
   * Gets the team's board.
   */
  public readonly board: Signal<readonly TeamBoardEntry[]> = this.boardSignal.asReadonly();

  /**
   * Gets every worker as the user sees it, in the order they were started.
   */
  public readonly workers: Signal<readonly TeamWorkerView[]> = computed(
    (): readonly TeamWorkerView[] =>
      this.workerSignal().map((record: WorkerRecord): TeamWorkerView => this.view(record)),
  );

  /**
   * Initializes a new instance of the {@link AgentTeam} class: joins the app-wide registry that routes
   * the team tools' requests, resolves agents being waited for as their checkouts register them, and
   * watches for workers that stop without reporting.
   */
  public constructor() {
    const teams: AgentTeams = inject(AgentTeams);
    inject(DestroyRef).onDestroy(teams.join(this));

    effect((): void => {
      const agents: ReadonlyMap<string, Agent> = this.session.agents();
      untracked((): void => {
        for (const [id, waiters] of this.agentWaiters) {
          const agent: Agent | undefined = agents.get(id);
          if (agent !== undefined) {
            this.agentWaiters.delete(id);
            for (const resolve of waiters) {
              resolve(agent);
            }
          }
        }
      });
    });

    effect((): void => {
      const views: readonly TeamWorkerView[] = this.workers();
      untracked((): void => this.noticeStops(views));
    });

    // Deliver what is waiting for each lead once it is between turns. Tracks each waiting lead's
    // running state, so a lead finishing its turn is what delivers the next message.
    effect((): void => {
      const pending: ReadonlyMap<string, readonly string[]> = this.pendingWakesSignal();
      const agents: ReadonlyMap<string, Agent> = this.session.agents();
      for (const [leadId, messages] of pending) {
        const lead: Agent | undefined = agents.get(leadId);
        if (lead !== undefined && messages.length > 0 && !lead.isRunning()) {
          untracked((): void => this.deliverWakes(leadId, lead));
        }
      }
    });
  }

  /**
   * Determines whether a run's workspace root is one of this team's checkouts.
   * @param root The run's stamped workspace root.
   * @returns Returns true when the run belongs to this container.
   */
  public owns(root: string | null): boolean {
    return this.session.isContainer() && this.session.checkoutAt(root) !== null;
  }

  /**
   * Gets the part a checkout's agent plays: a worker if the team started it, otherwise a lead. Outside
   * a container there is no team, and no part.
   * @param checkoutId The checkout id.
   * @returns Returns the role, or null outside a container.
   */
  public roleOf(checkoutId: string): AgentTeamRole | null {
    if (!this.session.isContainer()) {
      return null;
    }
    return this.workerSignal().some(
      (record: WorkerRecord): boolean => record.checkoutId === checkoutId,
    )
      ? 'worker'
      : 'lead';
  }

  /** @inheritdoc */
  public workersLedBy(lead: Agent): readonly TeamWorkerView[] {
    const leadId: string | null = this.checkoutOfAgent(lead);
    if (leadId === null) {
      return [];
    }
    const led: ReadonlySet<string> = new Set<string>(
      this.workerSignal()
        .filter((record: WorkerRecord): boolean => record.leadCheckoutId === leadId)
        .map((record: WorkerRecord): string => record.id),
    );
    return this.workers().filter((view: TeamWorkerView): boolean => led.has(view.id));
  }

  /** @inheritdoc */
  public open(id: string): void {
    const checkout: string | null = this.find(id)?.checkoutId ?? null;
    if (checkout !== null) {
      this.session.activate(checkout);
    }
  }

  /** @inheritdoc */
  public stop(id: string): void {
    const record: WorkerRecord | undefined = this.find(id);
    // Unknown, or already finished: nothing to stop.
    if (record?.outcome !== null) {
      return;
    }
    this.cancel(record, 'Stopped by the user.');
    this.wakeLead(
      record,
      `[Team] The user stopped worker "${record.title}" (${record.id}) on ${record.branch}.`,
    );
  }

  /**
   * Answers a team tool's request, made by the run whose stamped scope it carries.
   * @param capability The tool's name.
   * @param input The tool's input, untrusted.
   * @param scope The calling run's stamped scope.
   * @returns Returns what the model is told.
   */
  public async handle(
    capability: string,
    input: unknown,
    scope: AiBridgeScope,
  ): Promise<TeamToolReply> {
    const caller: string | null = this.session.checkoutAt(scope.workspaceRoot);
    const role: AgentTeamRole | null = caller === null ? null : this.roleOf(caller);
    if (caller === null || role === null) {
      return refuse('This agent is not part of a team.');
    }
    const record: Record<string, unknown> =
      typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    switch (capability) {
      case TEAM_READ_BOARD:
        return this.readBoard(record['since']);
      case TEAM_POST_TO_BOARD:
        return this.post(caller, role, input);
      case TEAM_START_WORKER:
      case TEAM_WORKER_STATUS:
      case TEAM_INSTRUCT_WORKER:
      case TEAM_STOP_WORKER:
        if (role !== 'lead') {
          return refuse('Only a lead directs workers.');
        }
        return this.handleLead(caller, capability, input, record);
      case TEAM_COMPLETE_TASK:
      case TEAM_FAIL_TASK:
        if (role !== 'worker') {
          return refuse('Only a worker reports a task.');
        }
        return this.report(caller, capability, record);
      default:
        return refuse(`The team has no tool called ${capability}.`);
    }
  }

  /**
   * Answers a lead's request.
   * @param lead The lead's checkout.
   * @param capability The tool's name.
   * @param input The tool's input, untrusted.
   * @param record The input as a record.
   * @returns Returns what the model is told.
   */
  private handleLead(
    lead: string,
    capability: string,
    input: unknown,
    record: Record<string, unknown>,
  ): Promise<TeamToolReply> | TeamToolReply {
    switch (capability) {
      case TEAM_START_WORKER: {
        const run: Promise<TeamToolReply> = this.starting.then((): Promise<TeamToolReply> =>
          this.startWorker(lead, input),
        );
        this.starting = run.catch((): void => undefined);
        return run;
      }
      case TEAM_WORKER_STATUS:
        return this.status(lead, record['worker']);
      case TEAM_INSTRUCT_WORKER:
        return this.instruct(lead, record['worker'], record['text']);
      default:
        return this.stopFor(lead, record['worker']);
    }
  }

  /**
   * Starts a worker: a new checkout on its own branch, whose agent is briefed with the task.
   * @param lead The lead's checkout.
   * @param input The tool's input, untrusted.
   * @returns Returns what the model is told.
   */
  private async startWorker(lead: string, input: unknown): Promise<TeamToolReply> {
    const parsed: StartWorkerInput | string = parseStartWorkerInput(input);
    if (typeof parsed === 'string') {
      return refuse(parsed);
    }
    const active: readonly WorkerRecord[] = this.workerSignal().filter(
      (record: WorkerRecord): boolean => record.outcome === null,
    );
    if (active.length >= MAX_ACTIVE_WORKERS) {
      return refuse(
        `${active.length} workers are already running, the most this workspace runs at once. Wait for one to finish, or stop one.`,
      );
    }
    if (
      active.some(
        (record: WorkerRecord): boolean =>
          record.title.toLowerCase() === parsed.title.toLowerCase(),
      )
    ) {
      return refuse(
        `A worker called "${parsed.title}" is already running. Give this one another title.`,
      );
    }
    if (this.session.takenBranches().has(parsed.branch)) {
      return refuse(
        `The branch ${parsed.branch} is already checked out in this workspace. Give the worker a branch of its own.`,
      );
    }
    this.sequence += 1;
    const id: string = `w${this.sequence}`;
    this.workerSignal.set([
      ...this.workerSignal(),
      {
        id,
        leadCheckoutId: lead,
        checkoutId: null,
        title: parsed.title,
        task: parsed.task,
        branch: parsed.branch,
        base: parsed.base ?? null,
        starting: true,
        outcome: null,
        summary: null,
        pullRequest: null,
      },
    ]);
    this.log.info('workspace.team', 'Starting worker', id, parsed.title, parsed.branch);

    const added: WorktreeOutcome<WorktreeCheckoutInfo> = await this.session.add({
      branch: parsed.branch,
      ...(parsed.base === undefined ? {} : { base: parsed.base }),
      alias: parsed.title,
    });
    if (!added.ok) {
      this.update(id, { starting: false, outcome: 'failed', summary: added.error });
      this.log.warn('workspace.team', 'Worker checkout failed', id, added.error);
      return refuse(`The worker's checkout could not be made: ${added.error}`);
    }
    this.update(id, { checkoutId: added.value.id });
    this.session.ensureLoaded(added.value.id);
    const agent: Agent | null = await this.waitForAgent(added.value.id);
    if (agent === null) {
      this.update(id, {
        starting: false,
        outcome: 'failed',
        summary: 'Its checkout did not open.',
      });
      return refuse(
        `The worker's checkout was made on ${parsed.branch} but did not open. The user can open it from the Worktrees panel.`,
      );
    }
    agent.setMode('agent');
    this.update(id, { starting: false });
    const started: WorkerRecord | undefined = this.find(id);
    if (started !== undefined) {
      agent.send(brief(started), undefined, TEAM_SURFACE);
    }
    this.log.info('workspace.team', 'Worker started', id, added.value.path);
    return accept(
      `Started worker ${id}, "${parsed.title}", on ${parsed.branch} in a checkout of its own. You will be woken when it completes or fails, or if it stops without saying either. While it waits on the user it shows as input_required.`,
    );
  }

  /**
   * Reports the lead's workers.
   * @param lead The lead's checkout.
   * @param worker The worker to report, or undefined for all of them.
   * @returns Returns what the model is told.
   */
  private status(lead: string, worker: unknown): TeamToolReply {
    const mine: readonly WorkerRecord[] = this.workerSignal().filter(
      (record: WorkerRecord): boolean => record.leadCheckoutId === lead,
    );
    const chosen: readonly WorkerRecord[] =
      worker === undefined
        ? mine
        : mine.filter((record: WorkerRecord): boolean => matches(record, worker));
    if (chosen.length === 0) {
      return worker === undefined
        ? accept('You have started no workers.')
        : refuse(`You have no worker called ${nameOf(worker)}.`);
    }
    return accept(
      chosen.map((record: WorkerRecord): string => describeWorker(this.view(record))).join('\n'),
    );
  }

  /**
   * Gives one of the lead's workers further instructions.
   * @param lead The lead's checkout.
   * @param worker The worker, by id or title.
   * @param text The instructions.
   * @returns Returns what the model is told.
   */
  private instruct(lead: string, worker: unknown, text: unknown): TeamToolReply {
    const record: WorkerRecord | string = this.ledWorker(lead, worker);
    if (typeof record === 'string') {
      return refuse(record);
    }
    const instructions: string | null = boundedText(text);
    if (instructions === null) {
      return refuse('Say what the worker should do.');
    }
    const agent: Agent | undefined =
      record.checkoutId === null ? undefined : this.session.agents().get(record.checkoutId);
    if (record.starting || agent === undefined) {
      return refuse(`${record.title} is still starting. Try again once it is working.`);
    }
    agent.send(`[Lead] ${instructions}`, undefined, TEAM_SURFACE);
    return accept(`${record.title} has your instructions.`);
  }

  /**
   * Stops one of the lead's workers.
   * @param lead The lead's checkout.
   * @param worker The worker, by id or title.
   * @returns Returns what the model is told.
   */
  private stopFor(lead: string, worker: unknown): TeamToolReply {
    const record: WorkerRecord | string = this.ledWorker(lead, worker);
    if (typeof record === 'string') {
      return refuse(record);
    }
    this.cancel(record, 'Stopped by its lead.');
    return accept(
      `Stopped ${record.title}. Its checkout and the branch ${record.branch} stay for the user to keep or remove.`,
    );
  }

  /**
   * Records a worker's report and wakes its lead.
   * @param worker The worker's checkout.
   * @param capability Which report.
   * @param record The report's input.
   * @returns Returns what the model is told.
   */
  private report(
    worker: string,
    capability: string,
    record: Record<string, unknown>,
  ): TeamToolReply {
    const found: WorkerRecord | undefined = this.workerSignal().find(
      (candidate: WorkerRecord): boolean => candidate.checkoutId === worker,
    );
    if (found === undefined) {
      return refuse('This agent is not one of the team’s workers.');
    }
    if (found.outcome !== null) {
      return refuse(`Your task is already ${found.outcome}.`);
    }
    if (capability === TEAM_COMPLETE_TASK) {
      const summary: string | null = boundedText(record['summary']);
      if (summary === null) {
        return refuse('Say what you did.');
      }
      const pullRequest: string | null = boundedText(record['pullRequest'], 500);
      this.update(found.id, { outcome: 'completed', summary, pullRequest });
      this.log.info('workspace.team', 'Worker completed', found.id);
      this.wakeLead(
        found,
        [
          `[Team] Worker "${found.title}" (${found.id}) completed its task on ${found.branch}.`,
          `Summary: ${summary}`,
          ...(pullRequest === null ? [] : [`Pull request: ${pullRequest}`]),
        ].join('\n'),
      );
      return accept('Your task is recorded as complete, and your lead has been told.');
    }
    const reason: string | null = boundedText(record['reason']);
    if (reason === null) {
      return refuse('Say why the task cannot be finished.');
    }
    this.update(found.id, { outcome: 'failed', summary: reason });
    this.log.info('workspace.team', 'Worker failed', found.id);
    this.wakeLead(
      found,
      `[Team] Worker "${found.title}" (${found.id}) could not finish its task on ${found.branch}.\nReason: ${reason}`,
    );
    return accept('Your task is recorded as failed, and your lead has been told.');
  }

  /**
   * Reads the board.
   * @param since The last sequence already read, untrusted.
   * @returns Returns what the model is told.
   */
  private readBoard(since: unknown): TeamToolReply {
    const after: number = typeof since === 'number' && Number.isFinite(since) ? since : 0;
    const entries: readonly TeamBoardEntry[] = this.boardSignal().filter(
      (entry: TeamBoardEntry): boolean => entry.sequence > after,
    );
    if (entries.length === 0) {
      return accept(after === 0 ? 'The board is empty.' : 'Nothing new on the board.');
    }
    return accept(
      entries
        .map(
          (entry: TeamBoardEntry): string =>
            `#${entry.sequence} ${entry.author} — ${entry.kind}: ${entry.text}`,
        )
        .join('\n'),
    );
  }

  /**
   * Posts to the board.
   * @param caller The caller's checkout.
   * @param role The caller's role.
   * @param input The tool's input, untrusted.
   * @returns Returns what the model is told.
   */
  private post(caller: string, role: AgentTeamRole, input: unknown): TeamToolReply {
    const parsed: PostToBoardInput | string = parsePostToBoardInput(input);
    if (typeof parsed === 'string') {
      return refuse(parsed);
    }
    const author: string =
      role === 'lead'
        ? 'Lead'
        : (this.workerSignal().find((record: WorkerRecord): boolean => record.checkoutId === caller)
            ?.title ?? 'Worker');
    const sequence: number = this.boardSignal().length + 1;
    this.boardSignal.set([
      ...this.boardSignal(),
      { sequence, author, at: Date.now(), kind: parsed.kind, text: parsed.text },
    ]);
    return accept(`Posted as #${sequence}.`);
  }

  /**
   * Cancels a worker: stops its turn and records it as cancelled.
   * @param record The worker.
   * @param why Why, kept as its summary.
   */
  private cancel(record: WorkerRecord, why: string): void {
    if (record.checkoutId !== null) {
      this.session.agents().get(record.checkoutId)?.stop();
    }
    this.update(record.id, { starting: false, outcome: 'cancelled', summary: why });
    this.log.info('workspace.team', 'Worker cancelled', record.id, why);
  }

  /**
   * Wakes a worker's lead with a message from the team, as its next turn.
   *
   * ⛔ Never into a turn the lead is running. Folding a message into a running turn (steering) was
   * tried, and in a real round two workers finishing together lost the second report: the lead's turn
   * ended answering the first and never acted on the other. So a message waits until the lead is
   * between turns, and everything that arrived meanwhile is delivered together, as one turn.
   * @param record The worker the message is about.
   * @param text The message.
   */
  private wakeLead(record: WorkerRecord, text: string): void {
    const next: Map<string, readonly string[]> = new Map<string, readonly string[]>(
      this.pendingWakesSignal(),
    );
    next.set(record.leadCheckoutId, [...(next.get(record.leadCheckoutId) ?? []), text]);
    this.pendingWakesSignal.set(next);
    const lead: Agent | undefined = this.session.agents().get(record.leadCheckoutId);
    if (lead === undefined) {
      this.log.warn('workspace.team', 'Lead not loaded; message held', record.id);
    } else if (!lead.isRunning()) {
      this.deliverWakes(record.leadCheckoutId, lead);
    }
  }

  /**
   * Sends a lead everything waiting for it, as one message.
   * @param leadId The lead's checkout.
   * @param lead The lead's agent, between turns.
   */
  private deliverWakes(leadId: string, lead: Agent): void {
    const messages: readonly string[] = this.pendingWakesSignal().get(leadId) ?? [];
    if (messages.length === 0) {
      return;
    }
    const next: Map<string, readonly string[]> = new Map<string, readonly string[]>(
      this.pendingWakesSignal(),
    );
    next.delete(leadId);
    this.pendingWakesSignal.set(next);
    lead.send(messages.join('\n\n'), undefined, TEAM_SURFACE);
  }

  /**
   * Wakes the lead of every worker that has just stopped — its turn ended, its task neither completed
   * nor failed — so a stalled or errored worker never leaves its lead waiting in silence.
   * @param views The workers as they are now.
   */
  private noticeStops(views: readonly TeamWorkerView[]): void {
    for (const view of views) {
      const before: TeamWorkerState | undefined = this.lastSeen.get(view.id);
      this.lastSeen.set(view.id, view.state);
      if (view.state !== 'idle' || (before !== 'working' && before !== 'input_required')) {
        continue;
      }
      const record: WorkerRecord | undefined = this.find(view.id);
      if (record !== undefined) {
        const last: string | null = view.agent === null ? null : lastMessage(view.agent);
        this.wakeLead(
          record,
          [
            `[Team] Worker "${record.title}" (${record.id}) stopped without reporting its task complete or failed.`,
            ...(last === null ? [] : [`Its last message: ${last}`]),
            'Instruct it to carry on, or stop it.',
          ].join('\n'),
        );
      }
    }
  }

  /**
   * Waits for a checkout's view to register its agent.
   * @param checkoutId The checkout id.
   * @returns Returns the agent, or null when it did not register in time.
   */
  private waitForAgent(checkoutId: string): Promise<Agent | null> {
    const present: Agent | undefined = this.session.agents().get(checkoutId);
    if (present !== undefined) {
      return Promise.resolve(present);
    }
    return new Promise<Agent | null>((resolve: (agent: Agent | null) => void): void => {
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        const waiting: ((agent: Agent) => void)[] = this.agentWaiters.get(checkoutId) ?? [];
        this.agentWaiters.set(
          checkoutId,
          waiting.filter((waiter: (agent: Agent) => void): boolean => waiter !== settle),
        );
        resolve(null);
      }, AGENT_READY_TIMEOUT_MS);
      const settle: (agent: Agent) => void = (agent: Agent): void => {
        clearTimeout(timer);
        resolve(agent);
      };
      this.agentWaiters.set(checkoutId, [...(this.agentWaiters.get(checkoutId) ?? []), settle]);
    });
  }

  /**
   * Builds the user's view of a worker from its record and its live agent.
   * @param record The worker.
   * @returns Returns the view.
   */
  private view(record: WorkerRecord): TeamWorkerView {
    const agent: Agent | null =
      record.checkoutId === null ? null : (this.session.agents().get(record.checkoutId) ?? null);
    const pending: AgentItem | null =
      agent === null ? null : (agent.items().find(isPendingRequest) ?? null);
    return {
      id: record.id,
      title: record.title,
      branch: record.branch,
      state: this.stateOf(record, agent, pending),
      summary: record.summary,
      pullRequest: record.pullRequest,
      agent,
      pending,
    };
  }

  /**
   * Reads where a worker is in its task.
   * @param record The worker.
   * @param agent Its agent, or null before its checkout opens.
   * @param pending What it waits on the user for, or null.
   * @returns Returns the state.
   */
  private stateOf(
    record: WorkerRecord,
    agent: Agent | null,
    pending: AgentItem | null,
  ): TeamWorkerState {
    if (record.outcome !== null) {
      return record.outcome;
    }
    // A worker whose checkout the user removed has nothing left to work in.
    if (record.checkoutId !== null && this.session.pathOf(record.checkoutId) === null) {
      return 'cancelled';
    }
    if (record.starting || agent === null) {
      return 'starting';
    }
    if (pending !== null) {
      return 'input_required';
    }
    return agent.isRunning() ? 'working' : 'idle';
  }

  /**
   * Finds the checkout a live agent belongs to.
   * @param agent The agent.
   * @returns Returns the checkout id, or null.
   */
  private checkoutOfAgent(agent: Agent): string | null {
    for (const [id, candidate] of this.session.agents()) {
      if (candidate === agent) {
        return id;
      }
    }
    return null;
  }

  /**
   * Finds one of a lead's workers that is still running, by id or title.
   * @param lead The lead's checkout.
   * @param worker The worker named, untrusted.
   * @returns Returns the worker, or why it cannot be had.
   */
  private ledWorker(lead: string, worker: unknown): WorkerRecord | string {
    const record: WorkerRecord | undefined = this.workerSignal().find(
      (candidate: WorkerRecord): boolean =>
        candidate.leadCheckoutId === lead && matches(candidate, worker),
    );
    if (record === undefined) {
      return `You have no worker called ${nameOf(worker)}.`;
    }
    if (record.outcome !== null) {
      return `${record.title} has already ${record.outcome === 'cancelled' ? 'been stopped' : record.outcome}.`;
    }
    return record;
  }

  /**
   * Finds a worker by id.
   * @param id The worker's id.
   * @returns Returns the worker, or undefined.
   */
  private find(id: string): WorkerRecord | undefined {
    return this.workerSignal().find((record: WorkerRecord): boolean => record.id === id);
  }

  /**
   * Updates a worker's record.
   * @param id The worker's id.
   * @param change The fields to change.
   */
  private update(id: string, change: Partial<Omit<WorkerRecord, 'id'>>): void {
    this.workerSignal.set(
      this.workerSignal().map((record: WorkerRecord): WorkerRecord =>
        record.id === id ? { ...record, ...change } : record,
      ),
    );
  }
}

/**
 * Builds a successful answer.
 * @param text What the model is told.
 * @returns Returns the answer.
 */
function accept(text: string): TeamToolReply {
  return { ok: true, text };
}

/**
 * Builds a refusal.
 * @param text Why, for the model.
 * @returns Returns the answer.
 */
function refuse(text: string): TeamToolReply {
  return { ok: false, text };
}

/**
 * Determines whether a worker is the one a model named.
 * @param record The worker.
 * @param name The id or title the model gave, untrusted.
 * @returns Returns true when it names this worker.
 */
function matches(record: WorkerRecord, name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const wanted: string = name.trim().toLowerCase();
  return record.id === wanted || record.title.toLowerCase() === wanted;
}

/**
 * Says how a model named a worker, for a refusal.
 * @param name The id or title the model gave, untrusted.
 * @returns Returns the name, or a stand-in when it gave none.
 */
function nameOf(name: unknown): string {
  return typeof name === 'string' && name.trim().length > 0 ? `"${name.trim()}"` : 'that';
}

/**
 * Determines whether a transcript item waits on the user.
 * @param item The item.
 * @returns Returns true when it is a pending permission, question or edit decision.
 */
function isPendingRequest(item: AgentItem): boolean {
  return (
    (item.kind === 'permission' && item.permissionState === 'pending') ||
    (item.kind === 'input-request' && item.inputState === 'pending') ||
    (item.kind === 'edit-decision' && item.decisionState === 'pending')
  );
}

/**
 * Says in a line what a worker is doing, for the lead.
 * @param view The worker.
 * @returns Returns the line.
 */
function describeWorker(view: TeamWorkerView): string {
  const parts: string[] = [`- ${view.id} "${view.title}" on ${view.branch}: ${view.state}`];
  if (view.pending !== null) {
    parts.push(`waiting on the user for: ${describeRequest(view.pending)}`);
  }
  if (view.summary !== null) {
    parts.push(view.summary);
  }
  if (view.pullRequest !== null) {
    parts.push(`pull request ${view.pullRequest}`);
  }
  return parts.join('; ');
}

/**
 * Reads an agent's last message: what it said last, or the error its turn ended on.
 * @param agent The agent.
 * @returns Returns the message, bounded, or null when it has said nothing.
 */
function lastMessage(agent: Agent): string | null {
  const items: readonly AgentItem[] = agent.items();
  for (let index: number = items.length - 1; index >= 0; index -= 1) {
    const item: AgentItem = items[index];
    if ((item.kind === 'assistant' && item.parentToolId === undefined) || item.kind === 'error') {
      const text: string = item.text.trim();
      if (text.length > 0) {
        return text.length > LAST_MESSAGE_CHARS ? `${text.slice(0, LAST_MESSAGE_CHARS)}…` : text;
      }
    }
  }
  return null;
}

/**
 * Writes a worker's first message: its task, and how it fits the team.
 * @param record The worker.
 * @returns Returns the brief.
 */
function brief(record: WorkerRecord): string {
  return [
    `[Lead] You are worker ${record.id} on a team. Your task: ${record.title}.`,
    '',
    record.task,
    '',
    `You are in your own checkout of the repository, on the branch ${record.branch}${record.base === null ? '' : `, which starts from ${record.base}`}. Work only here.`,
    'Read the board before you start. When you are done, call complete_task; if you cannot finish, call fail_task.',
  ].join('\n');
}
