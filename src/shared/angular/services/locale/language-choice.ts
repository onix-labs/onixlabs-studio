import type { HostEnv } from '@shared/api/host';
import type { InterfaceLanguage } from '@shared/api/startup-settings';

/**
 * Holds whether every language Studio offers is translated across the whole interface. Until it is,
 * a packaged build keeps the interface in English: a half-translated interface, part French and part
 * English, reads worse than one in English throughout. Set it to `true` to offer the Language setting
 * to everyone.
 */
export const INTERFACE_TRANSLATED: boolean = false;

/**
 * Gets a value indicating whether the Language setting is offered. A development build always offers
 * it, so the translations, and the pseudo language that shows what is still unmarked, can be seen
 * while the interface is being translated.
 * @param packaged Whether this is a packaged build.
 * @returns Returns `true` when the Language setting is offered.
 */
export function isLanguageChoiceOffered(packaged: boolean): boolean {
  return INTERFACE_TRANSLATED || !packaged;
}

/**
 * Gets the Language setting as it applies to this build. Where the setting isn't offered, the
 * interface is English, whatever was saved before and whatever the operating system prefers.
 * @param setting The Language setting, as saved.
 * @param packaged Whether this is a packaged build.
 * @returns Returns the setting in force.
 */
export function languageInForce(setting: InterfaceLanguage, packaged: boolean): InterfaceLanguage {
  return isLanguageChoiceOffered(packaged) ? setting : 'en';
}

/**
 * Gets the Language setting this launch started in: the setting the main process mirrored, as it
 * applies to this build. Start-up loads it, and Settings compares a new choice against it.
 * @param host The host environment, absent outside Electron.
 * @returns Returns the setting in force at launch.
 */
export function launchLanguage(host: HostEnv | undefined): InterfaceLanguage {
  return languageInForce(host?.startupSettings.language ?? 'system', host?.packaged ?? false);
}
