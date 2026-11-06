import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildGate, buildOptions, parseQuestions, proposedChange, sandboxFor } from './options';
import type { GateContext } from './options';
import type { TurnRequest } from './protocol';
import { osSandboxAvailable, RUN_UNSANDBOXED, UNSANDBOXED_DECLINED } from './sandbox-rules';

/**
 * The part of the SDK's permission callback the gate reads.
 */
type Gate = (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult>;

/**
 * What a fake gate context recorded, and how it answers.
 */
interface Recorded {
  readonly permissions: string[];
  readonly inputs: string[];
  readonly audits: string[][];
  readonly sandboxed: (boolean | undefined)[];
  readonly toolIds: (string | undefined)[];
  withdrawals: number;
  granted: boolean;
  answer: string | null;
  bridge: unknown;
  turn: TurnRequest;
}

describe('the permission gate', () => {
  let workspace: string = '';
  let recorded: Recorded;

  /**
   * Builds a turn.
   * @param overrides What differs from an agent turn in the workspace, prompting for everything.
   * @returns Returns the turn.
   */
  function turn(overrides: Partial<TurnRequest> = {}): TurnRequest {
    return {
      requestId: 'r1',
      prompt: 'go',
      workspaceRoot: workspace,
      model: 'claude',
      agentSessionId: null,
      effort: null,
      mode: 'agent',
      surface: 'agent',
      allowedWritePaths: [],
      deniedWritePaths: [],
      allowedNetworkLocations: [],
      deniedNetworkLocations: [],
      tokenCap: 0,
      resumeSessionId: null,
      forkSession: false,
      resumeSessionAt: null,
      // The gate's own subject, not whether this machine has bubblewrap: a CI runner does not.
      requireSandbox: false,
      permissionPosture: 'prompt',
      toolPolicies: {},
      images: [],
      contextPaths: [],
      remoteControl: 'off',
      agentShell: null,
      owningTabId: null,
      providerSettings: {},
      ...overrides,
    };
  }

  /**
   * Builds the gate's context.
   * @returns Returns it.
   */
  function context(): GateContext {
    return {
      getTurn: (): TurnRequest => recorded.turn,
      getBridge: (): never => recorded.bridge as never,
      askPermission: (
        _id: string,
        name: string,
        detail: string,
      ): ReturnType<GateContext['askPermission']> => {
        recorded.permissions.push(`${name}: ${detail}`);
        return {
          granted: Promise.resolve(recorded.granted),
          withdraw: (): void => {
            recorded.withdrawals += 1;
          },
        };
      },
      askInput: (_id: string, question: string): ReturnType<GateContext['askInput']> => {
        recorded.inputs.push(question);
        return {
          answer: Promise.resolve(recorded.answer),
          withdraw: (): void => {
            recorded.withdrawals += 1;
          },
        };
      },
      audit: (
        _id: string,
        name: string,
        detail: string,
        source: string,
        sandboxed?: boolean,
        toolId?: string,
      ): void => {
        recorded.audits.push([name, detail, source]);
        recorded.sandboxed.push(sandboxed);
        recorded.toolIds.push(toolId);
      },
    };
  }

  /**
   * Builds a gate for a turn.
   * @param overrides What differs from the default turn.
   * @returns Returns the gate.
   */
  function gate(overrides: Partial<TurnRequest> = {}): Gate {
    recorded.turn = turn(overrides);
    return buildGate(context(), recorded.turn) as unknown as Gate;
  }

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'studio-gate-'));
    recorded = {
      permissions: [],
      inputs: [],
      audits: [],
      sandboxed: [],
      toolIds: [],
      withdrawals: 0,
      granted: true,
      answer: 'yes',
      bridge: null,
      turn: turn(),
    };
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('confinement', () => {
    it('refusesAWriteOutsideTheWorkspace_evenOnAutoAll', async () => {
      const outcome: PermissionResult = await gate({ permissionPosture: 'auto-all' })('Write', {
        file_path: path.join(tmpdir(), 'elsewhere.txt'),
      });

      expect(outcome.behavior).toBe('deny');
      expect(recorded.permissions).toEqual([]);
    });

    it('refusesARelativeTraversalOutOfTheWorkspace', async () => {
      const outcome: PermissionResult = await gate({ permissionPosture: 'auto-all' })('Edit', {
        file_path: '../outside.txt',
      });

      expect(outcome.behavior).toBe('deny');
    });

    it('refusesAWriteThroughASymlinkOutOfTheWorkspace', async () => {
      const outside: string = mkdtempSync(path.join(tmpdir(), 'studio-gate-outside-'));
      symlinkSync(outside, path.join(workspace, 'link'));

      const outcome: PermissionResult = await gate({ permissionPosture: 'auto-all' })('Write', {
        file_path: path.join(workspace, 'link', 'escaped.txt'),
      });
      rmSync(outside, { recursive: true, force: true });

      expect(outcome.behavior).toBe('deny');
    });

    it('allowsAWriteInAnAllowedPathOutsideTheWorkspace', async () => {
      const extra: string = path.join(workspace, '..', path.basename(workspace) + '-extra');
      mkdirSync(extra);

      const outcome: PermissionResult = await gate({
        permissionPosture: 'auto-all',
        allowedWritePaths: [extra],
      })('Write', { file_path: path.join(extra, 'a.txt') });
      rmSync(extra, { recursive: true, force: true });

      expect(outcome.behavior).toBe('allow');
    });

    it('refusesAWriteOnTheDeniedPaths_insideTheWorkspace', async () => {
      const denied: string = path.join(workspace, 'secrets');

      const outcome: PermissionResult = await gate({
        permissionPosture: 'auto-all',
        deniedWritePaths: [denied],
      })('Write', { file_path: path.join(denied, 'key.pem') });

      expect(outcome.behavior).toBe('deny');
    });

    it('readsTheDeniedPathsFromTheLiveTurn_notTheOneThatOpenedTheSession', async () => {
      const denied: string = path.join(workspace, 'secrets');
      const opened: Gate = gate({ permissionPosture: 'auto-all' });

      recorded.turn = turn({ permissionPosture: 'auto-all', deniedWritePaths: [denied] });

      expect((await opened('Write', { file_path: path.join(denied, 'key.pem') })).behavior).toBe(
        'deny',
      );
    });

    it('confinesNothing_withoutAWorkspace', async () => {
      const outcome: PermissionResult = await gate({
        workspaceRoot: null,
        permissionPosture: 'auto-all',
      })('Write', { file_path: path.join(tmpdir(), 'anywhere.txt') });

      expect(outcome.behavior).toBe('allow');
    });
  });

  describe('modes', () => {
    it('chatReads_butCannotWriteOrRun', async () => {
      const chat: Gate = gate({ mode: 'chat', permissionPosture: 'auto-all' });

      expect((await chat('Read', { file_path: 'a' })).behavior).toBe('allow');
      expect((await chat('Write', { file_path: 'a' })).behavior).toBe('deny');
      expect((await chat('Bash', { command: 'ls' })).behavior).toBe('deny');
    });

    it.each<[string, Partial<TurnRequest>, RegExp]>([
      ['aTerminalsAgent', { surface: 'terminal' }, /only use the terminal/],
      ['aToolViewsAgent', { builtInTools: 'none' }, /tools of the view/],
    ])(
      '%s_canUseNoBuiltIn',
      async (_n: string, overrides: Partial<TurnRequest>, reason: RegExp) => {
        const outcome: PermissionResult = await gate({
          ...overrides,
          permissionPosture: 'auto-all',
        })('Read', { file_path: 'a' });

        expect(outcome).toMatchObject({
          behavior: 'deny',
          message: expect.stringMatching(reason) as unknown,
        });
      },
    );

    it('aConfinedAgent_stillGetsStudiosOwnTools_andTheQuestionTool', async () => {
      const confined: Gate = gate({ surface: 'terminal' });

      expect((await confined('mcp__studio__open_file', { a: 1 })).behavior).toBe('allow');
      expect((await confined('AskUserQuestion', { questions: [] })).behavior).toBe('allow');
    });
  });

  describe('policy', () => {
    it('promptsByDefault_andRespectsTheAnswer', async () => {
      const prompting: Gate = gate();

      expect(await prompting('Bash', { command: 'ls' })).toEqual({
        behavior: 'allow',
        updatedInput: { command: 'ls' },
      });
      expect(recorded.permissions).toHaveLength(1);

      recorded.granted = false;
      expect((await prompting('Bash', { command: 'ls' })).behavior).toBe('deny');
    });

    it('aDeniedToolIsRefused_onAutoAllToo', async () => {
      const denied: Gate = gate({ permissionPosture: 'auto-all', toolPolicies: { Bash: 'deny' } });

      expect((await denied('Bash', { command: 'ls' })).behavior).toBe('deny');
      expect(recorded.permissions).toEqual([]);
    });

    it('anAllowedToolSkipsThePrompt', async () => {
      const allowed: Gate = gate({ toolPolicies: { Bash: 'allow' } });

      expect((await allowed('Bash', { command: 'ls' })).behavior).toBe('allow');
      expect(recorded.permissions).toEqual([]);
    });

    it('autoEdits_coversEdits_butNotTheShell', async () => {
      const edits: Gate = gate({ permissionPosture: 'auto-edits' });

      await edits('Write', { file_path: path.join(workspace, 'a.txt') });
      expect(recorded.permissions).toEqual([]);

      await edits('Bash', { command: 'ls' });
      expect(recorded.permissions).toHaveLength(1);
    });
  });

  describe('a peer on remote control', () => {
    /**
     * Builds a fake bridge.
     * @param granted What the peer answers.
     * @param answer What the peer answers a question with.
     * @returns Returns the bridge and what it was told.
     */
    function peer(
      granted: Promise<boolean>,
      answer: Promise<Record<string, unknown> | null> = new Promise<never>((): void => undefined),
    ): { calls: string[] } {
      const calls: string[] = [];
      recorded.bridge = {
        canPrompt: true,
        requestPermission: (): unknown => ({ id: 'p', granted }),
        cancelPermission: (id: string): void => void calls.push(`cancelPermission:${id}`),
        requestQuestions: (): unknown => ({ id: 'q', answer }),
        cancelQuestion: (id: string): void => void calls.push(`cancelQuestion:${id}`),
        clearAction: (): void => void calls.push('clearAction'),
      };
      return { calls };
    }

    it('aStudioAnswerFirst_dismissesThePeersPrompt', async () => {
      const { calls }: { calls: string[] } = peer(new Promise<never>((): void => undefined));

      const outcome: PermissionResult = await gate()('Bash', { command: 'ls' });

      expect(outcome.behavior).toBe('allow');
      expect(calls).toEqual(['cancelPermission:p', 'clearAction']);
    });

    it('aPeersAnswerFirst_withdrawsStudiosPrompt_andIsFinal', async () => {
      peer(Promise.resolve(false));
      recorded.granted = true;
      const slowLocal: GateContext = {
        ...context(),
        askPermission: (): ReturnType<GateContext['askPermission']> => ({
          granted: new Promise<boolean>((): void => undefined),
          withdraw: (): void => {
            recorded.withdrawals += 1;
          },
        }),
      };
      recorded.turn = turn();
      const racing: Gate = buildGate(slowLocal, recorded.turn) as unknown as Gate;

      const outcome: PermissionResult = await racing('Bash', { command: 'ls' });

      expect(outcome.behavior).toBe('deny');
      expect(recorded.withdrawals).toBe(1);
    });

    it('aPeersAnswerToAQuestion_takesItOffStudiosScreen', async () => {
      peer(Promise.resolve(true), Promise.resolve({ questions: [], answers: { Which: 'that' } }));
      const slowLocal: GateContext = {
        ...context(),
        askInput: (): ReturnType<GateContext['askInput']> => ({
          answer: new Promise<string | null>((): void => undefined),
          withdraw: (): void => {
            recorded.withdrawals += 1;
          },
        }),
      };
      recorded.turn = turn();
      const racing: Gate = buildGate(slowLocal, recorded.turn) as unknown as Gate;

      const outcome: PermissionResult = await racing('AskUserQuestion', {
        questions: [{ question: 'Which?', options: [] }],
      });

      expect(outcome).toEqual({
        behavior: 'allow',
        updatedInput: { questions: [], answers: { Which: 'that' } },
      });
      expect(recorded.withdrawals).toBe(1);
    });

    it('aStudioAnswerFirst_dismissesThePeersQuestion', async () => {
      const { calls }: { calls: string[] } = peer(Promise.resolve(true));

      const outcome: PermissionResult = await gate()('AskUserQuestion', {
        questions: [{ question: 'Which?', options: [] }],
      });

      expect(outcome).toMatchObject({ behavior: 'allow' });
      expect(calls).toEqual(['cancelQuestion:q', 'clearAction']);
    });

    it('aPeerDecliningAQuestion_isADenial', async () => {
      peer(Promise.resolve(true), Promise.resolve(null));
      const slowLocal: GateContext = {
        ...context(),
        askInput: (): ReturnType<GateContext['askInput']> => ({
          answer: new Promise<string | null>((): void => undefined),
          withdraw: (): void => undefined,
        }),
      };
      recorded.turn = turn();

      const outcome: PermissionResult = await (
        buildGate(slowLocal, recorded.turn) as unknown as Gate
      )('AskUserQuestion', { questions: [{ question: 'Which?', options: [] }] });

      expect(outcome.behavior).toBe('deny');
    });
  });

  describe('questions', () => {
    it('asksEachInTurn_andReturnsTheAnswersWithTheOriginalQuestions', async () => {
      const questions: unknown[] = [{ question: 'One?' }, { question: 'Two?' }];

      const outcome: PermissionResult = await gate()('AskUserQuestion', { questions });

      expect(recorded.inputs).toEqual(['One?', 'Two?']);
      expect(outcome).toEqual({
        behavior: 'allow',
        updatedInput: { questions, answers: { 'One?': 'yes', 'Two?': 'yes' } },
      });
    });

    it('stopsAtADecline', async () => {
      recorded.answer = null;

      const outcome: PermissionResult = await gate()('AskUserQuestion', {
        questions: [{ question: 'One?' }, { question: 'Two?' }],
      });

      expect(outcome.behavior).toBe('deny');
      expect(recorded.inputs).toEqual(['One?']);
    });

    it('letsAMalformedCallThrough_ratherThanStallTheTurn', async () => {
      const input: Record<string, unknown> = { questions: 'nonsense' };

      expect(await gate()('AskUserQuestion', input)).toEqual({
        behavior: 'allow',
        updatedInput: input,
      });
    });

    it('skipsMalformedEntries', () => {
      expect(
        parseQuestions({
          questions: [
            null,
            'text',
            { question: '' },
            { question: 5 },
            {
              question: 'Good?',
              options: [
                null,
                'x',
                { label: '' },
                { label: 'A', description: 'first' },
                { label: 'B', description: 1 },
              ],
            },
          ],
        }),
      ).toEqual([
        {
          question: 'Good?',
          options: [{ label: 'A', description: 'first' }, { label: 'B' }],
          selection: 'single',
        },
      ]);
    });
  });

  describe('session options', () => {
    /**
     * Builds the SDK options for a turn.
     * @param overrides What differs from the default turn.
     * @returns Returns them.
     */
    function options(overrides: Partial<TurnRequest> = {}): Options {
      recorded.turn = turn(overrides);
      return buildOptions(
        context(),
        recorded.turn,
        {} as never,
        'instructions',
        null,
        new AbortController(),
      );
    }

    /**
     * Runs a hook of the options.
     * @param built The options.
     * @param name The hook event.
     * @param input The hook's input.
     * @returns Returns its output.
     */
    function hook(
      built: Options,
      name: 'PreToolUse' | 'PostToolUse',
      input: unknown,
    ): Promise<unknown> {
      const callback: ((value: unknown) => Promise<unknown>) | undefined = built.hooks?.[name]?.[0]
        ?.hooks[0] as ((value: unknown) => Promise<unknown>) | undefined;
      if (callback === undefined) {
        throw new Error(`No ${name} hook`);
      }
      return callback(input);
    }

    it('removesDeniedToolsFromTheModel_notOnlyFromTheGate', () => {
      expect(options({ toolPolicies: { Bash: 'deny', Read: 'allow' } }).disallowedTools).toEqual([
        'Bash',
      ]);
    });

    it('offersAConfinedAgentOnlyTheQuestionTool', () => {
      expect(options({ surface: 'terminal' }).tools).toEqual(['AskUserQuestion']);
    });

    it('keepsMinimalEffortOutOfTheOptions', () => {
      expect(options({ effort: 'minimal' }).effort).toBeUndefined();
      expect(options({ effort: 'high' }).effort).toBe('high');
    });

    it('forksOnlyWhatItResumes', () => {
      expect(options({ forkSession: true }).forkSession).toBeUndefined();
      expect(
        options({ resumeSessionId: 's', resumeSessionAt: 'm', forkSession: true }),
      ).toMatchObject({ resume: 's', resumeSessionAt: 'm', forkSession: true });
    });

    it('sendsATokenCapAsATaskBudget_onlyWhenThereIsOne', () => {
      expect(options({ tokenCap: 0 }).taskBudget).toBeUndefined();
      expect(options({ tokenCap: 500 }).taskBudget).toEqual({ total: 500 });
    });

    it('autoAllowsReadingOnlyWhenThereIsSomethingToRead_andNeverInChat', () => {
      expect(options({ workspaceRoot: null }).allowedTools).toEqual([]);
      expect(options({ mode: 'chat' }).allowedTools).toEqual([]);
      expect(options().allowedTools?.length).toBeGreaterThan(0);
    });

    it('blocksACommandTheUserKeepsAgentsOff_fromTheLiveTurn', async () => {
      const built: Options = options();
      recorded.turn = turn({ blockedCommands: ['gh'] });

      expect(
        await hook(built, 'PreToolUse', {
          tool_name: 'Bash',
          tool_input: { command: 'gh pr merge 1' },
        }),
      ).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    });

    it.each<[string, unknown]>([
      ['aCommandNotBlocked', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
      ['anotherTool', { tool_name: 'Write', tool_input: { command: 'gh' } }],
      ['noInput', { tool_name: 'Bash', tool_input: null }],
      ['aNonStringCommand', { tool_name: 'Bash', tool_input: { command: 4 } }],
    ])('letsThrough_%s', async (_name: string, input: unknown) => {
      recorded.turn = turn({ blockedCommands: ['gh'] });

      expect(await hook(options({ blockedCommands: ['gh'] }), 'PreToolUse', input)).toEqual({
        continue: true,
      });
    });

    it('auditsWhatRan_butNotReads_orStudiosOwnTools', async () => {
      const built: Options = options({ toolPolicies: { Bash: 'allow' } });

      await hook(built, 'PostToolUse', { tool_name: 'Read', tool_input: {} });
      await hook(built, 'PostToolUse', { tool_name: 'mcp__studio__x', tool_input: {} });
      await hook(built, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });

      expect(recorded.audits).toHaveLength(1);
      expect(recorded.audits[0][0]).toBe('Bash');
    });

    it('auditsAShellCommand_asRunOutsideTheSandbox_whenItCarriedTheFlag', async () => {
      recorded.turn = turn({ permissionPosture: 'auto-all' });
      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      await hook(built, 'PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'ls', dangerouslyDisableSandbox: true },
      });

      expect(recorded.sandboxed).toEqual([false]);
      expect(recorded.audits[0][2]).toBe('posture');
    });

    it('auditsTheToolUse_soTheTranscriptCanMarkTheRightCall', async () => {
      recorded.turn = turn();
      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      await hook(built, 'PostToolUse', {
        tool_name: 'Bash',
        tool_use_id: 'toolu_9',
        tool_input: { command: 'ls' },
      });

      expect(recorded.toolIds).toEqual(['toolu_9']);
    });

    it('auditsAShellCommand_asSandboxed_whereThereIsASandbox', async () => {
      recorded.turn = turn();
      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      await hook(built, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });

      expect(recorded.sandboxed).toEqual([osSandboxAvailable()]);
    });

    it('auditsNothingAboutTheSandbox_forAnyOtherTool', async () => {
      recorded.turn = turn();
      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      await hook(built, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: '/a' } });

      expect(recorded.sandboxed).toEqual([undefined]);
    });

    it('auditsAPromptedRunOutsideTheSandbox_asGated_evenWhenItsLevelIsAllowed', async () => {
      recorded.turn = turn({ toolPolicies: { [RUN_UNSANDBOXED]: 'allow' } });
      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      await hook(built, 'PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'ls', dangerouslyDisableSandbox: true },
      });

      expect(recorded.audits[0][2]).toBe('gated-or-auto');
    });

    it('anAuditThatFails_neverDisturbsTheRun', async () => {
      const failing: GateContext = {
        ...context(),
        audit: (): void => {
          throw new Error('audit log full');
        },
      };
      recorded.turn = turn();
      const built: Options = buildOptions(
        failing,
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      expect(await hook(built, 'PostToolUse', { tool_name: 'Bash', tool_input: {} })).toEqual({
        continue: true,
      });
    });
  });

  describe('running outside the sandbox', () => {
    const outside: Record<string, unknown> = {
      command: 'rm -rf build',
      dangerouslyDisableSandbox: true,
    };

    /**
     * Decides a command asking to leave the sandbox, the user answering as given.
     * @param overrides What differs from the default turn.
     * @param answer What the user answers.
     * @returns Returns the decision.
     */
    async function decide(
      overrides: Partial<TurnRequest>,
      answer: boolean = true,
    ): Promise<PermissionResult> {
      recorded.granted = answer;
      return gate(overrides)('Bash', outside);
    }

    it.each<[string, 'prompt' | 'auto-edits' | 'auto-all', 'allow' | 'ask' | 'deny', boolean]>([
      ['promptAll asks though it is Ask', 'prompt', 'ask', true],
      ['promptAll asks though it is Allowed', 'prompt', 'allow', true],
      ['allowEdits does not reach it', 'auto-edits', 'ask', true],
      ['allowEdits with Allowed runs it', 'auto-edits', 'allow', false],
      ['allowAll runs it', 'auto-all', 'ask', false],
      ['allowAll with Allowed runs it', 'auto-all', 'allow', false],
    ])(
      'decides_%s',
      async (
        _name: string,
        permissionPosture: 'prompt' | 'auto-edits' | 'auto-all',
        level: 'allow' | 'ask' | 'deny',
        prompts: boolean,
      ) => {
        const decision: PermissionResult = await decide({
          permissionPosture,
          toolPolicies: { [RUN_UNSANDBOXED]: level },
        });

        expect(decision).toMatchObject({ behavior: 'allow', updatedInput: outside });
        expect(recorded.permissions.length).toBe(prompts ? 1 : 0);
      },
    );

    it.each<['prompt' | 'auto-edits' | 'auto-all']>([['prompt'], ['auto-edits'], ['auto-all']])(
      'deniedUnder_%s_runsTheCommandSandboxed_ratherThanRefusingIt',
      async (permissionPosture: 'prompt' | 'auto-edits' | 'auto-all') => {
        const decision: PermissionResult = await decide({
          permissionPosture,
          toolPolicies: { [RUN_UNSANDBOXED]: 'deny', Bash: 'allow' },
        });

        expect(decision).toMatchObject({
          behavior: 'allow',
          updatedInput: { command: 'rm -rf build' },
        });
        expect(
          (decision as { updatedInput: Record<string, unknown> }).updatedInput,
        ).not.toHaveProperty('dangerouslyDisableSandbox');
      },
    );

    it('deniedWithTheShellOnAsk_stillAsksForTheShellCommandItBecomes', async () => {
      await decide({ toolPolicies: { [RUN_UNSANDBOXED]: 'deny' } });

      expect(recorded.permissions).toEqual(['Bash: rm -rf build']);
    });

    it('aBashToolAllow_doesNotCoverIt', async () => {
      await decide({ toolPolicies: { Bash: 'allow' } });

      expect(recorded.permissions).toEqual([`${RUN_UNSANDBOXED}: rm -rf build`]);
    });

    it('autoAllowSandboxedShell_doesNotCoverIt', async () => {
      await decide({ autoAllowSandboxedShell: true });

      expect(recorded.permissions).toEqual([`${RUN_UNSANDBOXED}: rm -rf build`]);
    });

    it('theShellOnDeny_blocksItToo', async () => {
      const decision: PermissionResult = await decide({ toolPolicies: { Bash: 'deny' } });

      expect(decision).toMatchObject({ behavior: 'deny' });
      expect(recorded.permissions).toEqual([]);
    });

    it('asksWithTheWholeCommand_notItsSummary', async () => {
      const command: string = `echo ${'x'.repeat(300)}`;

      await gate()('Bash', { command, dangerouslyDisableSandbox: true });

      expect(recorded.permissions).toEqual([`${RUN_UNSANDBOXED}: ${command}`]);
    });

    it('whenTheUserDeclines_saysWhatToDoInstead', async () => {
      const decision: PermissionResult = await decide({}, false);

      expect(decision).toEqual({ behavior: 'deny', message: UNSANDBOXED_DECLINED });
    });

    it('anOrdinaryShellCommand_isStillDecidedAsTheShell', async () => {
      await gate()('Bash', { command: 'ls' });

      expect(recorded.permissions).toEqual(['Bash: ls']);
    });

    it('isNotWithheldFromTheModel_whenDenied', () => {
      recorded.turn = turn({ toolPolicies: { [RUN_UNSANDBOXED]: 'deny', WebFetch: 'deny' } });

      const built: Options = buildOptions(
        context(),
        recorded.turn,
        {} as never,
        '',
        null,
        new AbortController(),
      );

      expect(built.disallowedTools).toEqual(['WebFetch']);
    });
  });

  describe('sandboxFor', () => {
    it('passesOnlyAbsoluteDeniedPaths_toTheSandbox', () => {
      const sandbox: ReturnType<typeof sandboxFor> = sandboxFor(
        turn({ deniedWritePaths: ['relative/secrets', '/abs/secrets'] }),
      );

      expect(sandbox.filesystem).toEqual({ denyWrite: ['/abs/secrets'] });
    });

    it('expandsAWildcardToItsApex_onBothNetworkLists', () => {
      const sandbox: ReturnType<typeof sandboxFor> = sandboxFor(
        turn({
          allowedNetworkLocations: ['*.example.com'],
          deniedNetworkLocations: ['*.bad.com'],
        }),
      );

      expect(sandbox.network?.allowedDomains).toEqual(
        expect.arrayContaining(['*.example.com', 'example.com']),
      );
      expect(sandbox.network?.deniedDomains).toEqual(
        expect.arrayContaining(['*.bad.com', 'bad.com']),
      );
    });

    it('addsNoFilesystemOrNetworkRules_whenThereAreNone', () => {
      const sandbox: ReturnType<typeof sandboxFor> = sandboxFor(turn());

      expect(sandbox.filesystem).toBeUndefined();
      expect(sandbox.network).toBeUndefined();
    });
  });

  describe('proposedChange', () => {
    it.each<[string, string, unknown]>([
      ['aToolThatProposesNothing', 'Bash', { command: 'ls' }],
      ['aWriteWithNoPath', 'Write', { content: 'x' }],
      ['aWriteWithNoContent', 'Write', { file_path: '/a' }],
      [
        'anEditWithANonStringReplacement',
        'Edit',
        { file_path: '/a', old_string: 1, new_string: 2 },
      ],
    ])('proposesNothing_for_%s', (_name: string, tool: string, input: unknown) => {
      expect(proposedChange(tool, input as Record<string, unknown>)).toBeUndefined();
    });

    it('proposesNothing_forAWriteTooBigToSendWithAPrompt', () => {
      expect(
        proposedChange('Write', { file_path: '/a', content: 'x'.repeat(5 * 1024 * 1024) }),
      ).toBeUndefined();
    });
  });
});
