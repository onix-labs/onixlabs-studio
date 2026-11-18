import {
  computed,
  inject,
  InjectionToken,
  Provider,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import type { NotificationChoice } from '@shared/angular/services/settings/settings-registry';
import { CORE_NOTIFICATION_TYPES } from './core-notification-types';

/**
 * Describes one kind of notification Studio raises about something that happened in the background
 * (#1486): a container exiting, a test run finishing, an agent failing. Each kind can be switched on
 * its own in Settings › Notifications, which builds its rows from these descriptions — adding a kind
 * is adding one of them.
 *
 * A notification that answers a button the user just pressed ("Pushed main", "Could not rename") has
 * no type and cannot be switched off, so a failure the user is waiting on never goes unreported.
 */
export interface NotificationTypeDef {
  /**
   * Gets the stable, namespaced identifier (for example `tests.finished`). The user's choice is stored
   * against it, so it must never change once shipped.
   */
  readonly id: string;

  /**
   * Gets the label shown for the kind in Settings (for example `Test Run Finished`).
   */
  readonly label: string;

  /**
   * Gets the description shown beneath the label.
   */
  readonly description: string;

  /**
   * Gets the area Settings groups the kind under (for example `Tests` or `Source Control`).
   */
  readonly area: string;

  /**
   * Gets the choice in force until the user makes one. Failures pop up and successes go to the
   * history, so a new source never makes Studio louder than the user asked for.
   */
  readonly default: NotificationChoice;
}

/**
 * Names the multi-provider token eagerly-wired features and the composition root contribute their
 * notification types through. The shared {@link NotificationTypes} service aggregates them without
 * naming any feature; a lazily-loaded feature contributes through its descriptor instead.
 */
export const NOTIFICATION_TYPES: InjectionToken<readonly NotificationTypeDef[]> =
  new InjectionToken<readonly NotificationTypeDef[]>('NOTIFICATION_TYPES');

/**
 * Contributes a set of notification types.
 * @param types The notification types contributed.
 * @returns Returns the multi-provider registering them.
 */
export function provideNotificationTypes(types: readonly NotificationTypeDef[]): Provider {
  return { provide: NOTIFICATION_TYPES, useValue: types, multi: true };
}

/**
 * Describes one area's notification types, as Settings shows them.
 */
export interface NotificationArea {
  /**
   * Gets the area's label.
   */
  readonly area: string;

  /**
   * Gets the area's notification types, in the order they were contributed.
   */
  readonly types: readonly NotificationTypeDef[];
}

/**
 * Represents the list of notification types and the user's choice for each. The choices live in one
 * setting, `notifications.types`, holding only the kinds the user has changed from their default.
 */
@Service()
export class NotificationTypes {
  /**
   * Holds the settings store the choices are kept in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the stored choices, by type identifier. Read through `get` inside a computed rather than
   * `value`, which tracks the same; the settings store's narrower stand-ins in other services' specs
   * offer `get` alone.
   */
  private readonly stored: Signal<Readonly<Record<string, NotificationChoice>>> = computed(
    (): Readonly<Record<string, NotificationChoice>> => this.settings.get('notifications.types'),
  );

  /**
   * Holds every contributed type, in contribution order: the shared services' own first, then the
   * root providers, then each lazy feature as its chunk resolves.
   */
  private readonly typesSignal: WritableSignal<readonly NotificationTypeDef[]> = signal<
    readonly NotificationTypeDef[]
  >([...CORE_NOTIFICATION_TYPES, ...(inject(NOTIFICATION_TYPES, { optional: true }) ?? []).flat()]);

  /**
   * Gets every contributed type, in contribution order.
   */
  public readonly all: Signal<readonly NotificationTypeDef[]> = this.typesSignal.asReadonly();

  /**
   * Gets the types grouped by area, the areas in alphabetical order so the page reads the same
   * whichever lazy feature happened to load first.
   */
  public readonly areas: Signal<readonly NotificationArea[]> = computed(
    (): readonly NotificationArea[] => {
      const byArea: Map<string, NotificationTypeDef[]> = new Map<string, NotificationTypeDef[]>();
      for (const type of this.typesSignal()) {
        const list: NotificationTypeDef[] = byArea.get(type.area) ?? [];
        list.push(type);
        byArea.set(type.area, list);
      }
      return [...byArea.entries()]
        .sort(([left]: [string, unknown], [right]: [string, unknown]): number =>
          left.localeCompare(right),
        )
        .map(([area, types]: [string, NotificationTypeDef[]]): NotificationArea => ({
          area,
          types,
        }));
    },
  );

  /**
   * Gets whether any type has a choice other than its default, so Reset All has something to do.
   */
  public readonly changed: Signal<boolean> = computed(
    (): boolean => Object.keys(this.stored()).length > 0,
  );

  /**
   * Adds the types a lazily-loaded feature contributes. A type already known keeps its first
   * definition, so a feature that loads twice (a pop-out window) cannot list a kind twice.
   * @param types The types contributed.
   */
  public contribute(types: readonly NotificationTypeDef[]): void {
    this.typesSignal.update(
      (current: readonly NotificationTypeDef[]): readonly NotificationTypeDef[] => {
        const known: ReadonlySet<string> = new Set<string>(
          current.map((type: NotificationTypeDef): string => type.id),
        );
        return [
          ...current,
          ...types.filter((type: NotificationTypeDef): boolean => !known.has(type.id)),
        ];
      },
    );
  }

  /**
   * Gets the choice in force for a type: the user's, else the type's default. A type nobody has
   * contributed (its feature has not loaded yet) pops up unless the user chose otherwise, so a
   * notification is never lost to a race with the list being filled.
   * @param id The type identifier.
   * @returns Returns the choice in force.
   */
  public choice(id: string): NotificationChoice {
    // Untracked: notifications are raised from inside effects, which must not come to depend on the
    // choices through the call.
    return untracked((): NotificationChoice => this.shown(id));
  }

  /**
   * Gets the choice in force for a type, as {@link choice} does, but read reactively: for a view that
   * shows the choice and must follow a change made elsewhere (Reset All, another window).
   * @param id The type identifier.
   * @returns Returns the choice in force.
   */
  public shown(id: string): NotificationChoice {
    return (
      this.stored()[id] ??
      this.typesSignal().find((type: NotificationTypeDef): boolean => type.id === id)?.default ??
      'popup'
    );
  }

  /**
   * Sets the choice for a type. Choosing its default removes the stored choice, so a later change to
   * the default reaches the user.
   * @param id The type identifier.
   * @param choice The choice.
   */
  public set(id: string, choice: NotificationChoice): void {
    const fallback: NotificationChoice | undefined = this.typesSignal().find(
      (type: NotificationTypeDef): boolean => type.id === id,
    )?.default;
    const next: Record<string, NotificationChoice> = { ...this.stored() };
    if (choice === fallback) {
      delete next[id];
    } else {
      next[id] = choice;
    }
    this.settings.set('notifications.types', next);
  }

  /**
   * Returns every type to its default.
   */
  public resetAll(): void {
    this.settings.set('notifications.types', {});
  }
}
