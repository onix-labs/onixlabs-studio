import { describe, expect, it } from 'vitest';
import { OPEN_TERMINAL, type AgentSurface } from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import {
  describeRunError,
  describeStandingInstruction,
  promptForSurface,
  toolsForSurface,
} from './ai-sdk-stream';

/**
 * A tool as far as these specs use it: something that runs on arguments the model chose.
 */
interface RunnableTool {
  readonly execute?: (input: unknown, options: unknown) => Promise<string>;
}

/**
 * One audit record a run wrote.
 */
interface AuditRecord {
  readonly name: string;
  readonly detail: string;
  readonly source: string;
}

/**
 * What a fake run observed.
 */
interface Recorded {
  readonly context: AgentRunContext;
  readonly capabilities: string[];
  readonly prompted: string[];
  readonly audited: AuditRecord[];
}

/**
 * Every surface a run can stand on.
 */
const SURFACES: readonly AgentSurface[] = [
  'editor',
  'terminal',
  'binary',
  'api',
  'database',
  'workspace',
  'project',
  'monitor',
  'models',
  'plugins',
  'containers',
];

/**
 * Arguments wide enough for any tool: the executors take the schema's word for the shape, and each
 * reads only its own fields.
 */
const ANY_INPUT: Record<string, unknown> = {
  action: 'start',
  assembly: 'nop',
  bytes: '00',
  changes: {},
  choices: [],
  configurations: [],
  content: 'content',
  format: 'code',
  id: 'id-1',
  ids: ['id-1'],
  image: 'postgres:16',
  instructions: 'Be brief.',
  length: 1,
  level: 'info',
  name: 'name-1',
  newString: 'b',
  offset: 0,
  oldString: 'a',
  path: 'a.txt',
  placement: 'end',
  question: 'Which?',
  query: 'query',
  reference: 'postgres:16',
  repository: 'owner/repo',
  request: { method: 'GET' },
  terminalId: 'term-1',
  text: 'ls',
  title: 'Title',
  value: 'value',
};

/**
 * The tools a run prompts for: everything that spawns, spends, sends, deletes, changes the tree or
 * leaves a standing instruction behind. A new tool lands in this list or in {@link UNPROMPTED}.
 */
const PROMPTED: readonly string[] = [
  'create_file',
  'create_folder',
  'delete_binary_bytes',
  'delete_model',
  'delete_path',
  'delete_prompt_profile',
  'delete_run_configurations',
  'delete_skill',
  'download_model',
  'insert_binary_bytes',
  'open_terminal',
  'patch_binary_bytes',
  'pull_image',
  'remove_container',
  'remove_image',
  'remove_volume',
  'rename_path',
  'run_active_document',
  'run_container',
  'run_database_query',
  'save_prompt_profile',
  'save_run_configurations',
  'save_skill',
  'send_api_request',
  'set_log_level',
  'uninstall_plugin',
  'write_binary_assembly',
  'write_terminal_input',
];

/**
 * The tools that do not prompt: reads, display actions, and changes with a gate of their own (the
 * edit preview, the save dialog, the plugin's consent window) or that another action undoes.
 */
const UNPROMPTED: readonly string[] = [
  'ask_user',
  'control_container',
  'create_api_request',
  'create_database_query',
  'edit_active_document',
  'edit_document',
  'insert_into_active_document',
  'install_plugin',
  'list_api_requests',
  'list_container_images',
  'list_container_volumes',
  'list_containers',
  'list_database_connections',
  'list_database_objects',
  'list_database_queries',
  'list_local_models',
  'list_log_sessions',
  'list_open_documents',
  'list_plugins',
  'list_prompt_profiles',
  'list_run_configurations',
  'list_skill_tags',
  'list_skills',
  'list_terminals',
  'open_diff',
  'open_document',
  'open_file',
  'propose_workspace',
  'query_logs',
  'read_active_document',
  'read_binary_bytes',
  'read_binary_disassembly',
  'read_binary_overview',
  'read_binary_selection',
  'read_container_logs',
  'read_document',
  'read_machine_facts',
  'read_skill',
  'read_source_control_status',
  'read_system_metrics',
  'read_terminal_output',
  'read_workspace_languages',
  'replace_active_document',
  'replace_document',
  'reveal_in_explorer',
  'save_document',
  'script_database_object',
  'search_model_catalog',
  'set_active_document_language',
  'set_api_variable',
  'update_api_request',
  'update_database_query',
];

/**
 * What a chat-mode run may be offered on any surface: nothing here changes anything.
 */
const READ_ONLY: readonly string[] = UNPROMPTED.filter(
  (name: string): boolean =>
    /^(ask|list|query|read|script|search|open_diff|reveal)/.test(name) ||
    name === 'propose_workspace',
);

/**
 * Builds a run context over fakes, recording what the run reaches.
 * @param surface The surface.
 * @param overrides The context fields to set.
 * @returns Returns the context and what it recorded.
 */
function runOn(surface: AgentSurface, overrides: Record<string, unknown> = {}): Recorded {
  const capabilities: string[] = [];
  const prompted: string[] = [];
  const audited: AuditRecord[] = [];
  const context: AgentRunContext = {
    surface,
    mode: 'agent',
    permissionPosture: 'prompt',
    toolPolicies: {},
    owningTabId: 'tab-1',
    workspaceRoot: '/ws',
    allowedWritePaths: [],
    deniedWritePaths: [],
    blockedCommands: [],
    skills: [],
    systemPromptExtra: '',
    hosting: null,
    contextPaths: [],
    requestId: 'run-1',
    emit: (): void => undefined,
    requestPermission: (name: string): Promise<boolean> => {
      prompted.push(name);
      return Promise.resolve(false);
    },
    requestInput: (): Promise<null> => Promise.resolve(null),
    requestEditDecision: (): Promise<string> => Promise.resolve('no'),
    recordAudit: (name: string, detail: string, source: string): void => {
      audited.push({ name, detail, source });
    },
    bridge: {
      request: (capability: string): Promise<unknown> => {
        capabilities.push(capability);
        return Promise.resolve({});
      },
    },
    ...overrides,
  } as unknown as AgentRunContext;
  return { context, capabilities, prompted, audited };
}

/**
 * Runs a tool from a run's tool set, as the harness bridge does.
 * @param context The run context.
 * @param name The tool's name.
 * @returns Returns what the tool told the model.
 */
async function invoke(context: AgentRunContext, name: string): Promise<string> {
  const tools: Record<string, RunnableTool> = (await toolsForSurface(context)) as Record<
    string,
    RunnableTool
  >;
  const execute: RunnableTool['execute'] = tools[name].execute;
  if (execute === undefined) {
    throw new Error(`${name} cannot be run`);
  }
  return execute(ANY_INPUT, {});
}

/**
 * Lists the tools a run on a surface is offered.
 * @param surface The surface.
 * @param overrides The context fields to set.
 * @returns Returns the names.
 */
async function offered(
  surface: AgentSurface,
  overrides: Record<string, unknown> = {},
): Promise<string[]> {
  return Object.keys(await toolsForSurface(runOn(surface, overrides).context));
}

describe('ai sdk tools', () => {
  describe('the permission gate', () => {
    it.each(SURFACES)('promptsForExactlyTheToolsThatChangeThings_on_%s', async (surface) => {
      for (const name of await offered(surface)) {
        const run: Recorded = runOn(surface);

        await invoke(run.context, name);

        const expected: string[] = PROMPTED.includes(name) ? [name] : [];
        expect(UNPROMPTED.includes(name) || PROMPTED.includes(name), name).toBe(true);
        expect(run.prompted, `${surface}/${name}`).toEqual(expected);
      }
    });

    it.each(SURFACES)('aDeclinedPrompt_reachesNothing_on_%s', async (surface) => {
      for (const name of (await offered(surface)).filter((tool: string): boolean =>
        PROMPTED.includes(tool),
      )) {
        const run: Recorded = runOn(surface);

        const text: string = await invoke(run.context, name);

        expect(text, name).toBe('The user declined to run this tool.');
        expect(run.capabilities, name).not.toContain(name);
        expect(run.audited, name).toEqual([]);
      }
    });

    it.each(SURFACES)('aDenyPolicy_refusesWithoutAsking_on_%s', async (surface) => {
      const policies: Record<string, string> = Object.fromEntries(
        PROMPTED.map((name: string): [string, string] => [name, 'deny']),
      );
      for (const name of (await offered(surface)).filter((tool: string): boolean =>
        PROMPTED.includes(tool),
      )) {
        const run: Recorded = runOn(surface, {
          toolPolicies: policies,
          permissionPosture: 'auto-all',
        });

        expect(await invoke(run.context, name), name).toContain('set to Deny');
        expect(run.prompted, name).toEqual([]);
        expect(run.capabilities, name).not.toContain(name);
      }
    });

    it.each(SURFACES)('anAllowPolicy_runsUnasked_andIsAudited_on_%s', async (surface) => {
      const policies: Record<string, string> = Object.fromEntries(
        PROMPTED.map((name: string): [string, string] => [name, 'allow']),
      );
      for (const name of (await offered(surface)).filter((tool: string): boolean =>
        PROMPTED.includes(tool),
      )) {
        const run: Recorded = runOn(surface, { toolPolicies: policies });

        await invoke(run.context, name);

        expect(run.prompted, name).toEqual([]);
        expect(
          run.audited.map((record: AuditRecord): string => record.name),
          name,
        ).toEqual([name]);
      }
    });

    it('autoAll_runsWithoutAsking_andRecordsThePosture', async () => {
      const run: Recorded = runOn('terminal', { permissionPosture: 'auto-all' });

      await invoke(run.context, 'write_terminal_input');

      expect(run.prompted).toEqual([]);
      expect(run.capabilities).toContain('write_terminal_input');
      expect(run.audited).toHaveLength(1);
      expect(run.audited[0].detail.length).toBeGreaterThan(0);
    });

    it('aGrantedPrompt_runsTheTool_andIsAudited', async () => {
      const run: Recorded = runOn('terminal', {
        requestPermission: (): Promise<boolean> => Promise.resolve(true),
      });

      await invoke(run.context, 'write_terminal_input');

      expect(run.capabilities).toContain('write_terminal_input');
      expect(run.audited).toHaveLength(1);
    });

    it('aDatabaseRun_showsTheQueryOnThePrompt_beforeAnythingRuns', async () => {
      const details: string[] = [];
      const capabilities: string[] = [];
      const run: Recorded = runOn('database', {
        requestPermission: (_name: string, detail: string): Promise<boolean> => {
          details.push(detail);
          return Promise.resolve(false);
        },
        bridge: {
          request: (capability: string): Promise<unknown> => {
            capabilities.push(capability);
            return Promise.resolve({ ok: true, query: { name: 'Users', text: 'select 1' } });
          },
        },
      });

      await invoke(run.context, 'run_database_query');

      expect(details).toHaveLength(1);
      expect(capabilities).not.toContain('run_database_query');
    });

    it('aMountOutsideTheWriteArea_isRefusedBeforeTheUserIsAsked', async () => {
      const run: Recorded = runOn('containers');
      const tools: Record<string, RunnableTool> = (await toolsForSurface(run.context)) as Record<
        string,
        RunnableTool
      >;

      const text: string | undefined = await tools['run_container'].execute?.(
        { image: 'x', volumes: [{ source: '/etc', target: '/data' }] },
        {},
      );

      expect(text).toContain('/etc');
      expect(run.prompted).toEqual([]);
      expect(run.capabilities).toEqual([]);
    });
  });

  describe('chat mode', () => {
    it.each(SURFACES)('offersNothingThatChangesAnything_on_%s', async (surface) => {
      const tools: string[] = await offered(surface, { mode: 'chat' });

      expect(tools.filter((name: string): boolean => !READ_ONLY.includes(name))).toEqual([]);
      expect(tools).toContain('ask_user');
    });
  });

  describe('which tools a surface carries', () => {
    it('aToolView_holdsItsOwnToolsAndNoneOfStudiosAtLarge', async () => {
      const tools: string[] = await offered('monitor');

      expect(tools).toContain('query_logs');
      expect(tools).not.toContain('open_document');
      expect(tools).not.toContain('save_run_configurations');
    });

    it('theWorkspaceSurface_opensATerminalInItsOwnPanel', async () => {
      const inputs: unknown[] = [];
      const run: Recorded = runOn('workspace', {
        permissionPosture: 'auto-all',
        bridge: {
          request: (_capability: string, input: unknown): Promise<unknown> => {
            inputs.push(input);
            return Promise.resolve({ ok: true, id: 't', where: 'workspace' });
          },
        },
      });

      await invoke(run.context, OPEN_TERMINAL);

      expect(inputs).toEqual([{ workspace: true }]);
    });

    it('otherSurfaces_openATerminalAsATab', async () => {
      const inputs: unknown[] = [];
      const run: Recorded = runOn('editor', {
        permissionPosture: 'auto-all',
        bridge: {
          request: (_capability: string, input: unknown): Promise<unknown> => {
            inputs.push(input);
            return Promise.resolve({ ok: true, id: 't' });
          },
        },
      });

      await invoke(run.context, OPEN_TERMINAL);

      expect(inputs).toEqual([{ workspace: false }]);
    });

    it('aToolViewsTools_runAgainstTheirOwnSurface_inAutoAll', async () => {
      for (const surface of ['monitor', 'models', 'plugins', 'containers'] as const) {
        for (const name of await offered(surface)) {
          const run: Recorded = runOn(surface, { permissionPosture: 'auto-all' });

          await expect(invoke(run.context, name), name).resolves.toEqual(expect.any(String));
        }
      }
    });

    it('everyOtherSurfacesTools_runInAutoAll', async () => {
      for (const surface of [
        'editor',
        'terminal',
        'binary',
        'api',
        'database',
        'workspace',
      ] as const) {
        for (const name of await offered(surface)) {
          const run: Recorded = runOn(surface, { permissionPosture: 'auto-all' });

          await expect(invoke(run.context, name), name).resolves.toEqual(expect.any(String));
        }
      }
    });
  });

  describe('promptForSurface', () => {
    it.each([
      ['terminal', 'docked to a single terminal'],
      ['binary', 'single open binary file'],
      ['api', 'docked to an API Explorer'],
      ['workspace', 'docked to a workspace tab'],
      ['project', 'standalone agent'],
      ['editor', 'docked to a specific editor tab'],
    ] as const)('saysWhereTheRunStands_on_%s', (surface: AgentSurface, phrase: string) => {
      expect(promptForSurface(runOn(surface).context)).toContain(phrase);
    });

    it.each(SURFACES)('neverDescribesAMissingTool_inChatMode_on_%s', (surface) => {
      const prompt: string = promptForSurface(runOn(surface, { mode: 'chat' }).context);

      expect(prompt).toContain('read-only chat mode');
      expect(prompt).not.toContain('"open_document"');
      expect(prompt).not.toContain('save_run_configurations');
    });

    it('describesTheRunConfigurationTools_onlyWhereTheyAreOffered', () => {
      expect(promptForSurface(runOn('editor').context)).toContain('save_run_configurations');
      expect(promptForSurface(runOn('terminal').context)).not.toContain('save_run_configurations');
    });

    it('aToolView_isToldOnlyAboutItsOwnTools', () => {
      const prompt: string = promptForSurface(runOn('containers').context);

      expect(prompt).not.toContain('"open_document"');
    });

    it('aModelWithItsOwnQuestionTool_isNotSteeredToOurs', () => {
      const prompt: string = promptForSurface(runOn('editor').context, { nativeAsk: true });

      expect(prompt).toContain('clarifying question');
      expect(prompt).not.toContain('"ask_user"');
    });

    it('theUsersStandingText_comesLast_onEverySurfaceKind', () => {
      for (const surface of ['editor', 'monitor'] as const) {
        const prompt: string = promptForSurface(
          runOn(surface, { systemPromptExtra: 'Answer in French.' }).context,
        );

        expect(prompt.trimEnd().endsWith('Answer in French.')).toBe(true);
      }
    });

    it('listsSkills_inAChatToolView', () => {
      const prompt: string = promptForSurface(
        runOn('monitor', {
          mode: 'chat',
          skills: [{ name: 'review', description: 'Reviews code.' }],
        }).context,
      );

      expect(prompt).toContain('review');
      expect(prompt).toContain('read-only chat mode');
    });
  });

  describe('describeRunError', () => {
    it.each([
      ['aString', 'boom', 'boom'],
      ['anError', new Error('bang'), 'bang'],
      ['aPlainObject', { message: 'pow' }, 'pow'],
      ['anEmptyString', '', 'The run failed with an unspecified error.'],
      ['anEmptyError', new Error(''), 'The run failed with an unspecified error.'],
      ['aNonStringMessage', { message: 42 }, 'The run failed with an unspecified error.'],
      ['null', null, 'The run failed with an unspecified error.'],
      ['undefined', undefined, 'The run failed with an unspecified error.'],
      ['aNumber', 7, 'The run failed with an unspecified error.'],
    ])('rendersSomethingDisplayable_from_%s', (_name: string, error: unknown, text: string) => {
      expect(describeRunError(error)).toBe(text);
    });
  });

  describe('describeStandingInstruction', () => {
    it('namesTheEntry_andQuotesTheFirstLine', () => {
      expect(
        describeStandingInstruction({ name: 'Terse', instructions: '  Be brief.\nAlways.' }),
      ).toBe('Terse: "Be brief."');
    });

    it('fallsBackToTheId_thenToUnnamed', () => {
      expect(describeStandingInstruction({ name: '', id: 'p1' })).toBe('p1');
      expect(describeStandingInstruction({})).toBe('unnamed');
    });

    it('capsALongLine_soTheCardStaysACard', () => {
      const text: string = describeStandingInstruction({
        name: 'n',
        instructions: 'x'.repeat(500),
      });

      expect(text).toBe(`n: "${'x'.repeat(79)}…"`);
    });

    it('ignoresInstructionsThatAreNotText', () => {
      expect(describeStandingInstruction({ name: 'n', instructions: 7 })).toBe('n');
    });
  });
});
