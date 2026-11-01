import { DestroyRef, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
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
  profileIdFor,
  PromptProfile,
  PromptProfileChannel,
  PromptProfileListing,
} from '@shared/api/prompt-profile-channels';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

export type { PromptProfile } from '@shared/api/prompt-profile-channels';

/**
 * The store key the profiles persisted under before they moved to files (#1263). It is still read
 * once, to migrate, and never written or removed — so an older build rolled back to finds them.
 */
const LEGACY_STORE_KEY: string = 'ai.promptProfiles';

/**
 * How long after the last edit a profile's file is rewritten, so typing into its instructions does
 * not rewrite the file on every keystroke.
 */
const WRITE_DELAY_MS: number = 400;

/**
 * Owns the user's prompt profiles: one Markdown file each in a folder beside the skill library
 * (#1263), held here as a signal and resolved per run against the run's surface and language.
 *
 * The list is read from disk when the service starts and whenever another window changes it; edits
 * made here apply to the signal at once and reach the disk a moment later. The first launch after
 * profiles moved to files finds the folder missing and copies the profiles kept in the settings store
 * into it, leaving the store as it was.
 *
 * Resolution composes rather than picks. Every enabled profile whose scope matches contributes, ordered
 * global → surface → language, each under its own heading — so "British English in markdown" stacks on
 * "be terse in the editor" rather than replacing it. That is the one behaviour that separates this from
 * the editor's language profiles, where the most specific value wins because two font sizes cannot both
 * apply; two instructions can.
 *
 * Outside Electron there is no folder; profiles live in memory for the session.
 */
@Service()
export class PromptProfiles {
  /**
   * Holds the bridge, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the settings store the profiles were kept in before they moved to files.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the profiles, in id order.
   */
  private readonly profilesState: WritableSignal<readonly PromptProfile[]> = signal<
    readonly PromptProfile[]
  >([]);

  /**
   * Holds the pending write of each profile edited, by id.
   */
  private readonly writeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Gets the profiles, in id order.
   */
  public readonly profiles: Signal<readonly PromptProfile[]> = this.profilesState.asReadonly();

  /**
   * Gets a promise that settles once the profiles have first been read from disk.
   */
  public readonly ready: Promise<void>;

  /**
   * Initializes the service: reads the folder (migrating on the first launch after the move), then
   * follows edits made in another window (#955) — every window holds its own copy, and the AI Manager
   * is rarely in the window whose agent is about to send the next message.
   */
  public constructor() {
    this.ready = this.reload(true);
    const unfollow: (() => void) | undefined = this.bridge?.on(
      PromptProfileChannel.Changed,
      (): void => {
        void this.reload(false);
        this.log.debug('PromptProfiles', 'Re-reading profiles changed elsewhere');
      },
    );
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
   * Re-reads the profiles from disk. Profiles with a write still pending keep the edited form.
   * @param migrate Whether a missing folder is the cue to copy the settings store's profiles in.
   * @returns Resolves once the signal is current.
   */
  public async reload(migrate: boolean = false): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    let listing: PromptProfileListing;
    try {
      listing = await this.bridge.invoke<PromptProfileListing>(PromptProfileChannel.List);
    } catch (error: unknown) {
      this.log.warn('PromptProfiles', 'Could not read the profile folder', error);
      return;
    }
    let profiles: readonly PromptProfile[] = listing.profiles;
    if (migrate && !listing.existed) {
      profiles = await this.migrate(profiles);
    }
    const pending: ReadonlyMap<string, PromptProfile> = new Map(
      this.profilesState()
        .filter((profile: PromptProfile): boolean => this.writeTimers.has(profile.id))
        .map((profile: PromptProfile): [string, PromptProfile] => [profile.id, profile]),
    );
    this.profilesState.set(
      profiles.map((profile: PromptProfile): PromptProfile => pending.get(profile.id) ?? profile),
    );
  }

  /**
   * Creates an empty profile applying everywhere, and returns it for the caller to open.
   * @param name The display name.
   * @returns Returns the new profile.
   */
  public create(name: string = 'New profile'): PromptProfile {
    const display: string = name.trim().length === 0 ? 'New profile' : name.trim();
    const profile: PromptProfile = {
      id: profileIdFor(
        display,
        this.profilesState().map((existing: PromptProfile): string => existing.id),
      ),
      name: display,
      scope: GLOBAL_SCOPE,
      instructions: '',
      enabled: true,
    };
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] =>
      [...profiles, profile].sort((a: PromptProfile, b: PromptProfile): number =>
        a.id.localeCompare(b.id),
      ),
    );
    this.write(profile.id);
    this.log.info('PromptProfiles', `Profile created '${profile.name}'`, profile.id);
    return profile;
  }

  /**
   * Updates a profile in place; its file is rewritten a moment after the last edit.
   * @param id The profile's identifier.
   * @param patch The fields to change.
   */
  public update(id: string, patch: Partial<Omit<PromptProfile, 'id'>>): void {
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] =>
      profiles.map((profile: PromptProfile): PromptProfile =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
    this.scheduleWrite(id);
  }

  /**
   * Deletes a profile and its file.
   * @param id The profile's identifier.
   */
  public delete(id: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.writeTimers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.writeTimers.delete(id);
    }
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] =>
      profiles.filter((profile: PromptProfile): boolean => profile.id !== id),
    );
    void this.bridge
      ?.invoke<void>(PromptProfileChannel.Delete, id)
      .catch((error: unknown): void => {
        this.log.warn('PromptProfiles', `Could not delete profile '${id}'`, error);
      });
    this.log.info('PromptProfiles', 'Profile deleted', id);
  }

  /**
   * Composes the instructions a run receives from every enabled profile in scope, each under its own
   * heading.
   * @param surface The surface the run is dispatched from.
   * @param language The language of the document owning the run, or null.
   * @returns Returns the composed instructions, or an empty string when none apply.
   */
  public resolve(surface: AgentSurface, language: string | null): string {
    const matching: readonly PromptProfile[] = sortByScope(
      this.profilesState().filter(
        (profile: PromptProfile): boolean =>
          profile.enabled && scopeMatches(profile.scope, surface, language),
      ),
      (profile: PromptProfile): PromptScope => profile.scope,
    );
    return matching
      .map((profile: PromptProfile): { name: string; text: string } => ({
        name: profile.name,
        text: profile.instructions.trim(),
      }))
      .filter((section: { text: string }): boolean => section.text.length > 0)
      .map(
        (section: { name: string; text: string }): string => `### ${section.name}\n${section.text}`,
      )
      .join('\n\n');
  }

  /**
   * Rewrites a profile's file a moment after the last edit.
   * @param id The profile's id.
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
   * Writes a profile's file now.
   * @param id The profile's id.
   */
  private write(id: string): void {
    const profile: PromptProfile | undefined = this.profilesState().find(
      (candidate: PromptProfile): boolean => candidate.id === id,
    );
    if (profile === undefined || this.bridge === undefined) {
      return;
    }
    void this.bridge
      .invoke<string | null>(PromptProfileChannel.Save, profile)
      .then((error: string | null): void => {
        if (error !== null) {
          this.log.warn('PromptProfiles', `Profile '${id}' not saved: ${error}`);
        }
      })
      .catch((error: unknown): void => {
        this.log.warn('PromptProfiles', `Could not save profile '${id}'`, error);
      });
  }

  /**
   * Copies the profiles kept in the settings store into the new folder, once. Each is filed under its
   * name, made unique; the store is left as it was.
   * @param onDisk What the folder already holds (normally nothing).
   * @returns Returns the profiles now on disk.
   */
  private async migrate(onDisk: readonly PromptProfile[]): Promise<readonly PromptProfile[]> {
    const legacy: readonly PromptProfile[] = this.readLegacy();
    if (legacy.length === 0 || this.bridge === undefined) {
      return onDisk;
    }
    const taken: string[] = onDisk.map((profile: PromptProfile): string => profile.id);
    const moved: PromptProfile[] = [];
    for (const profile of legacy) {
      // Filed under the name rather than the old random id, so the folder reads like the list.
      const id: string = profileIdFor(profile.name, taken);
      taken.push(id);
      const filed: PromptProfile = { ...profile, id };
      const error: string | null = await this.bridge.invoke<string | null>(
        PromptProfileChannel.Save,
        filed,
      );
      if (error === null) {
        moved.push(filed);
      } else {
        this.log.warn('PromptProfiles', `Profile '${profile.name}' not migrated: ${error}`);
      }
    }
    this.log.info('PromptProfiles', `Moved ${moved.length} profile(s) from settings to files`);
    return [...onDisk, ...moved].sort((a: PromptProfile, b: PromptProfile): number =>
      a.id.localeCompare(b.id),
    );
  }

  /**
   * Reads the profiles the settings store kept, dropping anything malformed. A profile saved before
   * the user layer was dropped has its two texts joined into one, system first, so nothing the user
   * wrote is lost.
   * @returns Returns the profiles.
   */
  private readLegacy(): readonly PromptProfile[] {
    const raw: unknown = this.store.get<unknown>(LEGACY_STORE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const profiles: PromptProfile[] = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') {
        continue;
      }
      profiles.push({
        id: record['id'],
        name: record['name'],
        scope: readPromptScope(record['scope']),
        instructions: this.instructionsOf(record),
        enabled: record['enabled'] !== false,
      });
    }
    return profiles;
  }

  /**
   * Reads a stored profile's instructions, joining the old system and user texts when it predates the
   * single text.
   * @param record The stored profile.
   * @returns Returns the instructions.
   */
  private instructionsOf(record: Record<string, unknown>): string {
    if (typeof record['instructions'] === 'string') {
      return record['instructions'];
    }
    return [record['system'], record['user']]
      .filter((text: unknown): text is string => typeof text === 'string')
      .map((text: string): string => text.trim())
      .filter((text: string): boolean => text.length > 0)
      .join('\n\n');
  }
}
