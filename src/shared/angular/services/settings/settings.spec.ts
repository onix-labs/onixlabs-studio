import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AiConnection } from '@shared/api/ai-types';
import { EditorProfile, Settings, TextEditorSettings } from './settings';

/**
 * Builds a minimal user connection for the connection-management tests.
 * @param id The connection id.
 * @returns Returns a connection.
 */
function connection(id: string): AiConnection {
  return {
    id,
    kind: 'openai',
    label: id,
    auth: 'api-key',
    models: [{ id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000 }],
    defaultModelId: 'gpt-4o',
  };
}

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(Settings)).toBeTruthy();
  });

  it('set_whenCalled_updatesTheSignal', () => {
    const service: Settings = TestBed.inject(Settings);

    service.set('application.printMargin', 'wide');

    expect(service.get('application.printMargin')).toBe('wide');
  });

  it('setUndoStackSize_whenCalled_updatesTheSignal', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setUndoStackSize(200);

    expect(service.undoStackSize()).toBe(200);
  });

  it('updateTextEditorSettings_whenCalled_updatesGlobalSettings', () => {
    const service: Settings = TestBed.inject(Settings);

    service.updateTextEditorSettings({ wordWrap: true, fontSize: 18 });

    expect(service.globalTextEditor().wordWrap).toBe(true);
    expect(service.globalTextEditor().fontSize).toBe(18);
  });

  it('createProfile_whenCalled_addsProfileWithGeneratedId', () => {
    const service: Settings = TestBed.inject(Settings);

    const profile: EditorProfile = service.createProfile('TS', ['typescript'], { wordWrap: true });

    expect(service.profiles()).toContain(profile);
    expect(profile.id).toBeTruthy();
  });

  it('updateProfile_whenCalled_appliesUpdates', () => {
    const service: Settings = TestBed.inject(Settings);
    const profile: EditorProfile = service.createProfile('TS', ['typescript']);

    service.updateProfile(profile.id, { name: 'TypeScript' });

    expect(service.profiles()[0]?.name).toBe('TypeScript');
  });

  it('deleteProfile_whenCalled_removesProfile', () => {
    const service: Settings = TestBed.inject(Settings);
    const profile: EditorProfile = service.createProfile('TS', ['typescript']);

    service.deleteProfile(profile.id);

    expect(service.profiles()).toHaveLength(0);
  });

  it('resolveSettingsForLanguage_whenProfileMatches_mergesOverGlobal', () => {
    const service: Settings = TestBed.inject(Settings);
    service.updateTextEditorSettings({ wordWrap: false, fontSize: 14 });
    service.createProfile('TS', ['typescript'], { wordWrap: true });

    const resolved: TextEditorSettings = service.resolveSettingsForLanguage('typescript');

    expect(resolved.wordWrap).toBe(true);
    expect(resolved.fontSize).toBe(14);
  });

  it('resolveSettingsForLanguage_whenNoProfileMatches_returnsGlobal', () => {
    const service: Settings = TestBed.inject(Settings);

    const resolved: TextEditorSettings = service.resolveSettingsForLanguage('python');

    expect(resolved).toEqual(service.globalTextEditor());
  });

  it('settings_whenChanged_persistsChangedKeyToTheStore', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setUndoStackSize(200);
    TestBed.inject(ApplicationRef).tick();

    // Persistence is a sparse, flat map keyed by the registry setting keys: only changed keys are
    // stored, and each falls back to its registry default when absent.
    const stored: Record<string, unknown> = JSON.parse(
      localStorage.getItem('settings') ?? '{}',
    ) as Record<string, unknown>;
    expect(stored['application.undoStackSize']).toBe(200);
  });

  it('settings_whenPersistedValuesExist_areRestoredOnCreation', () => {
    localStorage.setItem('settings', JSON.stringify({ application: { undoStackSize: 250 } }));

    expect(TestBed.inject(Settings).undoStackSize()).toBe(250);
  });

  it('settings_whenLegacyTextEditorFormatPersisted_migratesToProfileAware', () => {
    localStorage.setItem('settings', JSON.stringify({ textEditor: { wordWrap: true } }));

    const service: Settings = TestBed.inject(Settings);

    expect(service.globalTextEditor().wordWrap).toBe(true);
    expect(service.globalTextEditor().showLineNumbers).toBe(true);
    expect(service.profiles()).toHaveLength(0);
  });

  it('ai_whenDefaulted_usesClaudeConnectionPromptAndNoCap', () => {
    const service: Settings = TestBed.inject(Settings);

    expect(service.aiActiveConnectionId()).toBe('claude');
    expect(service.aiPermissionPosture()).toBe('prompt');
    expect(service.aiTokenCap()).toBe(0);
  });

  it('setConnectionModel_whenCalled_persistsPerConnection', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setConnectionModel('claude', 'claude-haiku-4-5');
    service.setConnectionModel('vercel', 'claude-opus-4-8');

    expect(service.connectionModelFor('claude')).toBe('claude-haiku-4-5');
    expect(service.connectionModelFor('vercel')).toBe('claude-opus-4-8');
  });

  it('setAiTokenCap_whenCalled_updatesTheSignal', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setAiTokenCap(32000);

    expect(service.aiTokenCap()).toBe(32000);
  });

  it('setAiPermissionPosture_whenCalled_updatesTheSignal', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setAiPermissionPosture('auto-all');

    expect(service.aiPermissionPosture()).toBe('auto-all');
  });

  it('ai_whenPreConnectionsBlobPersisted_migratesOntoConnections', () => {
    // A pre-epic settings blob picked a provider and a per-provider model; the migration carries those
    // onto the connection selection (the seeded connection ids match the old provider ids).
    localStorage.setItem(
      'settings',
      JSON.stringify({ ai: { provider: 'vercel', models: { vercel: 'claude-sonnet-4-6' } } }),
    );

    const service: Settings = TestBed.inject(Settings);

    expect(service.aiActiveConnectionId()).toBe('vercel');
    expect(service.connectionModelFor('vercel')).toBe('claude-sonnet-4-6');
    expect(service.aiPermissionPosture()).toBe('prompt');
  });

  it('connections_whenDefaulted_seedTheBuiltInsWithClaudeActive', () => {
    const service: Settings = TestBed.inject(Settings);

    expect(service.aiConnections().map((c: AiConnection): string => c.id)).toEqual([
      'claude',
      'codex',
      'vercel',
      'ollama',
    ]);
    expect(service.aiActiveConnectionId()).toBe('claude');
    expect(service.aiActiveConnection()?.kind).toBe('anthropic');
  });

  it('upsertConnection_whenNew_appendsAndWhenExisting_replaces', () => {
    const service: Settings = TestBed.inject(Settings);

    service.upsertConnection(connection('my-openai'));
    expect(service.aiConnections()).toHaveLength(5);

    service.upsertConnection({ ...connection('my-openai'), label: 'Renamed' });
    expect(service.aiConnections()).toHaveLength(5);
    expect(
      service.aiConnections().find((c: AiConnection): boolean => c.id === 'my-openai')?.label,
    ).toBe('Renamed');
  });

  it('setActiveConnection_andSetConnectionModel_roundTrip', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setActiveConnection('ollama');
    service.setConnectionModel('ollama', 'qwen3:8b');

    expect(service.aiActiveConnectionId()).toBe('ollama');
    expect(service.aiActiveConnection()?.id).toBe('ollama');
    expect(service.connectionModelFor('ollama')).toBe('qwen3:8b');
  });

  it('removeConnection_whenActive_fallsBackAndDropsItsModel', () => {
    const service: Settings = TestBed.inject(Settings);
    service.upsertConnection(connection('my-openai'));
    service.setActiveConnection('my-openai');
    service.setConnectionModel('my-openai', 'gpt-4o');

    service.removeConnection('my-openai');

    expect(service.aiConnections().some((c: AiConnection): boolean => c.id === 'my-openai')).toBe(
      false,
    );
    expect(service.aiActiveConnectionId()).toBe('claude');
    expect(service.connectionModelFor('my-openai')).toBe('');
  });

  it('connections_whenUpgradingFromOldProviderSettings_migrateOntoConnections', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ ai: { provider: 'ollama', models: { ollama: 'qwen3:8b' } } }),
    );

    const service: Settings = TestBed.inject(Settings);

    expect(service.aiActiveConnectionId()).toBe('ollama');
    expect(service.aiActiveConnection()?.id).toBe('ollama');
    expect(service.connectionModelFor('ollama')).toBe('qwen3:8b');
  });

  it('externalChange_fromAnotherWindow_appliesTheStoredOverridesLive', () => {
    const service: Settings = TestBed.inject(Settings);
    expect(service.get('application.printMargin')).not.toBe('wide');

    // Another window wrote the settings blob, then the browser notified this one.
    localStorage.setItem('settings', JSON.stringify({ 'application.printMargin': 'wide' }));
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'settings' }));

    expect(service.get('application.printMargin')).toBe('wide');
  });

  it('externalChange_isNotEchoedBackToTheStore_butLocalEditsStillPersist', () => {
    const service: Settings = TestBed.inject(Settings);
    TestBed.inject(ApplicationRef).tick();

    const external: string = JSON.stringify({ 'application.printMargin': 'wide' });
    localStorage.setItem('settings', external);
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'settings' }));
    TestBed.inject(ApplicationRef).tick();

    // The persist effect must not clobber the store with a re-serialisation of what it just read
    // (the guard suppresses the write, so the other window's exact blob remains).
    expect(localStorage.getItem('settings')).toBe(external);

    service.set('application.printMargin', 'narrow');
    TestBed.inject(ApplicationRef).tick();
    expect(service.get('application.printMargin')).toBe('narrow');
    expect(localStorage.getItem('settings')).not.toBe(external);
  });
});
