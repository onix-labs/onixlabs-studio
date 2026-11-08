import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LspServerSettingValue, LspServerSummary } from '@shared/api/lsp-channels';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Settings } from '@shared/angular/services/settings/settings';
import { CODE_LENS_ADOPTED_KEY, CodeLensServerSync } from './code-lens-server-sync';

/**
 * A stand-in for the language-server settings: stored values in memory, and when they have loaded.
 */
class FakeLspSettings {
  public readonly values: WritableSignal<Record<string, Record<string, LspServerSettingValue>>> =
    signal<Record<string, Record<string, LspServerSettingValue>>>({});
  public readonly settingsLoaded: WritableSignal<boolean> = signal<boolean>(true);
  public readonly catalogueLoaded: WritableSignal<boolean> = signal<boolean>(true);
  public readonly catalogue: WritableSignal<readonly LspServerSummary[]> = signal<
    readonly LspServerSummary[]
  >([{ id: 'csharp' } as LspServerSummary, { id: 'go' } as LspServerSummary]);
  public readonly settings: WritableSignal<Record<string, Record<string, LspServerSettingValue>>> =
    this.values;
  public writes: number = 0;

  public serverSetting(serverId: string, section: string): LspServerSettingValue | undefined {
    return this.values()[serverId]?.[section];
  }

  public setServerSettings(
    changes: readonly { serverId: string; section: string; value: LspServerSettingValue | null }[],
  ): Promise<void> {
    this.writes++;
    const next: Record<string, Record<string, LspServerSettingValue>> = structuredClone(
      this.values(),
    );
    for (const { serverId, section, value } of changes) {
      next[serverId] ??= {};
      if (value === null) {
        delete next[serverId][section];
      } else {
        next[serverId][section] = value;
      }
    }
    this.values.set(next);
    return Promise.resolve();
  }
}

describe('CodeLensServerSync (#1215)', () => {
  let lsp: FakeLspSettings;

  /**
   * Starts the service, letting its effect run.
   */
  function start(): void {
    TestBed.inject(CodeLensServerSync);
    TestBed.tick();
  }

  beforeEach(() => {
    // The code settings persist through storage too, so each test starts from the defaults.
    localStorage.clear();
    lsp = new FakeLspSettings();
    TestBed.configureTestingModule({
      providers: [{ provide: LspSettings, useValue: lsp as unknown as LspSettings }],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('answersTheServersSwitchesFromTheCodeLensSettings', () => {
    start();

    // gopls shows no test lens unless asked; Roslyn shows its own by default, so nothing is stored.
    expect(lsp.values()).toEqual({ go: { 'gopls.codelenses.test': true } });
  });

  it('followsAChange_toTheSwitches', () => {
    start();

    TestBed.inject(Settings).updateTextEditorSettings({ codeLensTests: false });
    TestBed.tick();

    expect(lsp.values()).toEqual({
      csharp: { 'csharp|code_lens.dotnet_enable_tests_code_lens': false },
      go: {},
    });
  });

  it('waitsForTheStoredValues_beforeWritingAny', () => {
    lsp.settingsLoaded.set(false);
    start();

    expect(lsp.writes).toBe(0);
  });

  it('carriesCsharpsReferenceCountsOver_asACsharpOverride_once', () => {
    lsp.values.set({ csharp: { 'csharp|code_lens.dotnet_enable_references_code_lens': false } });
    start();
    const settings: Settings = TestBed.inject(Settings);

    expect(settings.languageOverrides()['csharp']?.codeLensReferences).toBe(false);
    expect(settings.resolveSettingsForLanguage('typescript').codeLensReferences).toBe(true);
    expect(lsp.serverSetting('csharp', 'csharp|code_lens.dotnet_enable_references_code_lens')).toBe(
      false,
    );
    expect(localStorage.getItem(CODE_LENS_ADOPTED_KEY)).toBe('true');
  });

  it('doesNotCarryAValueOver_afterTheFirstTime', () => {
    localStorage.setItem(CODE_LENS_ADOPTED_KEY, 'true');
    lsp.values.set({ csharp: { 'csharp|code_lens.dotnet_enable_references_code_lens': false } });
    start();

    expect(TestBed.inject(Settings).languageOverrides()['csharp']?.codeLensReferences).toBe(
      undefined,
    );
    expect(lsp.serverSetting('csharp', 'csharp|code_lens.dotnet_enable_references_code_lens')).toBe(
      undefined,
    );
  });
});
