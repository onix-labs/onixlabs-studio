import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { NotificationTypes } from '@shared/angular/services/notifications/notification-types';
import type { NotificationChoice } from '@shared/angular/services/settings/settings-registry';

/**
 * Lists the three choices every notification type offers, in the order the dropdown shows them.
 */
const CHOICES: readonly DropdownOption[] = [
  { value: 'popup', label: 'Pop Up' },
  { value: 'history', label: 'History Only' },
  { value: 'off', label: 'Off' },
];

/**
 * Represents the notification types on Settings › Notifications (#1486): one group per area, one row
 * per type, each with Pop Up, History Only and Off, built from the notification type list so a new
 * type's row appears without any change here.
 */
@Component({
  selector: 'app-notification-types',
  imports: [Accordion, Button, Dropdown, SettingRow],
  templateUrl: './notification-types.html',
  styleUrls: ['../section.scss', './notification-types.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationTypesSettings {
  /**
   * Holds the notification type list and the user's choices.
   */
  protected readonly types: NotificationTypes = inject(NotificationTypes);

  /**
   * Gets the choices each row offers.
   */
  protected readonly choices: readonly DropdownOption[] = CHOICES;

  /**
   * Stores the choice picked for a type.
   * @param id The type identifier.
   * @param value The picked choice.
   */
  protected choose(id: string, value: string): void {
    this.types.set(id, value as NotificationChoice);
  }
}
