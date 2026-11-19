import {
  computed,
  DestroyRef,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  AgentSurface,
  GLOBAL_SCOPE,
  PromptScope,
  readPromptScope,
  scopeMatches,
  sortByScope,
} from '@shared/api/ai-types';
import { Bridge } from '@shared/api/bridge';
import {
  coreLineCount,
  personaIdFor,
  PersonaChannel,
  PersonaEntry,
  PersonaLayer,
  PersonaListing,
} from '@shared/api/persona-channels';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

export type { PersonaEntry } from '@shared/api/persona-channels';

/**
 * The store key prompt profiles persisted under before they moved to files (#1263). Read once, when
 * the persona is first created and no profile files were there to convert, so a user upgrading
 * straight from a build older than profile files keeps them too. Never written or removed.
 */
const LEGACY_PROFILES_KEY: string = 'ai.promptProfiles';

/**
 * How long after the last edit an entry's file is rewritten, so typing into its text does not rewrite
 * the file on every keystroke.
 */
const WRITE_DELAY_MS: number = 400;

/**
 * The fields a new entry may be created with.
 */
export interface PersonaDraft {
  /**
   * Gets the name, or a placeholder when absent.
   */
  readonly name?: string;

  /**
   * Gets which half of the persona it goes in; the core when absent.
   */
  readonly layer?: PersonaLayer;

  /**
   * Gets the text, or empty when absent.
   */
  readonly text?: string;

  /**
   * Gets the tags, or none when absent.
   */
  readonly tags?: readonly string[];
}

/**
 * Owns the user's persona (#1513, #1514) in the renderer: the entries held as a signal, and the core
 * resolved per run against the run's surface and language. It replaces prompt profiles, and resolves
 * the core exactly where and how profiles were resolved, so every harness receives it unchanged.
 *
 * The list is read from disk when the service starts and whenever another window (or the main process,
 * for persona learning and the agent's tools) changes it; edits made here apply to the signal at once and reach the
 * disk a moment later.
 *
 * Resolution composes rather than picks: every enabled core entry whose scope matches contributes,
 * ordered global → surface → language, each under its own heading — so "British English in markdown"
 * stacks on "be terse in the editor" rather than replacing it. Memories are never resolved here: the
 * agent finds them by searching (#1515).
 *
 * Outside Electron there is no folder; entries live in memory for the session.
 */
@Service()
export class Persona {
  /**
   * Holds the bridge, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the settings store prompt profiles were kept in before they moved to files.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the entries, in id order.
   */
  private readonly entriesState: WritableSignal<readonly PersonaEntry[]> = signal<
    readonly PersonaEntry[]
  >([]);

  /**
   * Holds how many prompt profiles were converted when the persona was created.
   */
  private readonly convertedState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the pending write of each entry edited, by id.
   */
  private readonly writeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Gets the entries, in id order.
   */
  public readonly entries: Signal<readonly PersonaEntry[]> = this.entriesState.asReadonly();

  /**
   * Gets the core entries, in id order.
   */
  public readonly core: Signal<readonly PersonaEntry[]> = computed((): readonly PersonaEntry[] =>
    this.entriesState().filter((entry: PersonaEntry): boolean => entry.layer === 'core'),
  );

  /**
   * Gets the memories, in id order.
   */
  public readonly memories: Signal<readonly PersonaEntry[]> = computed(
    (): readonly PersonaEntry[] =>
      this.entriesState().filter((entry: PersonaEntry): boolean => entry.layer === 'memory'),
  );

  /**
   * Gets how many lines the enabled core takes, against {@link PERSONA_CORE_LINE_LIMIT}.
   */
  public readonly coreLines: Signal<number> = computed((): number =>
    coreLineCount(this.entriesState()),
  );

  /**
   * Gets how many prompt profiles were converted when the persona was created, or 0.
   */
  public readonly convertedProfiles: Signal<number> = this.convertedState.asReadonly();

  /**
   * Gets a promise that settles once the entries have first been read from disk.
   */
  public readonly ready: Promise<void>;

  /**
   * Initializes the service: reads the persona (which creates it, and converts the profiles, on the
   * first launch with personas), then follows changes made elsewhere — every window holds its own
   * copy, and the AI Manager is rarely in the window whose agent is about to send the next message.
   */
  public constructor() {
    this.ready = this.reload(true);
    const unfollow: (() => void) | undefined = this.bridge?.on(PersonaChannel.Changed, (): void => {
      void this.reload(false);
      this.log.debug('Persona', 'Re-reading the persona changed elsewhere');
    });
    inject(DestroyRef).onDestroy((): void => {
      unfollow?.();
      // Leaving saves what was typed rather than dropping the last pause's worth of it.
      for (const [id, timer] of this.writeTimers) {
        clearTimeout(timer);
        this.write(id);
      }
      this.writeTimers.clear();
    });
  }

  /**
   * Re-reads the persona from disk. Entries with a write still pending keep the edited form.
   * @param first Whether this is the first read, when a new persona may need the oldest profiles.
   * @returns Resolves once the signal is current.
   */
  public async reload(first: boolean = false): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    let listing: PersonaListing;
    try {
      listing = await this.bridge.invoke<PersonaListing>(PersonaChannel.List);
    } catch (error: unknown) {
      this.log.warn('Persona', 'Could not read the persona folder', error);
      return;
    }
    if (listing === null || typeof listing !== 'object' || !Array.isArray(listing.entries)) {
      this.log.warn('Persona', 'The persona folder could not be listed');
      return;
    }
    let entries: readonly PersonaEntry[] = listing.entries;
    let converted: number = listing.convertedProfiles;
    if (first && !listing.existed && converted === 0) {
      const legacy: readonly PersonaEntry[] = await this.convertLegacy(entries);
      converted = legacy.length;
      entries = [...entries, ...legacy].sort((a: PersonaEntry, b: PersonaEntry): number =>
        a.id.localeCompare(b.id),
      );
    }
    this.convertedState.set(converted);
    const pending: ReadonlyMap<string, PersonaEntry> = new Map(
      this.entriesState()
        .filter((entry: PersonaEntry): boolean => this.writeTimers.has(entry.id))
        .map((entry: PersonaEntry): [string, PersonaEntry] => [entry.id, entry]),
    );
    this.entriesState.set(
      entries.map((entry: PersonaEntry): PersonaEntry => pending.get(entry.id) ?? entry),
    );
  }

  /**
   * Opens the persona folder in the file manager, for a user who would rather work on disk.
   * @returns Resolves once the request is issued.
   */
  public async openFolder(): Promise<void> {
    await this.bridge?.invoke<void>(PersonaChannel.OpenFolder);
  }

  /**
   * Finds an entry.
   * @param id The entry's id.
   * @returns Returns the entry, or undefined.
   */
  public find(id: string): PersonaEntry | undefined {
    return this.entriesState().find((entry: PersonaEntry): boolean => entry.id === id);
  }

  /**
   * Creates an entry the user wrote, applying everywhere, and returns it for the caller to open. It is
   * locked, as everything the user writes is unless they unlock it, so persona learning never rewrites it.
   * @param draft What the entry starts with.
   * @returns Returns the new entry.
   */
  public create(draft: PersonaDraft = {}): PersonaEntry {
    const layer: PersonaLayer = draft.layer ?? 'core';
    const fallback: string = layer === 'core' ? 'New core entry' : 'New memory';
    const name: string = (draft.name ?? '').trim() || fallback;
    const entry: PersonaEntry = {
      id: personaIdFor(
        name,
        this.entriesState().map((existing: PersonaEntry): string => existing.id),
      ),
      name,
      text: draft.text ?? '',
      why: '',
      tags: draft.tags ?? [],
      links: [],
      scope: GLOBAL_SCOPE,
      layer,
      enabled: true,
      confidence: 1,
      confirmed: '',
      author: 'user',
      locked: true,
    };
    this.entriesState.update((entries: readonly PersonaEntry[]): readonly PersonaEntry[] =>
      [...entries, entry].sort((a: PersonaEntry, b: PersonaEntry): number =>
        a.id.localeCompare(b.id),
      ),
    );
    this.write(entry.id);
    this.log.info('Persona', `Entry created '${entry.name}'`, entry.id);
    return entry;
  }

  /**
   * Updates an entry in place; its file is rewritten a moment after the last edit.
   * @param id The entry's id.
   * @param patch The fields to change.
   */
  public update(id: string, patch: Partial<Omit<PersonaEntry, 'id'>>): void {
    this.entriesState.update((entries: readonly PersonaEntry[]): readonly PersonaEntry[] =>
      entries.map((entry: PersonaEntry): PersonaEntry =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
    this.scheduleWrite(id);
  }

  /**
   * Deletes an entry and its file.
   * @param id The entry's id.
   */
  public delete(id: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.writeTimers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.writeTimers.delete(id);
    }
    this.entriesState.update((entries: readonly PersonaEntry[]): readonly PersonaEntry[] =>
      entries.filter((entry: PersonaEntry): boolean => entry.id !== id),
    );
    void this.bridge?.invoke<void>(PersonaChannel.Delete, id).catch((error: unknown): void => {
      this.log.warn('Persona', `Could not delete entry '${id}'`, error);
    });
    this.log.info('Persona', 'Entry deleted', id);
  }

  /**
   * Composes the core a run receives from every enabled core entry in scope, each under its own
   * heading, its reason beneath when it has one.
   * @param surface The surface the run is dispatched from.
   * @param language The language of the document owning the run, or null.
   * @returns Returns the composed core, or an empty string when none applies.
   */
  public resolve(surface: AgentSurface, language: string | null): string {
    const matching: readonly PersonaEntry[] = sortByScope(
      this.entriesState().filter(
        (entry: PersonaEntry): boolean =>
          entry.enabled &&
          entry.layer === 'core' &&
          entry.text.trim().length > 0 &&
          scopeMatches(entry.scope, surface, language),
      ),
      (entry: PersonaEntry): PromptScope => entry.scope,
    );
    return matching
      .map((entry: PersonaEntry): string => {
        const why: string = entry.why.trim();
        return `### ${entry.name}\n${entry.text.trim()}${why.length > 0 ? `\nWhy: ${why}` : ''}`;
      })
      .join('\n\n');
  }

  /**
   * Rewrites an entry's file a moment after the last edit.
   * @param id The entry's id.
   */
  private scheduleWrite(id: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.writeTimers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    this.writeTimers.set(
      id,
      setTimeout((): void => {
        this.writeTimers.delete(id);
        this.write(id);
      }, WRITE_DELAY_MS),
    );
  }

  /**
   * Writes an entry's file now.
   * @param id The entry's id.
   */
  private write(id: string): void {
    const entry: PersonaEntry | undefined = this.find(id);
    if (entry === undefined || this.bridge === undefined) {
      return;
    }
    void this.bridge
      .invoke<string | null>(PersonaChannel.Save, entry)
      .then((error: string | null): void => {
        if (error !== null) {
          this.log.warn('Persona', `Entry '${id}' not saved: ${error}`);
        }
      })
      .catch((error: unknown): void => {
        this.log.warn('Persona', `Could not save entry '${id}'`, error);
      });
  }

  /**
   * Converts the prompt profiles a build older than profile files kept in the settings store, once:
   * each becomes a locked core entry the user wrote, filed under its name. The store is left as it was.
   * @param onDisk What the persona already holds.
   * @returns Returns the entries written.
   */
  private async convertLegacy(onDisk: readonly PersonaEntry[]): Promise<readonly PersonaEntry[]> {
    const raw: unknown = this.store.get<unknown>(LEGACY_PROFILES_KEY, []);
    if (!Array.isArray(raw) || this.bridge === undefined) {
      return [];
    }
    const taken: string[] = onDisk.map((entry: PersonaEntry): string => entry.id);
    const written: PersonaEntry[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const record: Record<string, unknown> = item as Record<string, unknown>;
      if (typeof record['name'] !== 'string') {
        continue;
      }
      const id: string = personaIdFor(record['name'], taken);
      taken.push(id);
      const entry: PersonaEntry = {
        id,
        name: record['name'],
        text: legacyInstructionsOf(record),
        why: '',
        tags: [],
        links: [],
        scope: readPromptScope(record['scope']),
        layer: 'core',
        enabled: record['enabled'] !== false,
        confidence: 1,
        confirmed: '',
        author: 'user',
        locked: true,
      };
      const error: string | null = await this.bridge.invoke<string | null>(
        PersonaChannel.Save,
        entry,
      );
      if (error === null) {
        written.push(entry);
      } else {
        this.log.warn('Persona', `Profile '${entry.name}' not converted: ${error}`);
      }
    }
    if (written.length > 0) {
      this.log.info('Persona', `Converted ${written.length} profile(s) from settings`);
    }
    return written;
  }
}

/**
 * Reads a stored profile's instructions, joining the old system and user texts when it predates the
 * single text, so nothing the user wrote is lost.
 * @param record The stored profile.
 * @returns Returns the instructions.
 */
function legacyInstructionsOf(record: Record<string, unknown>): string {
  if (typeof record['instructions'] === 'string') {
    return record['instructions'];
  }
  return [record['system'], record['user']]
    .filter((text: unknown): text is string => typeof text === 'string')
    .map((text: string): string => text.trim())
    .filter((text: string): boolean => text.length > 0)
    .join('\n\n');
}
