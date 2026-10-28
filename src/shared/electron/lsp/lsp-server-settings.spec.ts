import { describe, expect, it } from 'vitest';
import {
  answerConfiguration,
  parseServerSettings,
  serversWithChangedSettings,
} from './lsp-server-settings';

describe('parseServerSettings (#1143)', () => {
  it('keepsSwitchesAndChoicesPerServer_andDropsAServerWithNone', () => {
    expect(
      parseServerSettings({
        csharp: {
          'projects.dotnet_enable_automatic_restore': false,
          'some.choice': 'fullSolution',
        },
        typescript: {},
      }),
    ).toEqual({
      csharp: { 'projects.dotnet_enable_automatic_restore': false, 'some.choice': 'fullSolution' },
    });
  });

  it('treatsAStoreWrittenBeforeServersDeclaredSettings_asNoValues', () => {
    expect(parseServerSettings(undefined)).toEqual({});
  });

  it('refusesMalformedValuesRatherThanRepairingThem', () => {
    expect(parseServerSettings([])).toBeNull();
    expect(parseServerSettings({ csharp: 'yes' })).toBeNull();
    expect(parseServerSettings({ csharp: { a: 1 } })).toBeNull();
    expect(parseServerSettings({ csharp: { a: null } })).toBeNull();
  });
});

describe('answerConfiguration (#1143)', () => {
  it('answersEachItemWithTheUsersValue_orNullForTheServersDefault', () => {
    expect(
      answerConfiguration({ 'projects.dotnet_enable_automatic_restore': false }, [
        { section: 'projects.dotnet_enable_automatic_restore' },
        { section: 'csharp|inlay_hints.csharp_enable_inlay_hints_for_types' },
        { scopeUri: 'file:///x' },
        null,
      ]),
    ).toEqual([false, null, null, null]);
  });

  it('answersNullForEveryItem_whenTheUserSetNothing', () => {
    expect(answerConfiguration(undefined, [{ section: 'a' }, { section: 'b' }])).toEqual([
      null,
      null,
    ]);
    expect(answerConfiguration(undefined, undefined)).toEqual([]);
  });
});

describe('serversWithChangedSettings (#1143)', () => {
  it('namesOnlyTheServersWhoseValuesDiffer', () => {
    expect(
      serversWithChangedSettings(
        { csharp: { a: true }, go: { b: 'x' }, rust: { c: true } },
        { csharp: { a: false }, go: { b: 'x' }, java: { d: true } },
      ).sort(),
    ).toEqual(['csharp', 'java', 'rust']);
  });
});
