/**
 * The categories of the New Project wizard's technology catalogue (#806), by id, in the order they are
 * shown. Other holds what the user adds themselves.
 */
export const TECHNOLOGY_CATEGORIES: readonly [
  'languages',
  'frontend',
  'backend',
  'desktop-mobile',
  'databases',
  'caching',
  'messaging',
  'search',
  'auth',
  'ai',
  'cloud',
  'containers',
  'observability',
  'testing',
  'cicd',
  'build',
  'other',
] = [
  'languages',
  'frontend',
  'backend',
  'desktop-mobile',
  'databases',
  'caching',
  'messaging',
  'search',
  'auth',
  'ai',
  'cloud',
  'containers',
  'observability',
  'testing',
  'cicd',
  'build',
  'other',
];

/**
 * Identifies a category of the technology catalogue.
 */
export type TechnologyCategory = (typeof TECHNOLOGY_CATEGORIES)[number];

/**
 * What each category is called where the user sees it.
 */
export const TECHNOLOGY_CATEGORY_LABELS: Readonly<Record<TechnologyCategory, string>> = {
  languages: 'Languages',
  frontend: 'Frontend',
  backend: 'Backend & APIs',
  'desktop-mobile': 'Desktop & Mobile',
  databases: 'Databases',
  caching: 'Caching',
  messaging: 'Messaging & Streaming',
  search: 'Search',
  auth: 'Auth & Identity',
  ai: 'AI & ML',
  cloud: 'Cloud & Hosting',
  containers: 'Containers & Orchestration',
  observability: 'Observability',
  testing: 'Testing',
  cicd: 'CI/CD',
  build: 'Build & Packaging',
  other: 'Other',
};

/**
 * Determines whether a value names a technology category.
 * @param value The value.
 * @returns Returns true when it does.
 */
export function isTechnologyCategory(value: unknown): value is TechnologyCategory {
  return typeof value === 'string' && (TECHNOLOGY_CATEGORIES as readonly string[]).includes(value);
}
