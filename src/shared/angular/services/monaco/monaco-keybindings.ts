import type * as MonacoApi from 'monaco-editor';
import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Describes one of Studio's editor commands as Monaco binds it (#1036): the catalogue command whose
 * chord it takes, the Monaco command that chord runs, and the context the chord applies in. The chord
 * itself is never written here — it comes from the keybinding registry, so it can be rebound in
 * Settings › Keyboard, shown in the shortcuts overlay, and replaced by a profile.
 */
export interface EditorKeybinding {
  /**
   * Gets the catalogue command id, in {@link EDITOR_KEYBINDINGS}.
   */
  readonly id: string;

  /**
   * Gets the Monaco command the chord runs.
   */
  readonly command: string;

  /**
   * Gets the Monaco context expression the chord applies in.
   */
  readonly when: string;
}

/**
 * Catalogues every shortcut Studio binds inside its editors (#1036, phase 1): the commands that replaced
 * Monaco's own widgets (#946) — find, go to, navigation, hover and problems, quick fix, rename,
 * completions, the context menu — and the diff editor's difference steps. Before this they were Monaco
 * keybinding rules written in code, so they could not be rebound, were missing from the shortcuts
 * overlay and ignored overrides. The defaults are the chords those rules had, F-keys included.
 *
 * A command with a second chord (F8 and ⌥F8) has a second entry, so each can be rebound or cleared on
 * its own. Keys that only move within an open completion list or signature card (↑ ↓ PgUp PgDn Enter
 * Tab Esc) are the list's own navigation, not shortcuts, and stay as the list binds them.
 */
export const EDITOR_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Text Editor',
  bindings: [
    { id: 'editor.find', description: 'Find in this file', chord: 'Mod+F' },
    {
      id: 'editor.findReplace',
      description: 'Find and replace in this file',
      chord: 'Mod+H',
      macChord: 'Mod+Alt+F',
    },
    { id: 'editor.goToSymbol', description: 'Go to a symbol in this file', chord: 'Mod+Shift+O' },
    { id: 'editor.goToLine', description: 'Go to a line', chord: 'Mod+G', macChord: 'Control+G' },
    { id: 'editor.goToDefinition', description: 'Go to definition', chord: 'F12' },
    { id: 'editor.findReferences', description: 'Find all references', chord: 'Shift+F12' },
    { id: 'editor.goToImplementation', description: 'Go to implementation', chord: 'Mod+F12' },
    { id: 'editor.callHierarchy', description: 'Show the call hierarchy', chord: 'Control+Alt+H' },
    {
      id: 'editor.typeHierarchy',
      description: 'Show the type hierarchy',
      chord: 'Control+Shift+H',
    },
    {
      id: 'editor.switchSourceHeader',
      description: 'Switch between source and header',
      chord: 'Mod+K Mod+O',
    },
    { id: 'editor.showHover', description: 'Show the hover for the caret', chord: 'Mod+K Mod+I' },
    { id: 'editor.nextProblem', description: 'Go to the next problem', chord: 'F8' },
    {
      id: 'editor.nextProblemAlternative',
      description: 'Go to the next problem (alternative)',
      chord: 'Alt+F8',
    },
    { id: 'editor.previousProblem', description: 'Go to the previous problem', chord: 'Shift+F8' },
    {
      id: 'editor.previousProblemAlternative',
      description: 'Go to the previous problem (alternative)',
      chord: 'Shift+Alt+F8',
    },
    { id: 'editor.quickFix', description: 'Show quick fixes', chord: 'Mod+.' },
    { id: 'editor.renameSymbol', description: 'Rename symbol', chord: 'F2' },
    { id: 'editor.triggerSuggest', description: 'Show completions', chord: 'Control+Space' },
    {
      id: 'editor.triggerSuggestAlternative',
      description: 'Show completions (alternative)',
      chord: 'Mod+I',
    },
    {
      // macOS only, as Monaco had it: ⌥Esc. No default elsewhere.
      id: 'editor.triggerSuggestEscape',
      description: 'Show completions (alternative, macOS)',
      chord: '',
      macChord: 'Alt+Escape',
    },
    {
      id: 'editor.triggerParameterHints',
      description: 'Show parameter hints',
      chord: 'Mod+Shift+Space',
    },
    { id: 'editor.showContextMenu', description: 'Show the context menu', chord: 'Shift+F10' },
    { id: 'diff.nextDifference', description: 'Go to the next difference', chord: 'F7' },
    {
      id: 'diff.previousDifference',
      description: 'Go to the previous difference',
      chord: 'Shift+F7',
    },
  ],
};

/**
 * Names the keys a normalized chord may end in that are not a letter, a digit or a function key, by
 * the name Monaco gives their key code.
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'UpArrow',
  ArrowDown: 'DownArrow',
  ArrowLeft: 'LeftArrow',
  ArrowRight: 'RightArrow',
  '.': 'Period',
  ',': 'Comma',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
};

/**
 * Translates a normalized chord from the keybinding registry into Monaco's keybinding number: `Mod` is
 * Monaco's `CtrlCmd` (⌘ on macOS, Ctrl elsewhere), `Control` its `WinCtrl` (the Control key itself on
 * macOS), and two chords pressed in turn become `KeyMod.chord`.
 * @param monaco The Monaco instance whose key codes to use.
 * @param chord The normalized chord, or empty for none.
 * @returns Returns the keybinding, or null for no chord or one Monaco cannot express.
 */
export function toMonacoKeybinding(monaco: typeof MonacoApi, chord: string): number | null {
  const steps: readonly string[] = chord.split(' ').filter((step: string): boolean => step !== '');
  if (steps.length === 0 || steps.length > 2) {
    return null;
  }
  const first: number | null = toMonacoChord(monaco, steps[0]);
  if (first === null || steps.length === 1) {
    return first;
  }
  const second: number | null = toMonacoChord(monaco, steps[1]);
  return second === null ? null : monaco.KeyMod.chord(first, second);
}

/**
 * Translates one chord into Monaco's keybinding number.
 * @param monaco The Monaco instance.
 * @param step The normalized chord.
 * @returns Returns the keybinding, or null when its key has no Monaco key code.
 */
function toMonacoChord(monaco: typeof MonacoApi, step: string): number | null {
  const parts: readonly string[] = step.split('+');
  const key: string = parts[parts.length - 1];
  let code: number = keyCodeOf(monaco, key) ?? -1;
  if (code === -1) {
    return null;
  }
  for (const modifier of parts.slice(0, -1)) {
    switch (modifier) {
      case 'Mod':
        code |= monaco.KeyMod.CtrlCmd;
        break;
      case 'Control':
        code |= monaco.KeyMod.WinCtrl;
        break;
      case 'Alt':
        code |= monaco.KeyMod.Alt;
        break;
      case 'Shift':
        code |= monaco.KeyMod.Shift;
        break;
      default:
        return null;
    }
  }
  return code;
}

/**
 * Finds Monaco's key code for a normalized key name.
 * @param monaco The Monaco instance.
 * @param key The key: a letter, a digit, F1 to F24, or a named key.
 * @returns Returns the key code, or null when Monaco has none for it.
 */
function keyCodeOf(monaco: typeof MonacoApi, key: string): number | null {
  const codes: Readonly<Record<string, number>> = monaco.KeyCode as unknown as Readonly<
    Record<string, number>
  >;
  let name: string | undefined;
  if (/^[A-Z]$/.test(key)) {
    name = `Key${key}`;
  } else if (/^[0-9]$/.test(key)) {
    name = `Digit${key}`;
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    name = key;
  } else {
    name = NAMED_KEYS[key];
  }
  const code: number | undefined = name === undefined ? undefined : codes[name];
  return typeof code === 'number' ? code : null;
}
