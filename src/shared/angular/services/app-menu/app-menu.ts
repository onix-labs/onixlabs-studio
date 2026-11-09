import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { MenuChannel, MenuClient } from '@shared/api/menu-channels';
import { AppMenuItem, AppMenuSection } from '@shared/api/menu-types';
import { Bridge } from '@shared/api/bridge';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { MenuContribution, MenuEntry } from './app-menu-model';

/**
 * Holds a contributor's sections together with the priority ordering them against other contributors.
 */
interface ContributionEntry {
  /**
   * Gets the contributed sections.
   */
  readonly sections: readonly MenuContribution[];

  /**
   * Gets the priority ordering this contributor against others (lower merges first).
   */
  readonly priority: number;
}

/**
 * Ranks how strongly an entry holds its accelerator when two entries resolve to the same one: a
 * view's rebindable command over a fixed chord, and either over an application-wide command — the
 * same order dispatch gives them, the active view first.
 */
enum ChordClaim {
  Global = 0,
  Fixed = 1,
  View = 2,
}

/**
 * Composes the application menu and publishes it for the main process to render.
 *
 * The menu is contextual: it follows the active tab, exactly as the ribbon does (#362). The shell
 * contributes the core sections that are true whatever is in front — File, Edit, View, Window, Help —
 * and the active feature contributes its own on top, folding into a core section where the ids match so
 * a feature adds *to* File rather than creating a second one. Where the two want the same keyboard
 * chord the later contributor wins it outright: the core's Edit section carries the platform's editing
 * commands for every tab, and a feature takes back only the chords it declares.
 *
 * ⛔ **No feature may declare an editing chord** — ⌘Z/⌘⇧Z/⌘X/⌘C/⌘V. The core contributes those once as
 * native roles, and a native role is routed by Chromium to whatever holds focus, so every control
 * serves its own. A feature entry claiming one wins it outright by the rule above and then runs the
 * TAB's command wherever the caret happens to be, which broke copy and paste three times over. The
 * fix is not a smarter router — one was tried and deleted — it is that the chords are not the menu's
 * to route.
 *
 * An entry's shortcut comes from the keyboard catalogue: it names a catalogued command as its
 * `binding`, and the menu shows and binds that command's effective chord, so a shortcut changed in
 * Settings changes the menu with it. Only a chord the user cannot change (one an embedded editor
 * owns, or a native editing role) is written as a fixed `accelerator`. The same catalogued chords are
 * matched from the window's key listener ({@link dispatchChord}) too, which is what makes the menu's
 * shortcuts work on Windows and Linux, where there is no native menu bar to bind them.
 *
 * Handlers never leave the renderer. The published model carries command ids; a chosen command comes
 * back by id and is routed to the handler registered under it. That indirection is what lets the menu be
 * rendered natively on macOS, where the bar lives outside the window entirely, without the main process
 * knowing anything about what a command does.
 */
@Service()
export class AppMenu {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the keyboard catalogue the entries' shortcuts resolve through.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the menu client, or undefined outside Electron (served as a plain web app, or under tests),
   * where composing a menu is a harmless no-op.
   */
  private readonly client: MenuClient | undefined = AppMenu.createClient();

  /**
   * Holds each contributor's sections, keyed by owner.
   */
  private readonly contributions: WritableSignal<ReadonlyMap<string, ContributionEntry>> = signal<
    ReadonlyMap<string, ContributionEntry>
  >(new Map<string, ContributionEntry>());

  /**
   * Holds the entry behind each command id in the current menu, rebuilt whenever the menu changes.
   * Whole entries rather than bare handlers, because a native role has no handler and is dispatched to
   * the main process instead.
   */
  private entries: ReadonlyMap<string, MenuEntry> = new Map<string, MenuEntry>();

  /**
   * Holds the entry each catalogued chord runs in the current menu, keyed by normalized chord, rebuilt
   * whenever the menu changes. Only entries that hold their chord are present, so the keyboard runs
   * exactly what the menu shows against it.
   */
  private chords: ReadonlyMap<string, MenuEntry> = new Map<string, MenuEntry>();

  /**
   * Counts the surfaces reading a key chord right now (Settings' Set Chord dialog), during which the
   * menu publishes no accelerators: on macOS the menu bar takes its key equivalents before any window
   * sees them, so ⌘W would close the tab instead of being read as the new shortcut.
   */
  private readonly suspensions: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the merged menu, in bar order.
   */
  public readonly sections: Signal<readonly MenuContribution[]> = computed(
    (): readonly MenuContribution[] => {
      const ordered: readonly ContributionEntry[] = [...this.contributions().values()].sort(
        (left: ContributionEntry, right: ContributionEntry): number =>
          left.priority - right.priority,
      );
      const merged: MenuContribution[] = [];
      for (const entry of ordered) {
        for (const unresolved of entry.sections) {
          const section: MenuContribution = {
            ...unresolved,
            items: this.withBindingsResolved(unresolved.items),
          };
          const existing: number = merged.findIndex(
            (candidate: MenuContribution): boolean => candidate.id === section.id,
          );
          if (existing === -1) {
            merged.push(section);
            continue;
          }
          // Fold into the section already on the bar, so a feature extends File rather than adding a
          // second File beside it. The core's entries come first because the core contributes first.
          merged[existing] = {
            ...merged[existing],
            items: [
              ...AppMenu.withoutClaimed(merged[existing].items, section.items),
              ...section.items,
            ],
          };
        }
      }
      return this.withoutDuplicateChords(
        merged.map((section: MenuContribution): MenuContribution => ({
          ...section,
          items: AppMenu.tidySeparators(section.items),
        })),
      );
    },
  );

  /**
   * Initializes a new instance of the {@link AppMenu} class, republishing the menu whenever it changes
   * and routing chosen commands back to their handlers.
   */
  public constructor() {
    this.client?.onCommand((commandId: string): void => this.dispatch(commandId));
    effect((): void => {
      const sections: readonly MenuContribution[] = this.sections();
      this.entries = AppMenu.collectEntries(sections);
      this.chords = this.collectChords(sections);
      this.client?.setMenu(AppMenu.toWire(sections, this.suspensions() === 0));
    });
  }

  /**
   * Contributes (or replaces) an owner's menu sections.
   * @param ownerId The contributor's identifier.
   * @param sections The sections to contribute.
   * @param priority Orders this contributor against others; lower merges first, so the core's entries
   * lead each section it shares with a feature.
   * @returns Returns a function that withdraws the contribution.
   */
  public contribute(
    ownerId: string,
    sections: readonly MenuContribution[],
    priority: number,
  ): () => void {
    this.contributions.update(
      (current: ReadonlyMap<string, ContributionEntry>): ReadonlyMap<string, ContributionEntry> =>
        new Map<string, ContributionEntry>(current).set(ownerId, { sections, priority }),
    );
    return (): void => this.clearOwner(ownerId);
  }

  /**
   * Withdraws an owner's contribution.
   * @param ownerId The contributor's identifier.
   */
  public clearOwner(ownerId: string): void {
    this.contributions.update(
      (current: ReadonlyMap<string, ContributionEntry>): ReadonlyMap<string, ContributionEntry> => {
        const next: Map<string, ContributionEntry> = new Map<string, ContributionEntry>(current);
        next.delete(ownerId);
        return next;
      },
    );
  }

  /**
   * Runs a command by id, from either menu surface: the native bar's click round-trip, or the
   * in-window menu choosing a row. An unknown command is logged rather than thrown, because the menu is
   * rebuilt asynchronously and a click can land just after the command that raised it left the menu.
   * @param commandId The chosen command's identifier.
   */
  public dispatch(commandId: string): void {
    const entry: MenuEntry | undefined = this.entries.get(commandId);
    if (entry === undefined) {
      this.log.warn('AppMenu', `No entry for menu command '${commandId}'`);
      return;
    }
    this.log.debug('AppMenu', `Menu command '${commandId}'`);
    if (entry.run !== undefined) {
      entry.run();
      return;
    }
    // A role has no renderer-side handler: the native menu performs it itself, and the in-window menu
    // asks the main process to.
    if (entry.role !== undefined) {
      this.client?.runRole(entry.role);
    }
  }

  /**
   * Runs the menu command whose catalogued shortcut a key press spells, for the window's key listener.
   * The active view's own accelerators are offered the event first; this serves the menu's commands
   * nobody else binds — the application's (Open File, Close Tab) and a view's menu-only ones (Print,
   * Refresh) — on every platform, where the native bar would bind them only on macOS. A disabled
   * command does not consume its chord.
   * @param event The keyboard event to match.
   * @returns Returns true when a command ran, so the caller can suppress the event's default.
   */
  public dispatchChord(event: KeyboardEvent): boolean {
    if (this.suspensions() > 0) {
      return false;
    }
    const chord: string | null = this.keybindings.chordFromEvent(event);
    const entry: MenuEntry | undefined = chord === null ? undefined : this.chords.get(chord);
    if (entry?.run === undefined || entry.enabled === false) {
      return false;
    }
    this.log.info('AppMenu', `Menu shortcut '${entry.binding ?? entry.id ?? ''}'`, chord);
    entry.run();
    return true;
  }

  /**
   * Stands the menu's shortcuts down while a surface reads a key chord, so the keys pressed reach it
   * rather than running a menu command. The menu itself stays, with its shortcuts shown again once
   * every surface has released.
   * @returns Returns a function that releases the suspension; calling it again does nothing.
   */
  public suspendShortcuts(): () => void {
    this.suspensions.update((count: number): number => count + 1);
    let released: boolean = false;
    return (): void => {
      if (!released) {
        released = true;
        this.suspensions.update((count: number): number => count - 1);
      }
    };
  }

  /**
   * Gives each entry naming a catalogued command that command's effective chord as its accelerator.
   * An entry whose command is not (yet) catalogued keeps no accelerator rather than a stale one.
   * @param items The entries to resolve.
   * @returns Returns the entries with their accelerators resolved.
   */
  private withBindingsResolved(items: readonly MenuEntry[]): readonly MenuEntry[] {
    return items.map((entry: MenuEntry): MenuEntry => {
      const nested: MenuEntry =
        entry.items === undefined
          ? entry
          : { ...entry, items: this.withBindingsResolved(entry.items) };
      if (nested.binding === undefined) {
        return nested;
      }
      const chord: string | null = this.keybindings.chordFor(nested.binding);
      return {
        ...nested,
        accelerator:
          chord === null || chord === '' ? undefined : this.keybindings.toAccelerator(chord),
      };
    });
  }

  /**
   * Collects the catalogued chord each entry holding one runs, keyed by normalized chord.
   * @param sections The merged menu.
   * @returns Returns the chord map.
   */
  private collectChords(sections: readonly MenuContribution[]): ReadonlyMap<string, MenuEntry> {
    const chords: Map<string, MenuEntry> = new Map<string, MenuEntry>();
    for (const entry of AppMenu.collectEntries(sections).values()) {
      const chord: string | null =
        entry.binding === undefined || entry.accelerator === undefined
          ? null
          : this.keybindings.chordFor(entry.binding);
      if (chord !== null && chord !== '' && !chords.has(chord)) {
        chords.set(chord, entry);
      }
    }
    return chords;
  }

  /**
   * Leaves each accelerator on one entry only, so a shortcut the user moved onto a chord another entry
   * already shows does not leave two menu items bound to it (the platform would silently run the
   * first). The entry holding the strongest {@link ChordClaim} keeps it, the earlier on a tie; the
   * others stay in the menu without a shortcut. Settings flags the collision as a conflict.
   * @param sections The merged menu.
   * @returns Returns the menu with each accelerator held once.
   */
  private withoutDuplicateChords(
    sections: readonly MenuContribution[],
  ): readonly MenuContribution[] {
    const holders: Map<string, MenuEntry> = new Map<string, MenuEntry>();
    const claim: (entry: MenuEntry) => ChordClaim = (entry: MenuEntry): ChordClaim => {
      if (entry.binding === undefined) {
        return ChordClaim.Fixed;
      }
      return this.keybindings.isGlobal(entry.binding) ? ChordClaim.Global : ChordClaim.View;
    };
    for (const entry of AppMenu.collectAll(sections)) {
      if (entry.accelerator === undefined) {
        continue;
      }
      const holder: MenuEntry | undefined = holders.get(entry.accelerator);
      if (holder === undefined || claim(entry) > claim(holder)) {
        holders.set(entry.accelerator, entry);
      }
    }
    const strip: (items: readonly MenuEntry[]) => readonly MenuEntry[] = (
      items: readonly MenuEntry[],
    ): readonly MenuEntry[] =>
      items.map((entry: MenuEntry): MenuEntry => {
        const nested: MenuEntry =
          entry.items === undefined ? entry : { ...entry, items: strip(entry.items) };
        if (entry.accelerator === undefined || holders.get(entry.accelerator) === entry) {
          return nested;
        }
        return { ...nested, accelerator: undefined, binding: undefined };
      });
    return sections.map((section: MenuContribution): MenuContribution => ({
      ...section,
      items: strip(section.items),
    }));
  }

  /**
   * Collects every entry in menu order, submenus included.
   * @param sections The menu.
   * @returns Returns the entries.
   */
  private static collectAll(sections: readonly MenuContribution[]): readonly MenuEntry[] {
    const all: MenuEntry[] = [];
    const walk: (items: readonly MenuEntry[]) => void = (items: readonly MenuEntry[]): void => {
      for (const item of items) {
        all.push(item);
        if (item.items !== undefined) {
          walk(item.items);
        }
      }
    };
    for (const section of sections) {
      walk(section.items);
    }
    return all;
  }

  /**
   * Drops the entries an incoming contribution claims the chord of, so a later contributor wins a
   * keyboard chord an earlier one bound.
   *
   * This is what lets the core carry the platform's editing commands without taking them from the
   * editors. The core binds Undo to the native role, which suits a plain text box; a code tab needs its
   * own model-level undo instead, and by contributing an entry with the same accelerator it replaces the
   * core's rather than competing with it — two menu items sharing an accelerator would otherwise both be
   * live, and the first would silently win. Only top-level entries are compared: a chord buried in a
   * submenu is not a claim on the section. Only fixed accelerators claim and are claimed: a catalogued
   * shortcut the user moved onto another entry's chord must not take that entry out of the menu
   * ({@link withoutDuplicateChords} settles those instead).
   *
   * @param existing The entries already folded into the section.
   * @param incoming The entries being folded in.
   * @returns Returns the existing entries the incoming ones do not claim.
   */
  private static withoutClaimed(
    existing: readonly MenuEntry[],
    incoming: readonly MenuEntry[],
  ): readonly MenuEntry[] {
    const claimed: ReadonlySet<string> = new Set<string>(
      incoming
        .filter((entry: MenuEntry): boolean => entry.binding === undefined)
        .map((entry: MenuEntry): string | undefined => entry.accelerator)
        .filter(
          (accelerator: string | undefined): accelerator is string => accelerator !== undefined,
        ),
    );
    if (claimed.size === 0) {
      return existing;
    }
    return existing.filter(
      (entry: MenuEntry): boolean =>
        entry.binding !== undefined ||
        entry.accelerator === undefined ||
        !claimed.has(entry.accelerator),
    );
  }

  /**
   * Collapses runs of separators and trims them from either end, so a section reads cleanly however its
   * contributors happened to fall. The core deliberately ends a section with a separator to leave room
   * for a feature's entries; when no feature adds any — or when a feature's claim removed the entries
   * one was dividing — that separator would otherwise be left dangling.
   * @param items The section's entries.
   * @returns Returns the tidied entries.
   */
  private static tidySeparators(items: readonly MenuEntry[]): readonly MenuEntry[] {
    const isSeparator: (entry: MenuEntry) => boolean = (entry: MenuEntry): boolean =>
      entry.kind === 'separator';
    const collapsed: MenuEntry[] = [];
    for (const entry of items) {
      const nested: MenuEntry =
        entry.items === undefined
          ? entry
          : { ...entry, items: AppMenu.tidySeparators(entry.items) };
      if (
        isSeparator(nested) &&
        (collapsed.length === 0 || isSeparator(collapsed[collapsed.length - 1]))
      ) {
        continue;
      }
      collapsed.push(nested);
    }
    while (collapsed.length > 0 && isSeparator(collapsed[collapsed.length - 1])) {
      collapsed.pop();
    }
    return collapsed;
  }

  /**
   * Collects every identified entry, keyed by command id.
   * @param sections The merged menu.
   * @returns Returns the entry map.
   */
  private static collectEntries(
    sections: readonly MenuContribution[],
  ): ReadonlyMap<string, MenuEntry> {
    const entries: Map<string, MenuEntry> = new Map<string, MenuEntry>();
    const walk: (items: readonly MenuEntry[]) => void = (items: readonly MenuEntry[]): void => {
      for (const item of items) {
        if (item.id !== undefined) {
          entries.set(item.id, item);
        }
        if (item.items !== undefined) {
          walk(item.items);
        }
      }
    };
    for (const section of sections) {
      walk(section.items);
    }
    return entries;
  }

  /**
   * Strips the handlers, leaving the serialisable model the main process renders.
   * @param sections The merged menu.
   * @param withShortcuts Whether the entries carry their accelerators; false while a chord is read.
   * @returns Returns the wire model.
   */
  private static toWire(
    sections: readonly MenuContribution[],
    withShortcuts: boolean,
  ): readonly AppMenuSection[] {
    const item: (entry: MenuEntry) => AppMenuItem = (entry: MenuEntry): AppMenuItem => ({
      ...(entry.id === undefined ? {} : { id: entry.id }),
      ...(entry.label === undefined ? {} : { label: entry.label }),
      ...(entry.kind === undefined ? {} : { kind: entry.kind }),
      ...(entry.accelerator === undefined || !withShortcuts
        ? {}
        : { accelerator: entry.accelerator }),
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
      ...(entry.checked === undefined ? {} : { checked: entry.checked }),
      ...(entry.role === undefined ? {} : { role: entry.role }),
      ...(entry.items === undefined ? {} : { items: entry.items.map(item) }),
    });
    return sections.map((section: MenuContribution): AppMenuSection => ({
      id: section.id,
      label: section.label,
      items: section.items.map(item),
    }));
  }

  /**
   * Builds the menu client over the generic transport, or undefined when running outside Electron.
   * @returns Returns the client, or undefined.
   */
  private static createClient(): MenuClient | undefined {
    const bridge: Bridge | undefined = window.bridge;
    if (bridge === undefined) {
      return undefined;
    }
    return {
      setMenu: (sections: readonly AppMenuSection[]): void => {
        bridge.send(MenuChannel.SetMenu, sections);
      },
      runRole: (role: string): void => {
        bridge.send(MenuChannel.RunRole, role);
      },
      onCommand: (listener: (commandId: string) => void): (() => void) =>
        bridge.on(MenuChannel.Command, (...args: unknown[]): void => listener(args[0] as string)),
    };
  }
}
