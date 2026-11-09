import type { EditorConfigProperties } from '@shared/api/editor-config-channels';

/**
 * Describes indentation as the settings or the file's content give it.
 */
export interface BaseIndentation {
  /**
   * Gets the columns of one indentation level.
   */
  readonly tabSize: number;

  /**
   * Gets whether indenting inserts spaces.
   */
  readonly insertSpaces: boolean;
}

/**
 * Describes the indentation in force for a file.
 */
export interface ResolvedIndentation extends BaseIndentation {
  /**
   * Gets the columns of one indentation level, which `.editorconfig` can set apart from the width a
   * tab character is drawn at ({@link tabSize}).
   */
  readonly indentSize: number;
}

/**
 * Determines whether an `.editorconfig` leaves nothing to read from a file's content.
 * @param config The properties in force, or null.
 * @returns Returns true when it fixes both the style and the width.
 */
export function fixesIndentation(config: EditorConfigProperties | null): boolean {
  return (
    config?.indentStyle !== undefined &&
    (config.indentSize !== undefined || config.tabWidth !== undefined)
  );
}

/**
 * Resolves the indentation in force, each property on its own: `.editorconfig` wins, then what the
 * file's content shows, then the settings.
 * @param settings The tab size and insert spaces settings.
 * @param detected What the content shows, or null when it was not read.
 * @param config The `.editorconfig` properties, or null.
 * @returns Returns the indentation.
 */
export function resolveIndentation(
  settings: BaseIndentation,
  detected: BaseIndentation | null,
  config: EditorConfigProperties | null,
): ResolvedIndentation {
  const base: BaseIndentation = detected ?? settings;
  const size: number | undefined =
    typeof config?.indentSize === 'number' ? config.indentSize : undefined;
  const tabSize: number = config?.tabWidth ?? size ?? base.tabSize;
  return {
    tabSize,
    indentSize: size ?? (config?.tabWidth === undefined ? base.tabSize : tabSize),
    insertSpaces:
      config?.indentStyle === undefined ? base.insertSpaces : config.indentStyle === 'space',
  };
}

/**
 * Describes indentation for the status strip.
 * @param indentation The indentation.
 * @returns Returns its label.
 */
export function indentationLabel(indentation: ResolvedIndentation): string {
  return `${indentation.insertSpaces ? 'Spaces' : 'Tabs'}: ${indentation.indentSize}`;
}
