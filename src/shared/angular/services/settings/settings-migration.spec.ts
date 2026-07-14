import { restoreOverrides } from './settings-migration';
import { SettingsOverrides } from './settings';

describe('restoreOverrides', () => {
  it('nullOrNonObject_yieldsAnEmptyMap', () => {
    expect(restoreOverrides(null)).toEqual({});
    expect(restoreOverrides(42)).toEqual({});
    expect(restoreOverrides('legacy')).toEqual({});
  });

  it('flatDottedKeys_passThroughAsACopy', () => {
    const flat: Record<string, unknown> = {
      'application.undoStackSize': 50,
      'appearance.ribbonAlignment': 'left',
    };

    const result: SettingsOverrides = restoreOverrides(flat);

    expect(result).toEqual(flat);
    expect(result).not.toBe(flat);
  });

  it('legacyNestedSections_areFlattenedToDottedKeys', () => {
    const legacy: Record<string, unknown> = {
      application: { undoStackSize: 30 },
      appearance: { ribbonAlignment: 'left' },
    };

    expect(restoreOverrides(legacy)).toEqual({
      'application.undoStackSize': 30,
      'appearance.ribbonAlignment': 'left',
    });
  });

  it('legacyFlatTextEditor_mapsUnderTheGlobalPrefix', () => {
    const legacy: Record<string, unknown> = { textEditor: { fontSize: 14 } };

    expect(restoreOverrides(legacy)).toEqual({ 'textEditor.global.fontSize': 14 });
  });

  it('legacyProfileAwareTextEditor_splitsGlobalFromProfiles', () => {
    const legacy: Record<string, unknown> = {
      textEditor: { global: { fontSize: 16 }, profiles: [{ id: 'x' }] },
    };

    expect(restoreOverrides(legacy)).toEqual({
      'textEditor.global.fontSize': 16,
      'textEditor.profiles': [{ id: 'x' }],
    });
  });

  it('oldProviderChoice_carriesForwardOntoTheActiveConnection', () => {
    const result: SettingsOverrides = restoreOverrides({ 'ai.provider': 'ollama' });

    expect(result['ai.provider']).toBe('ollama');
    expect(result['ai.activeConnectionId']).toBe('ollama');
  });

  it('oldPerProviderModels_carryForwardOntoTheConnectionModels', () => {
    const models: Record<string, string> = { claude: 'claude-sonnet-4-6', ollama: 'qwen3:8b' };

    const result: SettingsOverrides = restoreOverrides({ 'ai.models': models });

    expect(result['ai.connectionModels']).toEqual(models);
    expect(result['ai.connectionModels']).not.toBe(models);
  });

  it('existingConnectionSelections_areNotOverwritten', () => {
    const result: SettingsOverrides = restoreOverrides({
      'ai.provider': 'ollama',
      'ai.activeConnectionId': 'claude',
      'ai.models': { ollama: 'qwen3:8b' },
      'ai.connectionModels': { claude: 'claude-opus-4-8' },
    });

    expect(result['ai.activeConnectionId']).toBe('claude');
    expect(result['ai.connectionModels']).toEqual({ claude: 'claude-opus-4-8' });
  });

  it('noAiChoices_addNoConnectionKeys', () => {
    const result: SettingsOverrides = restoreOverrides({ 'application.undoStackSize': 50 });

    expect('ai.activeConnectionId' in result).toBe(false);
    expect('ai.connectionModels' in result).toBe(false);
  });
});
