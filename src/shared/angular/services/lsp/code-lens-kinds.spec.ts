import { describe, expect, it } from 'vitest';
import type { LspServerSettingValue } from '@shared/api/lsp-channels';
import {
  CodeLensKind,
  CodeLensServerSwitchChange,
  codeLensKind,
  codeLensServerSwitchChanges,
  CodeLensSwitches,
  isCodeLensServerSwitch,
  showsCodeLensKind,
} from './code-lens-kinds';

/**
 * Every switch on, as the defaults are.
 */
const ALL_ON: CodeLensSwitches = {
  codeLens: true,
  codeLensReferences: true,
  codeLensImplementations: true,
  codeLensTests: true,
  codeLensOther: true,
};

describe('codeLensKind (#1215)', () => {
  it.each<[string, string, CodeLensKind]>([
    ['roslyn.client.peekReferences', '3 references', 'references'],
    ['dotnet.test.run', 'Run All Tests', 'tests'],
    ['dotnet.test.run', 'Debug Test', 'tests'],
    ['java.show.references', '2 references', 'references'],
    ['java.show.implementations', '1 implementation', 'implementations'],
    ['gopls.run_tests', 'run test', 'tests'],
    ['gopls.generate', 'run go generate', 'other'],
    ['gopls.tidy', 'Run go mod tidy', 'other'],
    ['editor.action.showReferences', '4 references', 'references'],
    ['editor.action.showReferences', '1 implementation', 'implementations'],
    ['rust-analyzer.showReferences', '2 implementations', 'implementations'],
    ['rust-analyzer.runSingle', '▶︎ Run Test', 'tests'],
    ['rust-analyzer.runSingle', '▶︎ Run Doctest', 'tests'],
    ['rust-analyzer.runSingle', '▶︎ Run', 'other'],
    ['rust-analyzer.debugSingle', 'Debug', 'tests'],
    ['', '2 references', 'references'],
    ['jumpToSchema', 'package.json', 'other'],
  ])('%s titled %s is %s', (command: string, title: string, kind: CodeLensKind) => {
    expect(codeLensKind(command, title)).toBe(kind);
  });
});

describe('showsCodeLensKind (#1215)', () => {
  it('showsAKind_whenItAndTheMasterSwitchAreOn', () => {
    expect(showsCodeLensKind(ALL_ON, 'tests')).toBe(true);
    expect(showsCodeLensKind({ ...ALL_ON, codeLensTests: false }, 'tests')).toBe(false);
    expect(showsCodeLensKind({ ...ALL_ON, codeLensTests: false }, 'references')).toBe(true);
  });

  it('showsNothing_whenTheMasterSwitchIsOff', () => {
    for (const kind of ['references', 'implementations', 'tests', 'other'] as const) {
      expect(showsCodeLensKind({ ...ALL_ON, codeLens: false }, kind)).toBe(false);
    }
  });
});

describe('codeLensServerSwitchChanges (#1215)', () => {
  it('storesOnlyWhatDiffersFromEachServersDefault', () => {
    const stored: Map<string, LspServerSettingValue> = new Map<string, LspServerSettingValue>();

    const changes: CodeLensServerSwitchChange[] = codeLensServerSwitchChanges(
      (): CodeLensSwitches => ALL_ON,
      (serverId: string, section: string): LspServerSettingValue | undefined =>
        stored.get(`${serverId}|${section}`),
      new Set<string>(['csharp', 'typescript', 'go']),
    );

    // Roslyn shows both by default; TypeScript and gopls show theirs only when asked.
    expect(changes).toEqual([
      { serverId: 'typescript', section: 'typescript.referencesCodeLens.enabled', value: true },
      {
        serverId: 'typescript',
        section: 'typescript.implementationsCodeLens.enabled',
        value: true,
      },
      { serverId: 'typescript', section: 'javascript.referencesCodeLens.enabled', value: true },
      { serverId: 'go', section: 'gopls.codelenses.test', value: true },
    ]);
  });

  it('followsEachLanguagesOwnSwitches', () => {
    const changes: CodeLensServerSwitchChange[] = codeLensServerSwitchChanges(
      (language: string): CodeLensSwitches =>
        language === 'csharp' ? { ...ALL_ON, codeLensReferences: false } : ALL_ON,
      (): undefined => undefined,
      new Set<string>(['csharp']),
    );

    expect(changes).toEqual([
      {
        serverId: 'csharp',
        section: 'csharp|code_lens.dotnet_enable_references_code_lens',
        value: false,
      },
    ]);
  });

  it('clearsAStoredValue_backToTheServersDefault', () => {
    const changes: CodeLensServerSwitchChange[] = codeLensServerSwitchChanges(
      (): CodeLensSwitches => ALL_ON,
      (serverId: string, section: string): LspServerSettingValue | undefined =>
        section === 'csharp|code_lens.dotnet_enable_tests_code_lens' ? false : undefined,
      new Set<string>(['csharp']),
    );

    expect(changes).toEqual([
      {
        serverId: 'csharp',
        section: 'csharp|code_lens.dotnet_enable_tests_code_lens',
        value: null,
      },
    ]);
  });

  it('isNothing_onceInStep', () => {
    const changes: CodeLensServerSwitchChange[] = codeLensServerSwitchChanges(
      (): CodeLensSwitches => ({ ...ALL_ON, codeLens: false }),
      (serverId: string): LspServerSettingValue | undefined =>
        serverId === 'csharp' ? false : undefined,
      new Set<string>(['csharp']),
    );

    expect(changes).toEqual([]);
  });

  it('leavesAServerThatIsNotInstalledAlone', () => {
    expect(
      codeLensServerSwitchChanges(
        (): CodeLensSwitches => ALL_ON,
        (): undefined => undefined,
        new Set<string>(),
      ),
    ).toEqual([]);
  });
});

describe('isCodeLensServerSwitch (#1215)', () => {
  it('namesTheServersOwnSwitches_only', () => {
    expect(
      isCodeLensServerSwitch('csharp', 'csharp|code_lens.dotnet_enable_references_code_lens'),
    ).toBe(true);
    expect(isCodeLensServerSwitch('csharp', 'projects.dotnet_enable_automatic_restore')).toBe(
      false,
    );
    expect(isCodeLensServerSwitch('java', 'typescript.referencesCodeLens.enabled')).toBe(false);
  });
});
