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
      'ai.provider': 'anthropic',
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
});
