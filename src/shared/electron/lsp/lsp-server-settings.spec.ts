import { describe, expect, it } from 'vitest';
import {
  answerConfiguration,
  changedSections,
  mergeOptions,
  parseServerSettings,
  pushedSettings,
  readOnlyAtStartup,
  serversWithChangedSettings,
  startupOptions,
  withDeclaredDefaults,
} from './lsp-server-settings';
import type { LspSettingsDelivery } from './language-server-descriptor';

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

  it('answersASectionThatHoldsSettings_withThoseSettingsNested (#1204)', () => {
    expect(
      answerConfiguration(
        { 'gopls.hints.parameterNames': true, 'gopls.ui.codelenses.test': false, other: 'x' },
        [{ section: 'gopls' }, { section: 'gopls.hints' }, { section: 'gop' }],
      ),
    ).toEqual([
      { hints: { parameterNames: true }, ui: { codelenses: { test: false } } },
      { parameterNames: true },
      null,
    ]);
  });

  it('neverAnswersFromAnObjectsPrototype', () => {
    expect(answerConfiguration({}, [{ section: 'constructor' }, { section: '__proto__' }])).toEqual(
      [null, null],
    );
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

describe('withDeclaredDefaults (#1145)', () => {
  const DECLARED: {
    section: string;
    label: string;
    description: string;
    default: boolean | string;
  }[] = [
    { section: 'hints.parameters', label: 'P', description: 'p', default: false },
    { section: 'restore', label: 'R', description: 'r', default: true },
  ];

  it('answersAClearedSettingWithItsDefault_notNull_soTurningItOffSticks', () => {
    expect(withDeclaredDefaults(DECLARED, undefined)).toEqual({
      'hints.parameters': false,
      restore: true,
    });
    expect(withDeclaredDefaults(DECLARED, { 'hints.parameters': true, other: 'x' })).toEqual({
      'hints.parameters': true,
      restore: true,
      other: 'x',
    });
  });

  it('leavesAServerThatDeclaresNothing_withTheUsersValuesAlone', () => {
    expect(withDeclaredDefaults(undefined, undefined)).toBeUndefined();
    expect(withDeclaredDefaults([], { a: true })).toEqual({ a: true });
  });
});

describe('settings delivery (#1204)', () => {
  /**
   * The values the TypeScript server's settings give, defaults included.
   */
  const TYPESCRIPT_VALUES: Record<string, boolean | string> = {
    'typescript.referencesCodeLens.enabled': true,
    'typescript.inlayHints.includeInlayParameterNameHints': 'all',
    'javascript.referencesCodeLens.enabled': false,
    'preferences.includeCompletionsForModuleExports': false,
  };

  /**
   * How the TypeScript server takes them: pushed, and its preferences at start-up.
   */
  const TYPESCRIPT: LspSettingsDelivery = {
    pull: false,
    push: ['typescript', 'javascript'],
    startup: { section: 'preferences', key: 'preferences' },
  };

  /**
   * How jdtls takes them: at start-up under `settings.java`, and pushed.
   */
  const JAVA: LspSettingsDelivery = {
    pull: false,
    push: ['java'],
    startup: { section: 'java', key: 'settings.java' },
  };

  it('pull_pushesNothing_andGivesNothingAtStartUp', () => {
    expect(pushedSettings(undefined, { 'csharp|code_lens.x': true })).toBeUndefined();
    expect(pushedSettings({ pull: true }, { a: true })).toBeUndefined();
    expect(startupOptions(undefined, { a: true })).toBeUndefined();
  });

  it('push_sendsTheSettingsUnderItsSections_nestedWithTheSectionKept', () => {
    expect(pushedSettings(TYPESCRIPT, TYPESCRIPT_VALUES)).toEqual({
      typescript: {
        referencesCodeLens: { enabled: true },
        inlayHints: { includeInlayParameterNameHints: 'all' },
      },
      javascript: { referencesCodeLens: { enabled: false } },
    });
    expect(pushedSettings({ push: ['java'] }, { 'java.signatureHelp.enabled': true })).toEqual({
      java: { signatureHelp: { enabled: true } },
    });
  });

  it('push_withNothingSet_stillSendsAnObject_soTheServerResetsToItsDefaults', () => {
    expect(pushedSettings(TYPESCRIPT, undefined)).toEqual({});
  });

  it('startup_givesTheSettingsUnderItsSection_withoutIt_atItsKey', () => {
    expect(startupOptions(TYPESCRIPT, TYPESCRIPT_VALUES)).toEqual({
      preferences: { includeCompletionsForModuleExports: false },
    });
    expect(
      startupOptions(JAVA, {
        'java.import.gradle.enabled': false,
        'java.referencesCodeLens.enabled': true,
      }),
    ).toEqual({
      settings: {
        java: { import: { gradle: { enabled: false } }, referencesCodeLens: { enabled: true } },
      },
    });
  });

  it('startup_withNoKey_mergesIntoTheRoot_andWithNothingUnderItsSection_givesNothing', () => {
    const rust: LspSettingsDelivery = { startup: { section: 'rust-analyzer' } };

    expect(startupOptions(rust, { 'rust-analyzer.checkOnSave': true })).toEqual({
      checkOnSave: true,
    });
    expect(startupOptions(rust, { other: true })).toBeUndefined();
    expect(startupOptions(rust, undefined)).toBeUndefined();
  });

  it('mixed_mergesStartUpOptionsWithTheDescriptorsOwn_whichWin', () => {
    expect(
      mergeOptions(
        { tsserver: { path: '/ts/tsserver.js' }, preferences: { quotePreference: 'single' } },
        { preferences: { includeCompletionsForModuleExports: false, quotePreference: 'double' } },
      ),
    ).toEqual({
      tsserver: { path: '/ts/tsserver.js' },
      preferences: { includeCompletionsForModuleExports: false, quotePreference: 'single' },
    });
    expect(mergeOptions(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(mergeOptions({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('aSettingIsReadOnlyAtStartUp_whenItSaysSo_orWhenNothingLiveReachesIt', () => {
    const setting: (
      section: string,
      startupOnly?: boolean,
    ) => {
      section: string;
      label: string;
      description: string;
      default: boolean;
      startupOnly?: boolean;
    } = (section: string, startupOnly?: boolean) => ({
      section,
      label: section,
      description: section,
      default: true,
      ...(startupOnly === undefined ? {} : { startupOnly }),
    });

    expect(readOnlyAtStartup(undefined, setting('csharp|x'))).toBe(false);
    expect(readOnlyAtStartup(JAVA, setting('java.referencesCodeLens.enabled'))).toBe(false);
    expect(readOnlyAtStartup(JAVA, setting('java.import.gradle.enabled', true))).toBe(true);
    // Not pushed, and the server never asks: it hears of the setting only as it starts.
    expect(readOnlyAtStartup(TYPESCRIPT, setting('preferences.quotePreference'))).toBe(true);
    expect(
      readOnlyAtStartup({ startup: { section: 'rust-analyzer' } }, setting('rust-analyzer.x')),
    ).toBe(false);
  });

  it('changedSections_namesOnlyTheSectionsThatDiffer', () => {
    expect(changedSections({ a: true, b: 'x' }, { a: false, b: 'x', c: true }).sort()).toEqual([
      'a',
      'c',
    ]);
    expect(changedSections(undefined, undefined)).toEqual([]);
  });
});
