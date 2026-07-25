import { Icon } from '@shared/angular/icons/icon';

/**
 * Specifies the kinds of top-level tab the application supports.
 */
export type TabType =
  | 'directory'
  | 'code'
  | 'markdown'
  | 'binary'
  | 'terminal'
  | 'agent'
  | 'mission-control'
  | 'settings';

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

  /**
   * Gets a value indicating whether the tab needs the user's attention (for example, a document
   * changed on disk and needs a keep/reload decision). Surfaced as an accent dot on the tab.
   */
  readonly attention?: boolean;

  /**
   * Gets the identity of the resource the tab represents (for example a directory path, repository
   * root, or file path), used to keep a resource single-instance per tab type: opening a resource
   * that already has a tab of the same type activates that tab instead of creating a duplicate.
   * Undefined for tabs that are not backed by a single resource (a blank editor, a terminal).
   */
  readonly resourceKey?: string;
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
  binary: { label: 'Binary', icon: Icon.BINARY },
  terminal: { label: 'Terminal', icon: Icon.TERMINAL },
  agent: { label: 'Agent', icon: Icon.AGENT },
  'mission-control': { label: 'Mission Control', icon: Icon.ROCKET_LAUNCH },
  settings: { label: 'Settings', icon: Icon.SETTINGS },
};
