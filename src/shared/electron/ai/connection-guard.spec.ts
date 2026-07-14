import type { AiConnection } from '@shared/api/ai-types';
import { isConnection, sanitizeConnections } from './connection-guard';

/**
 * A well-formed connection used as the baseline for the guard tests.
 */
const VALID: AiConnection = {
  id: 'openai-1',
  kind: 'openai',
  label: 'OpenAI',
  auth: 'api-key',
  models: [{ id: 'gpt-4o', label: 'gpt-4o', contextWindow: 128_000 }],
  defaultModelId: 'gpt-4o',
};

describe('connection-guard', () => {
  describe('isConnection', () => {
    it('isConnection_whenWellFormed_isTrue', () => {
      expect(isConnection(VALID)).toBe(true);
    });

    it('isConnection_whenNotAnObject_isFalse', () => {
      expect(isConnection(null)).toBe(false);
      expect(isConnection('openai')).toBe(false);
      expect(isConnection(42)).toBe(false);
    });

    it('isConnection_whenAFieldIsMissingOrMistyped_isFalse', () => {
      const noId: Record<string, unknown> = { ...VALID };
      delete noId['id'];
      expect(isConnection(noId)).toBe(false);

      expect(isConnection({ ...VALID, kind: 7 })).toBe(false);
      expect(isConnection({ ...VALID, auth: null })).toBe(false);
      expect(isConnection({ ...VALID, models: 'gpt-4o' })).toBe(false);
      expect(isConnection({ ...VALID, defaultModelId: undefined })).toBe(false);
    });
  });

  describe('sanitizeConnections', () => {
    it('sanitizeConnections_whenNotAnArray_isEmpty', () => {
      expect(sanitizeConnections(undefined)).toEqual([]);
      expect(sanitizeConnections({ id: 'x' })).toEqual([]);
    });

    it('sanitizeConnections_whenMixed_keepsOnlyWellFormedEntries', () => {
      const second: AiConnection = { ...VALID, id: 'ollama-1', kind: 'ollama', auth: 'none' };
      const result: readonly AiConnection[] = sanitizeConnections([
        VALID,
        { id: 'broken' },
        null,
        second,
      ]);

      expect(result.map((connection: AiConnection): string => connection.id)).toEqual([
        'openai-1',
        'ollama-1',
      ]);
    });
  });
});
