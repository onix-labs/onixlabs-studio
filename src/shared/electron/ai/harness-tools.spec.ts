import { describe, expect, it, vi } from 'vitest';
import {
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
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SAVE_RUN_CONFIGURATIONS,
  ASK_USER,
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
});
