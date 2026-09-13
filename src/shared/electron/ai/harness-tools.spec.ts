import { describe, expect, it, vi } from 'vitest';
import {
  DELETE_RUN_CONFIGURATIONS,
  LIST_RUN_CONFIGURATIONS,
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
