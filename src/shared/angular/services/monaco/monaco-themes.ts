import type * as MonacoApi from 'monaco-editor';

/**
 * Holds the fallback grey palette used when the document's CSS custom properties cannot be read (for
 * example under unit tests). Mirrors the `--gray-*` primitives in `_variables.scss`.
 */
const FALLBACK_GRAYS: Readonly<Record<string, string>> = {
  gray100: '#f8f9fa',
  gray200: '#e9ecef',
  gray800: '#343a40',
  gray900: '#212529',
};

/**
 * Reads a `--gray-*` custom property from the document root, falling back to a known value when it
 * cannot be resolved.
 * @param name The grey name (for example `gray900`).
 * @returns Returns the resolved hex colour.
 */
export function readGray(name: string): string {
  const variable: string = `--${name.replace('gray', 'gray-')}`;
  const value: string = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value.length > 0 ? value : FALLBACK_GRAYS[name];
}

/**
 * Reads the accent colour as a Monaco selection colour: a translucent hex derived from the projected
 * `--accent-color-rgb` custom property (so the editor selection matches the app accent while staying
 * legible). Returns null when the property cannot be parsed (e.g. under unit tests), so callers fall
 * back to the grey default.
 * @returns Returns an `#rrggbbaa` colour, or null.
 */
export function readAccentSelectionColor(): string | null {
  const rgb: string = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-color-rgb')
    .trim();
  return accentSelectionHex(rgb);
}

/**
 * Converts an `"r, g, b"` triplet (the projected `--accent-color-rgb` value) to a translucent
 * `#rrggbbaa` Monaco selection colour, or null when the triplet is malformed.
 * @param rgb The comma-separated red/green/blue channels.
 * @returns Returns an `#rrggbbaa` colour, or null.
 */
export function accentSelectionHex(rgb: string): string | null {
  const parts: string[] = rgb.split(',').map((part: string): string => part.trim());
  if (parts.length !== 3) {
    return null;
  }
  const channels: (string | null)[] = parts.map((part: string): string | null => {
    const value: number = Number(part);
    return part.length > 0 && Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.round(value)))
          .toString(16)
          .padStart(2, '0')
      : null;
  });
  return channels.some((channel: string | null): boolean => channel === null)
    ? null
    : `#${channels.join('')}59`;
}

/**
 * Registers the four `onix-{light,dark}-{outline,filled}` themes, painting the editor surface from the
 * application's `--gray-*` palette so it tracks light/dark with the rest of the app. A no-op when
 * Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param accentSelection Whether the editor selection uses the accent colour (#314) rather than the
 * neutral grey default.
 */
export function defineThemes(monaco: typeof MonacoApi | undefined, accentSelection: boolean): void {
  if (monaco === undefined) {
    return;
  }

  const gray: (name: string) => string = (name: string): string => readGray(name);
  const gray100: string = gray('gray100');
  const gray200: string = gray('gray200');
  const gray800: string = gray('gray800');
  const gray900: string = gray('gray900');

  // When accent selection is on, both light and dark themes use the accent-derived selection colour;
  // otherwise each keeps its neutral grey. A null accent colour (unreadable custom property) falls
  // back to grey too.
  const accent: string | null = accentSelection ? readAccentSelectionColor() : null;
  const darkSelection: string = accent ?? gray800;
  const lightSelection: string = accent ?? gray200;

  // Colour the standard semantic token types (and matching grammar tokens) so types, members, and
  // parameters are distinguished, not just keywords. Mirrors the VS Code Dark+/Light+ palettes.
  const semanticRules: (light: boolean) => MonacoApi.editor.ITokenThemeRule[] = (
    light: boolean,
  ): MonacoApi.editor.ITokenThemeRule[] => {
    const teal: string = light ? '267F99' : '4EC9B0';
    const yellow: string = light ? '795E26' : 'DCDCAA';
    const blue: string = light ? '001080' : '9CDCFE';
    const constant: string = light ? '0070C1' : '4FC1FF';
    const types: readonly string[] = [
      'type',
      'class',
      'interface',
      'enum',
      'struct',
      'typeParameter',
      'namespace',
      'macro',
    ];
    const functions: readonly string[] = ['function', 'method', 'decorator'];
    const variables: readonly string[] = ['variable', 'parameter', 'property'];
    return [
      ...types.map((token: string): MonacoApi.editor.ITokenThemeRule => ({
        token,
        foreground: teal,
      })),
      ...functions.map((token: string): MonacoApi.editor.ITokenThemeRule => ({
        token,
        foreground: yellow,
      })),
      ...variables.map((token: string): MonacoApi.editor.ITokenThemeRule => ({
        token,
        foreground: blue,
      })),
      { token: 'enumMember', foreground: constant },
    ];
  };
  const darkRules: MonacoApi.editor.ITokenThemeRule[] = semanticRules(false);
  const lightRules: MonacoApi.editor.ITokenThemeRule[] = semanticRules(true);

  monaco.editor.defineTheme('onix-dark-outline', {
    base: 'vs-dark',
    inherit: true,
    rules: darkRules,
    colors: {
      'editor.background': gray900,
      'editor.selectionBackground': darkSelection,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#ffffff20',
      'editorCursor.foreground': gray100,
    },
  });
  monaco.editor.defineTheme('onix-dark-filled', {
    base: 'vs-dark',
    inherit: true,
    rules: darkRules,
    colors: {
      'editor.background': gray900,
      'editor.selectionBackground': darkSelection,
      'editor.lineHighlightBackground': '#ffffff10',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': gray100,
    },
  });
  monaco.editor.defineTheme('onix-light-outline', {
    base: 'vs',
    inherit: true,
    rules: lightRules,
    colors: {
      'editor.background': gray100,
      'editor.selectionBackground': lightSelection,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000020',
      'editorCursor.foreground': gray900,
    },
  });
  monaco.editor.defineTheme('onix-light-filled', {
    base: 'vs',
    inherit: true,
    rules: lightRules,
    colors: {
      'editor.background': gray100,
      'editor.selectionBackground': lightSelection,
      'editor.lineHighlightBackground': '#00000008',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': gray900,
    },
  });
}
