/**
 * Names the icon theme IPC channels, and the types their payloads carry.
 *
 * The shapes follow VS Code's file icon theme format, reduced to what a renderer needs: every picture
 * is already a `data:` URI, and every association names a picture that exists.
 */
export enum IconThemeChannel {
  /**
   * Gets the active icon theme, or null when there is none (invoke).
   */
  GetActive = 'icon-theme:get-active',
}

/**
 * Maps a lower-case name to the identifier of a picture.
 */
export type IconAssociations = Readonly<Record<string, string>>;

/**
 * Describes which picture each file and folder is drawn with, in one colour mode.
 */
export interface IconSet {
  /**
   * Gets the picture for a file nothing else matches.
   */
  readonly file?: string;

  /**
   * Gets the picture for a collapsed folder nothing else matches.
   */
  readonly folder?: string;

  /**
   * Gets the picture for an expanded folder nothing else matches.
   */
  readonly folderExpanded?: string;

  /**
   * Gets the picture for the collapsed workspace root.
   */
  readonly rootFolder?: string;

  /**
   * Gets the picture for the expanded workspace root.
   */
  readonly rootFolderExpanded?: string;

  /**
   * Gets the pictures by file name, each optionally prefixed with its parent folder's.
   */
  readonly fileNames: IconAssociations;

  /**
   * Gets the pictures by extension, without its leading dot, each optionally prefixed likewise.
   */
  readonly fileExtensions: IconAssociations;

  /**
   * Gets the pictures by language identifier.
   */
  readonly languageIds: IconAssociations;

  /**
   * Gets the pictures by folder name, each optionally prefixed likewise.
   */
  readonly folderNames: IconAssociations;

  /**
   * Gets the pictures by folder name while expanded.
   */
  readonly folderNamesExpanded: IconAssociations;
}

/**
 * Describes an icon theme, ready to draw.
 */
export interface IconTheme {
  /**
   * Gets the name the theme is listed by.
   */
  readonly label: string;

  /**
   * Gets the associations over a dark background.
   */
  readonly dark: IconSet;

  /**
   * Gets the associations over a light background.
   */
  readonly light: IconSet;

  /**
   * Gets the pictures by identifier, as `data:` URIs.
   */
  readonly pictures: IconAssociations;
}
