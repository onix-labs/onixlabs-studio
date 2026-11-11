import { TestBed } from '@angular/core/testing';

import { KeybindingCatalogueEntry, provideKeybindingCatalogue } from './keybinding-catalogue';
import { Keybindings, ResolvedBinding } from './keybindings';
import { Settings } from '@shared/angular/services/settings/settings';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Builds a keyboard event carrying the Ctrl-based `Mod` modifier used off macOS, where the tests run
 * (outside Electron the host platform is `browser`, so `Mod` resolves to Ctrl).
 * @param key The event key.
 * @param modifiers The additional modifier flags to set.
 * @returns Returns the constructed keyboard event.
 */
function modEvent(
  key: string,
  modifiers: Partial<Pick<KeyboardEventInit, 'shiftKey' | 'altKey'>> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ctrlKey: true, ...modifiers });
}

/**
 * Stands in for the catalogue entry a lazily-loaded feature contributes after start-up.
 */
const LAZY_ENTRY: KeybindingCatalogueEntry = {
  view: 'API Explorer',
  bindings: [
    { id: 'api.save', description: 'Save', chord: 'Mod+S' },
    { id: 'api.saveAs', description: 'Save As', chord: 'Mod+Shift+S' },
  ],
};

describe('Keybindings', () => {
  let keybindings: Keybindings;

  /**
   * Configures the testing module with a two-view catalogue — an unconstrained code entry and a
   * Mod+Shift-only terminal entry — and resolves the service under test.
   */
  beforeEach((): void => {
    TestBed.configureTestingModule({
      providers: [
        provideKeybindingCatalogue({
          view: 'Code Editor',
          bindings: [
            { id: 'code.save', description: 'Save', chord: 'Mod+S' },
            { id: 'code.saveAs', description: 'Save As', chord: 'shift+mod+S' },
          ],
        }),
        provideKeybindingCatalogue({
          view: 'Terminal',
          modShiftOnly: true,
          bindings: [{ id: 'terminal.clear', description: 'Clear', chord: 'Mod+Shift+K' }],
        }),
      ],
    });
    keybindings = TestBed.inject(Keybindings);
  });

  afterEach((): void => {
    // Overrides persist through the Settings store into localStorage, which outlives each test
    // (specs run with isolate=false), so drop the store to keep the suites order-independent.
    window.localStorage.removeItem('settings');
  });

  it('matches_testsAnEventAgainstACommandsEffectiveChordWithoutAScope', (): void => {
    expect(keybindings.matches(modEvent('s'), 'code.save')).toBe(true);
    expect(keybindings.matches(modEvent('s', { shiftKey: true }), 'code.save')).toBe(false);
    expect(keybindings.matches(modEvent('s'), 'unknown.command')).toBe(false);
    expect(keybindings.matches(new KeyboardEvent('keydown', { key: 'Control' }), 'code.save')).toBe(
      false,
    );

    keybindings.setOverride('code.save', 'Mod+Alt+P');
    expect(keybindings.matches(modEvent('p', { altKey: true }), 'code.save')).toBe(true);
    expect(keybindings.matches(modEvent('s'), 'code.save')).toBe(false);
  });

  it('dispatch_whenChordMatchesActiveScope_invokesCommand', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('save') },
    ]);

    const handled: boolean = keybindings.dispatch(modEvent('s'));

    expect(handled).toBe(true);
    expect(calls).toEqual(['save']);
  });

  it('dispatch_whenCatalogueChordWrittenInAnyOrder_stillMatches', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.saveAs', command: (): void => void calls.push('saveAs') },
    ]);

    const handled: boolean = keybindings.dispatch(modEvent('S', { shiftKey: true }));

    expect(handled).toBe(true);
    expect(calls).toEqual(['saveAs']);
  });

  it('dispatch_whenChordDoesNotMatch_returnsFalse', (): void => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => void 0 }]);

    expect(keybindings.dispatch(modEvent('p'))).toBe(false);
  });

  it('dispatch_whenEventIsBareModifier_returnsFalse', (): void => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => void 0 }]);

    expect(keybindings.dispatch(new KeyboardEvent('keydown', { key: 'Control' }))).toBe(false);
  });

  it('dispatch_whenScopeDeactivated_doesNotInvokeCommand', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('save') },
    ]);
    keybindings.deactivate('tab-1');

    expect(keybindings.dispatch(modEvent('s'))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('dispatch_withAPreferredScope_routesToItEvenWhileAnotherIsActive', (): void => {
    // A pop-out window dispatches with its owning view's scope: the view keeps working there even
    // while another tab is active (and hence another scope) in the main window.
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('popped-save') },
    ]);
    keybindings.register('tab-2', [
      { id: 'terminal.clear', command: (): void => void calls.push('clear') },
    ]);

    expect(keybindings.dispatch(modEvent('s'), 'tab-1')).toBe(true);
    expect(calls).toEqual(['popped-save']);
  });

  it('dispatch_withAPreferredScope_stillFallsBackToTheGlobalScope', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('save') },
    ]);
    keybindings.registerGlobal([
      { id: 'code.saveAs', command: (): void => void calls.push('global-save-as') },
    ]);

    expect(keybindings.dispatch(modEvent('S', { shiftKey: true }), 'tab-1')).toBe(true);
    expect(calls).toEqual(['global-save-as']);
  });

  it('dispatch_afterAnotherScopeActivates_routesToTheNewScope', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('code') },
    ]);
    keybindings.register('tab-2', [
      { id: 'terminal.clear', command: (): void => void calls.push('clear') },
    ]);

    expect(keybindings.dispatch(modEvent('s'))).toBe(false);
    expect(keybindings.dispatch(modEvent('K', { shiftKey: true }))).toBe(true);
    expect(calls).toEqual(['clear']);
  });

  it('dispatch_afterScopeForgotten_returnsFalse', (): void => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => void 0 }]);
    keybindings.forget('tab-1');

    expect(keybindings.dispatch(modEvent('s'))).toBe(false);
  });

  it('register_whenIdIsNotCatalogued_skipsTheBinding', (): void => {
    keybindings.register('tab-1', [{ id: 'code.unknown', command: (): void => void 0 }]);

    expect(keybindings.activeBindings()).toEqual([]);
  });

  it('dispatch_whenGlobalScopeRegistered_dispatchesInEveryContext', (): void => {
    const calls: string[] = [];
    keybindings.registerGlobal([
      { id: 'code.save', command: (): void => void calls.push('global') },
    ]);

    expect(keybindings.dispatch(modEvent('s'))).toBe(true);
    expect(calls).toEqual(['global']);
  });

  it('dispatch_whenActiveScopeAndGlobalCollide_activeScopeWins', (): void => {
    const calls: string[] = [];
    keybindings.registerGlobal([
      { id: 'code.save', command: (): void => void calls.push('global') },
    ]);
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('active') },
    ]);

    keybindings.dispatch(modEvent('s'));

    expect(calls).toEqual(['active']);
  });

  it('setOverride_changesTheDispatchedChordImmediately', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'code.save', command: (): void => void calls.push('save') },
    ]);

    expect(keybindings.setOverride('code.save', 'Mod+Alt+P')).toBeNull();

    expect(keybindings.dispatch(modEvent('s'))).toBe(false);
    expect(keybindings.dispatch(modEvent('p', { altKey: true }))).toBe(true);
    expect(calls).toEqual(['save']);
  });

  it('setOverride_persistsThroughSettings_andClearRestoresTheDefault', (): void => {
    const settings: Settings = TestBed.inject(Settings);
    keybindings.setOverride('code.save', 'Mod+Alt+P');
    expect(settings.get('keyboard.overrides')).toEqual({ 'code.save': 'Mod+Alt+P' });

    keybindings.clearOverride('code.save');

    expect(settings.get('keyboard.overrides')).toEqual({});
    const resolved: ResolvedBinding | undefined = keybindings
      .resolvedCatalogue()
      .find((binding: ResolvedBinding): boolean => binding.id === 'code.save');
    expect(resolved?.chord).toBe('Mod+S');
    expect(resolved?.overridden).toBe(false);
  });

  it('setOverride_whenChordHasNoKey_rejects', (): void => {
    expect(keybindings.setOverride('code.save', 'Mod+Shift')).not.toBeNull();
    expect(keybindings.resolvedCatalogue()[0].chord).toBe('Mod+S');
  });

  it('setOverride_whenTerminalOverrideDropsShift_rejects', (): void => {
    expect(keybindings.setOverride('terminal.clear', 'Mod+K')).not.toBeNull();
    expect(keybindings.setOverride('terminal.clear', 'Mod+Shift+L')).toBeNull();
  });

  it('conflictedIds_whenTwoSameViewCommandsShareAChord_flagsBoth', (): void => {
    expect(keybindings.conflictedIds().size).toBe(0);

    keybindings.setOverride('code.saveAs', 'Mod+S');

    expect(keybindings.conflictedIds()).toEqual(new Set(['code.save', 'code.saveAs']));
  });

  it('resolvedCatalogue_reflectsTheContributedEntries', (): void => {
    const views: string[] = keybindings
      .resolvedCatalogue()
      .map((binding: ResolvedBinding): string => binding.view);

    expect(views).toEqual(['Code Editor', 'Code Editor', 'Terminal']);
  });

  it('contribute_afterStartUp_addsTheEntryToTheCatalogue', (): void => {
    keybindings.contribute(LAZY_ENTRY);

    const views: string[] = keybindings
      .resolvedCatalogue()
      .map((binding: ResolvedBinding): string => binding.view);
    expect(views).toEqual([
      'Code Editor',
      'Code Editor',
      'Terminal',
      'API Explorer',
      'API Explorer',
    ]);
  });

  it('contribute_letsItsIdsRegisterAndDispatch', (): void => {
    const calls: string[] = [];
    keybindings.register('tab-1', [
      { id: 'api.save', command: (): void => void calls.push('early') },
    ]);
    expect(keybindings.dispatch(modEvent('s'))).toBe(false);

    keybindings.contribute(LAZY_ENTRY);
    keybindings.register('tab-1', [
      { id: 'api.save', command: (): void => void calls.push('save') },
      { id: 'api.saveAs', command: (): void => void calls.push('saveAs') },
    ]);

    expect(keybindings.dispatch(modEvent('s'))).toBe(true);
    expect(keybindings.dispatch(modEvent('s', { shiftKey: true }))).toBe(true);
    expect(calls).toEqual(['save', 'saveAs']);
    expect(
      keybindings.activeBindings().map((binding: ResolvedBinding): string => binding.id),
    ).toEqual(['api.save', 'api.saveAs']);
  });

  it('contribute_appliesAnOverridePersistedBeforeTheEntryArrived', (): void => {
    TestBed.inject(Settings).set('keyboard.overrides', { 'api.save': 'Mod+Alt+P' });

    keybindings.contribute(LAZY_ENTRY);

    expect(keybindings.matches(modEvent('p', { altKey: true }), 'api.save')).toBe(true);
    const resolved: ResolvedBinding | undefined = keybindings
      .resolvedCatalogue()
      .find((binding: ResolvedBinding): boolean => binding.id === 'api.save');
    expect(resolved?.overridden).toBe(true);
  });

  it('contribute_whenTheEntryIsAlreadyCatalogued_isIgnored', (): void => {
    keybindings.contribute(LAZY_ENTRY);
    keybindings.contribute(LAZY_ENTRY);

    expect(keybindings.resolvedCatalogue()).toHaveLength(5);
  });

  it('contribute_surfacesConflictsWithinTheContributedEntry', (): void => {
    keybindings.contribute(LAZY_ENTRY);

    keybindings.setOverride('api.saveAs', 'Mod+S');

    expect(keybindings.conflictedIds()).toEqual(new Set(['api.save', 'api.saveAs']));
  });

  it('formatChord_offMac_usesCtrlStyle', (): void => {
    expect(keybindings.formatChord('Mod+Shift+S')).toBe('Ctrl+Shift+S');
  });

  it('validateOverride_whenTheChordIsAnEditingChord_rejectsIt', (): void => {
    // The editing chords are the native roles' in every text box; a command moved onto one would take
    // it from the menu's Copy or Paste.
    for (const chord of ['Mod+Z', 'Mod+Shift+Z', 'Mod+X', 'Mod+C', 'Mod+V', 'Mod+A']) {
      expect(keybindings.validateOverride('code.save', chord)).not.toBeNull();
    }
    expect(keybindings.setOverride('code.save', 'mod+c')).not.toBeNull();
    expect(keybindings.chordFor('code.save')).toBe('Mod+S');
  });

  it('chordFor_followsTheOverrideAndIsNullForAnUncataloguedCommand', (): void => {
    expect(keybindings.chordFor('code.saveAs')).toBe('Mod+Shift+S');
    expect(keybindings.chordFor('unknown.command')).toBeNull();

    keybindings.setOverride('code.saveAs', 'Mod+Alt+S');

    expect(keybindings.chordFor('code.saveAs')).toBe('Mod+Alt+S');
  });

  it('toAccelerator_writesTheChordInElectronsNotation', (): void => {
    expect(keybindings.toAccelerator('Mod+Shift+S')).toBe('CmdOrCtrl+Shift+S');
    expect(keybindings.toAccelerator('Mod+Alt+ArrowUp')).toBe('CmdOrCtrl+Alt+Up');
    expect(keybindings.toAccelerator('Mod+Enter')).toBe('CmdOrCtrl+Enter');
    expect(keybindings.toAccelerator('Mod+,')).toBe('CmdOrCtrl+,');
  });

  it('conflictedIds_whenAnApplicationCommandSharesAViewsChord_flagsBoth', (): void => {
    keybindings.contribute({
      view: 'Application',
      global: true,
      bindings: [{ id: 'app.closeTab', description: 'Close Tab', chord: 'Mod+W' }],
    });
    expect(keybindings.isGlobal('app.closeTab')).toBe(true);
    expect(keybindings.isGlobal('code.save')).toBe(false);
    expect(keybindings.conflictedIds().size).toBe(0);

    keybindings.setOverride('code.save', 'Mod+W');

    expect([...keybindings.conflictedIds()].sort()).toEqual(['app.closeTab', 'code.save']);
    const closeTab: ResolvedBinding | undefined = keybindings
      .resolvedCatalogue()
      .find((binding: ResolvedBinding): boolean => binding.id === 'app.closeTab');
    expect(closeTab?.global).toBe(true);
  });

  it('chordKeys_splitsAChordIntoTheKeysPressed', (): void => {
    // Off macOS, where the tests run, the modifiers are named.
    expect(keybindings.chordKeys('Mod+Shift+T')).toEqual(['Ctrl', 'Shift', 'T']);
    expect(keybindings.chordKeys('Mod+ArrowDown')).toEqual(['Ctrl', '↓']);
    expect(keybindings.chordKeys('')).toEqual([]);
    expect(keybindings.formatChord('Mod+Shift+T')).toBe('Ctrl+Shift+T');
  });

  it('clearChord_leavesTheCommandWithNoShortcutUntilReset', (): void => {
    keybindings.register('tab-1', [{ id: 'code.save', command: (): void => undefined }]);

    keybindings.clearChord('code.save');

    expect(keybindings.chordFor('code.save')).toBe('');
    expect(keybindings.dispatch(modEvent('s'))).toBe(false);
    expect(keybindings.matches(modEvent('s'), 'code.save')).toBe(false);
    expect(keybindings.conflictedIds().size).toBe(0);

    keybindings.clearOverride('code.save');

    expect(keybindings.chordFor('code.save')).toBe('Mod+S');
  });

  it('control_offMac_isMod', (): void => {
    expect(keybindings.normalizeChord('Control+Space')).toBe('Mod+Space');
    expect(keybindings.normalizeChord('alt+control+h')).toBe('Mod+Alt+H');
  });

  it('sequences_normalizeFormatAndSplitStepByStep', (): void => {
    expect(keybindings.normalizeChord(' mod+k   i+mod ')).toBe('Mod+K Mod+I');
    expect(keybindings.formatChord('Mod+K Mod+I')).toBe('Ctrl+K Ctrl+I');
    expect(keybindings.chordKeys('Mod+K Mod+I')).toEqual(['Ctrl', 'K', ',', 'Ctrl', 'I']);
    // Electron's menus cannot show a sequence.
    expect(keybindings.toAccelerator('Mod+K Mod+I')).toBe('');
  });

  it('validateOverride_checksEveryStepOfASequence', (): void => {
    expect(keybindings.validateOverride('code.save', 'Mod+K Mod+I')).toBeNull();
    expect(keybindings.validateOverride('code.save', 'Mod+K Mod+C')).not.toBeNull();
    expect(keybindings.validateOverride('terminal.clear', 'Mod+Shift+K Mod+I')).not.toBeNull();
    expect(keybindings.validateOverride('terminal.clear', 'Mod+Shift+K Mod+Shift+I')).toBeNull();
  });
});

describe('Keybindings on macOS', () => {
  let keybindings: Keybindings;

  /**
   * Configures the registry on macOS with a binding that has its own macOS chord, one that only
   * macOS has, and one written with the Control key.
   */
  beforeEach((): void => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Studio, useValue: { platform: 'darwin' } },
        provideKeybindingCatalogue({
          view: 'Text Editor',
          bindings: [
            {
              id: 'editor.goToLine',
              description: 'Go to Line',
              chord: 'Mod+G',
              macChord: 'Control+G',
            },
            { id: 'editor.macOnly', description: 'Mac only', chord: '', macChord: 'Alt+Escape' },
            { id: 'editor.suggest', description: 'Suggest', chord: 'Control+Space' },
          ],
        }),
      ],
    });
    keybindings = TestBed.inject(Keybindings);
  });

  afterEach((): void => {
    window.localStorage.removeItem('settings');
  });

  it('takesTheMacChord_asTheDefault', (): void => {
    expect(keybindings.chordFor('editor.goToLine')).toBe('Control+G');
    expect(keybindings.chordFor('editor.macOnly')).toBe('Alt+Escape');
    const goToLine: ResolvedBinding | undefined = keybindings
      .resolvedCatalogue()
      .find((binding: ResolvedBinding): boolean => binding.id === 'editor.goToLine');
    expect(goToLine?.defaultChord).toBe('Control+G');
    expect(goToLine?.overridden).toBe(false);
  });

  it('keepsControl_apartFromCommand', (): void => {
    expect(keybindings.normalizeChord('shift+control+mod+h')).toBe('Mod+Control+Shift+H');
    expect(keybindings.formatChord('Control+Space')).toBe('⌃Space');
    expect(keybindings.chordKeys('Mod+Control+G')).toEqual(['⌘', '⌃', 'G']);
    expect(keybindings.toAccelerator('Control+G')).toBe('Ctrl+G');
  });

  it('readsTheControlKey_fromAnEvent', (): void => {
    const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true });
    expect(keybindings.chordFromEvent(event)).toBe('Control+G');
    expect(keybindings.matches(event, 'editor.goToLine')).toBe(true);
    expect(
      keybindings.matches(
        new KeyboardEvent('keydown', { key: 'g', metaKey: true }),
        'editor.goToLine',
      ),
    ).toBe(false);
  });
});
