import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppSettings, EditorProfile, Settings, TextEditorSettings } from './settings';

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(Settings)).toBeTruthy();
  });

  it('setDefaultDocumentType_whenCalled_updatesTheSignal', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setDefaultDocumentType('markdown');

    expect(service.defaultDocumentType()).toBe('markdown');
  });

  it('setUndoStackSize_whenAboveMaximum_clampsToMaximum', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setUndoStackSize(5000);

    expect(service.undoStackSize()).toBe(1000);
  });

  it('setUndoStackSize_whenBelowMinimum_clampsToMinimum', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setUndoStackSize(1);

    expect(service.undoStackSize()).toBe(10);
  });

  it('setUndoStackSize_whenFractional_roundsToInteger', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setUndoStackSize(42.7);

    expect(service.undoStackSize()).toBe(43);
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

  it('settings_whenChanged_persistsToTheStore', () => {
    const service: Settings = TestBed.inject(Settings);

    service.setDefaultDocumentType('markdown');
    TestBed.inject(ApplicationRef).tick();

    const stored: AppSettings = JSON.parse(localStorage.getItem('settings') ?? '{}') as AppSettings;
    expect(stored.application.defaultDocumentType).toBe('markdown');
  });

  it('settings_whenPersistedValuesExist_areRestoredOnCreation', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ application: { undoStackSize: 250 } }),
    );

    expect(TestBed.inject(Settings).undoStackSize()).toBe(250);
  });

  it('settings_whenLegacyTextEditorFormatPersisted_migratesToProfileAware', () => {
    localStorage.setItem('settings', JSON.stringify({ textEditor: { wordWrap: true } }));

    const service: Settings = TestBed.inject(Settings);

    expect(service.globalTextEditor().wordWrap).toBe(true);
    expect(service.globalTextEditor().showLineNumbers).toBe(true);
    expect(service.profiles()).toHaveLength(0);
  });
});
