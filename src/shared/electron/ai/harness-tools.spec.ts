import { describe, expect, it, vi } from 'vitest';
import {
  CREATE_FILE,
  CREATE_FOLDER,
  DELETE_PATH,
  DELETE_RUN_CONFIGURATIONS,
  EDIT_ACTIVE_DOCUMENT,
  LIST_OPEN_DOCUMENTS,
  LIST_RUN_CONFIGURATIONS,
  LIST_TERMINALS,
  OPEN_TERMINAL,
  READ_TERMINAL_OUTPUT,
  WRITE_TERMINAL_INPUT,
  OPEN_DIFF,
  OPEN_FILE,
  READ_SOURCE_CONTROL_STATUS,
  READ_ACTIVE_DOCUMENT,
  RENAME_PATH,
  REVEAL_IN_EXPLORER,
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SAVE_RUN_CONFIGURATIONS,
  ASK_USER,
  LOAD_SKILL,
  PROPOSE_WORKSPACE,
  LIST_LOG_SESSIONS,
  QUERY_LOGS,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
  SEND_API_REQUEST,
  OPEN_DOCUMENT,
} from '@shared/api/ai-types';
import type { HarnessTool } from '@shared/api/agent-protocol';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { describeOffer } = await import('./harness-tools');

/**
 * Builds a run context with the fields the tool description reads.
 * @param overrides Fields to replace.
 * @returns Returns the context.
 */
function contextFor(overrides: Partial<Record<string, unknown>> = {}): AgentRunContext {
  return {
    requestId: 'r1',
    surface: 'editor',
    mode: 'agent',
    toolPolicies: {},
    language: null,
    systemPromptExtra: '',
    skills: [],
    workspaceRoot: '/ws',
    permissionPosture: 'prompt',
    bridge: { request: (): Promise<unknown> => Promise.resolve('') },
    emit: (): void => undefined,
    recordAudit: (): void => undefined,
    requestPermission: (): Promise<boolean> => Promise.resolve(true),
    ...overrides,
  } as unknown as AgentRunContext;
}

/**
 * Gets the names of the tools an offer describes.
 * @param offer The offer.
 * @returns Returns the tool names.
 */
function names(offer: { tools: readonly HarnessTool[] }): readonly string[] {
  return offer.tools.map((tool: HarnessTool): string => tool.name);
}

describe('describeOffer', () => {
  it('offersTheRunConfigurationToolsOnTheWorkspaceScopedSurfaces', async () => {
    // ⚠️ The parity gap the Claude port made load-bearing. These tools existed only in the in-core
    // Claude provider's own declarations, so an agent on any other connection simply could not author
    // a run configuration — and once a harness gets its tools by asking core, a tool core does not
    // describe is a tool nobody gets.
    expect(names(await describeOffer(contextFor({ surface: 'editor' })))).toContain(
      SAVE_RUN_CONFIGURATIONS,
    );
    expect(names(await describeOffer(contextFor({ surface: 'project' })))).toEqual(
      expect.arrayContaining([
        LIST_RUN_CONFIGURATIONS,
        SAVE_RUN_CONFIGURATIONS,
        DELETE_RUN_CONFIGURATIONS,
      ]),
    );
  });

  it('offersTheAgentTabAWayIntoAWorkspace_andNoOtherSurface', async () => {
    // #876: a project planned in an agent tab moves into a workspace of its own; anywhere else the
    // project already has one.
    const project: { tools: readonly HarnessTool[]; systemPrompt: string } = await describeOffer(
      contextFor({ surface: 'project', workspaceRoot: null }),
    );
    expect(names(project)).toContain(PROPOSE_WORKSPACE);
    expect(project.systemPrompt).toContain(PROPOSE_WORKSPACE);
    for (const surface of ['editor', 'workspace', 'terminal', 'binary', 'api']) {
      expect(names(await describeOffer(contextFor({ surface })))).not.toContain(PROPOSE_WORKSPACE);
    }
  });

  it('proposeWorkspace_putsTheProposalInTheConversation_andDoesNotWait', async () => {
    const { proposeWorkspace } = await import('./studio-tools');
    const emitted: unknown[] = [];
    const told: string = proposeWorkspace(
      contextFor({ surface: 'project', emit: (event: unknown): number => emitted.push(event) }),
      { name: 'invoice-tracker', handoff: '# Plan' },
    );

    expect(emitted).toEqual([
      expect.objectContaining({
        requestId: 'r1',
        kind: 'workspace-proposal',
        name: 'invoice-tracker',
        handoff: '# Plan',
      }),
    ]);
    expect(told).toContain('Stop here');
  });

  it('withholdsThemFromASurfaceConfinedToSomethingElse', async () => {
    // A terminal- or binary-docked agent is deliberately confined to its own surface, and authoring
    // the workspace's launch configuration is not that surface's business.
    for (const surface of ['terminal', 'binary', 'api']) {
      expect(names(await describeOffer(contextFor({ surface })))).not.toContain(
        SAVE_RUN_CONFIGURATIONS,
      );
    }
  });

  it('withholdsThemFromAChatTurn', async () => {
    expect(names(await describeOffer(contextFor({ mode: 'chat' })))).not.toContain(
      SAVE_RUN_CONFIGURATIONS,
    );
  });

  it('describesTheRunConfigurationGuidanceWhereverItDescribesTheTools', async () => {
    // Two things, kept in step by hand: describing a tool the model was not given is how a model ends
    // up calling something that does not exist.
    const editor: { systemPrompt: string } = await describeOffer(contextFor({ surface: 'editor' }));
    const terminal: { systemPrompt: string } = await describeOffer(
      contextFor({ surface: 'terminal' }),
    );

    expect(editor.systemPrompt).toContain('run configurations');
    expect(terminal.systemPrompt).not.toContain('Run dropdown');
  });

  it('offersTheWorkspaceSurfaceAWellToReadButNoDocumentToEdit', async () => {
    // #713. A workspace has a well but no document of its own: the read tool lets the model see what
    // the user is looking at; the edit tools, which would act on whatever happened to be focused, are
    // withheld. The run-configuration and workbench tools ride along, as on every workspace-scoped
    // surface.
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'workspace' }),
    );

    expect(names(offer)).toEqual(
      expect.arrayContaining([
        READ_ACTIVE_DOCUMENT,
        OPEN_FILE,
        SAVE_RUN_CONFIGURATIONS,
        ASK_USER,
        LIST_OPEN_DOCUMENTS,
        OPEN_DIFF,
        READ_SOURCE_CONTROL_STATUS,
        LIST_TERMINALS,
        READ_TERMINAL_OUTPUT,
        WRITE_TERMINAL_INPUT,
        OPEN_TERMINAL,
      ]),
    );
    expect(names(offer)).not.toContain(EDIT_ACTIVE_DOCUMENT);
    expect(names(offer)).not.toContain(REPLACE_ACTIVE_DOCUMENT);
    expect(names(offer)).not.toContain(RUN_ACTIVE_DOCUMENT);
    expect(offer.systemPrompt).toContain('docked to a workspace tab');
    expect(offer.systemPrompt).toContain('run configurations');
  });

  it('appendsTheUsersStandingSystemTextBeneathStudiosOwn', async () => {
    // #300. Append-only: the user's text follows every one of Studio's appendices, so a profile can
    // add guidance but cannot strand the tool descriptions above it.
    const offer: { systemPrompt: string } = await describeOffer(
      contextFor({ systemPromptExtra: '### Style\nExplicit types.' }),
    );

    expect(offer.systemPrompt.endsWith('### Style\nExplicit types.')).toBe(true);
    expect(offer.systemPrompt.indexOf('run configurations')).toBeLessThan(
      offer.systemPrompt.indexOf('### Style'),
    );
  });

  it('listsTheSkillsInScopeAndOffersTheToolThatLoadsThem', async () => {
    // #301. Progressive disclosure through the seam every harness already speaks: the listing rides
    // in the instructions, the body behind a Studio tool the harness runs like any other.
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({
        skills: [
          {
            name: 'csharp-style',
            description: 'C# house style.',
            load: (): Promise<null> => Promise.resolve(null),
          },
        ],
      }),
    );

    expect(offer.systemPrompt).toContain('- csharp-style: C# house style.');
    expect(names(offer)).toContain(LOAD_SKILL);
  });

  it('offersNoSkillToolWhenNothingIsInScope', async () => {
    expect(names(await describeOffer(contextFor()))).not.toContain(LOAD_SKILL);
  });

  it('addressesWorkspaceTerminalsByIdAndWithholdsWritingFromAChatTurn', async () => {
    // #713 phase 3. A workspace agent has no owning terminal, so its terminal tools name the one to
    // drive; a chat turn may look at a terminal but not type into it or open one.
    const agent: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'workspace' }),
    );
    const chat: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'workspace', mode: 'chat' }),
    );
    const read: HarnessTool | undefined = agent.tools.find(
      (tool: HarnessTool): boolean => tool.name === READ_TERMINAL_OUTPUT,
    );

    expect(JSON.stringify(read?.inputSchema)).toContain('terminalId');
    expect(names(chat)).toContain(READ_TERMINAL_OUTPUT);
    expect(names(chat)).toContain(LIST_TERMINALS);
    expect(names(chat)).not.toContain(WRITE_TERMINAL_INPUT);
    expect(names(chat)).not.toContain(OPEN_TERMINAL);
  });

  it('offersTheTreeToolsOnTheWorkspaceSurfaceAndOnlyTheRevealToAChatTurn', async () => {
    // #713 phase 4. Acting on the tree is a mutation like any other; a chat turn may point the user
    // at a file but not make, rename or remove one.
    const agent: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'workspace' }),
    );
    const chat: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'workspace', mode: 'chat' }),
    );

    expect(names(agent)).toEqual(
      expect.arrayContaining([
        CREATE_FILE,
        CREATE_FOLDER,
        RENAME_PATH,
        DELETE_PATH,
        REVEAL_IN_EXPLORER,
      ]),
    );
    expect(names(chat)).toContain(REVEAL_IN_EXPLORER);
    expect(names(chat)).not.toContain(CREATE_FILE);
    expect(names(chat)).not.toContain(DELETE_PATH);
    expect(names(await describeOffer(contextFor({ surface: 'editor' })))).not.toContain(
      CREATE_FILE,
    );
  });

  it('keepsTheWorkspaceViewToolsOffTheEditorSurface', async () => {
    // An editor tab has one document, its own; the well-wide listing and the diff belong to the tab
    // that shows the well.
    const offer: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'editor' }),
    );

    expect(names(offer)).not.toContain(LIST_OPEN_DOCUMENTS);
    expect(names(offer)).not.toContain(OPEN_DIFF);
    expect(names(offer)).not.toContain(READ_SOURCE_CONTROL_STATUS);
  });

  it('omitsAToolTheHarnessSaysItAlreadyHas', async () => {
    const offer: { tools: readonly HarnessTool[] } = await describeOffer(contextFor(), [ASK_USER]);

    expect(names(offer)).not.toContain(ASK_USER);
  });

  it('tellsTheModelToAskAnywayWhenTheHarnessBringsItsOwnAskTool', async () => {
    // 🔑 Why `omit` names what the harness *has* rather than what to withhold: the instruction to ask
    // rather than guess still applies; only the sentence naming a Studio tool has to go.
    const offer: { systemPrompt: string } = await describeOffer(contextFor(), [ASK_USER]);

    expect(offer.systemPrompt).toContain('ask a clarifying question');
    expect(offer.systemPrompt).not.toContain(`"${ASK_USER}"`);
  });

  it('withholdsADeniedToolEntirelyRatherThanListingItToBeRefused', async () => {
    // ⛔ The ruling, with its cost on the record: the model is never told the capability exists, so it
    // may work around the gap or fail without explaining itself — which was judged better than a
    // denial it can keep pushing against.
    const offer: { tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ toolPolicies: { [SAVE_RUN_CONFIGURATIONS]: 'deny' } }),
    );

    expect(names(offer)).not.toContain(SAVE_RUN_CONFIGURATIONS);
    expect(names(offer)).toContain(LIST_RUN_CONFIGURATIONS);
  });

  it('keepsAToolViewsAgentToItsViewsTools_theQuestionAndTheSkills', async () => {
    // #964/#966. A tool view's agent gets its view's tools and nothing of Studio's at large: no
    // workbench, run-configuration or hosting tools, and no word of them in its instructions.
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({
        surface: 'monitor',
        workspaceRoot: null,
        skills: [
          {
            name: 'triage',
            description: 'How to triage logs.',
            load: (): Promise<null> => Promise.resolve(null),
          },
        ],
      }),
    );

    expect([...names(offer)].sort()).toEqual(
      [
        ASK_USER,
        LOAD_SKILL,
        LIST_LOG_SESSIONS,
        QUERY_LOGS,
        READ_SYSTEM_METRICS,
        SET_LOG_LEVEL,
      ].sort(),
    );
    expect(offer.systemPrompt).toContain('docked to the System Monitor');
    expect(offer.systemPrompt).toContain('- triage: How to triage logs.');
    expect(offer.systemPrompt).not.toContain(`"${OPEN_DOCUMENT}"`);
  });

  it('withholdsTheLogLevelFromAToolViewsChatTurn', async () => {
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor({ surface: 'monitor', mode: 'chat' }),
    );

    expect(names(offer)).toContain(QUERY_LOGS);
    expect(names(offer)).not.toContain(SET_LOG_LEVEL);
  });

  it('asksBeforeTheApiExplorerSendsARequest', async () => {
    // #965. Sending is a real call; until now only the prompt held the agent back.
    const requestPermission: ReturnType<typeof vi.fn> = vi.fn((): Promise<boolean> =>
      Promise.resolve(false),
    );
    const request: ReturnType<typeof vi.fn> = vi.fn((): Promise<unknown> =>
      Promise.resolve({ ok: true }),
    );
    const { invokeTool } = await import('./harness-tools');

    const outcome: { result: string | null } = await invokeTool(
      contextFor({ surface: 'api', requestPermission, bridge: { request } }),
      SEND_API_REQUEST,
      { id: 'r1' },
    );

    expect(requestPermission).toHaveBeenCalledWith(SEND_API_REQUEST, expect.any(String));
    expect(request).not.toHaveBeenCalled();
    expect(outcome.result).toBe('The user declined to run this tool.');
  });
});
