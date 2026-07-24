import { TestBed } from '@angular/core/testing';

import { provideKeybindingCatalogue } from './keybinding-catalogue';
import { Keybindings, ResolvedBinding } from './keybindings';
import { Settings } from '@shared/angular/services/settings/settings';

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

  it('formatChord_offMac_usesCtrlStyle', (): void => {
    expect(keybindings.formatChord('Mod+Shift+S')).toBe('Ctrl+Shift+S');
  });
});
