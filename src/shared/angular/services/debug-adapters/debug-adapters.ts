import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DebugAdapterId, DebugAdapterSummary, DebugChannel } from '@shared/api/debug-channels';
import { entriesForLanguage, resolveForLanguage } from '@shared/api/language-slot';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * The settings key the user's per-language debug adapter choices are persisted under.
 */
const SELECTION_KEY: string = 'debug.adapters';

/**
 * Renderer-side view of the debug adapters registered in the main process, and of the user's choice of
 * which one debugs each language. It is the debug half of the language-slot model: a project system
 * declares the adapter that *ships* as its language's debugger, and this service resolves that default
 * against what is registered and what the user has chosen.
 *
 * Outside Electron the bridge is absent, the catalogue stays empty, and resolution falls back to the
 * declared default unchanged, so nothing depends on the main process being present.
 */
@Service()
export class DebugAdapters {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the persistence used for the user's choices.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the registered adapters as published by the main process, empty until the catalogue loads.
   */
  private readonly registered: WritableSignal<readonly DebugAdapterSummary[]> = signal<
    readonly DebugAdapterSummary[]
  >([]);

  /**
   * Holds the user's chosen adapter per language, restored from the settings store.
   */
  private readonly selected: WritableSignal<Record<string, DebugAdapterId>> = signal<
    Record<string, DebugAdapterId>
  >(this.store.get<Record<string, DebugAdapterId>>(SELECTION_KEY, {}));

  /**
   * Gets the registered debug adapters, for choosing which one debugs a language.
   */
  public readonly catalogue: Signal<readonly DebugAdapterSummary[]> = this.registered.asReadonly();

  /**
   * Gets a promise that resolves once the catalogue has been loaded from the main process.
   */
  public readonly ready: Promise<void>;

  /**
   * Initializes the service, loading the adapter catalogue from the main process.
   */
  public constructor() {
    this.ready = this.loadCatalogue();
  }

  /**
   * Resolves the adapter that debugs a project, given the adapter its project system declares. The
   * declared adapter names the *default* implementation; the language it debugs is read from the
   * catalogue, and the user's choice for that language wins when they have made one. An adapter that
   * is not registered (or that the catalogue has not loaded yet) resolves to the declared default
   * unchanged, so debugging never breaks on a missing catalogue.
   * @param declared The adapter identifier the project system declares.
   * @returns Returns the adapter identifier to start.
   */
  public resolveAdapter(declared: DebugAdapterId): DebugAdapterId {
    const entry: DebugAdapterSummary | undefined = this.registered().find(
      (adapter: DebugAdapterSummary): boolean => adapter.id === declared,
    );
    const language: string | undefined = entry?.languages[0];
    if (language === undefined) {
      return declared;
    }
    return resolveForLanguage(language, this.registered(), this.selected()) ?? declared;
  }

  /**
   * Gets every registered adapter that debugs a language, for offering the user the choice.
   * @param language The language identifier.
   * @returns Returns the adapters debugging the language, in catalogue order.
   */
  public adaptersForLanguage(language: string): readonly DebugAdapterSummary[] {
    return entriesForLanguage(language, this.registered());
  }

  /**
   * Chooses which adapter debugs a language, persisting the change. Passing null clears the choice,
   * returning the language to its default adapter.
   * @param language The language identifier.
   * @param adapterId The chosen adapter, or null to use the default.
   */
  public setAdapterForLanguage(language: string, adapterId: DebugAdapterId | null): void {
    const selection: Record<string, DebugAdapterId> = { ...this.selected() };
    if (adapterId === null) {
      delete selection[language];
    } else {
      selection[language] = adapterId;
    }
    this.selected.set(selection);
    this.store.set(SELECTION_KEY, selection);
    this.log.info(
      'DebugAdapters',
      `Language '${language}' debugged by '${adapterId ?? 'default'}'`,
    );
  }

  /**
   * Loads the registered adapters from the main process.
   * @returns Returns a promise that resolves once the catalogue has been loaded.
   */
  private async loadCatalogue(): Promise<void> {
    const catalogue: readonly DebugAdapterSummary[] =
      (await this.bridge?.invoke<readonly DebugAdapterSummary[]>(DebugChannel.GetCatalogue)) ?? [];
    this.registered.set(catalogue);
    this.log.debug('DebugAdapters', `Loaded catalogue; ${catalogue.length} registered adapter(s)`);
  }
}
