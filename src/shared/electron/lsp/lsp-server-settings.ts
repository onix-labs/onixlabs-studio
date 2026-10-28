import {
  LspServerId,
  LspServerSettingDescriptor,
  LspServerSettingValue,
} from '@shared/api/lsp-channels';

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
 * where `{}` is parsed as a value and rejected by servers (such as Roslyn) that expect a scalar.
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
    return typeof section === 'string' && values !== undefined && section in values
      ? values[section]
      : null;
  });
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
  return [...ids].filter((id: LspServerId): boolean => !sameValues(previous[id], next[id]));
}

/**
 * Determines whether two servers' values are the same.
 * @param a One set of values, or undefined for none.
 * @param b The other, or undefined for none.
 * @returns Returns true when every section holds the same value.
 */
function sameValues(
  a: LspServerSettingValues | undefined,
  b: LspServerSettingValues | undefined,
): boolean {
  const left: LspServerSettingValues = a ?? {};
  const right: LspServerSettingValues = b ?? {};
  const sections: Set<string> = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
  return [...sections].every((section: string): boolean => left[section] === right[section]);
}
