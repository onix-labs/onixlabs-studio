import { describe, expect, it } from 'vitest';
import { OPEN_DOCUMENT, OPEN_TERMINAL, SAVE_DOCUMENT } from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import { openDocument, openTerminal, saveDocument } from './studio-tools';

/**
 * Builds a run context whose bridge answers with a fixed result and records what it was asked, which
 * is the whole surface these handlers touch.
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

describe('workbench studio tools', () => {
  describe('openDocument', () => {
    it('passesTheDocumentThroughToTheRendererCapability', async () => {
      const { context, calls } = contextWith({ ok: true, id: 'tab-3', title: 'Release notes' });

      await openDocument(context, 'markdown', 'Release notes', '# Done', undefined);

      expect(calls).toEqual([
        {
          capability: OPEN_DOCUMENT,
          input: {
            format: 'markdown',
            title: 'Release notes',
            content: '# Done',
            language: undefined,
          },
        },
      ]);
    });

    it('reportsTheIdSoTheModelCanSaveItLater', async () => {
      // The id is the only handle the model has on the document it just opened; losing it from the
      // tool result would make save_document unusable.
      const { context } = contextWith({ ok: true, id: 'tab-3', title: 'Release notes' });

      const text: string = await openDocument(context, 'markdown', 'Release notes', '# Done');

      expect(text).toContain('tab-3');
      expect(text).toContain('Release notes');
      expect(text).toContain('unsaved');
    });

    it('surfacesARefusalReasonRatherThanClaimingSuccess', async () => {
      const { context } = contextWith({ ok: false, error: 'Unknown document format "sheet".' });

      const text: string = await openDocument(context, 'sheet', 'x', 'y');

      expect(text).toBe('Unknown document format "sheet".');
    });
  });

  describe('saveDocument', () => {
    it('reportsTheSavedPath', async () => {
      const { context, calls } = contextWith({ ok: true, path: '/tmp/notes.md' });

      const text: string = await saveDocument(context, 'tab-3');

      expect(calls[0]).toEqual({ capability: SAVE_DOCUMENT, input: { id: 'tab-3' } });
      expect(text).toContain('/tmp/notes.md');
    });

    it('aDismissedDialog_readsAsADecisionRatherThanAFailure', async () => {
      // Told it merely "failed", a model retries and puts the dialog up again. It has to be able to
      // tell that the user was asked and answered.
      const { context } = contextWith({ ok: false, cancelled: true });

      const text: string = await saveDocument(context, 'tab-3');

      expect(text).toContain('without saving');
      expect(text).toContain('still open');
    });

    it('aRealFailure_reportsItsReason', async () => {
      const { context } = contextWith({ ok: false, error: 'No open document with id "tab-9".' });

      expect(await saveDocument(context, 'tab-9')).toBe('No open document with id "tab-9".');
    });
  });

  describe('openTerminal', () => {
    it('reportsTheOpenedTab', async () => {
      const { context, calls } = contextWith({ ok: true, id: 'tab-4' });

      const text: string = await openTerminal(context);

      expect(calls[0]).toEqual({ capability: OPEN_TERMINAL, input: {} });
      expect(text).toContain('tab-4');
    });
  });
});
