/**
 * The agent organisation's persistence model (epic #788): the named agents a project employs, the roles
 * they hold, and which work item each one is assigned to.
 *
 * Two files under a project's `.studio` folder, mirroring `workspace.json` / `workspace.user.json`:
 *
 * - `organisation.json` is **committed**: the roster and any roles the team defined or changed, so
 *   everyone who clones the repository meets the same agents.
 * - `organisation.user.json` is **per developer** and git-ignored (it matches the `.studio/*.user.json`
 *   pattern already seeded): which work item each agent is on, and the conversation each one is
 *   carrying — runtime state that means nothing on another machine.
 *
 * Parsing is defensive for the same reasons as the studio files — hand-editable, editable outside the
 * app, and written by an untrusted renderer — so anything malformed degrades to the defaults, an entry
 * at a time, rather than throwing.
 */

/**
 * The name of the committed organisation file.
 */
export const ORGANISATION_FILE: string = 'organisation.json';

/**
 * The name of the per-developer organisation file.
 */
export const ORGANISATION_USER_FILE: string = 'organisation.user.json';

/**
 * The schema version written to both files.
 */
export const ORGANISATION_SCHEMA_VERSION: number = 1;

/**
 * The most agents one project may employ. A ceiling on what a hand-edited or hostile file can make the
 * app hold, well above the three-to-five a team works best at.
 */
export const MAX_AGENTS: number = 32;

/**
 * The most roles one project may define, for the same reason.
 */
export const MAX_ROLES: number = 32;

/**
 * The longest agent name kept.
 */
export const MAX_NAME_LENGTH: number = 40;

/**
 * The longest role brief kept. A brief is a system-prompt layer, so its length is a cost on every turn.
 */
export const MAX_BRIEF_LENGTH: number = 8000;

/**
 * What an agent holding a role may touch.
 *
 * - `checkout`: writes in its work item's checkout.
 * - `patch`: proposes changes for the checkout's writer to apply, so it can share a checkout.
 * - `readonly`: reads, and talks to the organisation; every supervisor.
 */
export type RoleIsolation = 'checkout' | 'patch' | 'readonly';

/**
 * The isolations, for validation.
 */
const ISOLATIONS: readonly RoleIsolation[] = ['checkout', 'patch', 'readonly'];

/**
 * A role an agent can hold: what it is told about its job, and what it may touch.
 */
export interface OrganisationRole {
  /**
   * Gets the role's stable identifier (kebab-case).
   */
  readonly id: string;

  /**
   * Gets the role's title, as the user reads it.
   */
  readonly title: string;

  /**
   * Gets the role's brief: the standing system-prompt layer every agent holding the role carries.
   */
  readonly brief: string;

  /**
   * Gets what an agent holding the role may touch.
   */
  readonly isolation: RoleIsolation;

  /**
   * Gets the roles an agent holding this one may dispatch work to. Empty for a leaf worker.
   */
  readonly supervises: readonly string[];
}

/**
 * A named agent on a project's roster.
 */
export interface OrganisationAgent {
  /**
   * Gets the agent's stable identifier.
   */
  readonly id: string;

  /**
   * Gets the agent's name — what the user calls them.
   */
  readonly name: string;

  /**
   * Gets the identifier of the role the agent holds.
   */
  readonly roleId: string;
}

/**
 * The committed part of a project's organisation.
 */
export interface Organisation {
  /**
   * Gets every role available on the project: the built-in roles, as the project may have changed them,
   * then any it defined itself.
   */
  readonly roles: readonly OrganisationRole[];

  /**
   * Gets the project's agents, in roster order.
   */
  readonly agents: readonly OrganisationAgent[];
}

/**
 * One agent's per-developer state.
 */
export interface OrganisationAgentState {
  /**
   * Gets the agent the state belongs to.
   */
  readonly agentId: string;

  /**
   * Gets the number of the work item the agent is assigned to, or null when it has none.
   */
  readonly workItem: number | null;

  /**
   * Gets the identifier of the conversation the agent is carrying, or null before its first message.
   */
  readonly conversationId: string | null;
}

/**
 * The per-developer part of a project's organisation.
 */
export interface OrganisationUser {
  /**
   * Gets each agent's state, at most one per agent.
   */
  readonly agents: readonly OrganisationAgentState[];
}

/**
 * The roles every project starts with. Projects may change them (the file then carries the changed
 * copy) but cannot remove them, so an agent's role can always be resolved.
 */
export const BUILT_IN_ROLES: readonly OrganisationRole[] = [
  {
    id: 'principal-product-owner',
    title: 'Principal Product Owner',
    brief:
      'You are the Principal Product Owner. You own an initiative: you break it into epics, give each ' +
      'epic to a Product Owner, follow their progress, and report to the user. You do not write code. ' +
      'Escalate decisions that are the user’s to make rather than making them yourself.',
    isolation: 'readonly',
    supervises: ['product-owner'],
  },
  {
    id: 'product-owner',
    title: 'Product Owner',
    brief:
      'You are a Product Owner. You own an epic: you break it into features with clear acceptance ' +
      'criteria, give each feature to an engineer, have testers and QA verify it, and report to your ' +
      'supervisor. You do not write code.',
    isolation: 'readonly',
    supervises: ['engineer', 'tester', 'qa', 'reviewer'],
  },
  {
    id: 'engineer',
    title: 'Engineer',
    brief:
      'You are a software engineer. You deliver the feature you are assigned on its branch, to the ' +
      'repository’s standards, with tests, and report what you did and anything that blocks you.',
    isolation: 'checkout',
    supervises: [],
  },
  {
    id: 'tester',
    title: 'Tester',
    brief:
      'You are a tester. You write and run tests for the feature you are assigned, proposing them as ' +
      'changes for the engineer to apply, and report defects precisely enough to reproduce.',
    isolation: 'patch',
    supervises: [],
  },
  {
    id: 'qa',
    title: 'QA',
    brief:
      'You are QA. You verify the feature you are assigned against its acceptance criteria and report ' +
      'whether it meets them, with evidence. You do not change the code.',
    isolation: 'readonly',
    supervises: [],
  },
  {
    id: 'reviewer',
    title: 'Reviewer',
    brief:
      'You are a code reviewer. You review the changes on the branch you are assigned for correctness, ' +
      'security and fit with the codebase, and report findings ranked by severity. You do not change ' +
      'the code.',
    isolation: 'readonly',
    supervises: [],
  },
];

/**
 * Matches an identifier: lower-case kebab-case, or a UUID, at most 64 characters. Identifiers reach
 * conversation keys and file contents, so they are held to a shape that cannot smuggle anything.
 */
const IDENTIFIER: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Tells whether a value is a well-formed identifier.
 * @param value The value.
 * @returns Returns true when it is one.
 */
export function isOrganisationId(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

/**
 * Reads a value as an object's members, or an empty object when it is not one.
 * @param value The value.
 * @returns Returns the members.
 */
function membersOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads a value as an array, or an empty one when it is not one.
 * @param value The value.
 * @returns Returns the array.
 */
function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalises a display string: trimmed, inner whitespace collapsed, and cut to a length.
 * @param value The value.
 * @param limit The longest result kept.
 * @returns Returns the string, empty when the value is not a string.
 */
function displayString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/**
 * Parses a role, or returns null when it is not a usable one.
 * @param value The candidate role.
 * @returns Returns the role, or null.
 */
function parseRole(value: unknown): OrganisationRole | null {
  const members: Record<string, unknown> = membersOf(value);
  const title: string = displayString(members['title'], MAX_NAME_LENGTH);
  const isolation: unknown = members['isolation'];
  if (
    !isOrganisationId(members['id']) ||
    title.length === 0 ||
    !ISOLATIONS.includes(isolation as RoleIsolation)
  ) {
    return null;
  }
  const brief: unknown = members['brief'];
  return {
    id: members['id'],
    title,
    brief: typeof brief === 'string' ? brief.trim().slice(0, MAX_BRIEF_LENGTH) : '',
    isolation: isolation as RoleIsolation,
    supervises: [...new Set(arrayOf(members['supervises']).filter(isOrganisationId))],
  };
}

/**
 * Tells whether two roles are the same in every field.
 * @param left The first role.
 * @param right The second role.
 * @returns Returns true when they are equal.
 */
function sameRole(left: OrganisationRole, right: OrganisationRole): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.brief === right.brief &&
    left.isolation === right.isolation &&
    left.supervises.length === right.supervises.length &&
    left.supervises.every((id: string, index: number): boolean => id === right.supervises[index])
  );
}

/**
 * Parses the committed organisation file.
 *
 * The built-in roles are always present: a file's copy of one replaces it, and any other role the file
 * defines follows them. A role's `supervises` list keeps only roles that exist. An agent is kept only
 * with a unique identifier, a name, and a role that exists; the roster is capped at {@link MAX_AGENTS}.
 *
 * @param value The parsed JSON, or anything else.
 * @returns Returns the organisation.
 */
export function parseOrganisation(value: unknown): Organisation {
  const members: Record<string, unknown> = membersOf(value);
  const defined: Map<string, OrganisationRole> = new Map<string, OrganisationRole>();
  for (const candidate of arrayOf(members['roles'])) {
    const role: OrganisationRole | null = parseRole(candidate);
    if (role !== null && !defined.has(role.id) && defined.size < MAX_ROLES) {
      defined.set(role.id, role);
    }
  }
  const builtInIds: ReadonlySet<string> = new Set<string>(
    BUILT_IN_ROLES.map((role: OrganisationRole): string => role.id),
  );
  const merged: readonly OrganisationRole[] = [
    ...BUILT_IN_ROLES.map(
      (role: OrganisationRole): OrganisationRole => defined.get(role.id) ?? role,
    ),
    ...[...defined.values()].filter((role: OrganisationRole): boolean => !builtInIds.has(role.id)),
  ];
  const roleIds: ReadonlySet<string> = new Set<string>(
    merged.map((role: OrganisationRole): string => role.id),
  );
  const roles: readonly OrganisationRole[] = merged.map(
    (role: OrganisationRole): OrganisationRole => ({
      ...role,
      supervises: role.supervises.filter((id: string): boolean => roleIds.has(id)),
    }),
  );

  const agents: OrganisationAgent[] = [];
  const seen: Set<string> = new Set<string>();
  for (const candidate of arrayOf(members['agents'])) {
    const agent: Record<string, unknown> = membersOf(candidate);
    const name: string = displayString(agent['name'], MAX_NAME_LENGTH);
    const id: unknown = agent['id'];
    const roleId: unknown = agent['roleId'];
    if (
      agents.length < MAX_AGENTS &&
      isOrganisationId(id) &&
      !seen.has(id) &&
      name.length > 0 &&
      typeof roleId === 'string' &&
      roleIds.has(roleId)
    ) {
      seen.add(id);
      agents.push({ id, name, roleId });
    }
  }
  return { roles, agents };
}

/**
 * Serialises the committed organisation file. Only the roles a project changed or defined are written:
 * a built-in role left as shipped stays out of the file, so an improvement to it in a later release
 * reaches every project that never changed it.
 * @param organisation The organisation.
 * @returns Returns the file contents.
 */
export function serializeOrganisation(organisation: Organisation): string {
  const parsed: Organisation = parseOrganisation(organisation);
  const roles: readonly OrganisationRole[] = parsed.roles.filter(
    (role: OrganisationRole): boolean =>
      !BUILT_IN_ROLES.some((builtIn: OrganisationRole): boolean => sameRole(builtIn, role)),
  );
  return `${JSON.stringify(
    { version: ORGANISATION_SCHEMA_VERSION, roles, agents: parsed.agents },
    null,
    2,
  )}\n`;
}

/**
 * Parses the per-developer organisation file. At most one entry per agent is kept (the first), and an
 * entry with nothing in it is dropped.
 * @param value The parsed JSON, or anything else.
 * @returns Returns the per-developer state.
 */
export function parseOrganisationUser(value: unknown): OrganisationUser {
  const agents: OrganisationAgentState[] = [];
  const seen: Set<string> = new Set<string>();
  for (const candidate of arrayOf(membersOf(value)['agents'])) {
    const entry: Record<string, unknown> = membersOf(candidate);
    const agentId: unknown = entry['agentId'];
    const workItem: unknown = entry['workItem'];
    const conversationId: unknown = entry['conversationId'];
    if (!isOrganisationId(agentId) || seen.has(agentId) || agents.length >= MAX_AGENTS) {
      continue;
    }
    const state: OrganisationAgentState = {
      agentId,
      workItem:
        typeof workItem === 'number' && Number.isSafeInteger(workItem) && workItem > 0
          ? workItem
          : null,
      conversationId: isOrganisationId(conversationId) ? conversationId : null,
    };
    if (state.workItem !== null || state.conversationId !== null) {
      seen.add(agentId);
      agents.push(state);
    }
  }
  return { agents };
}

/**
 * Serialises the per-developer organisation file.
 * @param user The per-developer state.
 * @returns Returns the file contents.
 */
export function serializeOrganisationUser(user: OrganisationUser): string {
  return `${JSON.stringify(
    { version: ORGANISATION_SCHEMA_VERSION, agents: parseOrganisationUser(user).agents },
    null,
    2,
  )}\n`;
}
