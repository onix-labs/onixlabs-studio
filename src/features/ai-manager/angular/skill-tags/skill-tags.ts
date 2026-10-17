import { MultiSelectItem } from '@shared/angular/components/forms/multi-select/multi-select';
import {
  knownLanguages,
  languageDisplayName,
} from '@shared/angular/services/plugins/language-names';
import { Technology, TECHNOLOGY_CATALOGUE } from '@shared/api/technology/technology-catalogue';
import {
  TECHNOLOGY_CATEGORIES,
  TECHNOLOGY_CATEGORY_LABELS,
  type TechnologyCategory,
} from '@shared/api/technology/technology-category';

// What a skill can be tagged with (#962), shared by the Skill Library's editor and the AI Manager's
// agent (#967), so a tag the agent writes is one the editor offers and shows.

/**
 * The languages the editor knows, which narrow a skill's editor runs.
 */
export const EDITOR_LANGUAGES: ReadonlySet<string> = new Set<string>(knownLanguages());

/**
 * The options of a skill's languages and technologies (#962), one list under category headings:
 * Languages first — every editor language and every language the catalogue names, by name — then each
 * of the catalogue's other categories. An editor language is listed only under Languages, so one id is
 * never offered twice.
 */
export const SKILL_TAG_OPTIONS: readonly MultiSelectItem[] = ((): readonly MultiSelectItem[] => {
  const byName: (a: MultiSelectItem, b: MultiSelectItem) => number = (
    a: MultiSelectItem,
    b: MultiSelectItem,
  ): number => a.label.localeCompare(b.label);
  const languages: Map<string, MultiSelectItem> = new Map<string, MultiSelectItem>();
  for (const id of EDITOR_LANGUAGES) {
    languages.set(id, { value: id, label: languageDisplayName(id), group: 'Languages' });
  }
  for (const technology of TECHNOLOGY_CATALOGUE) {
    if (technology.category === 'languages') {
      languages.set(technology.id, {
        value: technology.id,
        label: technology.name,
        group: 'Languages',
      });
    }
  }
  const rest: MultiSelectItem[] = TECHNOLOGY_CATEGORIES.filter(
    (category: TechnologyCategory): boolean => category !== 'languages' && category !== 'other',
  ).flatMap((category: TechnologyCategory): MultiSelectItem[] =>
    TECHNOLOGY_CATALOGUE.filter(
      (technology: Technology): boolean =>
        technology.category === category && !languages.has(technology.id),
    )
      .map((technology: Technology): MultiSelectItem => ({
        value: technology.id,
        label: technology.name,
        group: TECHNOLOGY_CATEGORY_LABELS[category],
      }))
      .sort(byName),
  );
  return [...[...languages.values()].sort(byName), ...rest];
})();

/**
 * The ids {@link SKILL_TAG_OPTIONS} offers.
 */
export const OFFERED_TAGS: ReadonlySet<string> = new Set<string>(
  SKILL_TAG_OPTIONS.map((option: MultiSelectItem): string => option.value),
);

/**
 * Splits one selection of tags into a skill's languages and technologies: an editor language narrows
 * the editor and is a tag besides; anything else is a technology, a tag alone. An id the list does not
 * offer — written into the file by hand — is kept where it was, since the list cannot untick it.
 * @param ids The ids chosen.
 * @param languages The skill's languages before the change.
 * @param technologies The skill's technologies before the change.
 * @returns Returns the languages and the technologies.
 */
export function splitSkillTags(
  ids: readonly string[],
  languages: readonly string[],
  technologies: readonly string[],
): { languages: readonly string[]; technologies: readonly string[] } {
  const unlisted: (id: string) => boolean = (id: string): boolean => !OFFERED_TAGS.has(id);
  return {
    languages: [
      ...ids.filter((id: string): boolean => EDITOR_LANGUAGES.has(id)),
      ...languages.filter(unlisted),
    ],
    technologies: [
      ...ids.filter((id: string): boolean => !EDITOR_LANGUAGES.has(id)),
      ...technologies.filter(unlisted),
    ],
  };
}
