import { Icon } from '../../icons/icon';

/**
 * Specifies the kinds of top-level tab the application supports.
 */
export type TabType = 'directory' | 'code' | 'markdown' | 'terminal' | 'agent' | 'settings';

/**
 * Defines a single top-level application tab.
 */
export interface Tab {
  /**
   * Gets the unique identifier of the tab.
   */
  readonly id: string;

  /**
   * Gets the type of the tab, which determines its view, ribbon, and icon.
   */
  readonly type: TabType;

  /**
   * Gets the display title of the tab.
   */
  readonly title: string;

  /**
   * Gets the icon of the tab.
   */
  readonly icon: Icon;

  /**
   * Gets a value indicating whether the tab has unsaved changes. Surfaced as a dirty indicator on
   * the tab; defaults to false for tabs without a document.
   */
  readonly dirty?: boolean;
}

/**
 * Defines the display metadata describing how a {@link TabType} is presented to the user.
 */
export interface TabTypeMetadata {
  /**
   * Gets the human-readable label for the tab type.
   */
  readonly label: string;

  /**
   * Gets the icon for the tab type.
   */
  readonly icon: Icon;
}

/**
 * Specifies the display metadata (label and icon) for every {@link TabType}.
 */
export const TAB_TYPE_METADATA: Readonly<Record<TabType, TabTypeMetadata>> = {
  directory: { label: 'Directory', icon: Icon.DIRECTORY },
  code: { label: 'Code', icon: Icon.CODE },
  markdown: { label: 'Markdown', icon: Icon.MARKDOWN },
  terminal: { label: 'Terminal', icon: Icon.TERMINAL },
  agent: { label: 'Agent', icon: Icon.AGENT },
  settings: { label: 'Settings', icon: Icon.SETTINGS },
};

/**
 * Specifies the tab types a user can create from the new-tab menu. The settings tab is excluded
 * because it is a singleton opened from its own dedicated button.
 */
export const CREATABLE_TAB_TYPES: readonly TabType[] = [
  'directory',
  'code',
  'markdown',
  'terminal',
  'agent',
];
