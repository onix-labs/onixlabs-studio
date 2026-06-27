import { computed, inject, Injector, Service, signal, Signal } from '@angular/core';
import type { ImageSourcePolicy } from '../../../shared/security-types';
import { LspSettings } from '../lsp/lsp-settings';
import { Security } from '../security/security';
import { Settings } from './settings';
import { SettingOwner, SettingsKey } from './settings-registry';

/**
 * Represents a reactive read/write binding for a single setting, abstracting which service owns the
 * value. The generic renderer reads {@link value}, writes through {@link set}, and reflects
 * {@link disabled} without needing to know the owner.
 */
export interface SettingBinding {
  /**
   * Gets the current value of the setting.
   */
  readonly value: Signal<unknown>;

  /**
   * Writes a new value for the setting.
   * @param value The value to write.
   */
  set(value: unknown): void;

  /**
   * Gets whether the control should be disabled (for example when the owning bridge is unavailable
   * outside Electron), or undefined when always enabled.
   */
  readonly disabled?: Signal<boolean>;
}

/**
 * Resolves a {@link SettingBinding} for a setting key, routing to the service that owns the value.
 *
 * Settings-owned keys bind to the Settings store; foreign owners (Security, LSP — and, in future,
 * Theme and Display) bind to their own services. This is what lets the generic renderer drive
 * settings that do not live in the Settings store, without the renderer knowing about those services.
 */
@Service()
export class SettingBindings {
  /**
   * Holds the injector used to resolve owner services lazily, so they are only constructed when a
   * setting they own is actually rendered.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the Settings store, which owns most settings and is always needed.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Resolves the binding for a setting key.
   * @param key The setting key.
   * @param owner The owner of the value.
   * @returns Returns the binding.
   */
  public resolve(key: string, owner: SettingOwner | undefined): SettingBinding {
    switch (owner) {
      case 'security':
        return this.securityBinding();
      case 'lsp':
        return this.lspBinding(key);
      default:
        return this.settingsBinding(key);
    }
  }

  /**
   * Builds a binding backed by the Settings store.
   * @param key The setting key.
   * @returns Returns the binding.
   */
  private settingsBinding(key: string): SettingBinding {
    const typedKey: SettingsKey = key as SettingsKey;
    return {
      value: this.settings.value(typedKey),
      set: (value: unknown): void => this.settings.assign(typedKey, value),
    };
  }

  /**
   * Builds a binding backed by the Security service (the image-source policy).
   * @returns Returns the binding.
   */
  private securityBinding(): SettingBinding {
    const security: Security = this.injector.get(Security);
    return {
      value: security.imagePolicy,
      set: (value: unknown): void => {
        void security.setImagePolicy(value as ImageSourcePolicy);
      },
      disabled: signal(!security.isAvailable).asReadonly(),
    };
  }

  /**
   * Builds a binding backed by the LSP settings service, for either a per-server toggle/arguments key
   * (`lsp.server.<id>.enabled` / `lsp.server.<id>.args`) or a tool-path key (`lsp.path.<tool>`).
   * @param key The setting key.
   * @returns Returns the binding.
   */
  private lspBinding(key: string): SettingBinding {
    const lsp: LspSettings = this.injector.get(LspSettings);
    const disabled: Signal<boolean> = signal(!lsp.isAvailable).asReadonly();

    if (key.startsWith('lsp.server.')) {
      const rest: string = key.slice('lsp.server.'.length);
      const separator: number = rest.lastIndexOf('.');
      const serverId: string = rest.slice(0, separator);
      const field: string = rest.slice(separator + 1);

      if (field === 'enabled') {
        return {
          value: computed((): boolean => !lsp.settings().disabledServers.includes(serverId)),
          set: (value: unknown): void => void lsp.setServerEnabled(serverId, value as boolean),
          disabled,
        };
      }

      return {
        value: computed((): string => lsp.serverArgsText(serverId)),
        set: (value: unknown): void => void lsp.setServerArgs(serverId, value as string),
        disabled,
      };
    }

    switch (key) {
      case 'lsp.path.typescriptServer':
        return {
          value: computed((): string => lsp.settings().typescriptServerPath ?? ''),
          set: (value: unknown): void => void lsp.setTypescriptServerPath(value as string),
          disabled,
        };
      case 'lsp.path.java':
        return {
          value: computed((): string => lsp.settings().javaPath ?? ''),
          set: (value: unknown): void => void lsp.setJavaPath(value as string),
          disabled,
        };
      case 'lsp.path.dotnet':
        return {
          value: computed((): string => lsp.settings().dotnetPath ?? ''),
          set: (value: unknown): void => void lsp.setDotnetPath(value as string),
          disabled,
        };
      default:
        return {
          value: computed((): string => lsp.settings().clangdPath ?? ''),
          set: (value: unknown): void => void lsp.setClangdPath(value as string),
          disabled,
        };
    }
  }
}
