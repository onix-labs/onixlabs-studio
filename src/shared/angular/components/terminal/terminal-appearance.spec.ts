import { TERMINAL_FONT_SAME_AS_CODE } from '@shared/angular/services/settings/settings-registry';
import {
  TerminalAppearance,
  TerminalAppearanceInputs,
  terminalAppearance,
  terminalPalette,
} from './terminal-appearance';

describe('terminalAppearance', () => {
  const defaults: TerminalAppearanceInputs = {
    fontFamily: TERMINAL_FONT_SAME_AS_CODE,
    fontSize: 0,
    codeFontFamily: 'JetBrains Mono',
    codeFontSize: 14,
    zoomPercent: 100,
    scrollback: 5000,
    cursorStyle: 'block',
    cursorBlink: true,
    renderer: 'gpu',
    graphics: 'full',
    readOnly: false,
  };

  it('sameAsCode_takesCodesFontAndSize', () => {
    const look: TerminalAppearance = terminalAppearance(defaults);
    expect(look.fontFamily).toMatch(/^"JetBrains Mono", /);
    expect(look.fontSize).toBe(14);
  });

  it('aFontAndSizeOfItsOwn_winOverCodes', () => {
    const look: TerminalAppearance = terminalAppearance({
      ...defaults,
      fontFamily: 'Menlo',
      fontSize: 12,
    });
    expect(look.fontFamily).toMatch(/^"Menlo", /);
    expect(look.fontSize).toBe(12);
  });

  it('fontSize_followsTheEditorZoom_eitherWay_andStaysLegible', () => {
    expect(terminalAppearance({ ...defaults, zoomPercent: 150 }).fontSize).toBe(21);
    expect(terminalAppearance({ ...defaults, fontSize: 12, zoomPercent: 50 }).fontSize).toBe(6);
    expect(terminalAppearance({ ...defaults, fontSize: 10, zoomPercent: 25 }).fontSize).toBe(6);
  });

  it('aFontNameCannotBreakOutOfItsQuotes', () => {
    expect(terminalAppearance({ ...defaults, fontFamily: 'A", serif, "B' }).fontFamily).toMatch(
      /^"A, serif, B", /,
    );
  });

  it('gpu_onlyWhenChosen_andWhileAccelerationIsOn', () => {
    expect(terminalAppearance(defaults).gpu).toBe(true);
    expect(terminalAppearance({ ...defaults, graphics: 'limited' }).gpu).toBe(true);
    expect(terminalAppearance({ ...defaults, graphics: 'off' }).gpu).toBe(false);
    expect(terminalAppearance({ ...defaults, renderer: 'standard' }).gpu).toBe(false);
  });

  it('aReadOnlyTaskConsole_neverBlinks', () => {
    expect(terminalAppearance({ ...defaults, readOnly: true }).cursorBlink).toBe(false);
    expect(terminalAppearance({ ...defaults, cursorBlink: false }).cursorBlink).toBe(false);
  });
});

describe('terminalPalette', () => {
  it('matchesTheMode_withEverySixteenColour', () => {
    const names: readonly string[] = [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
    ];
    for (const dark of [true, false]) {
      const palette: Record<string, unknown> = terminalPalette(dark);
      for (const name of names) {
        const bright: string = `bright${name[0].toUpperCase()}${name.slice(1)}`;
        expect(palette[name]).toMatch(/^#[0-9a-f]{6}$/);
        expect(palette[bright]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(terminalPalette(true).yellow).not.toBe(terminalPalette(false).yellow);
  });
});
