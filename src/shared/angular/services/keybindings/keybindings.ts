import { inject, Service, signal, WritableSignal } from '@angular/core';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Defines a single keyboard accelerator: a normalized chord and the command it invokes on the scope
 * that registered it.
 */
export interface Keybinding {
  /**
   * Gets the key chord that triggers the command, written with the platform-neutral `Mod` modifier
   * (⌘ on macOS, Ctrl elsewhere) — for example `Mod+S`, `Mod+Shift+F`, or `Mod+Enter`. Modifier
   * order and casing are not significant; the chord is normalized on registration.
   */
  readonly chord: string;

  /**
   * Invokes the command bound to the chord.
   */
  readonly command: () => void;
}

/**
 * Routes application keyboard accelerators to the active view's commands, without the shell knowing
 * which feature is active.
 *
 * Each view registers its accelerators under its tab id when it activates — exactly as it registers
 * its ribbon command handler — and clears them on deactivation and disposal. Only one scope is active
 * at a time; {@link dispatch} matches an incoming key event against the active scope's bindings. The
 * shell installs a single window-level key listener that calls {@link dispatch}, so accelerators
 * compose with the focused editor: keys an embedded engine (Monaco, Milkdown, xterm) already handles
 * stop propagating and never reach the window, while genuinely-unbound chords bubble up to here.
 */
@Service()
export class Keybindings {
  /**
   * Holds the host-platform accessor, used to resolve the `Mod` modifier to ⌘ on macOS and Ctrl
   * elsewhere.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds each scope's normalized bindings, keyed by the owning tab id.
   */
  private readonly scopes: Map<string, ReadonlyMap<string, () => void>> = new Map<
    string,
    ReadonlyMap<string, () => void>
  >();

  /**
   * Holds the id of the active scope, or null when no view has registered accelerators.
   */
  private readonly activeScope: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets a value indicating whether the `Mod` modifier resolves to the ⌘ (meta) key, which it does on
   * macOS; on every other platform it resolves to Ctrl.
   */
  private readonly isMac: boolean = this.studio.platform === 'darwin';

  /**
   * Registers a scope's accelerators and marks it the active scope.
   * @param scope The owning tab identifier.
   * @param bindings The accelerators the scope contributes while active.
   */
  public register(scope: string, bindings: readonly Keybinding[]): void {
    const normalized: Map<string, () => void> = new Map<string, () => void>();
    for (const binding of bindings) {
      normalized.set(this.normalizeChord(binding.chord), binding.command);
    }
    this.scopes.set(scope, normalized);
    this.activeScope.set(scope);
  }

  /**
   * Marks a scope inactive (its view lost focus), so its accelerators no longer dispatch while its
   * registration is retained for a later re-activation.
   * @param scope The owning tab identifier.
   */
  public deactivate(scope: string): void {
    if (this.activeScope() === scope) {
      this.activeScope.set(null);
    }
  }

  /**
   * Forgets a scope entirely (its view was disposed), clearing both its bindings and its active state.
   * @param scope The owning tab identifier.
   */
  public forget(scope: string): void {
    this.scopes.delete(scope);
    if (this.activeScope() === scope) {
      this.activeScope.set(null);
    }
  }

  /**
   * Dispatches a key event to the matching accelerator in the active scope.
   * @param event The keyboard event to match.
   * @returns Returns true when a bound command was invoked, so the caller can suppress the event's
   * default; false when no accelerator matched.
   */
  public dispatch(event: KeyboardEvent): boolean {
    const chord: string | null = this.chordFromEvent(event);
    if (chord === null) {
      return false;
    }
    const scope: string | null = this.activeScope();
    if (scope === null) {
      return false;
    }
    const command: (() => void) | undefined = this.scopes.get(scope)?.get(chord);
    if (command === undefined) {
      return false;
    }
    command();
    return true;
  }

  /**
   * Derives the normalized chord for a key event, or null for a bare modifier press that cannot form a
   * chord on its own.
   * @param event The keyboard event to read.
   * @returns Returns the normalized chord, or null when the event is a lone modifier key.
   */
  private chordFromEvent(event: KeyboardEvent): string | null {
    const key: string = event.key;
    if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') {
      return null;
    }
    const parts: string[] = [];
    if (this.isMac ? event.metaKey : event.ctrlKey) {
      parts.push('Mod');
    }
    if (event.altKey) {
      parts.push('Alt');
    }
    if (event.shiftKey) {
      parts.push('Shift');
    }
    parts.push(this.normalizeKey(key));
    return parts.join('+');
  }

  /**
   * Normalizes an author-written chord to the canonical modifier order and key casing, so registration
   * and dispatch compare identically regardless of how the chord was written.
   * @param chord The chord to normalize.
   * @returns Returns the canonical chord string.
   */
  private normalizeChord(chord: string): string {
    let mod: boolean = false;
    let alt: boolean = false;
    let shift: boolean = false;
    let key: string = '';
    for (const token of chord.split('+')) {
      const trimmed: string = token.trim();
      const lower: string = trimmed.toLowerCase();
      if (lower === 'mod' || lower === 'cmd' || lower === 'ctrl' || lower === 'meta') {
        mod = true;
      } else if (lower === 'alt' || lower === 'option') {
        alt = true;
      } else if (lower === 'shift') {
        shift = true;
      } else if (trimmed.length > 0) {
        key = this.normalizeKey(trimmed);
      }
    }
    const parts: string[] = [];
    if (mod) {
      parts.push('Mod');
    }
    if (alt) {
      parts.push('Alt');
    }
    if (shift) {
      parts.push('Shift');
    }
    if (key.length > 0) {
      parts.push(key);
    }
    return parts.join('+');
  }

  /**
   * Normalizes a key name: single characters are upper-cased so `s` and `S` match, and the space bar
   * is named `Space`; every other named key (such as `Enter` or `ArrowUp`) is left unchanged.
   * @param key The key name to normalize.
   * @returns Returns the normalized key name.
   */
  private normalizeKey(key: string): string {
    if (key === ' ') {
      return 'Space';
    }
    return key.length === 1 ? key.toUpperCase() : key;
  }
}
