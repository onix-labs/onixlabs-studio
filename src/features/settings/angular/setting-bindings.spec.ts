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
    const binding: SettingBinding = bindings.resolve('notifications.toastDuration', undefined);

    expect(binding.value()).toBe(settings.get('notifications.toastDuration'));
    binding.set(9000);

    expect(settings.get('notifications.toastDuration')).toBe(9000);
    expect(binding.value()).toBe(9000);
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

  it('resolve_whenSideloadingSwitch_bindsToTheMainOwnedChoice_offAndLockedWithoutABridge', () => {
    const binding: SettingBinding = bindings.resolve('plugins.loadSideloaded', 'plugins');

    // No Electron bridge is present under test, so nothing reports the choice and nothing can set it.
    expect(binding.value()).toBe(false);
    expect(binding.disabled?.()).toBe(true);
    expect(binding.restartPending?.()).toBe(false);
  });
});
