import { TestBed } from '@angular/core/testing';

import { SettingBinding, SettingBindings } from '@features/settings/angular/setting-bindings';
import { Settings } from '@shared/angular/services/settings/settings';

describe('SettingBindings', () => {
  let bindings: SettingBindings;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    bindings = TestBed.inject(SettingBindings);
  });

  it('resolve_whenSettingsOwned_readsAndWritesThroughTheStore', () => {
    const settings: Settings = TestBed.inject(Settings);
    const binding: SettingBinding = bindings.resolve('application.undoStackSize', undefined);

    expect(binding.value()).toBe(100);
    binding.set(250);

    expect(settings.get('application.undoStackSize')).toBe(250);
    expect(binding.value()).toBe(250);
  });

  it('resolve_whenSettingsOwnedNumber_clampsThroughTheStore', () => {
    const binding: SettingBinding = bindings.resolve('application.undoStackSize', undefined);

    binding.set(99999);

    expect(binding.value()).toBe(1000);
  });

  it('resolve_whenLspServerEnabledKey_reflectsTheDisabledState', () => {
    const binding: SettingBinding = bindings.resolve('lsp.server.typescript.enabled', 'lsp');

    expect(binding.value()).toBe(true);
  });

  it('resolve_whenLspArgsKey_returnsAString', () => {
    const binding: SettingBinding = bindings.resolve('lsp.server.typescript.args', 'lsp');

    expect(binding.value()).toBe('');
  });

  it('resolve_whenLspPathKey_returnsTheStoredPathOrEmpty', () => {
    const binding: SettingBinding = bindings.resolve('lsp.path.java', 'lsp');

    expect(binding.value()).toBe('');
  });

  it('resolve_whenForeignOwnerUnavailable_reportsDisabledAndItsDefaultValue', () => {
    const binding: SettingBinding = bindings.resolve('security.imagePolicy', 'security');

    // No Electron bridge is present under test, so the owning service is unavailable.
    expect(binding.disabled?.()).toBe(true);
    expect(binding.value()).toBe('local');
  });
});
