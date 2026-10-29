import {
  LspServerId,
  LspServerSettingDescriptor,
  LspServerSettingValue,
} from '@shared/api/lsp-channels';
import type { LspSettingsDelivery } from './language-server-descriptor';

/**
 * The user's values for one server's declared settings, keyed by configuration section.
 */
export type LspServerSettingValues = Readonly<Record<string, LspServerSettingValue>>;

/**
 * Validates the user's values for the settings servers declare (#1143), keyed by server identifier
 * and then by configuration section. Each value is a switch or a choice's value; an absent map is no
 * values at all, so a store written before servers declared settings still loads.
 * @param value The candidate map, untrusted.
 * @returns Returns the values, or null when the map is malformed.
 */
export function parseServerSettings(
  value: unknown,
): Record<LspServerId, LspServerSettingValues> | null {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const result: Record<LspServerId, LspServerSettingValues> = {};
  for (const [serverId, sections] of Object.entries(value as Record<string, unknown>)) {
    if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
      return null;
    }
    const values: Record<string, LspServerSettingValue> = {};
    for (const [section, setting] of Object.entries(sections as Record<string, unknown>)) {
      if (typeof setting !== 'boolean' && typeof setting !== 'string') {
        return null;
      }
      values[section] = setting;
    }
    if (Object.keys(values).length > 0) {
      result[serverId] = values;
    }
  }
  return result;
}

/**
 * Lays the user's values over the defaults of the settings a server declares (#1145), so a setting
 * the user has cleared is answered with its default rather than null: Roslyn reads a null on a
 * second reading as "unchanged" and keeps the value it had, so a switch turned on and then cleared
 * would stay on. Settings the server does not declare are left out, and answered null as before.
 * @param declared The settings the server declares.
 * @param values The user's values, or undefined when they have set none.
 * @returns Returns the values to answer with.
 */
export function withDeclaredDefaults(
  declared: readonly LspServerSettingDescriptor[] | undefined,
  values: LspServerSettingValues | undefined,
): LspServerSettingValues | undefined {
  if (declared === undefined || declared.length === 0) {
    return values;
  }
  const defaults: Record<string, LspServerSettingValue> = {};
  for (const setting of declared) {
    defaults[setting.section] = setting.default;
  }
  return { ...defaults, ...values };
}

/**
 * Answers a server's `workspace/configuration` request from the user's values: each requested
 * section's value, or null for one the user has not set — null tells a server to use its default,
 * where `{}` is parsed as a value and rejected by servers (such as Roslyn) that expect a scalar. A
 * section that names no setting but holds some — rust-analyzer and gopls ask for `rust-analyzer` and
 * `gopls` whole — is answered with the settings under it, nested (#1204).
 * @param values The user's values for the asking server.
 * @param items The requested items, untrusted.
 * @returns Returns one answer per item, in order.
 */
export function answerConfiguration(
  values: LspServerSettingValues | undefined,
  items: readonly unknown[] | undefined,
): unknown[] {
  return (items ?? []).map((item: unknown): unknown => {
    const section: unknown = (item as { section?: unknown } | null)?.section;
    return typeof section === 'string' && values !== undefined
      ? (settingsUnder(values, section) ?? null)
      : null;
  });
}

/**
 * Determines whether a configuration section is a prefix, or names one of the settings under it.
 * @param section The setting's section, such as `java.import.gradle.enabled`.
 * @param prefix The prefix, such as `java`.
 * @returns Returns true when the section is the prefix or under it.
 */
function isUnder(section: string, prefix: string): boolean {
  return section === prefix || section.startsWith(`${prefix}.`);
}

/**
 * The keys a dotted section may not write through, as they reach an object's prototype.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set<string>(['__proto__', 'constructor', 'prototype']);

/**
 * Places a value at a dotted path of an object, creating the objects on the way.
 * @param target The object to write into.
 * @param path The dotted path, such as `typescript.referencesCodeLens.enabled`.
 * @param value The value.
 */
function place(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys: string[] = path.split('.');
  // A section is a name from a settings file, never a way into an object's prototype.
  if (keys.some((key: string): boolean => UNSAFE_KEYS.has(key))) {
    return;
  }
  let node: Record<string, unknown> = target;
  for (const key of keys.slice(0, -1)) {
    const next: unknown = node[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

/**
 * Gets the settings under one section, without it (#1204): the setting's own value when the section
 * names one, the settings under it nested by their dotted remainder when it is a prefix — `java`
 * gives `{ import: { gradle: { enabled: true } } }` — or undefined when it holds none.
 * @param values The server's values.
 * @param section The section.
 * @returns Returns the value or nested settings, or undefined.
 */
export function settingsUnder(
  values: LspServerSettingValues,
  section: string,
): LspServerSettingValue | Record<string, unknown> | undefined {
  if (Object.prototype.hasOwnProperty.call(values, section)) {
    return values[section];
  }
  const nested: Record<string, unknown> = {};
  let found: boolean = false;
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(`${section}.`)) {
      place(nested, key.slice(section.length + 1), value);
      found = true;
    }
  }
  return found ? nested : undefined;
}

/**
 * Builds the `settings` a server is pushed in `workspace/didChangeConfiguration` (#1204): the settings
 * under each of its push sections, nested with the section kept — `{ typescript: { … } }` — as VS Code
 * sends them. Always the whole picture, never only what changed: typescript-language-server replaces
 * its configuration with what it is sent.
 * @param delivery How the server takes its settings.
 * @param values The server's values, defaults included.
 * @returns Returns the settings to push, or undefined for a server that is not pushed them.
 */
export function pushedSettings(
  delivery: LspSettingsDelivery | undefined,
  values: LspServerSettingValues | undefined,
): Record<string, unknown> | undefined {
  const sections: readonly string[] | undefined = delivery?.push;
  if (sections === undefined) {
    return undefined;
  }
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (sections.some((prefix: string): boolean => isUnder(key, prefix))) {
      place(settings, key, value);
    }
  }
  return settings;
}

/**
 * Builds what a server is given of its settings in `initializationOptions` (#1204): the settings under
 * its start-up section, without it, placed at its start-up key — jdtls's `java.*` settings at
 * `settings.java`, typescript-language-server's `preferences.*` at `preferences`.
 * @param delivery How the server takes its settings.
 * @param values The server's values, defaults included.
 * @returns Returns the options to merge into its `initializationOptions`, or undefined for none.
 */
export function startupOptions(
  delivery: LspSettingsDelivery | undefined,
  values: LspServerSettingValues | undefined,
): Record<string, unknown> | undefined {
  const startup: LspSettingsDelivery['startup'] = delivery?.startup;
  if (startup === undefined || values === undefined) {
    return undefined;
  }
  const under: unknown = settingsUnder(values, startup.section);
  if (under === undefined) {
    return undefined;
  }
  if (startup.key === undefined) {
    return typeof under === 'object' && under !== null
      ? (under as Record<string, unknown>)
      : undefined;
  }
  const options: Record<string, unknown> = {};
  place(options, startup.key, under);
  return options;
}

/**
 * Merges the options built from a server's settings into the `initializationOptions` its descriptor
 * resolved (the TypeScript server's `tsserver` path), object by object; the descriptor's own value
 * wins where both name the same scalar, as it says how the server is to run at all.
 * @param base The descriptor's options, or undefined for none.
 * @param extra The options built from the settings, or undefined for none.
 * @returns Returns the merged options.
 */
export function mergeOptions(base: unknown, extra: Record<string, unknown> | undefined): unknown {
  if (extra === undefined) {
    return base;
  }
  if (base === undefined) {
    return extra;
  }
  if (!isPlainObject(base)) {
    return base;
  }
  const merged: Record<string, unknown> = { ...extra };
  for (const [key, value] of Object.entries(base)) {
    const theirs: unknown = merged[key];
    merged[key] =
      isPlainObject(value) && isPlainObject(theirs) ? mergeOptions(value, theirs) : value;
  }
  return merged;
}

/**
 * Determines whether a value is a plain object, not null nor an array.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Determines whether a server reads a setting only when it starts (#1204), so a change to it must
 * restart the server: the setting says so, or the server neither asks for its settings nor is pushed
 * this one, leaving start-up the only time it hears of it.
 * @param delivery How the server takes its settings.
 * @param setting The setting.
 * @returns Returns true when a change to it needs a restart.
 */
export function readOnlyAtStartup(
  delivery: LspSettingsDelivery | undefined,
  setting: LspServerSettingDescriptor,
): boolean {
  if (setting.startupOnly === true) {
    return true;
  }
  if (delivery?.pull !== false) {
    return false;
  }
  return !(delivery.push ?? []).some((prefix: string): boolean => isUnder(setting.section, prefix));
}

/**
 * Lists the sections whose values differ between a server's two sets of values.
 * @param previous The values before the change, or undefined for none.
 * @param next The values after it, or undefined for none.
 * @returns Returns the sections that changed.
 */
export function changedSections(
  previous: LspServerSettingValues | undefined,
  next: LspServerSettingValues | undefined,
): string[] {
  const left: LspServerSettingValues = previous ?? {};
  const right: LspServerSettingValues = next ?? {};
  const sections: Set<string> = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
  return [...sections].filter((section: string): boolean => left[section] !== right[section]);
}

/**
 * Lists the servers whose values differ between two sets of settings, so only their sessions are
 * told to read their configuration again.
 * @param previous The values before the change.
 * @param next The values after it.
 * @returns Returns the identifiers of the servers whose values changed.
 */
export function serversWithChangedSettings(
  previous: Readonly<Record<LspServerId, LspServerSettingValues>>,
  next: Readonly<Record<LspServerId, LspServerSettingValues>>,
): LspServerId[] {
  const ids: Set<LspServerId> = new Set<LspServerId>([
    ...Object.keys(previous),
    ...Object.keys(next),
  ]);
  return [...ids].filter(
    (id: LspServerId): boolean => changedSections(previous[id], next[id]).length > 0,
  );
}
