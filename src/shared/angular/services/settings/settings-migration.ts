import type {
  AiSettings,
  ApplicationSettings,
  AppearanceSettings,
  MarkdownEditorSettings,
  SettingsOverrides,
  TextEditorSettings,
  TextEditorSettingsWithProfiles,
  WorkspacesSettings,
} from './settings';

/**
 * Defines the legacy text editor settings format (a flat object without profiles), retained so
 * settings persisted by an earlier version can be migrated forward.
 */
type LegacyTextEditorSettings = Partial<TextEditorSettings>;

/**
 * Defines the legacy persisted settings shape (nested section objects) accepted by the migration path.
 * The current format is a flat map keyed by the dotted setting keys.
 */
interface LegacyAppSettings {
  /**
   * Gets the persisted application settings, if any.
   */
  readonly application?: Partial<ApplicationSettings>;

  /**
   * Gets the persisted appearance settings, if any.
   */
  readonly appearance?: Partial<AppearanceSettings>;

  /**
   * Gets the persisted text editor settings, in either the legacy flat or the profile-aware format.
   */
  readonly textEditor?: LegacyTextEditorSettings | TextEditorSettingsWithProfiles;

  /**
   * Gets the persisted markdown editor settings, if any.
   */
  readonly markdownEditor?: Partial<MarkdownEditorSettings>;

  /**
   * Gets the persisted AI agent settings, if any.
   */
  readonly ai?: Partial<AiSettings>;

  /**
   * Gets the persisted workspace settings, if any.
   */
  readonly workspaces?: Partial<WorkspacesSettings>;
}

/**
 * Restores the sparse override map from a persisted value, migrating the legacy nested format forward
 * when present. A value already in the flat format (dotted keys) passes through; a legacy nested value
 * is flattened; anything else yields an empty map. Pure — the caller supplies the raw persisted value.
 * @param raw The raw persisted settings value read from the store.
 * @returns Returns the restored sparse override map.
 */
export function restoreOverrides(raw: unknown): SettingsOverrides {
  if (raw === null || typeof raw !== 'object') {
    return {};
  }

  const record: Record<string, unknown> = raw as Record<string, unknown>;
  const flat: SettingsOverrides = Object.keys(record).some((key: string): boolean =>
    key.includes('.'),
  )
    ? { ...record }
    : migrateLegacy(record);

  return migrateAiConnections(flat);
}

/**
 * Carries a pre-connections user's AI choices forward onto the seeded connections: their selected
 * provider becomes the active connection and their per-provider model selections become the
 * per-connection selections (the seeded connection ids match the old provider ids, so the mapping is
 * one-to-one). The seeded connection list itself comes from the registry default, so this only fills
 * the active id and model map when they are absent — it never overwrites values the user already has.
 *
 * Hardened against partial or malformed legacy blobs: a missing, empty, or non-string `ai.provider` is
 * skipped (leaving the default active connection), and the legacy `ai.models` map is copied only for its
 * string entries. An unknown provider value is carried across as-is; the engine falls back to an
 * available connection at load time when it does not resolve.
 * @param overrides The restored override map.
 * @returns Returns the override map with the AI connection selections forward-filled.
 */
function migrateAiConnections(overrides: SettingsOverrides): SettingsOverrides {
  const result: Record<string, unknown> = { ...overrides };

  const provider: unknown = result['ai.provider'];
  if (!('ai.activeConnectionId' in result) && typeof provider === 'string' && provider.length > 0) {
    result['ai.activeConnectionId'] = provider;
  }

  const models: unknown = result['ai.models'];
  if (!('ai.connectionModels' in result) && typeof models === 'object' && models !== null) {
    const stringEntries: [string, string][] = Object.entries(
      models as Record<string, unknown>,
    ).filter((entry: [string, unknown]): entry is [string, string] => typeof entry[1] === 'string');
    if (stringEntries.length > 0) {
      result['ai.connectionModels'] = Object.fromEntries(stringEntries);
    }
  }

  return result;
}

/**
 * Determines whether the persisted text editor settings use the profile-aware format.
 * @param settings The persisted text editor settings.
 * @returns Returns true when the settings use the profile-aware format; otherwise, false.
 */
function isProfileAwareFormat(
  settings: LegacyTextEditorSettings | TextEditorSettingsWithProfiles | undefined,
): settings is TextEditorSettingsWithProfiles {
  return settings !== undefined && 'global' in settings && 'profiles' in settings;
}

/**
 * Migrates the legacy nested settings shape into the flat override map, preserving only values the
 * user had set.
 * @param legacy The persisted legacy settings.
 * @returns Returns the migrated sparse override map.
 */
function migrateLegacy(legacy: LegacyAppSettings): SettingsOverrides {
  const overrides: Record<string, unknown> = {};

  function put(key: string, value: unknown): void {
    if (value !== undefined) {
      overrides[key] = value;
    }
  }

  function putAll(prefix: string, source: object | undefined): void {
    for (const [field, value] of Object.entries(source ?? {})) {
      put(`${prefix}.${field}`, value);
    }
  }

  putAll('application', legacy.application);
  putAll('appearance', legacy.appearance);

  const textEditor: LegacyTextEditorSettings | TextEditorSettingsWithProfiles | undefined =
    legacy.textEditor;
  if (isProfileAwareFormat(textEditor)) {
    putAll('textEditor.global', textEditor.global);
    put('textEditor.profiles', textEditor.profiles);
  } else {
    putAll('textEditor.global', textEditor);
  }

  putAll('markdownEditor', legacy.markdownEditor);
  putAll('ai', legacy.ai);
  putAll('workspaces', legacy.workspaces);

  return overrides;
}
