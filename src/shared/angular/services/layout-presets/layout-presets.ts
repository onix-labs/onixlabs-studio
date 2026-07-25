import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Describes a layout preset for the discoverability surfaces: its identity, display name, and
 * whether it is a built-in (immutable — forked with Save as… rather than updated in place).
 */
export interface LayoutPresetInfo {
  /**
   * Gets the preset identifier.
   */
  readonly id: string;

  /**
   * Gets the preset's display name.
   */
  readonly name: string;

  /**
   * Gets a value indicating whether the preset is a built-in, which cannot be updated, renamed,
   * or deleted.
   */
  readonly builtIn: boolean;
}

/**
 * Describes a built-in preset registration: a stable identifier, a name, and a factory minting a
 * fresh copy of its layout tree. Built-ins are contributed by the feature that owns the view (the
 * workspace feature registers Coding), so this store stays free of feature imports.
 */
export interface BuiltInLayoutPreset {
  /**
   * Gets the preset identifier.
   */
  readonly id: string;

  /**
   * Gets the preset's display name.
   */
  readonly name: string;

  /**
   * Builds a fresh copy of the preset's layout tree.
   * @returns Returns the layout tree.
   */
  createLayout(): DockNode;
}

/**
 * The seam a workspace view registers so the preset commands can reach its dock: reading the
 * current layout for Save as…/Update, and re-seeding the dock when a preset is selected or reset.
 */
export interface LayoutPresetSession {
  /**
   * Gets the workspace root the session's layout belongs to, or null while no folder is open.
   */
  readonly root: Signal<string | null>;

  /**
   * Reads the dock's current layout tree.
   * @returns Returns the current layout.
   */
  capture(): DockNode;

  /**
   * Re-seeds the dock from the active preset's saved definition.
   */
  apply(): void;
}

/**
 * The shape a user preset persists as.
 */
interface StoredPreset {
  /**
   * Gets the preset identifier.
   */
  readonly id: string;

  /**
   * Gets the preset's display name.
   */
  readonly name: string;

  /**
   * Gets the preset's layout tree.
   */
  readonly layout: DockNode;
}

/**
 * Holds the storage key the user-defined preset definitions persist under.
 */
const PRESETS_KEY: string = 'layout.presets';

/**
 * Holds the storage key the per-root active-preset picks persist under.
 */
const ACTIVE_KEY: string = 'layout.active-presets';

/**
 * The store and command façade for dock layout presets — named layout trees defining WHICH panels
 * exist in a workspace view and WHERE they dock.
 *
 * Persistence follows the 2026-07-25 rulings exactly: preset DEFINITIONS are app-wide (agnostic to
 * the loaded workspace) and each workspace root's ACTIVE PICK is remembered — nothing else. The
 * session's current layout is ephemeral: closing or moving panels never writes anywhere, and every
 * launch re-applies the active preset's saved definition. A preset only changes through the
 * explicit commands here (Save as…, Update, Rename, Delete). Built-ins are immutable.
 *
 * The active workspace view registers a {@link LayoutPresetSession} (exactly as it registers its
 * build runner), through which the ribbon-driven commands capture the current layout and re-seed
 * the dock.
 */
@Service()
export class LayoutPresets {
  /**
   * Holds the key-value store definitions and picks persist through.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the registered built-in presets, in registration order.
   */
  private readonly builtIns: WritableSignal<readonly BuiltInLayoutPreset[]> = signal<
    readonly BuiltInLayoutPreset[]
  >([]);

  /**
   * Holds the user-defined presets, in creation order.
   */
  private readonly userPresets: WritableSignal<readonly StoredPreset[]> = signal<
    readonly StoredPreset[]
  >(this.loadPresets());

  /**
   * Holds each workspace root's active-preset pick.
   */
  private readonly picks: WritableSignal<Readonly<Record<string, string>>> = signal<
    Readonly<Record<string, string>>
  >(this.store.get<Readonly<Record<string, string>>>(ACTIVE_KEY, {}));

  /**
   * Holds the active view's registered session, or null when no workspace view is active.
   */
  private readonly session: WritableSignal<LayoutPresetSession | null> =
    signal<LayoutPresetSession | null>(null);

  /**
   * Gets every preset for the discoverability surfaces: built-ins first, then user presets in
   * creation order.
   */
  public readonly presets: Signal<readonly LayoutPresetInfo[]> = computed(
    (): readonly LayoutPresetInfo[] => [
      ...this.builtIns().map(
        (preset: BuiltInLayoutPreset): LayoutPresetInfo => ({
          id: preset.id,
          name: preset.name,
          builtIn: true,
        }),
      ),
      ...this.userPresets().map(
        (preset: StoredPreset): LayoutPresetInfo => ({
          id: preset.id,
          name: preset.name,
          builtIn: false,
        }),
      ),
    ],
  );

  /**
   * Gets the active session's workspace root, or null when no view is registered (or no folder is
   * open in it).
   */
  public readonly activeRoot: Signal<string | null> = computed(
    (): string | null => this.session()?.root() ?? null,
  );

  /**
   * Gets the identifier of the preset active for the registered session's root, or null when no
   * session is registered.
   */
  public readonly activeId: Signal<string | null> = computed((): string | null => {
    const session: LayoutPresetSession | null = this.session();
    if (session === null) {
      return null;
    }
    return this.activeFor(session.root());
  });

  /**
   * Gets a value indicating whether the active preset is a user preset, so Update, Rename, and
   * Delete apply to it.
   */
  public readonly activeIsUserPreset: Signal<boolean> = computed((): boolean => {
    const active: string | null = this.activeId();
    return (
      active !== null &&
      this.userPresets().some((preset: StoredPreset): boolean => preset.id === active)
    );
  });

  /**
   * Registers a built-in preset. Registering an already-known identifier is a no-op, so view
   * construction can register idempotently.
   * @param preset The built-in preset.
   */
  public registerBuiltIn(preset: BuiltInLayoutPreset): void {
    if (this.builtIns().some((known: BuiltInLayoutPreset): boolean => known.id === preset.id)) {
      return;
    }
    this.builtIns.update(
      (current: readonly BuiltInLayoutPreset[]): readonly BuiltInLayoutPreset[] => [
        ...current,
        preset,
      ],
    );
  }

  /**
   * Registers the active view's session, replacing any previous one.
   * @param session The session to register.
   * @returns Returns a function that unregisters the session (unless it was replaced since).
   */
  public register(session: LayoutPresetSession): () => void {
    this.session.set(session);
    return (): void => {
      if (this.session() === session) {
        this.session.set(null);
      }
    };
  }

  /**
   * Resolves the preset active for a workspace root: its persisted pick when it names a preset
   * that still exists, else the first built-in.
   * @param root The workspace root, or null while no folder is open.
   * @returns Returns the active preset identifier, or null when no presets are registered at all.
   */
  public activeFor(root: string | null): string | null {
    const pick: string | undefined = root === null ? undefined : this.picks()[root];
    if (pick !== undefined && this.layoutOf(pick) !== null) {
      return pick;
    }
    return this.builtIns()[0]?.id ?? this.userPresets()[0]?.id ?? null;
  }

  /**
   * Builds a fresh copy of a preset's layout tree.
   * @param id The preset identifier.
   * @returns Returns the layout tree, or null for an unknown identifier.
   */
  public layoutOf(id: string): DockNode | null {
    const builtIn: BuiltInLayoutPreset | undefined = this.builtIns().find(
      (preset: BuiltInLayoutPreset): boolean => preset.id === id,
    );
    if (builtIn !== undefined) {
      return builtIn.createLayout();
    }
    const user: StoredPreset | undefined = this.userPresets().find(
      (preset: StoredPreset): boolean => preset.id === id,
    );
    return user === undefined ? null : structuredClone(user.layout);
  }

  /**
   * Builds a fresh copy of the layout tree active for a workspace root.
   * @param root The workspace root, or null while no folder is open.
   * @returns Returns the layout tree, or null when no presets are registered.
   */
  public layoutForRoot(root: string | null): DockNode | null {
    const active: string | null = this.activeFor(root);
    return active === null ? null : this.layoutOf(active);
  }

  /**
   * Makes a preset the active one for the registered session's root and re-seeds its dock from the
   * preset's definition. Ignored while no session is registered or for an unknown preset.
   * @param id The preset identifier.
   */
  public select(id: string): void {
    const session: LayoutPresetSession | null = this.session();
    if (session === null || this.layoutOf(id) === null) {
      return;
    }
    this.pick(session.root(), id);
    session.apply();
  }

  /**
   * Re-seeds the registered session's dock from the active preset's saved definition, discarding
   * the session's layout tweaks.
   */
  public reset(): void {
    this.session()?.apply();
  }

  /**
   * Saves the session's current layout as a new user preset and makes it the active one. The
   * layout is captured as it stands — saving is the only way layout changes reach a definition.
   * @param name The new preset's display name.
   */
  public saveAs(name: string): void {
    const session: LayoutPresetSession | null = this.session();
    const trimmed: string = name.trim();
    if (session === null || trimmed.length === 0) {
      return;
    }
    const preset: StoredPreset = {
      id: crypto.randomUUID(),
      name: trimmed,
      layout: structuredClone(session.capture()),
    };
    this.userPresets.update(
      (current: readonly StoredPreset[]): readonly StoredPreset[] => [...current, preset],
    );
    this.persistPresets();
    this.pick(session.root(), preset.id);
  }

  /**
   * Writes the session's current layout into the active user preset. Ignored when the active
   * preset is a built-in (fork it with {@link saveAs} instead).
   */
  public updateActive(): void {
    const session: LayoutPresetSession | null = this.session();
    const active: string | null = this.activeId();
    if (session === null || active === null || !this.activeIsUserPreset()) {
      return;
    }
    const layout: DockNode = structuredClone(session.capture());
    this.userPresets.update(
      (current: readonly StoredPreset[]): readonly StoredPreset[] =>
        current.map(
          (preset: StoredPreset): StoredPreset =>
            preset.id === active ? { ...preset, layout } : preset,
        ),
    );
    this.persistPresets();
  }

  /**
   * Renames a user preset. Built-ins and unknown identifiers are ignored, as are empty names.
   * @param id The preset identifier.
   * @param name The new display name.
   */
  public rename(id: string, name: string): void {
    const trimmed: string = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.userPresets.update(
      (current: readonly StoredPreset[]): readonly StoredPreset[] =>
        current.map(
          (preset: StoredPreset): StoredPreset =>
            preset.id === id ? { ...preset, name: trimmed } : preset,
        ),
    );
    this.persistPresets();
  }

  /**
   * Deletes a user preset. Built-ins and unknown identifiers are ignored. Roots whose pick named
   * the deleted preset fall back to the first built-in on their next resolution; when the
   * registered session was showing it, its dock re-seeds from the fallback immediately.
   * @param id The preset identifier.
   */
  public remove(id: string): void {
    if (!this.userPresets().some((preset: StoredPreset): boolean => preset.id === id)) {
      return;
    }
    const wasActive: boolean = this.activeId() === id;
    this.userPresets.update(
      (current: readonly StoredPreset[]): readonly StoredPreset[] =>
        current.filter((preset: StoredPreset): boolean => preset.id !== id),
    );
    this.persistPresets();
    if (wasActive) {
      this.session()?.apply();
    }
  }

  /**
   * Records a root's active-preset pick.
   * @param root The workspace root, or null while no folder is open (the pick is then session-only
   * and not persisted).
   * @param id The preset identifier.
   */
  private pick(root: string | null, id: string): void {
    if (root === null) {
      return;
    }
    const next: Record<string, string> = { ...this.picks(), [root]: id };
    this.picks.set(next);
    this.store.set(ACTIVE_KEY, next);
  }

  /**
   * Persists the user presets.
   */
  private persistPresets(): void {
    this.store.set(PRESETS_KEY, this.userPresets());
  }

  /**
   * Loads the persisted user presets, defensively: a malformed entry is dropped rather than
   * trusted. Layout trees are sanitized against the panel catalogue at APPLY time (the view knows
   * its panels), not here.
   * @returns Returns the persisted presets.
   */
  private loadPresets(): readonly StoredPreset[] {
    const raw: unknown = this.store.get<unknown>(PRESETS_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const presets: StoredPreset[] = [];
    for (const entry of raw) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredPreset).id === 'string' &&
        typeof (entry as StoredPreset).name === 'string' &&
        typeof (entry as StoredPreset).layout === 'object' &&
        (entry as StoredPreset).layout !== null
      ) {
        presets.push(entry as StoredPreset);
      }
    }
    return presets;
  }
}
