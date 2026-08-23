import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { MenuChannel, MenuClient } from '@shared/api/menu-channels';
import { AppMenuItem, AppMenuSection } from '@shared/api/menu-types';
import { Bridge } from '@shared/api/bridge';
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
 * Composes the application menu and publishes it for the main process to render.
 *
 * The menu is contextual: it follows the active tab, exactly as the ribbon does (#362). The shell
 * contributes the core sections that are true whatever is in front — File, Edit, View, Window, Help —
 * and the active feature contributes its own on top, folding into a core section where the ids match so
 * a feature adds *to* File rather than creating a second one.
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
   * Holds the handler for each command id in the current menu, rebuilt whenever the menu changes.
   */
  private handlers: ReadonlyMap<string, () => void> = new Map<string, () => void>();

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
        for (const section of entry.sections) {
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
            items: [...merged[existing].items, ...section.items],
          };
        }
      }
      return merged;
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
      this.handlers = AppMenu.collectHandlers(sections);
      this.client?.setMenu(AppMenu.toWire(sections));
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
   * Runs the handler registered for a command id. A command with no handler is logged rather than
   * thrown: the menu is rebuilt asynchronously, so a click can land microseconds after the command that
   * raised it left the bar.
   * @param commandId The chosen command's identifier.
   */
  private dispatch(commandId: string): void {
    const handler: (() => void) | undefined = this.handlers.get(commandId);
    if (handler === undefined) {
      this.log.warn('AppMenu', `No handler for menu command '${commandId}'`);
      return;
    }
    this.log.debug('AppMenu', `Menu command '${commandId}'`);
    handler();
  }

  /**
   * Collects every runnable entry's handler, keyed by command id.
   * @param sections The merged menu.
   * @returns Returns the handler map.
   */
  private static collectHandlers(
    sections: readonly MenuContribution[],
  ): ReadonlyMap<string, () => void> {
    const handlers: Map<string, () => void> = new Map<string, () => void>();
    const walk: (items: readonly MenuEntry[]) => void = (items: readonly MenuEntry[]): void => {
      for (const item of items) {
        if (item.id !== undefined && item.run !== undefined) {
          handlers.set(item.id, item.run);
        }
        if (item.items !== undefined) {
          walk(item.items);
        }
      }
    };
    for (const section of sections) {
      walk(section.items);
    }
    return handlers;
  }

  /**
   * Strips the handlers, leaving the serialisable model the main process renders.
   * @param sections The merged menu.
   * @returns Returns the wire model.
   */
  private static toWire(sections: readonly MenuContribution[]): readonly AppMenuSection[] {
    const item: (entry: MenuEntry) => AppMenuItem = (entry: MenuEntry): AppMenuItem => ({
      ...(entry.id === undefined ? {} : { id: entry.id }),
      ...(entry.label === undefined ? {} : { label: entry.label }),
      ...(entry.kind === undefined ? {} : { kind: entry.kind }),
      ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
      ...(entry.checked === undefined ? {} : { checked: entry.checked }),
      ...(entry.role === undefined ? {} : { role: entry.role }),
      ...(entry.items === undefined ? {} : { items: entry.items.map(item) }),
    });
    return sections.map(
      (section: MenuContribution): AppMenuSection => ({
        id: section.id,
        label: section.label,
        items: section.items.map(item),
      }),
    );
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
      onCommand: (listener: (commandId: string) => void): (() => void) =>
        bridge.on(MenuChannel.Command, (...args: unknown[]): void => listener(args[0] as string)),
    };
  }
}
