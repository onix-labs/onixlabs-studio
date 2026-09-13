import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  AgentSurface,
  GLOBAL_SCOPE,
  PromptScope,
  readPromptScope,
  scopeMatches,
  sortByScope,
} from '@shared/api/ai-types';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * A prompt profile (#300): standing text the user wants every matching agent turn to carry — a system
 * layer, appended to Studio's own instructions, and a user layer, composed beneath each message. Both
 * bodies are free-form; "skills, context, instructions, guardrails" are all just prompt text here, and
 * a profile may fill either body or both.
 */
export interface PromptProfile {
  /**
   * Gets the stable identifier.
   */
  readonly id: string;

  /**
   * Gets the display name, which also heads the profile's section in the composed prompt so the
   * model can tell one standing instruction from another.
   */
  readonly name: string;

  /**
   * Gets where the profile applies.
   */
  readonly scope: PromptScope;

  /**
   * Gets the system-prompt text, or empty for none.
   */
  readonly system: string;

  /**
   * Gets the user-prompt text, or empty for none.
   */
  readonly user: string;

  /**
   * Gets whether the profile is applied. A disabled profile is kept but never composed, so a user can
   * park one without losing it.
   */
  readonly enabled: boolean;
}

/**
 * The two composed layers a run receives, each empty when nothing applies.
 */
export interface ResolvedPrompts {
  /**
   * Gets the composed system layer.
   */
  readonly system: string;

  /**
   * Gets the composed user layer.
   */
  readonly user: string;
}

/**
 * The store key the profiles persist under.
 */
const STORE_KEY: string = 'ai.promptProfiles';

/**
 * Owns the user's prompt profiles: persisted through the settings store like the `/`-snippet library,
 * and resolved per run against the run's surface and language.
 *
 * Resolution composes rather than picks. Every enabled profile whose scope matches contributes, ordered
 * global → surface → language, each under its own heading — so "British English in markdown" stacks on
 * "be terse in the editor" rather than replacing it. That is the one behaviour that separates this from
 * the editor's language profiles, where the most specific value wins because two font sizes cannot both
 * apply; two instructions can.
 */
@Service()
export class PromptProfiles {
  /**
   * Holds the settings store the profiles persist in.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the profiles, in the order the user keeps them.
   */
  private readonly profilesState: WritableSignal<readonly PromptProfile[]> = signal<
    readonly PromptProfile[]
  >(this.load());

  /**
   * Gets the profiles, in the user's order.
   */
  public readonly profiles: Signal<readonly PromptProfile[]> = this.profilesState.asReadonly();

  /**
   * Creates an empty profile applying everywhere, and returns it for the caller to open.
   * @param name The display name.
   * @returns Returns the new profile.
   */
  public create(name: string = 'New profile'): PromptProfile {
    const profile: PromptProfile = {
      id: crypto.randomUUID(),
      name: name.trim().length === 0 ? 'New profile' : name.trim(),
      scope: GLOBAL_SCOPE,
      system: '',
      user: '',
      enabled: true,
    };
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] => [
      ...profiles,
      profile,
    ]);
    this.persist();
    this.log.info('PromptProfiles', `Profile created '${profile.name}'`, profile.id);
    return profile;
  }

  /**
   * Updates a profile in place.
   * @param id The profile's identifier.
   * @param patch The fields to change.
   */
  public update(id: string, patch: Partial<Omit<PromptProfile, 'id'>>): void {
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] =>
      profiles.map((profile: PromptProfile): PromptProfile =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
    this.persist();
  }

  /**
   * Deletes a profile.
   * @param id The profile's identifier.
   */
  public delete(id: string): void {
    this.profilesState.update((profiles: readonly PromptProfile[]): readonly PromptProfile[] =>
      profiles.filter((profile: PromptProfile): boolean => profile.id !== id),
    );
    this.persist();
    this.log.info('PromptProfiles', 'Profile deleted', id);
  }

  /**
   * Composes the layers a run receives from every enabled profile in scope.
   * @param surface The surface the run is dispatched from.
   * @param language The language of the document owning the run, or null.
   * @returns Returns the composed layers.
   */
  public resolve(surface: AgentSurface, language: string | null): ResolvedPrompts {
    const matching: readonly PromptProfile[] = sortByScope(
      this.profilesState().filter(
        (profile: PromptProfile): boolean =>
          profile.enabled && scopeMatches(profile.scope, surface, language),
      ),
      (profile: PromptProfile): PromptScope => profile.scope,
    );
    const compose: (pick: (profile: PromptProfile) => string) => string = (
      pick: (profile: PromptProfile) => string,
    ): string =>
      matching
        .map((profile: PromptProfile): { name: string; text: string } => ({
          name: profile.name,
          text: pick(profile).trim(),
        }))
        .filter((section: { text: string }): boolean => section.text.length > 0)
        .map(
          (section: { name: string; text: string }): string =>
            `### ${section.name}\n${section.text}`,
        )
        .join('\n\n');
    return {
      system: compose((profile: PromptProfile): string => profile.system),
      user: compose((profile: PromptProfile): string => profile.user),
    };
  }

  /**
   * Reads the persisted profiles, dropping anything malformed.
   * @returns Returns the profiles.
   */
  private load(): readonly PromptProfile[] {
    const raw: unknown = this.store.get<unknown>(STORE_KEY, []);
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
        system: typeof record['system'] === 'string' ? record['system'] : '',
        user: typeof record['user'] === 'string' ? record['user'] : '',
        enabled: record['enabled'] !== false,
      });
    }
    return profiles;
  }

  /**
   * Writes the profiles to the store.
   */
  private persist(): void {
    this.store.set(STORE_KEY, this.profilesState());
  }
}
