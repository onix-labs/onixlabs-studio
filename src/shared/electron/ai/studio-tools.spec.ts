import { describe, expect, it } from 'vitest';
import {
  CANCEL_EDIT_PREVIEW,
  COMMIT_EDIT_PREVIEW,
  CREATE_API_REQUEST,
  DELETE_BINARY_BYTES,
  DELETE_RUN_CONFIGURATIONS,
  EDIT_ACTIVE_DOCUMENT,
  EDIT_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  INSERT_BINARY_BYTES,
  LIST_API_REQUESTS,
  PATCH_BINARY_BYTES,
  PREVIEW_ACTIVE_DOCUMENT_EDIT,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  REPLACE_ACTIVE_DOCUMENT,
  REPLACE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SAVE_RUN_CONFIGURATIONS,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
  WRITE_BINARY_ASSEMBLY,
  type AiEvent,
  type AiInputChoice,
  type AiInputSelection,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import {
  RUN_DEFAULT_TIMEOUT_SECONDS,
  RUN_MAX_TIMEOUT_SECONDS,
  askUser,
  buildRunPrompt,
  createApiRequest,
  deleteBinaryBytes,
  deleteRunConfigurations,
  editActiveDocument,
  editDocument,
  formatAskUserAnswer,
  insertBinaryBytes,
  insertIntoActiveDocument,
  listApiRequests,
  listRunConfigurations,
  patchBinaryBytes,
  proposeWorkspace,
  readActiveDocument,
  readBinaryBytes,
  readBinaryDisassembly,
  readBinaryOverview,
  readBinarySelection,
  readDocument,
  readTerminalOutput,
  replaceActiveDocument,
  replaceDocument,
  runActiveDocument,
  saveRunConfigurations,
  sendApiRequest,
  setActiveDocumentLanguage,
  setApiVariable,
  updateApiRequest,
  writeBinaryAssembly,
  writeTerminalInput,
} from './studio-tools';

/**
 * One request the fake bridge received.
 */
interface BridgeCall {
  readonly capability: string;
  readonly input: unknown;
  readonly timeout?: number;
}

/**
 * Builds a run context whose bridge answers per capability, falling back to `fallback`, and records
 * what it was asked: the whole surface these handlers touch.
 * @param answers The result per capability.
 * @param overrides The context fields to set.
 * @param fallback The result of a capability with no answer of its own.
 * @returns Returns the context and the recorded calls.
 */
function contextOf(
  answers: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
  fallback: unknown = undefined,
): { context: AgentRunContext; calls: BridgeCall[] } {
  const calls: BridgeCall[] = [];
  const context: AgentRunContext = {
    owningTabId: 'tab-1',
    permissionPosture: 'auto-all',
    mode: 'agent',
    bridge: {
      request: (capability: string, input: unknown, timeout?: number): Promise<unknown> => {
        calls.push({ capability, input, ...(timeout === undefined ? {} : { timeout }) });
        return Promise.resolve(capability in answers ? answers[capability] : fallback);
      },
    },
    ...overrides,
  } as unknown as AgentRunContext;
  return { context, calls };
}

/**
 * Lists the capabilities a run asked for, in order.
 * @param calls The recorded calls.
 * @returns Returns the capability names.
 */
function asked(calls: readonly BridgeCall[]): string[] {
  return calls.map((call: BridgeCall): string => call.capability);
}

describe('studio tools', () => {
  describe('buildRunPrompt', () => {
    it('sendsThePromptAlone_withNothingAttached', () => {
      const prompt: string = buildRunPrompt({
        prompt: 'hello',
        contextPaths: [],
      } as unknown as AgentRunContext);

      expect(prompt).toBe('hello');
    });

    it('listsPathsAndInlinesSelections_beforeThePrompt', () => {
      const prompt: string = buildRunPrompt({
        prompt: 'explain',
        contextPaths: [
          { kind: 'file', path: '/ws/a.ts' },
          { kind: 'folder', path: '/ws/src' },
          { kind: 'selection', path: '/ws/b.ts:3', content: 'const x = 1;' },
        ],
      } as unknown as AgentRunContext);

      expect(prompt).toContain(' - /ws/a.ts (file)');
      expect(prompt).toContain(' - /ws/src (folder)');
      expect(prompt).toContain('(/ws/b.ts:3):\n"""\nconst x = 1;\n"""');
      expect(prompt.endsWith('\n\nexplain')).toBe(true);
    });

    it('dropsASelectionWithNoContent_ratherThanAttachingAnEmptyBlock', () => {
      const prompt: string = buildRunPrompt({
        prompt: 'explain',
        contextPaths: [
          { kind: 'selection', path: '/ws/empty.ts', content: '' },
          { kind: 'selection', path: '/ws/missing.ts' },
        ],
      } as unknown as AgentRunContext);

      expect(prompt).toBe('explain');
    });
  });

  describe('proposeWorkspace', () => {
    it('emitsTheCard_andTellsTheModelToStop', () => {
      const events: AiEvent[] = [];
      const context: AgentRunContext = {
        requestId: 'run-1',
        emit: (event: AiEvent): void => void events.push(event),
      } as unknown as AgentRunContext;

      const text: string = proposeWorkspace(context, { name: 'app', handoff: 'do it' });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        requestId: 'run-1',
        kind: 'workspace-proposal',
        name: 'app',
        handoff: 'do it',
      });
      expect(events[0]).not.toHaveProperty('summary');
      expect(text).toContain('Stop here');
    });

    it('carriesTheSummary_andAFreshIdPerProposal', () => {
      const events: { proposalId?: string; summary?: string }[] = [];
      const context: AgentRunContext = {
        requestId: 'run-1',
        emit: (event: { proposalId?: string; summary?: string }): void => void events.push(event),
      } as unknown as AgentRunContext;

      proposeWorkspace(context, { name: 'a', summary: 'short', handoff: 'h' });
      proposeWorkspace(context, { name: 'a', summary: 'short', handoff: 'h' });

      expect(events[0].summary).toBe('short');
      expect(events[0].proposalId).not.toBe(events[1].proposalId);
    });
  });

  describe('run configurations', () => {
    it('listRunConfigurations_saysWhenNoWorkspaceIsOpen_evenOnAnEmptyReply', async () => {
      expect(await listRunConfigurations(contextOf().context)).toContain('No workspace folder');
    });

    it('listRunConfigurations_saysWhenThereAreNone', async () => {
      const { context } = contextOf({}, {}, { available: true, root: '/ws' });

      expect(await listRunConfigurations(context)).toBe(
        'The workspace at /ws has no run configurations yet.',
      );
    });

    it('listRunConfigurations_rendersWhatSaveAccepts', async () => {
      const configurations: unknown[] = [{ id: 'api', name: 'API' }];
      const { context } = contextOf({}, {}, { available: true, configurations });

      const text: string = await listRunConfigurations(context);

      expect(text).toContain('the open root');
      expect(JSON.parse(text.slice(text.indexOf('[')))).toEqual(configurations);
    });

    it('saveRunConfigurations_reportsARefusal_ratherThanClaimingSuccess', async () => {
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, error: 'Duplicate id.' },
      );

      expect(await saveRunConfigurations(refused.context, [{}])).toBe('Duplicate id.');
      expect(await saveRunConfigurations(contextOf().context, [{}])).toContain(
        'could not be saved',
      );
    });

    it('saveRunConfigurations_namesWhatItSaved', async () => {
      const { context, calls } = contextOf({}, {}, { ok: true, ids: ['api', 'web'] });
      const configurations: unknown[] = [{ id: 'api' }, { id: 'web' }];

      const text: string = await saveRunConfigurations(context, configurations);

      expect(calls[0]).toEqual({
        capability: SAVE_RUN_CONFIGURATIONS,
        input: { configurations },
      });
      expect(text).toContain('Saved 2 run configuration(s): api, web.');
    });

    it('deleteRunConfigurations_namesWhatItDeleted_orSaysWhyNot', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true, ids: ['api'] },
      );
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, error: 'In use.' },
      );

      expect(await deleteRunConfigurations(done.context, ['api'])).toBe(
        'Deleted 1 run configuration(s): api.',
      );
      expect(done.calls[0]).toEqual({
        capability: DELETE_RUN_CONFIGURATIONS,
        input: { ids: ['api'] },
      });
      expect(await deleteRunConfigurations(refused.context, ['api'])).toBe('In use.');
      expect(await deleteRunConfigurations(contextOf().context, ['api'])).toContain(
        'could not be deleted',
      );
    });

    it('deleteRunConfigurations_sayingOkWithNoIds_reportsNothingDeleted', async () => {
      const { context } = contextOf({}, {}, { ok: true });

      expect(await deleteRunConfigurations(context, ['api'])).toBe(
        'Deleted 0 run configuration(s): .',
      );
    });
  });

  describe('askUser', () => {
    it('passesTheQuestionAndSelectionThrough_andRendersTheAnswer', async () => {
      const seen: unknown[][] = [];
      const context: AgentRunContext = {
        requestInput: (
          question: string,
          choices: readonly AiInputChoice[],
          cancel: AbortSignal | undefined,
          selection: AiInputSelection,
        ): Promise<string> => {
          seen.push([question, choices, cancel, selection]);
          return Promise.resolve('Blue');
        },
      } as unknown as AgentRunContext;
      const choices: readonly AiInputChoice[] = [{ label: 'Blue' }];

      const text: string = await askUser(context, 'Which?', choices, 'multiple');

      expect(seen).toEqual([['Which?', choices, undefined, 'multiple']]);
      expect(text).toBe('The user answered: Blue');
    });

    it('defaultsToOneOf', async () => {
      const selections: AiInputSelection[] = [];
      const context: AgentRunContext = {
        requestInput: (
          _question: string,
          _choices: readonly AiInputChoice[],
          _cancel: AbortSignal | undefined,
          selection: AiInputSelection,
        ): Promise<string> => {
          selections.push(selection);
          return Promise.resolve('x');
        },
      } as unknown as AgentRunContext;

      await askUser(context, 'Which?', []);

      expect(selections).toEqual(['single']);
    });

    it('aDeclinedQuestion_tellsTheModelToContinueConservatively', async () => {
      const context: AgentRunContext = {
        requestInput: (): Promise<null> => Promise.resolve(null),
      } as unknown as AgentRunContext;

      expect(await askUser(context, 'Which?', [])).toContain('declined');
    });

    it('formatAskUserAnswer_keepsAnEmptyAnswerDistinctFromDeclining', () => {
      expect(formatAskUserAnswer('')).toBe('The user answered: ');
      expect(formatAskUserAnswer(null)).toContain('declined');
    });
  });

  describe('terminal output', () => {
    it('readTerminalOutput_fallsBackToTheOwningTab', async () => {
      const { context, calls } = contextOf({}, {}, { available: true });

      expect(await readTerminalOutput(context)).toBe('');
      expect(calls[0].input).toEqual({ tabId: 'tab-1' });
    });

    it('readTerminalOutput_reportsWhyATerminalIsUnavailable', async () => {
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { available: false, error: 'Closed.' },
      );

      expect(await readTerminalOutput(refused.context)).toBe('Closed.');
      expect(await readTerminalOutput(contextOf().context)).toContain('not available');
    });

    it('writeTerminalInput_withNoBlockList_submitsByDefault', async () => {
      const { context, calls } = contextOf({}, {}, { ok: true });

      expect(await writeTerminalInput(context, 'gh pr list')).toBe('Sent to the terminal.');
      expect(calls[0].input).toEqual({ tabId: 'tab-1', text: 'gh pr list', submit: true });
    });

    it('writeTerminalInput_reportsAClosedTerminal', async () => {
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, error: 'Closed.' },
      );

      expect(await writeTerminalInput(refused.context, 'ls')).toBe('Closed.');
      expect(await writeTerminalInput(contextOf().context, 'ls')).toContain('not available');
    });

    it('writeTerminalInput_letsAnEmptyEnterThrough_whateverIsBlocked', async () => {
      const { context, calls } = contextOf({}, { blockedCommands: ['gh'] }, { ok: true });

      await writeTerminalInput(context, '\n', false);

      expect(calls).toHaveLength(1);
    });
  });

  describe('edits under a prompting posture', () => {
    const PREVIEW: Record<string, unknown> = {
      available: true,
      previewId: 'p-1',
      name: 'a.ts',
      summary: '+1 -1',
      diffShown: true,
    };

    /**
     * Builds a prompting agent run whose user answers as given.
     * @param decision The user's decision.
     * @param commit What committing the staged edit reports.
     * @returns Returns the context, the calls and the decisions asked for.
     */
    function prompting(
      decision: string,
      commit: unknown = { ok: true },
    ): { context: AgentRunContext; calls: BridgeCall[]; decisions: unknown[][] } {
      const decisions: unknown[][] = [];
      const built: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        { [PREVIEW_ACTIVE_DOCUMENT_EDIT]: PREVIEW, [COMMIT_EDIT_PREVIEW]: commit },
        {
          permissionPosture: 'prompt',
          requestEditDecision: (
            name: string,
            detail: string,
            hasDiff: boolean,
          ): Promise<string> => {
            decisions.push([name, detail, hasDiff]);
            return Promise.resolve(decision);
          },
        },
      );
      return { ...built, decisions };
    }

    it('nothingReachesTheDocumentBeforeTheUserDecides', async () => {
      const { context, calls, decisions } = prompting('yes');

      expect(await replaceActiveDocument(context, 'new')).toBe('The edit was applied.');

      expect(decisions).toEqual([['a.ts', '+1 -1', true]]);
      expect(asked(calls)).toEqual([PREVIEW_ACTIVE_DOCUMENT_EDIT, COMMIT_EDIT_PREVIEW]);
      expect(calls[0].input).toEqual({ operation: 'replace', text: 'new', tabId: 'tab-1' });
      expect(calls[1].input).toEqual({ previewId: 'p-1' });
    });

    it('aRejectedEdit_isDiscardedAndNeverCommitted', async () => {
      const { context, calls } = prompting('no');

      const text: string = await editActiveDocument(context, 'a', 'b');

      expect(text).toContain('rejected');
      expect(asked(calls)).toEqual([PREVIEW_ACTIVE_DOCUMENT_EDIT, CANCEL_EDIT_PREVIEW]);
      expect(calls[1].input).toEqual({ previewId: 'p-1' });
    });

    it('anAnchorFailure_reportsItsReason_andAsksTheUserNothing', async () => {
      const { context, calls, decisions } = prompting('yes');
      Object.assign(context, {
        bridge: {
          request: (capability: string, input: unknown): Promise<unknown> => {
            calls.push({ capability, input });
            return Promise.resolve({ available: false, detail: 'Matched twice.' });
          },
        },
      });

      expect(await editActiveDocument(context, 'a', 'b')).toBe('Matched twice.');
      expect(decisions).toEqual([]);
      expect(asked(calls)).toEqual([PREVIEW_ACTIVE_DOCUMENT_EDIT]);
    });

    it('aPreviewWithNoId_cannotBeCommitted', async () => {
      const { context, decisions } = prompting('yes');
      Object.assign(context, {
        bridge: {
          request: (): Promise<unknown> => Promise.resolve({ available: true }),
        },
      });

      expect(await replaceActiveDocument(context, 'x')).toContain('No active document');
      expect(decisions).toEqual([]);
    });

    it('aTabThatClosedBeforeTheCommit_saysTheEditDidNotLand', async () => {
      const { context } = prompting('yes', { ok: false });

      expect(await replaceActiveDocument(context, 'x')).toBe('The editor is no longer available.');
    });

    it('aCommitDetail_isPreferred', async () => {
      const { context } = prompting('yes', { ok: false, detail: 'Replaced 2 occurrences.' });

      expect(await editActiveDocument(context, 'a', 'b', true)).toBe('Replaced 2 occurrences.');
    });

    it('anInsert_previewsItsPlacementAndAnchor', async () => {
      const { context, calls } = prompting('yes');

      await insertIntoActiveDocument(context, 'x', 'before', 'anchor');

      expect(calls[0].input).toEqual({
        operation: 'insert',
        text: 'x',
        placement: 'before',
        anchor: 'anchor',
        tabId: 'tab-1',
      });
    });

    it('anInsertWithNoAnchor_doesNotInventOne', async () => {
      const { context, calls } = prompting('yes');

      await insertIntoActiveDocument(context, 'x', 'end');

      expect(calls[0].input).not.toHaveProperty('anchor');
    });

    it('aChatRun_neverStagesAPreview', async () => {
      const { context, calls } = contextOf(
        {},
        { permissionPosture: 'prompt', mode: 'chat' },
        { ok: true },
      );

      await replaceActiveDocument(context, 'x');

      expect(asked(calls)).toEqual([REPLACE_ACTIVE_DOCUMENT]);
    });
  });

  describe('edits applied directly', () => {
    it('replaceActiveDocument_reportsTheOutcome', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );

      expect(await replaceActiveDocument(done.context, 'x')).toContain('was updated');
      expect(done.calls[0]).toEqual({
        capability: REPLACE_ACTIVE_DOCUMENT,
        input: { text: 'x', tabId: 'tab-1' },
      });
      expect(await replaceActiveDocument(contextOf().context, 'x')).toContain('no active document');
    });

    it('editActiveDocument_reportsTheRendererDetail_orAFallback', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );
      const missed: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, detail: 'Not found.' },
      );

      expect(await editActiveDocument(done.context, 'a', 'b')).toBe('The edit was applied.');
      expect(done.calls[0]).toEqual({
        capability: EDIT_ACTIVE_DOCUMENT,
        input: { tabId: 'tab-1', oldString: 'a', newString: 'b', replaceAll: false },
      });
      expect(await editActiveDocument(missed.context, 'a', 'b')).toBe('Not found.');
      expect(await editActiveDocument(contextOf().context, 'a', 'b')).toContain(
        'no active document',
      );
    });

    it('insertIntoActiveDocument_reportsTheOutcome', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );

      expect(await insertIntoActiveDocument(done.context, 'x', 'end')).toContain('was inserted');
      expect(done.calls[0].capability).toBe(INSERT_ACTIVE_DOCUMENT);
      expect(await insertIntoActiveDocument(contextOf().context, 'x', 'end')).toContain(
        'no active document',
      );
    });

    it('auto-edits_appliesWithoutAPreview', async () => {
      const { context, calls } = contextOf({}, { permissionPosture: 'auto-edits' }, { ok: true });

      await editActiveDocument(context, 'a', 'b');

      expect(asked(calls)).toEqual([EDIT_ACTIVE_DOCUMENT]);
    });

    it('aBridgeFailure_propagates_ratherThanReportingSuccess', async () => {
      const context: AgentRunContext = {
        owningTabId: 't',
        permissionPosture: 'auto-all',
        mode: 'agent',
        bridge: {
          request: (): Promise<unknown> => Promise.reject(new Error('Window closed')),
        },
      } as unknown as AgentRunContext;

      await expect(replaceActiveDocument(context, 'x')).rejects.toThrow('Window closed');
    });
  });

  describe('reading and setting the document', () => {
    it('readActiveDocument_tellsNoDocumentFromAnEmptyOne', async () => {
      const empty: { context: AgentRunContext } = contextOf({}, {}, { available: true, text: '' });

      expect(await readActiveDocument(empty.context)).toBe('');
      expect(await readActiveDocument(contextOf().context)).toContain('No active document');
    });

    it('setActiveDocumentLanguage_reportsWhatHappened', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );
      const unknown: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, detail: 'Unknown language.' },
      );

      expect(await setActiveDocumentLanguage(done.context, 'csharp')).toContain('was set');
      expect(done.calls[0]).toEqual({
        capability: SET_ACTIVE_DOCUMENT_LANGUAGE,
        input: { tabId: 'tab-1', language: 'csharp' },
      });
      expect(await setActiveDocumentLanguage(unknown.context, 'x')).toBe('Unknown language.');
      expect(await setActiveDocumentLanguage(contextOf().context, 'x')).toContain('was not set');
    });
  });

  describe('runActiveDocument', () => {
    it.each([
      ['theDefault', undefined, RUN_DEFAULT_TIMEOUT_SECONDS],
      ['aFraction', 2.9, 2],
      ['belowOne', 0.5, RUN_DEFAULT_TIMEOUT_SECONDS],
      ['zero', 0, RUN_DEFAULT_TIMEOUT_SECONDS],
      ['negative', -5, 1],
      ['notANumber', Number.NaN, RUN_DEFAULT_TIMEOUT_SECONDS],
      ['aboveTheCeiling', 9999, RUN_MAX_TIMEOUT_SECONDS],
      ['infinite', Number.POSITIVE_INFINITY, RUN_MAX_TIMEOUT_SECONDS],
    ])('clampsTheTimeout_%s', async (_name: string, given: number | undefined, seconds: number) => {
      const { context, calls } = contextOf({}, {}, { ran: true });

      await runActiveDocument(context, given);

      expect(calls[0]).toEqual({
        capability: RUN_ACTIVE_DOCUMENT,
        input: { tabId: 'tab-1', timeoutSeconds: seconds },
        // The bridge must outlast the renderer's own poll, or the reply is cut off first.
        timeout: (seconds + 5) * 1000,
      });
    });

    it('saysWhyNothingRan', async () => {
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ran: false, detail: 'Unsupported language.' },
      );

      expect(await runActiveDocument(refused.context)).toBe('Unsupported language.');
      expect(await runActiveDocument(contextOf().context)).toContain('no code document');
    });

    it.each([
      ['success', { success: true, exitCode: 0 }, 'exited successfully (exit code 0)'],
      ['timeout', { timedOut: true }, 'did not finish within 7s and is still running'],
      ['failure', { exitCode: 2 }, 'failed (exit code 2)'],
      ['exitZeroWithoutSuccess', { exitCode: 0 }, 'failed (exit code 0)'],
      ['unknown', { exitCode: null }, 'finished with an unknown exit status'],
    ])('rendersTheOutcome_%s', async (_name: string, run: object, status: string) => {
      const { context } = contextOf({}, {}, { ran: true, command: 'node a.js', ...run });

      const text: string = await runActiveDocument(context, 7);

      expect(text).toContain('Ran: node a.js');
      expect(text).toContain(`Result: the program ${status}.`);
    });

    it('trimsTheOutput_andSaysWhenThereIsNone', async () => {
      const noisy: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ran: true, output: '\n  hi  \n' },
      );
      const silent: { context: AgentRunContext } = contextOf({}, {}, { ran: true, output: ' \n' });

      expect(await runActiveDocument(noisy.context)).toMatch(/Output:\nhi$/);
      expect(await runActiveDocument(silent.context)).toMatch(/Output:\n\(no output\)$/);
    });

    it('anUnnamedCommand_stillReads', async () => {
      expect(await runActiveDocument(contextOf({}, {}, { ran: true }).context)).toContain(
        'Ran: (unknown command)',
      );
    });
  });

  describe('binary tools', () => {
    it('reads_forwardTheRangeOnlyWhereThereIsOne', async () => {
      const { context, calls } = contextOf({}, {}, { available: true, text: 'dump' });

      expect(await readBinaryOverview(context)).toBe('dump');
      expect(await readBinarySelection(context)).toBe('dump');
      expect(await readBinaryBytes(context, 16, 32)).toBe('dump');
      expect(await readBinaryDisassembly(context, 0, 8)).toBe('dump');

      expect(calls).toEqual([
        { capability: READ_BINARY_OVERVIEW, input: { tabId: 'tab-1' } },
        { capability: READ_BINARY_SELECTION, input: { tabId: 'tab-1' } },
        { capability: READ_BINARY_BYTES, input: { tabId: 'tab-1', offset: 16, length: 32 } },
        { capability: READ_BINARY_DISASSEMBLY, input: { tabId: 'tab-1', offset: 0, length: 8 } },
      ]);
    });

    it('reads_sayWhenNoBinaryIsOpen', async () => {
      expect(await readBinaryOverview(contextOf().context)).toContain('No binary document');
    });

    it('reads_tellAnEmptyDumpFromNoDocument', async () => {
      expect(await readBinarySelection(contextOf({}, {}, { available: true }).context)).toBe('');
    });

    it.each([
      [
        'patch',
        PATCH_BINARY_BYTES,
        (context: AgentRunContext): Promise<string> => patchBinaryBytes(context, 4, '4d5a'),
        { offset: 4, bytes: '4d5a' },
        ['The bytes were patched.', 'The bytes were not patched.'],
      ],
      [
        'insert',
        INSERT_BINARY_BYTES,
        (context: AgentRunContext): Promise<string> => insertBinaryBytes(context, 4, '00'),
        { offset: 4, bytes: '00' },
        ['The bytes were inserted.', 'The bytes were not inserted.'],
      ],
      [
        'delete',
        DELETE_BINARY_BYTES,
        (context: AgentRunContext): Promise<string> => deleteBinaryBytes(context, 4, 2),
        { offset: 4, length: 2 },
        ['The bytes were deleted.', 'The bytes were not deleted.'],
      ],
      [
        'assemble',
        WRITE_BINARY_ASSEMBLY,
        (context: AgentRunContext): Promise<string> => writeBinaryAssembly(context, 4, 'ret'),
        { offset: 4, assembly: 'ret' },
        ['The assembly was written.', 'The assembly was not written.'],
      ],
    ])(
      'writes_%s_addressTheOwningDocumentAndReportTheOutcome',
      async (
        _name: string,
        capability: string,
        run: (context: AgentRunContext) => Promise<string>,
        input: object,
        phrases: string[],
      ) => {
        const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
          {},
          {},
          { ok: true },
        );
        const failed: { context: AgentRunContext } = contextOf(
          {},
          {},
          { ok: false, text: 'Offset past the end.' },
        );

        expect(await run(done.context)).toBe(phrases[0]);
        expect(done.calls[0]).toEqual({ capability, input: { tabId: 'tab-1', ...input } });
        expect(await run(contextOf().context)).toBe(phrases[1]);
        expect(await run(failed.context)).toBe('Offset past the end.');
      },
    );

    it('writeBinaryAssembly_passesTheReplacedLength_includingZero', async () => {
      const { context, calls } = contextOf({}, {}, { ok: true });

      await writeBinaryAssembly(context, 0, 'nop', 0);

      expect(calls[0].input).toMatchObject({ length: 0 });
    });
  });

  describe('api explorer tools', () => {
    it('listApiRequests_saysWhenNoTabIsOpen', async () => {
      expect(await listApiRequests(contextOf().context)).toContain('No API Explorer');
    });

    it('listApiRequests_rendersCollectionsAndEnvironments', async () => {
      const { context, calls } = contextOf(
        {},
        {},
        { available: true, collections: [{ id: 'c' }], environments: [{ name: 'dev' }] },
      );

      const text: string = await listApiRequests(context);

      expect(asked(calls)).toEqual([LIST_API_REQUESTS]);
      expect(text).toContain('"id": "c"');
      expect(text).toContain('"name": "dev"');
    });

    it('listApiRequests_withNothingYet_rendersEmptyLists', async () => {
      const text: string = await listApiRequests(contextOf({}, {}, { available: true }).context);

      expect(text).toBe('Collections:\n[]\n\nEnvironments:\n[]');
    });

    it('createApiRequest_reportsTheNewRequest_orTheRefusal', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true, id: 'r1', name: 'Get user' },
      );
      const refused: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, error: 'No tab.' },
      );
      const request: Record<string, unknown> = { method: 'GET' };

      expect(await createApiRequest(done.context, request)).toContain('"Get user" (id r1)');
      expect(done.calls[0]).toEqual({ capability: CREATE_API_REQUEST, input: { request } });
      expect(await createApiRequest(refused.context, request)).toBe('No tab.');
      expect(await createApiRequest(contextOf().context, request)).toContain(
        'could not be created',
      );
    });

    it('updateApiRequest_reportsTheOutcome', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );
      const changes: Record<string, unknown> = { url: 'x' };

      expect(await updateApiRequest(done.context, 'r1', changes)).toBe('Updated request r1.');
      expect(done.calls[0]).toEqual({
        capability: UPDATE_API_REQUEST,
        input: { id: 'r1', changes },
      });
      expect(await updateApiRequest(contextOf().context, 'r1', changes)).toContain(
        'could not be updated',
      );
    });

    it('sendApiRequest_rendersTheResponse_markingATruncatedBody', async () => {
      const { context } = contextOf(
        {},
        {},
        {
          ok: true,
          status: 200,
          statusText: 'OK',
          durationMs: 12.6,
          headers: { etag: 'x' },
          body: '{"a":1}',
          truncated: true,
        },
      );

      const text: string = await sendApiRequest(context, 'r1');

      expect(text).toContain('200 OK in 13 ms');
      expect(text).toContain('"etag": "x"');
      expect(text).toContain('Body (truncated):\n{"a":1}');
    });

    it('sendApiRequest_reportsAFailure_ratherThanAnEmptyResponse', async () => {
      const failed: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, error: 'ECONNREFUSED' },
      );

      expect(await sendApiRequest(failed.context, 'r1')).toBe('ECONNREFUSED');
      expect(await sendApiRequest(contextOf().context, 'r1')).toContain('could not be sent');
    });

    it('setApiVariable_namesTheEnvironment', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true, environment: 'dev' },
      );

      expect(await setApiVariable(done.context, 'host', 'x')).toBe(
        'Set {{host}} in the "dev" environment.',
      );
      expect(done.calls[0]).toEqual({
        capability: SET_API_VARIABLE,
        input: { name: 'host', value: 'x' },
      });
      expect(await setApiVariable(contextOf().context, 'host', 'x')).toContain('could not be set');
    });
  });

  describe('documents the agent opened', () => {
    it('readDocument_tellsAClosedDocumentFromAnEmptyOne', async () => {
      const closed: { context: AgentRunContext } = contextOf(
        {},
        {},
        { available: false, detail: 'It was closed.' },
      );
      const empty: { context: AgentRunContext } = contextOf({}, {}, { available: true });

      expect(await readDocument(closed.context, 'd1')).toBe('It was closed.');
      expect(await readDocument(empty.context, 'd1')).toBe('');
      expect(await readDocument(contextOf().context, 'd1')).toContain('could not be read');
    });

    it('editDocument_reportsTheOutcome', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );
      const missed: { context: AgentRunContext } = contextOf(
        {},
        {},
        { ok: false, detail: 'Not found.' },
      );

      expect(await editDocument(done.context, 'd1', 'a', 'b', true)).toContain('was applied');
      expect(done.calls[0]).toEqual({
        capability: EDIT_DOCUMENT,
        input: { id: 'd1', oldString: 'a', newString: 'b', replaceAll: true },
      });
      expect(await editDocument(missed.context, 'd1', 'a', 'b')).toBe('Not found.');
      expect(await editDocument(contextOf().context, 'd1', 'a', 'b')).toContain('was not applied');
    });

    it('replaceDocument_reportsTheOutcome', async () => {
      const done: { context: AgentRunContext; calls: BridgeCall[] } = contextOf(
        {},
        {},
        { ok: true },
      );

      expect(await replaceDocument(done.context, 'd1', 'x')).toContain('was updated');
      expect(done.calls[0]).toEqual({
        capability: REPLACE_DOCUMENT,
        input: { id: 'd1', text: 'x' },
      });
      expect(await replaceDocument(contextOf().context, 'd1', 'x')).toContain('was not updated');
    });
  });
});
