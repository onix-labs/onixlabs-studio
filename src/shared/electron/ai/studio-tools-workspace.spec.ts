import { describe, expect, it } from 'vitest';
import {
  CREATE_FILE,
  LIST_OPEN_DOCUMENTS,
  LIST_TERMINALS,
  OPEN_DIFF,
  OPEN_TERMINAL,
  READ_SOURCE_CONTROL_STATUS,
  READ_TERMINAL_OUTPUT,
  RENAME_PATH,
  WRITE_TERMINAL_INPUT,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import {
  createFile,
  createFolder,
  deletePath,
  listOpenDocuments,
  listTerminals,
  openDiff,
  openTerminal,
  readSourceControlStatus,
  readTerminalOutput,
  renamePath,
  revealInExplorer,
  writeTerminalInput,
} from './studio-tools';

/**
 * Builds a run context whose bridge answers with a fixed result and records what it was asked.
 * @param result The result the bridge resolves with.
 * @returns Returns the context and the recorded calls.
 */
function contextWith(result: unknown): {
  context: AgentRunContext;
  calls: { capability: string; input: unknown }[];
} {
  const calls: { capability: string; input: unknown }[] = [];
  const context: AgentRunContext = {
    bridge: {
      request: (capability: string, input: unknown): Promise<unknown> => {
        calls.push({ capability, input });
        return Promise.resolve(result);
      },
    },
  } as unknown as AgentRunContext;
  return { context, calls };
}

describe('workspace studio tools', () => {
  describe('listOpenDocuments', () => {
    it('listsEachDocumentWithItsLanguageAndMarksTheActiveAndUnsavedOnes', async () => {
      const { context, calls } = contextWith({
        ok: true,
        root: '/ws',
        documents: [
          { path: '/ws/a.ts', name: 'a.ts', language: 'typescript', dirty: true, active: true },
          { path: null, name: 'Untitled', language: 'plaintext', dirty: false, active: false },
        ],
      });

      const text: string = await listOpenDocuments(context);

      expect(calls[0].capability).toBe(LIST_OPEN_DOCUMENTS);
      expect(text).toContain('of /ws');
      expect(text).toContain('- /ws/a.ts [typescript] (active, unsaved)');
      expect(text).toContain('- Untitled (not saved to disk) [plaintext]');
    });

    it('saysWhenTheWellIsEmpty', async () => {
      const { context } = contextWith({ ok: true, root: '/ws', documents: [] });

      expect(await listOpenDocuments(context)).toBe('No documents are open in the well.');
    });

    it('surfacesARefusalReason', async () => {
      const { context } = contextWith({ ok: false, error: 'No workspace is open.' });

      expect(await listOpenDocuments(context)).toBe('No workspace is open.');
    });
  });

  describe('openDiff', () => {
    it('passesThePathThroughAndConfirms', async () => {
      const { context, calls } = contextWith({ ok: true, path: '/ws/src/a.ts' });

      const text: string = await openDiff(context, 'src/a.ts');

      expect(calls[0]).toEqual({ capability: OPEN_DIFF, input: { path: 'src/a.ts' } });
      expect(text).toContain('/ws/src/a.ts');
      expect(text).toContain('against HEAD');
    });

    it('surfacesARefusalReasonRatherThanClaimingSuccess', async () => {
      const { context } = contextWith({
        ok: false,
        error: '"src/a.ts" has no changes against HEAD.',
      });

      expect(await openDiff(context, 'src/a.ts')).toContain('no changes');
    });
  });

  describe('openTerminal in the workspace', () => {
    it('asksForAWorkspaceTerminalAndTellsTheModelHowToDriveIt', async () => {
      const { context, calls } = contextWith({ ok: true, id: 'term-7', where: 'workspace' });

      const text: string = await openTerminal(context, true);

      expect(calls[0]).toEqual({ capability: OPEN_TERMINAL, input: { workspace: true } });
      expect(text).toContain('term-7');
      expect(text).toContain(READ_TERMINAL_OUTPUT);
    });
  });

  describe('listTerminals', () => {
    it('listsEachTerminalWithItsIdAndMarksTheSelectedOne', async () => {
      const { context, calls } = contextWith({
        ok: true,
        terminals: [
          { id: 'term-1', name: 'Terminal 1', active: false },
          { id: 'term-2', name: 'Build', active: true },
        ],
      });

      const text: string = await listTerminals(context);

      expect(calls[0].capability).toBe(LIST_TERMINALS);
      expect(text).toContain('- Terminal 1 (id term-1)');
      expect(text).toContain('- Build (id term-2) (selected)');
    });

    it('whenThereAreNone_pointsAtOpenTerminal', async () => {
      const { context } = contextWith({ ok: true, terminals: [] });

      expect(await listTerminals(context)).toContain(OPEN_TERMINAL);
    });
  });

  describe('terminal tools by id', () => {
    it('readTerminalOutput_addressesTheNamedTerminalRatherThanTheOwningTab', async () => {
      const { context, calls } = contextWith({ available: true, text: 'hello' });

      expect(await readTerminalOutput(context, 'term-3')).toBe('hello');
      expect(calls[0]).toEqual({ capability: READ_TERMINAL_OUTPUT, input: { tabId: 'term-3' } });
    });

    it('writeTerminalInput_addressesTheNamedTerminal', async () => {
      const { context, calls } = contextWith({ ok: true, output: 'done' });

      expect(await writeTerminalInput(context, 'ls', true, 'term-3')).toBe('done');
      expect(calls[0]).toEqual({
        capability: WRITE_TERMINAL_INPUT,
        input: { tabId: 'term-3', text: 'ls', submit: true },
      });
    });
  });

  describe('tree tools', () => {
    /**
     * Builds a context confined to a workspace, with the bridge answering as given.
     * @param result The bridge's answer.
     * @param overrides Confinement fields to set.
     * @returns Returns the context and calls.
     */
    function confined(
      result: unknown,
      overrides: Partial<Record<string, unknown>> = {},
    ): { context: AgentRunContext; calls: { capability: string; input: unknown }[] } {
      const built: { context: AgentRunContext; calls: { capability: string; input: unknown }[] } =
        contextWith(result);
      Object.assign(built.context, {
        workspaceRoot: '/ws',
        allowedWritePaths: [],
        deniedWritePaths: [],
        ...overrides,
      });
      return built;
    }

    it('createFile_passesThePathAndContentThroughAndConfirms', async () => {
      const { context, calls } = confined({ ok: true, path: '/ws/src/new.ts' });

      const text: string = await createFile(context, 'src/new.ts', 'export {};');

      expect(calls[0]).toEqual({
        capability: CREATE_FILE,
        input: { path: 'src/new.ts', content: 'export {};' },
      });
      expect(text).toContain('/ws/src/new.ts');
    });

    it('createFile_refusesAPathOutsideTheWorkspaceWithoutAskingTheRenderer', async () => {
      // ⛔ The confinement is a boundary, not a prompt (#307): the same rule a harness applies to its
      // own file tools, so a workspace tool cannot be a way around it.
      const { context, calls } = confined({ ok: true });

      const text: string = await createFile(context, '/etc/hosts');

      expect(text).toContain('Blocked');
      expect(calls).toEqual([]);
    });

    it('createFile_allowsAnAllowedWritePathAndRefusesADeniedOne', async () => {
      const { context, calls } = confined(
        { ok: true, path: '/elsewhere/a.txt' },
        { allowedWritePaths: ['/elsewhere'], deniedWritePaths: ['.git'] },
      );

      expect(await createFile(context, '/elsewhere/a.txt')).toContain('/elsewhere/a.txt');
      expect(await createFile(context, '.git/config')).toContain('denied');
      expect(calls).toHaveLength(1);
    });

    it('createFile_withNoWorkspace_saysSo', async () => {
      const { context } = confined({ ok: true }, { workspaceRoot: null });

      expect(await createFile(context, 'a.txt')).toContain('No workspace is open');
    });

    it('renamePath_passesTheNewNameThrough', async () => {
      const { context, calls } = confined({ ok: true, path: '/ws/b.ts' });

      expect(await renamePath(context, 'a.ts', 'b.ts')).toContain('/ws/b.ts');
      expect(calls[0]).toEqual({ capability: RENAME_PATH, input: { path: 'a.ts', name: 'b.ts' } });
    });

    it('deletePath_saysWhetherTheEntryWentToTheTrash', async () => {
      const trashed: { context: AgentRunContext } = confined({
        ok: true,
        path: '/ws/a.ts',
        trashed: true,
      });
      const removed: { context: AgentRunContext } = confined({
        ok: true,
        path: '/ws/a.ts',
        trashed: false,
      });

      expect(await deletePath(trashed.context, 'a.ts')).toContain('trash');
      expect(await deletePath(removed.context, 'a.ts')).toContain('permanently');
    });

    it('createFolder_andReveal_surfaceARefusalReason', async () => {
      const { context } = confined({ ok: false, error: 'Already exists.' });

      expect(await createFolder(context, 'src')).toBe('Already exists.');
      expect(await revealInExplorer(context, 'src')).toBe('Already exists.');
    });
  });

  describe('readSourceControlStatus', () => {
    it('reportsTheBranchTrackingAndEachChangeList', async () => {
      const { context, calls } = contextWith({
        ok: true,
        status: {
          root: '/ws',
          branch: 'main',
          upstream: 'origin/main',
          ahead: 2,
          behind: 1,
          staged: [{ path: 'a.ts', status: 'added' }],
          unstaged: [{ path: 'b.ts', status: 'modified' }],
          conflicted: [],
        },
      });

      const text: string = await readSourceControlStatus(context);

      expect(calls[0].capability).toBe(READ_SOURCE_CONTROL_STATUS);
      expect(text).toContain('Branch: main — tracking origin/main, 2 ahead, 1 behind');
      expect(text).toContain('Staged:\n- a.ts (added)');
      expect(text).toContain('Unstaged:\n- b.ts (modified)');
      expect(text).toContain('Conflicted: none');
    });

    it('saysDetachedAndNoUpstreamWhenThereIsNeither', async () => {
      const { context } = contextWith({
        ok: true,
        status: {
          root: '/ws',
          branch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          conflicted: [],
        },
      });

      const text: string = await readSourceControlStatus(context);

      expect(text).toContain('(detached HEAD) — no upstream');
    });

    it('saysWhenTheWorkspaceIsNotARepository', async () => {
      const { context } = contextWith({ ok: true, status: null });

      expect(await readSourceControlStatus(context)).toBe(
        'This workspace is not a git repository.',
      );
    });
  });
});
