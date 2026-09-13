import { describe, expect, it } from 'vitest';
import { LIST_OPEN_DOCUMENTS, OPEN_DIFF, READ_SOURCE_CONTROL_STATUS } from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import { listOpenDocuments, openDiff, readSourceControlStatus } from './studio-tools';

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
