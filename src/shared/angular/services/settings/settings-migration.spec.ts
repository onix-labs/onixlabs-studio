import { restoreOverrides } from './settings-migration';
import { SettingsOverrides } from './settings';

/**
 * The marker every restored map carries once its stored context windows have been dealt with.
 */
const MARKED: Record<string, unknown> = { 'ai.connectionsFormat': 2 };

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
      ...MARKED,
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
      ...MARKED,
    });
  });

  it('legacyFlatTextEditor_mapsUnderTheGlobalPrefix', () => {
    const legacy: Record<string, unknown> = { textEditor: { fontSize: 14 } };

    expect(restoreOverrides(legacy)).toEqual({ 'textEditor.global.fontSize': 14, ...MARKED });
  });

  it('legacyProfileAwareTextEditor_keepsGlobalAndDropsTheRetiredProfiles', () => {
    const legacy: Record<string, unknown> = {
      textEditor: { global: { fontSize: 16 }, profiles: [{ id: 'x' }] },
    };

    expect(restoreOverrides(legacy)).toEqual({ 'textEditor.global.fontSize': 16, ...MARKED });
  });

  it('flatProfiles_areDroppedFromAnAlreadyFlatStore', () => {
    const flat: Record<string, unknown> = {
      'textEditor.global.fontSize': 16,
      'textEditor.profiles': [{ id: 'x' }],
    };

    expect(restoreOverrides(flat)).toEqual({ 'textEditor.global.fontSize': 16, ...MARKED });
  });

  it('oldProviderChoice_carriesForwardOntoTheActiveConnection', () => {
    const result: SettingsOverrides = restoreOverrides({ 'ai.provider': 'ollama' });

    expect(result['ai.activeConnectionId']).toBe('ollama');
  });

  it('oldProviderChoice_whenEmptyString_leavesTheActiveConnectionDefault', () => {
    const result: SettingsOverrides = restoreOverrides({ 'ai.provider': '' });

    expect('ai.activeConnectionId' in result).toBe(false);
  });

  it('oldPerProviderModels_whenEntriesAreNonString_areDropped', () => {
    const result: SettingsOverrides = restoreOverrides({
      'ai.models': { claude: 'claude-sonnet-4-6', bad: 42 },
    });

    expect(result['ai.connectionModels']).toEqual({ claude: 'claude-sonnet-4-6' });
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

  it('oldProviderAndModelKeys_areDroppedOnceTheyHaveBeenRead', () => {
    // A migration that copies forward but leaves the source behind never finishes. Before this, an
    // upgraded profile kept a dead `ai.provider` next to the `ai.activeConnectionId` that replaced it
    // — settings the user could not see, could not edit, and that decided nothing (#697).
    const result: SettingsOverrides = restoreOverrides({
      'ai.provider': 'ollama',
      'ai.models': { ollama: 'qwen3:8b' },
    });

    expect(result['ai.activeConnectionId']).toBe('ollama');
    expect(result['ai.connectionModels']).toEqual({ ollama: 'qwen3:8b' });
    expect('ai.provider' in result).toBe(false);
    expect('ai.models' in result).toBe(false);
  });

  it('oldProviderAndModelKeys_areDroppedEvenWhenTheReplacementsAlreadyExist', () => {
    const result: SettingsOverrides = restoreOverrides({
      'ai.provider': 'ollama',
      'ai.activeConnectionId': 'claude',
      'ai.models': { ollama: 'qwen3:8b' },
      'ai.connectionModels': { claude: 'claude-opus-4-8' },
    });

    expect('ai.provider' in result).toBe(false);
    expect('ai.models' in result).toBe(false);
  });

  it('noAiChoices_addNoConnectionKeys', () => {
    const result: SettingsOverrides = restoreOverrides({ 'application.undoStackSize': 50 });

    expect('ai.activeConnectionId' in result).toBe(false);
    expect('ai.connectionModels' in result).toBe(false);
  });

  it('storedContextWindows_areDroppedOnceWithEachModelCheck', () => {
    const result: SettingsOverrides = restoreOverrides({
      'ai.connections': [
        {
          id: 'claude',
          modelCheck: { at: 1, plugin: 'onixlabs.claude-harness@0.8.0', discovered: true },
          models: [
            { id: 'opus', label: 'Opus 5.5', contextWindow: 200_000, pinned: true },
            { id: 'my-model', label: 'my-model', manual: true },
          ],
        },
      ],
    });

    expect(result['ai.connections']).toEqual([
      {
        id: 'claude',
        models: [
          { id: 'opus', label: 'Opus 5.5', pinned: true },
          { id: 'my-model', label: 'my-model', manual: true },
        ],
      },
    ]);
    expect(result['ai.connectionsFormat']).toBe(2);
  });

  it('storedContextWindows_onceMarked_areKept', () => {
    const connections: unknown[] = [
      { id: 'codex', models: [{ id: 'gpt-5.5', label: 'GPT-5.5', contextWindow: 272_000 }] },
    ];

    const result: SettingsOverrides = restoreOverrides({
      'ai.connections': connections,
      ...MARKED,
    });

    expect(result['ai.connections']).toEqual(connections);
  });

  it('retiredRightRibbonAlignment_fallsBackToTheDefault', () => {
    expect(restoreOverrides({ 'appearance.ribbonAlignment': 'right' })).not.toHaveProperty(
      'appearance.ribbonAlignment',
    );
    expect(restoreOverrides({ 'appearance.ribbonAlignment': 'center' })).toMatchObject({
      'appearance.ribbonAlignment': 'center',
    });
  });

  it('retiredNotificationPosition_isDropped', () => {
    expect(restoreOverrides({ 'notifications.position': 'ribbon' })).not.toHaveProperty(
      'notifications.position',
    );
  });
});
