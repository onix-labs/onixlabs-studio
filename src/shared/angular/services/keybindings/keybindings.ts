import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  CatalogueBinding,
  KEYBINDING_CATALOGUE,
  KeybindingCatalogueEntry,
} from './keybinding-catalogue';
import { Settings } from '@shared/angular/services/settings/settings';
import { Studio } from '@shared/angular/services/studio/studio';
import { Log } from '@shared/angular/services/log/log';

/**
 * Defines a single keyboard accelerator registration: the catalogued command identifier and the
 * handler invoked when its chord is pressed. The chord and description live in the feature's
 * {@link KeybindingCatalogueEntry}, layered with the user's persisted overrides, so a registration
 * names only the command it implements.
 */
export interface Keybinding {
  /**
   * Gets the catalogued command identifier (for example `code.save`).
   */
  readonly id: string;

  /**
   * Invokes the command bound to the identifier's effective chord.
   */
  readonly command: () => void;
}

/**
 * Describes one resolved accelerator for the discoverability surfaces: its identity, human
 * description, owning view label, and the chord currently in effect (the user's override when one
 * is persisted and valid, else the catalogued default).
 */
export interface ResolvedBinding {
  /**
   * Gets the catalogued command identifier.
   */
  readonly id: string;

  /**
   * Gets the human description of the command.
   */
  readonly description: string;

  /**
   * Gets the label of the view that owns the binding.
   */
  readonly view: string;

  /**
   * Gets the normalized chord currently in effect.
   */
  readonly chord: string;

  /**
   * Gets the normalized default chord, which Reset restores.
   */
  readonly defaultChord: string;

  /**
   * Gets a value indicating whether the effective chord is a user override rather than the default.
   */
  readonly overridden: boolean;

  /**
   * Gets a value indicating whether the command is application-wide (Application › Keyboard) rather
   * than one view's.
   */
  readonly global: boolean;
}

/**
 * Names the reserved scope the shell's application-level accelerators register under. It dispatches
 * regardless of which view is active, after the active view has had first refusal.
 */
const GLOBAL_SCOPE: string = '__global__';

/**
 * Names the editing chords no command may take. The core menu carries them once as native roles,
 * which Chromium routes to whatever holds focus, and the editors bind ⌘A to their own selection; a
 * menu command overridden onto one would take it from every text box, editor and terminal.
 */
const EDITING_CHORDS: ReadonlySet<string> = new Set<string>([
  'Mod+Z',
  'Mod+Shift+Z',
  'Mod+X',
  'Mod+C',
  'Mod+V',
  'Mod+A',
]);

/**
 * Maps the key names a normalized chord uses to Electron's accelerator names, where they differ.
 */
const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/**
 * Maps the key names a normalized chord uses to the symbols a key cap shows, where they differ.
 */
const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * Names the override value that leaves a command with no shortcut at all (Clear in Settings).
 */
const NO_CHORD: string = '';

/**
 * Separates the chords of a sequence pressed one after the other (`Mod+K Mod+I`).
 */
const CHORD_STEP_SEPARATOR: string = ' ';

/**
 * Names the modifiers of a normalized chord, none of which is a key on its own.
 */
const MODIFIERS: ReadonlySet<string> = new Set<string>(['Mod', 'Control', 'Alt', 'Shift']);

/**
 * Routes application keyboard accelerators to the active view's commands, without the shell knowing
 * which feature is active.
 *
 * Features contribute a {@link KeybindingCatalogueEntry} (command ids, descriptions, default chords)
 * through the `KEYBINDING_CATALOGUE` multi-provider, and each view registers `{id, command}` pairs
 * under its tab id when it activates — exactly as it registers its ribbon command handler — and
 * clears them on deactivation and disposal. Only one scope is active at a time; the shell's
 * application-level accelerators live in a reserved global scope that dispatches after the active
 * view. Chords resolve at dispatch time as the user's persisted override (from the
 * `keyboard.overrides` setting) when valid, else the catalogued default — so an override takes
 * effect immediately, with no re-registration.
 *
 * The shell installs a single window-level key listener that calls {@link dispatch}, so accelerators
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
   * Holds the settings store the user's chord overrides persist in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the logging client for reporting registrations skipped as uncatalogued.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the feature-contributed keybinding catalogue entries: those provided at the composition
   * root, followed by any a lazily-loaded feature {@link contribute}s once its chunk resolves.
   */
  private readonly catalogueEntries: KeybindingCatalogueEntry[] = [
    ...(inject(KEYBINDING_CATALOGUE, { optional: true }) ?? []),
  ];

  /**
   * Holds each catalogued binding and its owning entry, keyed by command id.
   */
  private readonly catalogueById: Map<
    string,
    { readonly entry: KeybindingCatalogueEntry; readonly binding: CatalogueBinding }
  > = new Map<string, { entry: KeybindingCatalogueEntry; binding: CatalogueBinding }>();

  /**
   * Bumps whenever a lazily-loaded feature contributes a catalogue entry, so computed surfaces
   * re-derive from the non-reactive {@link catalogueEntries} and {@link catalogueById}.
   */
  private readonly catalogueVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Holds each scope's registered bindings, in registration order, keyed by the owning tab id.
   */
  private readonly scopes: Map<string, readonly Keybinding[]> = new Map<
    string,
    readonly Keybinding[]
  >();

  /**
   * Bumps whenever a scope registers or is forgotten, so computed surfaces re-derive from the
   * non-reactive {@link scopes} map.
   */
  private readonly scopesVersion: WritableSignal<number> = signal<number>(0);

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
   * Gets the user's persisted chord overrides, keyed by command id.
   */
  private readonly overrides: Signal<Readonly<Record<string, string>>> =
    this.settings.value('keyboard.overrides');

  /**
   * Gets every catalogued binding resolved to its effective chord, in contribution order. This is
   * the Keyboard settings section's model.
   */
  public readonly resolvedCatalogue: Signal<readonly ResolvedBinding[]> = computed(
    (): readonly ResolvedBinding[] => {
      this.catalogueVersion();
      return this.catalogueEntries.flatMap(
        (entry: KeybindingCatalogueEntry): readonly ResolvedBinding[] =>
          entry.bindings.map((binding: CatalogueBinding): ResolvedBinding =>
            this.resolve(binding, entry),
          ),
      );
    },
  );

  /**
   * Gets the command ids whose effective chords collide with another binding that can be live at the
   * same time: one in the same view (a single scope dispatches at a time), or an application-wide
   * command against any view's, since the application's commands work whichever tab is in front.
   * Dispatch resolves a collision — the view first, then registration order — so a conflict is
   * surfaced as a warning rather than blocking.
   */
  public readonly conflictedIds: Signal<ReadonlySet<string>> = computed((): ReadonlySet<string> => {
    this.catalogueVersion();
    const conflicted: Set<string> = new Set<string>();
    const globals: readonly ResolvedBinding[] = this.catalogueEntries
      .filter((entry: KeybindingCatalogueEntry): boolean => entry.global === true)
      .flatMap((entry: KeybindingCatalogueEntry): readonly ResolvedBinding[] =>
        entry.bindings.map((binding: CatalogueBinding): ResolvedBinding =>
          this.resolve(binding, entry),
        ),
      );
    for (const entry of this.catalogueEntries) {
      const byChord: Map<string, string[]> = new Map<string, string[]>();
      for (const binding of entry.bindings) {
        const chord: string = this.resolve(binding, entry).chord;
        if (chord !== NO_CHORD) {
          byChord.set(chord, [...(byChord.get(chord) ?? []), binding.id]);
        }
      }
      if (entry.global !== true) {
        for (const global of globals) {
          const ids: string[] | undefined =
            global.chord === NO_CHORD ? undefined : byChord.get(global.chord);
          if (ids !== undefined) {
            ids.push(global.id);
          }
        }
      }
      for (const ids of byChord.values()) {
        if (ids.length > 1) {
          ids.forEach((id: string): void => void conflicted.add(id));
        }
      }
    }
    return conflicted;
  });

  /**
   * Gets the accelerators available right now — the active view's bindings followed by the shell's
   * global ones — resolved to their effective chords, so user overrides are reflected.
   */
  public readonly activeBindings: Signal<readonly ResolvedBinding[]> = computed(
    (): readonly ResolvedBinding[] => {
      this.scopesVersion();
      this.catalogueVersion();
      const scopes: string[] = [];
      const active: string | null = this.activeScope();
      if (active !== null) {
        scopes.push(active);
      }
      scopes.push(GLOBAL_SCOPE);
      return scopes.flatMap((scope: string): readonly ResolvedBinding[] =>
        (this.scopes.get(scope) ?? []).flatMap(
          (registration: Keybinding): readonly ResolvedBinding[] => {
            const catalogued:
              { entry: KeybindingCatalogueEntry; binding: CatalogueBinding } | undefined =
              this.catalogueById.get(registration.id);
            return catalogued === undefined
              ? []
              : [this.resolve(catalogued.binding, catalogued.entry)];
          },
        ),
      );
    },
  );

  /**
   * Initializes the service, indexing the contributed catalogue by command id.
   */
  public constructor() {
    for (const entry of this.catalogueEntries) {
      this.index(entry);
    }
  }

  /**
   * Adds a catalogue entry after start-up, for a feature contributed lazily — its chunk resolves after
   * bootstrap, so it cannot reach the `KEYBINDING_CATALOGUE` multi-provider. The entry then behaves
   * exactly as a root-provided one: its ids register, resolve overrides and appear in the
   * discoverability surfaces. Contributing the same entry again is ignored.
   * @param entry The catalogue entry the feature contributes.
   */
  public contribute(entry: KeybindingCatalogueEntry): void {
    if (this.catalogueEntries.includes(entry)) {
      return;
    }
    this.catalogueEntries.push(entry);
    this.index(entry);
    this.catalogueVersion.update((version: number): number => version + 1);
    this.log.info(
      'Keybindings',
      `Catalogue contributed for '${entry.view}'`,
      entry.bindings.length,
    );
  }

  /**
   * Registers a scope's accelerators and marks it the active scope. An id missing from the catalogue
   * is skipped with a warning — it cannot resolve a chord or appear in the discoverability surfaces.
   * @param scope The owning tab identifier.
   * @param bindings The accelerators the scope contributes while active.
   */
  public register(scope: string, bindings: readonly Keybinding[]): void {
    const known: Keybinding[] = [];
    for (const binding of bindings) {
      if (this.catalogueById.has(binding.id)) {
        known.push(binding);
      } else {
        this.log.warn(
          'keybindings',
          `'${binding.id}' is not in the keybinding catalogue; skipped.`,
        );
      }
    }
    this.scopes.set(scope, known);
    this.activeScope.set(scope);
    this.scopesVersion.update((version: number): number => version + 1);
    this.log.info('Keybindings', `Registered scope '${scope}'`, known.length);
  }

  /**
   * Registers the shell's application-level accelerators, which dispatch in every context after the
   * active view has had first refusal. Registering again replaces the previous global set; the
   * active view scope is left untouched.
   * @param bindings The application-level accelerators.
   */
  public registerGlobal(bindings: readonly Keybinding[]): void {
    const active: string | null = this.activeScope();
    this.register(GLOBAL_SCOPE, bindings);
    this.activeScope.set(active);
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
    this.scopesVersion.update((version: number): number => version + 1);
    this.log.debug('Keybindings', `Forgot scope '${scope}'`);
  }

  /**
   * Dispatches a key event to the matching accelerator — the preferred scope (or the active one)
   * first, then the shell's global scope. Within a scope, the first registered binding whose
   * effective chord matches wins, which is also how a surfaced conflict resolves.
   * @param event The keyboard event to match.
   * @param scope The scope to prefer over the active one. A pop-out window dispatches with its
   * owning view's scope, so its chords act on that view even while another tab is active in the
   * main window (a view's registrations are retained through deactivation).
   * @returns Returns true when a bound command was invoked, so the caller can suppress the event's
   * default; false when no accelerator matched.
   */
  public dispatch(event: KeyboardEvent, scope?: string): boolean {
    const chord: string | null = this.chordFromEvent(event);
    if (chord === null) {
      return false;
    }
    for (const candidate of [scope ?? this.activeScope(), GLOBAL_SCOPE]) {
      if (candidate === null) {
        continue;
      }
      for (const registration of this.scopes.get(candidate) ?? []) {
        if (this.effectiveChord(registration.id) === chord) {
          this.log.info('Keybindings', `Dispatched '${registration.id}'`, chord, candidate);
          registration.command();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Determines whether a key event presses a catalogued command's effective chord — its user override
   * when one is set, else its default. For a surface that handles its own chords while it has focus
   * rather than registering a scope: an image in a workspace's document well cannot register under
   * the workspace tab's scope without displacing the workspace's own accelerators.
   * @param event The keyboard event to test.
   * @param id The catalogued command identifier.
   * @returns Returns true when the event presses the command's chord; false otherwise, including when
   * the command is not catalogued.
   */
  public matches(event: KeyboardEvent, id: string): boolean {
    const chord: string | null = this.chordFromEvent(event);
    return chord !== null && this.catalogueById.has(id) && this.effectiveChord(id) === chord;
  }

  /**
   * Gets the chord currently in effect for a catalogued command — the user's override when one is set
   * and valid, else the default — so a surface that shows or binds the chord itself (the application
   * menu) agrees with dispatch. Reactive: it re-reads when an override changes or a lazily-loaded
   * feature contributes the command.
   * @param id The catalogued command identifier.
   * @returns Returns the normalized effective chord (empty when the user cleared it), or null when the
   * command is not catalogued.
   */
  public chordFor(id: string): string | null {
    this.catalogueVersion();
    return this.catalogueById.has(id) ? this.effectiveChord(id) : null;
  }

  /**
   * Determines whether a catalogued command is application-wide rather than one view's.
   * @param id The catalogued command identifier.
   * @returns Returns true for a command of a `global` catalogue entry; false otherwise.
   */
  public isGlobal(id: string): boolean {
    this.catalogueVersion();
    return this.catalogueById.get(id)?.entry.global === true;
  }

  /**
   * Converts a normalized chord to Electron's accelerator notation (`Mod+Shift+S` → `CmdOrCtrl+Shift+S`),
   * for the application menu, which displays and binds accelerators in that notation.
   * @param chord The normalized chord.
   * @returns Returns the Electron accelerator.
   */
  public toAccelerator(chord: string): string {
    // An accelerator is one chord: a menu cannot show or bind two pressed in turn, so such a command
    // keeps its menu item with no accelerator, and its editor still runs it.
    if (chord.includes(CHORD_STEP_SEPARATOR)) {
      return '';
    }
    return chord
      .split('+')
      .map((part: string): string => {
        if (part === 'Mod') {
          return 'CmdOrCtrl';
        }
        // Electron's `Ctrl` is the Control key itself on every platform.
        return part === 'Control' ? 'Ctrl' : (ACCELERATOR_KEYS[part] ?? part);
      })
      .join('+');
  }

  /**
   * Persists a chord override for a command, replacing its default. The chord is validated first; an
   * invalid chord is rejected and reported instead of applied.
   * @param id The catalogued command identifier.
   * @param chord The chord to bind, in any modifier order or casing.
   * @returns Returns null when the override was applied, or the human-readable reason it was rejected.
   */
  public setOverride(id: string, chord: string): string | null {
    const error: string | null = this.validateOverride(id, chord);
    if (error !== null) {
      return error;
    }
    const next: Record<string, string> = { ...this.overrides() };
    next[id] = this.normalizeChord(chord);
    this.settings.set('keyboard.overrides', next);
    this.log.info('Keybindings', `Override set for '${id}'`, next[id]);
    return null;
  }

  /**
   * Leaves a command with no shortcut at all, persisted as an override, so neither the keyboard nor the
   * menu runs it until a chord is set again or the default restored.
   * @param id The catalogued command identifier.
   */
  public clearChord(id: string): void {
    if (!this.catalogueById.has(id)) {
      return;
    }
    this.settings.set('keyboard.overrides', { ...this.overrides(), [id]: NO_CHORD });
    this.log.info('Keybindings', `Shortcut cleared for '${id}'`);
  }

  /**
   * Removes a command's chord override, restoring its catalogued default.
   * @param id The catalogued command identifier.
   */
  public clearOverride(id: string): void {
    const next: Record<string, string> = { ...this.overrides() };
    delete next[id];
    this.settings.set('keyboard.overrides', next);
    this.log.info('Keybindings', `Override cleared for '${id}'`);
  }

  /**
   * Validates a prospective chord override without applying it.
   * @param id The catalogued command identifier.
   * @param chord The chord to validate.
   * @returns Returns null when the chord is acceptable, or the human-readable reason it is not.
   */
  public validateOverride(id: string, chord: string): string | null {
    const catalogued: { entry: KeybindingCatalogueEntry; binding: CatalogueBinding } | undefined =
      this.catalogueById.get(id);
    if (catalogued === undefined) {
      return 'Unknown command.';
    }
    const normalized: string = this.normalizeChord(chord);
    // Every chord of a sequence is held to the same rules as a single one.
    for (const step of normalized.length === 0 ? [''] : normalized.split(CHORD_STEP_SEPARATOR)) {
      const key: string = step.split('+').pop() ?? '';
      if (key.length === 0 || MODIFIERS.has(key)) {
        return 'A shortcut needs a key in addition to its modifiers.';
      }
      if (EDITING_CHORDS.has(step)) {
        return `${this.formatChord(step)} is kept for undo, redo, cut, copy, paste and select all in every text box.`;
      }
      if (
        catalogued.entry.modShiftOnly === true &&
        !(step.includes('Mod+') && step.includes('Shift+'))
      ) {
        return `${catalogued.entry.view} shortcuts must use both ${this.isMac ? '⌘' : 'Ctrl'} and Shift, so they never collide with the shell's control codes.`;
      }
    }
    return null;
  }

  /**
   * Formats a normalized chord for display on the current platform: modifier symbols on macOS
   * (`⌘⇧S`) and `Ctrl+Shift+S` style elsewhere.
   * @param chord The normalized chord to format.
   * @returns Returns the platform-formatted chord.
   */
  public formatChord(chord: string): string {
    if (chord === NO_CHORD) {
      return '';
    }
    // A sequence reads as its chords in turn, a space apart: ⌘K ⌘I, Ctrl+K Ctrl+I.
    return chord
      .split(CHORD_STEP_SEPARATOR)
      .map((step: string): string => this.stepKeys(step).join(this.isMac ? '' : '+'))
      .join(CHORD_STEP_SEPARATOR);
  }

  /**
   * Splits a normalized chord into the keys a person presses, as the current platform labels them —
   * `⌘`, `⇧`, `T` on macOS and `Ctrl`, `Shift`, `T` elsewhere — for showing each as its own key cap.
   * @param chord The normalized chord to split.
   * @returns Returns the key labels in pressing order, or none for an empty chord.
   */
  public chordKeys(chord: string): readonly string[] {
    if (chord === NO_CHORD) {
      return [];
    }
    // A sequence's chords are kept apart by a comma cap, so ⌘K, ⌘I never reads as one chord.
    return chord
      .split(CHORD_STEP_SEPARATOR)
      .flatMap((step: string, index: number): readonly string[] =>
        index === 0 ? this.stepKeys(step) : [',', ...this.stepKeys(step)],
      );
  }

  /**
   * Normalizes an author-written chord to the canonical modifier order and key casing, so
   * registration, overrides and dispatch compare identically regardless of how the chord was
   * written. A sequence keeps its chords in order, each normalized, a single space apart.
   * @param chord The chord to normalize.
   * @returns Returns the canonical chord string.
   */
  public normalizeChord(chord: string): string {
    return chord
      .trim()
      .split(/\s+/)
      .map((step: string): string => this.normalizeStep(step))
      .filter((step: string): boolean => step.length > 0)
      .join(CHORD_STEP_SEPARATOR);
  }

  /**
   * Gets a binding's default chord on this platform: its macOS chord on a Mac when it has one.
   * @param binding The catalogued binding.
   * @returns Returns the default chord, as authored.
   */
  private defaultChordOf(binding: CatalogueBinding): string {
    return this.isMac && binding.macChord !== undefined ? binding.macChord : binding.chord;
  }

  /**
   * Splits one chord of a sequence into the keys a person presses, as the platform labels them.
   * @param step The normalized chord.
   * @returns Returns the key labels in pressing order.
   */
  private stepKeys(step: string): readonly string[] {
    return step.split('+').map((part: string): string => {
      if (part === 'Mod') {
        return this.isMac ? '⌘' : 'Ctrl';
      }
      if (part === 'Control') {
        return this.isMac ? '⌃' : 'Ctrl';
      }
      if (part === 'Alt') {
        return this.isMac ? '⌥' : 'Alt';
      }
      if (part === 'Shift') {
        return this.isMac ? '⇧' : 'Shift';
      }
      return KEY_SYMBOLS[part] ?? part;
    });
  }

  /**
   * Normalizes one chord: canonical modifier order (Mod, Control, Alt, Shift) and key casing. `Ctrl` is
   * kept as a spelling of `Mod`, as overrides saved before `Control` existed were written with it;
   * `Control` is the Control key itself, which on platforms other than macOS is `Mod`.
   * @param step The chord to normalize.
   * @returns Returns the canonical chord.
   */
  private normalizeStep(step: string): string {
    let mod: boolean = false;
    let control: boolean = false;
    let alt: boolean = false;
    let shift: boolean = false;
    let key: string = '';
    for (const token of step.split('+')) {
      const trimmed: string = token.trim();
      const lower: string = trimmed.toLowerCase();
      if (lower === 'mod' || lower === 'cmd' || lower === 'ctrl' || lower === 'meta') {
        mod = true;
      } else if (lower === 'control') {
        if (this.isMac) {
          control = true;
        } else {
          mod = true;
        }
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
    if (control) {
      parts.push('Control');
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
   * Indexes a catalogue entry's bindings by command id.
   * @param entry The catalogue entry to index.
   */
  private index(entry: KeybindingCatalogueEntry): void {
    for (const binding of entry.bindings) {
      this.catalogueById.set(binding.id, { entry, binding });
    }
  }

  /**
   * Resolves a catalogued binding to its effective, display-ready form.
   * @param binding The catalogued binding.
   * @param entry The owning catalogue entry.
   * @returns Returns the resolved binding.
   */
  private resolve(binding: CatalogueBinding, entry: KeybindingCatalogueEntry): ResolvedBinding {
    const chord: string = this.effectiveChord(binding.id);
    const defaultChord: string = this.normalizeChord(this.defaultChordOf(binding));
    return {
      id: binding.id,
      description: binding.description,
      view: entry.view,
      chord,
      defaultChord,
      overridden: chord !== defaultChord,
      global: entry.global === true,
    };
  }

  /**
   * Derives the chord currently in effect for a command: the user's persisted override when it is
   * present and still valid, else the catalogued default.
   * @param id The catalogued command identifier.
   * @returns Returns the normalized effective chord, or an empty string for an uncatalogued id or a
   * cleared shortcut.
   */
  private effectiveChord(id: string): string {
    const catalogued: { entry: KeybindingCatalogueEntry; binding: CatalogueBinding } | undefined =
      this.catalogueById.get(id);
    if (catalogued === undefined) {
      return '';
    }
    const override: string | undefined = this.overrides()[id];
    if (override === NO_CHORD) {
      return NO_CHORD;
    }
    if (override !== undefined && this.validateOverride(id, override) === null) {
      return this.normalizeChord(override);
    }
    return this.normalizeChord(this.defaultChordOf(catalogued.binding));
  }

  /**
   * Derives the normalized chord for a key event, or null for a bare modifier press that cannot form a
   * chord on its own. Public so the Keyboard settings section's chord-capture input reads exactly the
   * chord dispatch would match.
   * @param event The keyboard event to read.
   * @returns Returns the normalized chord, or null when the event is a lone modifier key.
   */
  public chordFromEvent(event: KeyboardEvent): string | null {
    const key: string = event.key;
    if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') {
      return null;
    }
    const parts: string[] = [];
    if (this.isMac ? event.metaKey : event.ctrlKey) {
      parts.push('Mod');
    }
    // On a Mac the Control key is a modifier of its own (⌃G is not ⌘G); elsewhere it is Mod already.
    if (this.isMac && event.ctrlKey) {
      parts.push('Control');
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
