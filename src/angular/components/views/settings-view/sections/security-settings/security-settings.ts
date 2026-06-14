import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import type { ImageSourcePolicy } from '../../../../../../shared/security-types';
import { Security } from '../../../../../services/security/security';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { SettingRow } from '../../../../forms/setting-row/setting-row';

/**
 * Represents the Security section of the settings view. It currently exposes the image-source policy
 * that governs the `img-src` Content-Security-Policy directive, letting the user trade off
 * markdown/remote-image convenience against exposure to remote content. The policy is owned by the
 * main process; a change takes effect the next time the app starts.
 */
@Component({
  selector: 'app-security-settings',
  imports: [SettingRow, Dropdown],
  templateUrl: './security-settings.html',
  styleUrls: ['../section.scss', './security-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecuritySettingsSection {
  /**
   * Holds the renderer security service.
   */
  private readonly security: Security = inject(Security);

  /**
   * Gets the active image-source policy.
   */
  protected readonly imagePolicy: Signal<ImageSourcePolicy> = this.security.imagePolicy;

  /**
   * Gets a value indicating whether the security bridge is available (running inside Studio).
   */
  protected readonly isAvailable: boolean = this.security.isAvailable;

  /**
   * Gets the image-source policy options, from safest to least safe.
   */
  protected readonly imageOptions: readonly DropdownOption[] = [
    { value: 'local', label: 'Local only (safest)' },
    { value: 'https', label: 'HTTPS only (safe)' },
    { value: 'all', label: 'HTTP and HTTPS (less safe)' },
  ];

  /**
   * Initialises the section, refreshing the active policy from the main process.
   */
  public constructor() {
    void this.security.refresh();
  }

  /**
   * Sets the image-source policy.
   * @param policy The selected policy id.
   */
  protected onImagePolicyChange(policy: string): void {
    void this.security.setImagePolicy(policy as ImageSourcePolicy);
  }
}
