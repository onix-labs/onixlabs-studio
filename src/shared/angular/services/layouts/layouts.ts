import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Describes a saved layout for the surfaces that list it: its identity and its display name.
 */
export interface LayoutInfo {
  /**
   * Gets the layout identifier.
   */
  readonly id: string;

  /**
   * Gets the layout's display name.
   */
  readonly name: string;
}

/**
 * Describes a layout template: a starting point a user creates a layout from. A template is
 * contributed by the feature that owns the view, so this store stays free of feature imports.
 *
 * Templates are NOT layouts. They are never listed in the ribbon, never applied directly, never the
 * default, and nothing the user does can change one. Choosing a template copies its tree into a new
 * layout of the user's own, which is then theirs entirely — renameable, savable over, deletable.
 */
export interface LayoutTemplate {
  /**
   * Gets the template identifier.
   */
  readonly id: string;

  /**
   * Gets the template's display name, which the layout created from it is first called.
   */
  readonly name: string;

  /**
   * Builds a fresh copy of the template's layout tree.
   * @returns Returns the layout tree.
   */
  createLayout(): DockNode;
}

/**
 * The seam a workspace view registers so the layout commands can reach its dock: reading the current
 * layout for Save As, and re-seeding the dock when a layout is selected or reset.
 */
export interface LayoutSession {
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
   * Re-seeds the dock from the active layout's saved definition.
   */
  apply(): void;
}

/**
 * The shape a layout persists as.
 */
interface StoredLayout {
  /**
   * Gets the layout identifier.
   */
  readonly id: string;

  /**
   * Gets the layout's display name.
   */
  readonly name: string;

  /**
   * Gets the layout tree.
   */
  readonly layout: DockNode;

  /**
   * Gets the identifier of the template this layout was created from, or undefined when it was saved
   * from a session's own arrangement. Kept so a contextual stage-set can prefer the user's own
   * version of a template's layout over the template itself, and it survives every rename.
   */
  readonly templateId?: string;
}

/**
 * Holds the storage key the layout definitions persist under. The keys keep their original `preset`
 * spelling: the concept was renamed, not re-homed, and an existing user's layouts must survive the
 * rename rather than being seeded over.
 */
const LAYOUTS_KEY: string = 'layout.presets';

/**
 * Holds the storage key the per-root active-layout picks persist under.
 */
const ACTIVE_KEY: string = 'layout.active-presets';

/**
 * Holds the storage key the app-wide default layout persists under.
 */
const DEFAULT_KEY: string = 'layout.default-preset';

/**
 * The store and command façade for dock layouts — named layout trees defining WHICH panels exist in
 * a workspace view and WHERE they dock.
 *
 * Every layout is the user's own. There are no immutable built-in layouts: what ships instead is a
 * set of {@link LayoutTemplate}s, which are starting points the layout manager copies from and which
 * appear nowhere else. On first run every template is seeded as a real layout so the list is never
 * empty and nothing behaves specially; from then on the set is whatever the user has made of it.
 *
 * Persistence: layout DEFINITIONS are app-wide (agnostic to the loaded workspace), each workspace
 * root's ACTIVE PICK is remembered, and one layout is marked the app-wide DEFAULT. The session's
 * current layout is ephemeral — closing or moving panels never writes anywhere, and every launch
 * re-applies the active layout's saved definition. A layout only changes through the explicit
 * commands here (Save As, Rename, Delete).
 *
 * The active workspace view registers a {@link LayoutSession} (exactly as it registers its build
 * runner), through which the ribbon-driven commands capture the current layout and re-seed the dock.
 */
@Service()
export class Layouts {
  /**
   * Holds the key-value store definitions and picks persist through.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the registered templates, in registration order.
   */
  private readonly registered: WritableSignal<readonly LayoutTemplate[]> = signal<
    readonly LayoutTemplate[]
  >([]);

  /**
   * Holds the saved layouts, in creation order.
   */
  private readonly saved: WritableSignal<readonly StoredLayout[]> = signal<readonly StoredLayout[]>(
    this.loadLayouts(),
  );

  /**
   * Holds each workspace root's active-layout pick.
   */
  private readonly picks: WritableSignal<Readonly<Record<string, string>>> = signal<
    Readonly<Record<string, string>>
  >(this.store.get<Readonly<Record<string, string>>>(ACTIVE_KEY, {}));

  /**
   * Holds the user's chosen default layout, or null when they have never chosen one. Null is not the
   * absence of a default — {@link defaultId} resolves one whenever a layout exists — it only means
   * nothing was chosen, so the first layout stands in and keeps standing in as layouts come and go.
   */
  private readonly chosenDefault: WritableSignal<string | null> = signal<string | null>(
    this.store.get<string | null>(DEFAULT_KEY, null),
  );

  /**
   * Holds the active view's registered session, or null when no workspace view is active.
   */
  private readonly session: WritableSignal<LayoutSession | null> = signal<LayoutSession | null>(
    null,
  );

  /**
   * Holds the transient layout overlay, or null when none is active: a contextual switch (the IDE
   * setting the stage) that shadows the persisted pick without writing it, and remembers what it left
   * so returning restores it. Its id may name a template rather than a layout, since a stage-set falls
   * back to the template when the user has no layout of their own for it. Cleared by an explicit
   * {@link select} (the user took over) and by a session change (a different tab is its own context).
   */
  private readonly transient: WritableSignal<{ id: string; returnTo: string | null } | null> =
    signal<{ id: string; returnTo: string | null } | null>(null);

  /**
   * Gets the registered templates, for the layout manager's template picker.
   */
  public readonly templates: Signal<readonly LayoutInfo[]> = computed((): readonly LayoutInfo[] =>
    this.registered().map((template: LayoutTemplate): LayoutInfo => ({
      id: template.id,
      name: template.name,
    })),
  );

  /**
   * Gets every saved layout, in creation order — what the ribbon lists and what the layout manager
   * manages. Templates are deliberately absent: they are not layouts.
   */
  public readonly layouts: Signal<readonly LayoutInfo[]> = computed((): readonly LayoutInfo[] =>
    this.saved().map((layout: StoredLayout): LayoutInfo => ({ id: layout.id, name: layout.name })),
  );

  /**
   * Gets the default layout's identifier: the user's chosen one while it still names a layout,
   * otherwise the first layout. Null only when no layout exists at all, where the fallback template
   * stands in (see {@link layoutForRoot}).
   */
  public readonly defaultId: Signal<string | null> = computed((): string | null => {
    const chosen: string | null = this.chosenDefault();
    if (
      chosen !== null &&
      this.saved().some((layout: StoredLayout): boolean => layout.id === chosen)
    ) {
      return chosen;
    }
    return this.saved()[0]?.id ?? null;
  });

  /**
   * Gets the active session's workspace root, or null when no view is registered (or no folder is
   * open in it).
   */
  public readonly activeRoot: Signal<string | null> = computed(
    (): string | null => this.session()?.root() ?? null,
  );

  /**
   * Gets the identifier of the layout active for the registered session's root, or null when no
   * session is registered. While a transient stage-set is showing this is its id, which may name a
   * template rather than a layout.
   */
  public readonly activeId: Signal<string | null> = computed((): string | null => {
    const session: LayoutSession | null = this.session();
    if (session === null) {
      return null;
    }
    return this.transient()?.id ?? this.activeFor(session.root());
  });

  /**
   * Gets the display name of the layout showing in the active view, or null when no workspace view is
   * registered. This is what the status strip names. It resolves through templates too, so a
   * transient stage-set and the first-run fallback both read as themselves rather than as nothing.
   */
  public readonly activeName: Signal<string | null> = computed((): string | null => {
    if (this.session() === null) {
      return null;
    }
    const active: string | null = this.activeId();
    if (active !== null) {
      const named: LayoutInfo | undefined =
        this.layouts().find((layout: LayoutInfo): boolean => layout.id === active) ??
        this.templates().find((template: LayoutInfo): boolean => template.id === active);
      if (named !== undefined) {
        return named.name;
      }
    }
    return this.fallbackTemplate()?.name ?? null;
  });

  /**
   * Gets a value indicating whether a transient (contextual) switch is active, so the ribbon can
   * offer returning to the layout it left.
   */
  public readonly transientActive: Signal<boolean> = computed(
    (): boolean => this.transient() !== null,
  );

  /**
   * Registers a template. Registering an already-known identifier is a no-op, so view construction
   * can register idempotently.
   * @param template The template.
   */
  public registerTemplate(template: LayoutTemplate): void {
    if (this.registered().some((known: LayoutTemplate): boolean => known.id === template.id)) {
      return;
    }
    this.registered.update((current: readonly LayoutTemplate[]): readonly LayoutTemplate[] => [
      ...current,
      template,
    ]);
  }

  /**
   * Seeds a first-run installation with one layout per registered template, so the list is never
   * empty and every layout in it is the user's own from the outset.
   *
   * Guarded on the definitions having never been written, NOT on the list being empty: a user who
   * deliberately deletes every layout has said something, and growing them back on the next launch
   * would be overruling them. They keep the fallback until they make a layout again.
   */
  public seedFromTemplates(): void {
    if (this.store.get<unknown>(LAYOUTS_KEY, null) !== null) {
      return;
    }
    const templates: readonly LayoutTemplate[] = this.registered();
    if (templates.length === 0) {
      return;
    }
    this.saved.set(
      templates.map((template: LayoutTemplate): StoredLayout => ({
        id: crypto.randomUUID(),
        name: template.name,
        layout: template.createLayout(),
        templateId: template.id,
      })),
    );
    this.persist();
    this.log.info('Layouts', `Seeded ${templates.length} layouts from templates`);
  }

  /**
   * Registers the active view's session, replacing any previous one.
   * @param session The session to register.
   * @returns Returns a function that unregisters the session (unless it was replaced since).
   */
  public register(session: LayoutSession): () => void {
    this.transient.set(null);
    this.session.set(session);
    return (): void => {
      if (this.session() === session) {
        this.session.set(null);
      }
    };
  }

  /**
   * Resolves the layout active for a workspace root: its persisted pick when it names a layout that
   * still exists, else the default layout.
   * @param root The workspace root, or null while no folder is open.
   * @returns Returns the active layout identifier, or null when no layout exists at all.
   */
  public activeFor(root: string | null): string | null {
    const pick: string | undefined = root === null ? undefined : this.picks()[root];
    if (
      pick !== undefined &&
      this.saved().some((layout: StoredLayout): boolean => layout.id === pick)
    ) {
      return pick;
    }
    return this.defaultId();
  }

  /**
   * Makes a layout the app-wide default — the one the ribbon's View button applies and the one a
   * workspace root falls back to before it has a pick of its own. Unknown identifiers are ignored, so
   * a stale id can never displace a working default.
   * @param id The layout identifier.
   */
  public setDefault(id: string): void {
    if (!this.saved().some((layout: StoredLayout): boolean => layout.id === id)) {
      return;
    }
    this.chosenDefault.set(id);
    this.store.set(DEFAULT_KEY, id);
    this.log.info('Layouts', `Default layout set`, id);
  }

  /**
   * Builds a fresh copy of a layout tree. Saved layouts are resolved first, then templates — so a
   * transient stage-set may name either.
   * @param id The layout or template identifier.
   * @returns Returns the layout tree, or null for an unknown identifier.
   */
  public layoutOf(id: string): DockNode | null {
    const layout: StoredLayout | undefined = this.saved().find(
      (candidate: StoredLayout): boolean => candidate.id === id,
    );
    if (layout !== undefined) {
      return structuredClone(layout.layout);
    }
    const template: LayoutTemplate | undefined = this.registered().find(
      (candidate: LayoutTemplate): boolean => candidate.id === id,
    );
    return template === undefined ? null : template.createLayout();
  }

  /**
   * Builds a fresh copy of the layout tree active for a workspace root, falling back to the first
   * registered template when the user has no layouts at all — a brand-new installation whose seed has
   * yet to run, or one whose layouts were all deleted. The fallback is a tree, not a layout: it is
   * listed nowhere and cannot be edited, and the moment a layout exists it is never reached again.
   * @param root The workspace root, or null while no folder is open.
   * @returns Returns the layout tree, or null when not even a template is registered.
   */
  public layoutForRoot(root: string | null): DockNode | null {
    const active: string | null = this.transient()?.id ?? this.activeFor(root);
    if (active !== null) {
      const layout: DockNode | null = this.layoutOf(active);
      if (layout !== null) {
        return layout;
      }
    }
    return this.fallbackTemplate()?.createLayout() ?? null;
  }

  /**
   * Makes a layout the active one for the registered session's root and re-seeds its dock. Ignored
   * while no session is registered or for an unknown layout.
   * @param id The layout identifier.
   */
  public select(id: string): void {
    const session: LayoutSession | null = this.session();
    if (
      session === null ||
      !this.saved().some((layout: StoredLayout): boolean => layout.id === id)
    ) {
      return;
    }
    this.transient.set(null);
    this.pick(session.root(), id);
    session.apply();
    this.log.info('Layouts', `Applied layout`, id, session.root());
  }

  /**
   * Switches to a layout TRANSIENTLY — a contextual stage-set that shadows the persisted pick without
   * writing it, remembering what it left. A second transient switch keeps the original return target.
   * Ignored while no session is registered, for an unknown id, or when it is already showing.
   * @param id The layout or template identifier.
   * @returns Returns true when the switch happened (so callers can arm their return trigger).
   */
  public switchTransient(id: string): boolean {
    const session: LayoutSession | null = this.session();
    if (session === null || this.layoutOf(id) === null || this.activeId() === id) {
      return false;
    }
    const returnTo: string | null = this.transient()?.returnTo ?? this.activeId();
    this.transient.set({ id, returnTo });
    session.apply();
    this.log.debug('Layouts', `Switched to transient layout`, id, returnTo);
    return true;
  }

  /**
   * Resolves the user's own layout for a template — the one seeded or created from it, whatever they
   * have since renamed it to — so a contextual stage-set honours the arrangement they made of it
   * rather than the template it started as.
   * @param templateId The template identifier.
   * @returns Returns the first layout created from the template, or null when they kept none.
   */
  public layoutForTemplate(templateId: string): LayoutInfo | null {
    const match: StoredLayout | undefined = this.saved().find(
      (layout: StoredLayout): boolean => layout.templateId === templateId,
    );
    return match === undefined ? null : { id: match.id, name: match.name };
  }

  /**
   * Switches transiently to the user's own layout for a template when they have one, and to the
   * template itself when they do not — so a contextual stage-set honours the arrangement the user
   * made of it, and still has somewhere to go when they never made one.
   * @param templateId The template identifier.
   * @returns Returns true when the switch happened.
   */
  public switchTransientForTemplate(templateId: string): boolean {
    return this.switchTransient(this.layoutForTemplate(templateId)?.id ?? templateId);
  }

  /**
   * Returns from a transient switch to what it left, re-seeding the dock. A no-op when no transient
   * switch is active.
   */
  public returnFromTransient(): void {
    if (this.transient() === null) {
      return;
    }
    this.transient.set(null);
    this.session()?.apply();
    this.log.debug('Layouts', 'Returned from transient layout');
  }

  /**
   * Re-seeds the registered session's dock from the showing layout's saved definition, discarding the
   * session's own rearrangements.
   */
  public reset(): void {
    this.session()?.apply();
  }

  /**
   * Determines whether a name is already taken, so Save As can warn that confirming overwrites and
   * the manager can refuse a rename that would collide. Names are compared case-insensitively and
   * trimmed: two layouts differing only in case read as the same layout to everyone but the computer.
   * @param name The name to test.
   * @param exceptId A layout to disregard, so renaming one to its own name is not a collision.
   * @returns Returns the layout holding the name, or null when it is free.
   */
  public layoutNamed(name: string, exceptId: string | null = null): LayoutInfo | null {
    const key: string = name.trim().toLowerCase();
    const match: StoredLayout | undefined = this.saved().find(
      (layout: StoredLayout): boolean =>
        layout.id !== exceptId && layout.name.trim().toLowerCase() === key,
    );
    return match === undefined ? null : { id: match.id, name: match.name };
  }

  /**
   * Saves the session's current layout. A name already in use OVERWRITES that layout in place, which
   * is how a layout is updated: the identifier is kept, so the default marker and every root that
   * picked it stay pointed at the same layout rather than being orphaned by a delete-and-recreate.
   * An unused name creates a new layout. Either way it becomes the root's active pick.
   * @param name The layout's display name.
   * @param makeDefault Whether the layout also becomes the app-wide default, replacing the previous.
   * @returns Returns the identifier of the saved layout, or null when there was nothing to save.
   */
  public saveAs(name: string, makeDefault: boolean = false): string | null {
    const session: LayoutSession | null = this.session();
    const trimmed: string = name.trim();
    if (session === null || trimmed.length === 0) {
      return null;
    }
    const tree: DockNode = structuredClone(session.capture());
    const existing: LayoutInfo | null = this.layoutNamed(trimmed);
    const id: string = existing?.id ?? crypto.randomUUID();
    if (existing !== null) {
      this.saved.update((current: readonly StoredLayout[]): readonly StoredLayout[] =>
        current.map((layout: StoredLayout): StoredLayout =>
          layout.id === id ? { ...layout, name: trimmed, layout: tree } : layout,
        ),
      );
    } else {
      this.saved.update((current: readonly StoredLayout[]): readonly StoredLayout[] => [
        ...current,
        { id, name: trimmed, layout: tree },
      ]);
    }
    this.persist();
    this.transient.set(null);
    this.pick(session.root(), id);
    if (makeDefault) {
      this.setDefault(id);
    }
    this.log.info('Layouts', `Saved layout '${trimmed}'`, id, existing !== null);
    return id;
  }

  /**
   * Creates a layout from a template, named after it — uniquely, so choosing the same template twice
   * gives two layouts that can be told apart. The layout is added but NOT applied: the manager is
   * where layouts are made, and the ribbon is where they are chosen.
   * @param templateId The template identifier.
   * @returns Returns the new layout's identifier, or null for an unknown template.
   */
  public createFromTemplate(templateId: string): string | null {
    const template: LayoutTemplate | undefined = this.registered().find(
      (candidate: LayoutTemplate): boolean => candidate.id === templateId,
    );
    if (template === undefined) {
      return null;
    }
    const layout: StoredLayout = {
      id: crypto.randomUUID(),
      name: this.uniqueName(template.name),
      layout: template.createLayout(),
      templateId: template.id,
    };
    this.saved.update((current: readonly StoredLayout[]): readonly StoredLayout[] => [
      ...current,
      layout,
    ]);
    this.persist();
    this.log.info('Layouts', `Created layout '${layout.name}' from template`, templateId);
    return layout.id;
  }

  /**
   * Renames a layout. Refused for an empty name, an unknown layout, or a name another layout already
   * holds — a rename that silently swallowed another layout's name would leave two layouts the user
   * cannot tell apart, and Save As would then overwrite whichever came first.
   * @param id The layout identifier.
   * @param name The new display name.
   * @returns Returns true when the rename was applied; otherwise, false.
   */
  public rename(id: string, name: string): boolean {
    const trimmed: string = name.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (!this.saved().some((layout: StoredLayout): boolean => layout.id === id)) {
      return false;
    }
    if (this.layoutNamed(trimmed, id) !== null) {
      return false;
    }
    this.saved.update((current: readonly StoredLayout[]): readonly StoredLayout[] =>
      current.map((layout: StoredLayout): StoredLayout =>
        layout.id === id ? { ...layout, name: trimmed } : layout,
      ),
    );
    this.persist();
    this.log.info('Layouts', `Renamed layout to '${trimmed}'`, id);
    return true;
  }

  /**
   * Deletes a layout. Roots whose pick named it fall back to the default on their next resolution;
   * when the registered session was showing it, its dock re-seeds from the fallback immediately.
   * Deleting the default drops the choice too, so the default falls back to the first layout rather
   * than hanging on an id nothing resolves.
   * @param id The layout identifier.
   */
  public remove(id: string): void {
    if (!this.saved().some((layout: StoredLayout): boolean => layout.id === id)) {
      return;
    }
    const wasActive: boolean = this.activeId() === id;
    this.saved.update((current: readonly StoredLayout[]): readonly StoredLayout[] =>
      current.filter((layout: StoredLayout): boolean => layout.id !== id),
    );
    this.persist();
    if (this.chosenDefault() === id) {
      this.chosenDefault.set(null);
      this.store.set(DEFAULT_KEY, null);
    }
    if (wasActive) {
      this.session()?.apply();
    }
    this.log.info('Layouts', `Removed layout`, id);
  }

  /**
   * Gets the template a workspace falls back to when no layout exists: the first registered, which is
   * the feature's own Default.
   * @returns Returns the fallback template, or undefined when none is registered.
   */
  private fallbackTemplate(): LayoutTemplate | undefined {
    return this.registered()[0];
  }

  /**
   * Builds a name no layout holds, by appending a counter to the base name until it is free.
   * @param base The preferred name.
   * @returns Returns the base name when it is free; otherwise, the base name with a counter.
   */
  private uniqueName(base: string): string {
    if (this.layoutNamed(base) === null) {
      return base;
    }
    for (let counter: number = 2; ; counter += 1) {
      const candidate: string = `${base} ${counter}`;
      if (this.layoutNamed(candidate) === null) {
        return candidate;
      }
    }
  }

  /**
   * Records a root's active-layout pick.
   * @param root The workspace root, or null while no folder is open (the pick is then session-only
   * and not persisted).
   * @param id The layout identifier.
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
   * Persists the layouts.
   */
  private persist(): void {
    this.store.set(LAYOUTS_KEY, this.saved());
  }

  /**
   * Loads the persisted layouts, defensively: a malformed entry is dropped rather than trusted.
   * Layout trees are sanitized against the panel catalogue at APPLY time (the view knows its panels),
   * not here.
   * @returns Returns the persisted layouts.
   */
  private loadLayouts(): readonly StoredLayout[] {
    const raw: unknown = this.store.get<unknown>(LAYOUTS_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const layouts: StoredLayout[] = [];
    for (const entry of raw) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredLayout).id === 'string' &&
        typeof (entry as StoredLayout).name === 'string' &&
        typeof (entry as StoredLayout).layout === 'object' &&
        (entry as StoredLayout).layout !== null
      ) {
        layouts.push(entry as StoredLayout);
      }
    }
    return layouts;
  }
}
