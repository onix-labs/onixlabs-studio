import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';

import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Studio } from '@shared/angular/services/studio/studio';
import { EDITOR_KEYBINDINGS, toMonacoKeybinding } from './monaco-keybindings';

const CTRL_CMD: number = 2048;
const SHIFT: number = 1024;
const ALT: number = 512;
const WIN_CTRL: number = 256;
const KEY_F: number = 36;
const KEY_G: number = 37;
const KEY_H: number = 38;
const KEY_I: number = 39;
const KEY_K: number = 41;
const KEY_O: number = 45;
const DIGIT_1: number = 23;
const F2: number = 60;
const F7: number = 65;
const F8: number = 66;
const F10: number = 68;
const F12: number = 70;
const SPACE: number = 10;
const ESCAPE: number = 9;
const PERIOD: number = 89;
const UP: number = 16;

/**
 * Combines two chords pressed in turn, as Monaco's `KeyMod.chord` does.
 * @param first The first chord.
 * @param second The second chord.
 * @returns Returns the two-step keybinding.
 */
function chord(first: number, second: number): number {
  return (first | (second << 16)) >>> 0;
}

/**
 * Stands in for the Monaco key codes and modifiers the translation reads.
 */
const monaco: typeof MonacoApi = {
  KeyMod: { CtrlCmd: CTRL_CMD, Shift: SHIFT, Alt: ALT, WinCtrl: WIN_CTRL, chord },
  KeyCode: {
    KeyF: KEY_F,
    KeyG: KEY_G,
    KeyH: KEY_H,
    KeyI: KEY_I,
    KeyK: KEY_K,
    KeyO: KEY_O,
    Digit1: DIGIT_1,
    F2,
    F7,
    F8,
    F10,
    F12,
    Space: SPACE,
    Escape: ESCAPE,
    Period: PERIOD,
    UpArrow: UP,
  },
} as unknown as typeof MonacoApi;

describe('toMonacoKeybinding', () => {
  it('translatesEachModifier_ModToCtrlCmdAndControlToWinCtrl', (): void => {
    expect(toMonacoKeybinding(monaco, 'Mod+F')).toBe(CTRL_CMD | KEY_F);
    expect(toMonacoKeybinding(monaco, 'Control+G')).toBe(WIN_CTRL | KEY_G);
    expect(toMonacoKeybinding(monaco, 'Mod+Alt+Shift+F')).toBe(CTRL_CMD | ALT | SHIFT | KEY_F);
  });

  it('translatesLettersDigitsFunctionAndNamedKeys', (): void => {
    expect(toMonacoKeybinding(monaco, 'Mod+1')).toBe(CTRL_CMD | DIGIT_1);
    expect(toMonacoKeybinding(monaco, 'Shift+F12')).toBe(SHIFT | F12);
    expect(toMonacoKeybinding(monaco, 'Mod+.')).toBe(CTRL_CMD | PERIOD);
    expect(toMonacoKeybinding(monaco, 'Control+Space')).toBe(WIN_CTRL | SPACE);
    expect(toMonacoKeybinding(monaco, 'Alt+Escape')).toBe(ALT | ESCAPE);
    expect(toMonacoKeybinding(monaco, 'ArrowUp')).toBe(UP);
  });

  it('translatesASequence_toKeyModChord', (): void => {
    expect(toMonacoKeybinding(monaco, 'Mod+K Mod+I')).toBe(
      chord(CTRL_CMD | KEY_K, CTRL_CMD | KEY_I),
    );
  });

  it('returnsNull_forNoChordAnUnknownKeyOrAnUnknownModifier', (): void => {
    expect(toMonacoKeybinding(monaco, '')).toBeNull();
    expect(toMonacoKeybinding(monaco, 'Mod+F13')).toBeNull();
    expect(toMonacoKeybinding(monaco, 'Hyper+F')).toBeNull();
    expect(toMonacoKeybinding(monaco, 'Mod+K Mod+I Mod+O')).toBeNull();
    expect(toMonacoKeybinding(monaco, 'Mod+K Mod+F13')).toBeNull();
  });
});

describe('EDITOR_KEYBINDINGS', () => {
  /**
   * Builds the registry with the editor catalogue on one platform.
   * @param platform The host platform.
   * @returns Returns the registry.
   */
  function build(platform: string): Keybindings {
    TestBed.configureTestingModule({
      providers: [
        { provide: Studio, useValue: { platform } },
        provideKeybindingCatalogue(EDITOR_KEYBINDINGS),
      ],
    });
    return TestBed.inject(Keybindings);
  }

  /**
   * Gets the Monaco keybinding a catalogued command resolves to.
   * @param keybindings The registry.
   * @param id The catalogued command.
   * @returns Returns the keybinding, or null for none.
   */
  function bound(keybindings: Keybindings, id: string): number | null {
    return toMonacoKeybinding(monaco, keybindings.chordFor(id) ?? '');
  }

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('resolvesOnMacOS_toTheChordsMonacoWasBoundTo', (): void => {
    const keybindings: Keybindings = build('darwin');

    expect(bound(keybindings, 'editor.find')).toBe(CTRL_CMD | KEY_F);
    expect(bound(keybindings, 'editor.findReplace')).toBe(CTRL_CMD | ALT | KEY_F);
    expect(bound(keybindings, 'editor.goToLine')).toBe(WIN_CTRL | KEY_G);
    expect(bound(keybindings, 'editor.callHierarchy')).toBe(WIN_CTRL | ALT | KEY_H);
    expect(bound(keybindings, 'editor.showHover')).toBe(chord(CTRL_CMD | KEY_K, CTRL_CMD | KEY_I));
    expect(bound(keybindings, 'editor.switchSourceHeader')).toBe(
      chord(CTRL_CMD | KEY_K, CTRL_CMD | KEY_O),
    );
    expect(bound(keybindings, 'editor.triggerSuggest')).toBe(WIN_CTRL | SPACE);
    expect(bound(keybindings, 'editor.triggerSuggestEscape')).toBe(ALT | ESCAPE);
    expect(bound(keybindings, 'editor.quickFix')).toBe(CTRL_CMD | PERIOD);
  });

  it('resolvesElsewhere_toTheChordsMonacoWasBoundTo', (): void => {
    const keybindings: Keybindings = build('win32');

    expect(bound(keybindings, 'editor.findReplace')).toBe(CTRL_CMD | KEY_H);
    expect(bound(keybindings, 'editor.goToLine')).toBe(CTRL_CMD | KEY_G);
    // Control is Ctrl off macOS, never the Windows key.
    expect(bound(keybindings, 'editor.callHierarchy')).toBe(CTRL_CMD | ALT | KEY_H);
    expect(bound(keybindings, 'editor.triggerSuggest')).toBe(CTRL_CMD | SPACE);
    expect(bound(keybindings, 'editor.triggerSuggestEscape')).toBeNull();
  });

  it('keepsTheFunctionKeyChords', (): void => {
    const keybindings: Keybindings = build('darwin');

    expect(bound(keybindings, 'editor.goToDefinition')).toBe(F12);
    expect(bound(keybindings, 'editor.findReferences')).toBe(SHIFT | F12);
    expect(bound(keybindings, 'editor.goToImplementation')).toBe(CTRL_CMD | F12);
    expect(bound(keybindings, 'editor.nextProblem')).toBe(F8);
    expect(bound(keybindings, 'editor.nextProblemAlternative')).toBe(ALT | F8);
    expect(bound(keybindings, 'editor.previousProblem')).toBe(SHIFT | F8);
    expect(bound(keybindings, 'editor.previousProblemAlternative')).toBe(SHIFT | ALT | F8);
    expect(bound(keybindings, 'editor.renameSymbol')).toBe(F2);
    expect(bound(keybindings, 'editor.showContextMenu')).toBe(SHIFT | F10);
    expect(bound(keybindings, 'diff.nextDifference')).toBe(F7);
    expect(bound(keybindings, 'diff.previousDifference')).toBe(SHIFT | F7);
  });

  it('bindsEveryDefaultToAChordMonacoCanExpress', (): void => {
    for (const platform of ['darwin', 'win32']) {
      TestBed.resetTestingModule();
      const keybindings: Keybindings = build(platform);
      for (const binding of EDITOR_KEYBINDINGS.bindings) {
        const resolved: string = keybindings.chordFor(binding.id) ?? '';
        if (resolved !== '') {
          // Every key the catalogue uses is in the stand-in, so a null means a chord Monaco lacks.
          expect(toMonacoKeybinding(monaco, resolved), `${platform} ${binding.id}`).not.toBeNull();
        }
      }
    }
  });

  it('neverBindsAnEditingChord', (): void => {
    const editing: readonly string[] = ['Mod+Z', 'Mod+Shift+Z', 'Mod+X', 'Mod+C', 'Mod+V', 'Mod+A'];
    for (const platform of ['darwin', 'win32']) {
      TestBed.resetTestingModule();
      const keybindings: Keybindings = build(platform);
      for (const binding of EDITOR_KEYBINDINGS.bindings) {
        expect(editing).not.toContain(keybindings.chordFor(binding.id));
      }
    }
  });

  it('followsAnOverride_soARebindReachesMonaco', (): void => {
    const keybindings: Keybindings = build('darwin');

    keybindings.setOverride('editor.goToLine', 'Mod+Shift+G');
    expect(bound(keybindings, 'editor.goToLine')).toBe(CTRL_CMD | SHIFT | KEY_G);

    keybindings.clearChord('editor.goToLine');
    expect(bound(keybindings, 'editor.goToLine')).toBeNull();
  });
});
