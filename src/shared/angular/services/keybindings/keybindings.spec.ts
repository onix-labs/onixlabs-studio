import { TestBed } from '@angular/core/testing';

import { Keybindings } from './keybindings';

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

  beforeEach((): void => {
    keybindings = TestBed.inject(Keybindings);
  });

  it('dispatch_whenChordMatchesActiveScope_invokesCommand', (): void => {
    const calls: string[] = [];
    keybindings.register('code', [
      { chord: 'Mod+S', command: (): void => void calls.push('save') },
    ]);

    const handled: boolean = keybindings.dispatch(modEvent('s'));

    expect(handled).toBe(true);
    expect(calls).toEqual(['save']);
  });

  it('dispatch_whenChordCaseAndModifierOrderDiffer_stillMatches', (): void => {
    const calls: string[] = [];
    keybindings.register('code', [
      { chord: 'shift+mod+S', command: (): void => void calls.push('saveAs') },
    ]);

    const handled: boolean = keybindings.dispatch(modEvent('S', { shiftKey: true }));

    expect(handled).toBe(true);
    expect(calls).toEqual(['saveAs']);
  });

  it('dispatch_whenChordDoesNotMatch_returnsFalse', (): void => {
    keybindings.register('code', [{ chord: 'Mod+S', command: (): void => void 0 }]);

    const handled: boolean = keybindings.dispatch(modEvent('p'));

    expect(handled).toBe(false);
  });

  it('dispatch_whenEventIsBareModifier_returnsFalse', (): void => {
    keybindings.register('code', [{ chord: 'Mod+S', command: (): void => void 0 }]);

    const handled: boolean = keybindings.dispatch(new KeyboardEvent('keydown', { key: 'Control' }));

    expect(handled).toBe(false);
  });

  it('dispatch_whenScopeDeactivated_doesNotInvokeCommand', (): void => {
    const calls: string[] = [];
    keybindings.register('code', [
      { chord: 'Mod+S', command: (): void => void calls.push('save') },
    ]);
    keybindings.deactivate('code');

    const handled: boolean = keybindings.dispatch(modEvent('s'));

    expect(handled).toBe(false);
    expect(calls).toEqual([]);
  });

  it('dispatch_afterAnotherScopeActivates_routesToTheNewScope', (): void => {
    const calls: string[] = [];
    keybindings.register('code', [
      { chord: 'Mod+S', command: (): void => void calls.push('code') },
    ]);
    keybindings.register('terminal', [
      { chord: 'Mod+K', command: (): void => void calls.push('clear') },
    ]);

    const codeHandled: boolean = keybindings.dispatch(modEvent('s'));
    const terminalHandled: boolean = keybindings.dispatch(modEvent('k'));

    expect(codeHandled).toBe(false);
    expect(terminalHandled).toBe(true);
    expect(calls).toEqual(['clear']);
  });

  it('dispatch_afterScopeForgotten_returnsFalse', (): void => {
    keybindings.register('code', [{ chord: 'Mod+S', command: (): void => void 0 }]);
    keybindings.forget('code');

    const handled: boolean = keybindings.dispatch(modEvent('s'));

    expect(handled).toBe(false);
  });
});
