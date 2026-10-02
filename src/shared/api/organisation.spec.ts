import {
  BUILT_IN_ROLES,
  isOrganisationId,
  MAX_AGENTS,
  MAX_BRIEF_LENGTH,
  Organisation,
  OrganisationRole,
  parseOrganisation,
  parseOrganisationUser,
  serializeOrganisation,
  serializeOrganisationUser,
} from './organisation';

/**
 * Reads the role ids of an organisation, in order.
 * @param organisation The organisation.
 * @returns Returns the ids.
 */
function roleIds(organisation: Organisation): readonly string[] {
  return organisation.roles.map((role: OrganisationRole): string => role.id);
}

/**
 * A custom role.
 */
const ARCHITECT: OrganisationRole = {
  id: 'architect',
  title: 'Architect',
  brief: 'Own the design.',
  isolation: 'readonly',
  supervises: ['engineer'],
};

describe('isOrganisationId', () => {
  it('acceptsKebabCaseAndUuids', () => {
    expect(isOrganisationId('product-owner')).toBe(true);
    expect(isOrganisationId('3f2b9c1e-6a7d-4e1f-9b2a-0c5d8e7f6a1b')).toBe(true);
  });

  it('rejectsAnythingThatCouldSmuggleStructure', () => {
    for (const value of ['', 'Ada', '../x', 'a b', '-lead', 'a/b', 'x'.repeat(65), 7, null]) {
      expect(isOrganisationId(value)).toBe(false);
    }
  });
});

describe('parseOrganisation', () => {
  it('startsWithTheBuiltInRolesAndNoAgents', () => {
    for (const value of [null, 'nonsense', [], { roles: 'x', agents: {} }]) {
      expect(parseOrganisation(value)).toEqual({ roles: BUILT_IN_ROLES, agents: [] });
    }
  });

  it('letsAFileChangeABuiltInRole_withoutMovingIt', () => {
    const changed: OrganisationRole = { ...BUILT_IN_ROLES[2], brief: 'Ship it.' };

    const organisation: Organisation = parseOrganisation({ roles: [changed] });

    expect(roleIds(organisation)).toEqual(BUILT_IN_ROLES.map((role) => role.id));
    expect(organisation.roles[2].brief).toBe('Ship it.');
  });

  it('appendsTheRolesAFileDefines', () => {
    expect(roleIds(parseOrganisation({ roles: [ARCHITECT] })).at(-1)).toBe('architect');
  });

  it('dropsMalformedRoles_andDuplicates', () => {
    const organisation: Organisation = parseOrganisation({
      roles: [
        ARCHITECT,
        { ...ARCHITECT, title: 'Second architect' },
        { ...ARCHITECT, id: 'Bad Id' },
        { ...ARCHITECT, id: 'no-title', title: '   ' },
        { ...ARCHITECT, id: 'bad-isolation', isolation: 'root' },
      ],
    });

    expect(roleIds(organisation).slice(BUILT_IN_ROLES.length)).toEqual(['architect']);
    expect(organisation.roles.at(-1)?.title).toBe('Architect');
  });

  it('keepsOnlySupervisedRolesThatExist', () => {
    const organisation: Organisation = parseOrganisation({
      roles: [{ ...ARCHITECT, supervises: ['engineer', 'ghost', 'engineer', 'Bad'] }],
    });

    expect(organisation.roles.at(-1)?.supervises).toEqual(['engineer']);
  });

  it('capsTheBrief', () => {
    const organisation: Organisation = parseOrganisation({
      roles: [{ ...ARCHITECT, brief: 'x'.repeat(MAX_BRIEF_LENGTH + 10) }],
    });

    expect(organisation.roles.at(-1)?.brief).toHaveLength(MAX_BRIEF_LENGTH);
  });

  it('keepsAgentsWithAUniqueIdANameAndARoleThatExists', () => {
    const organisation: Organisation = parseOrganisation({
      agents: [
        { id: 'ada', name: '  Ada   Lovelace ', roleId: 'engineer' },
        { id: 'ada', name: 'Second Ada', roleId: 'engineer' },
        { id: 'grace', name: 'Grace', roleId: 'astronaut' },
        { id: 'alan', name: '', roleId: 'qa' },
        { id: 'Bad Id', name: 'Bad', roleId: 'qa' },
        { id: 'linus', name: 'Linus', roleId: 'reviewer' },
      ],
    });

    expect(organisation.agents).toEqual([
      { id: 'ada', name: 'Ada Lovelace', roleId: 'engineer' },
      { id: 'linus', name: 'Linus', roleId: 'reviewer' },
    ]);
  });

  it('capsTheRoster', () => {
    const agents: readonly unknown[] = Array.from({ length: MAX_AGENTS + 5 }, (_v, index) => ({
      id: `agent-${index}`,
      name: `Agent ${index}`,
      roleId: 'engineer',
    }));

    expect(parseOrganisation({ agents }).agents).toHaveLength(MAX_AGENTS);
  });
});

describe('serializeOrganisation', () => {
  it('writesOnlyTheRolesAProjectChangedOrDefined', () => {
    const organisation: Organisation = parseOrganisation({
      roles: [ARCHITECT, { ...BUILT_IN_ROLES[0], title: 'Chief' }],
      agents: [{ id: 'ada', name: 'Ada', roleId: 'architect' }],
    });

    const written: { version: number; roles: OrganisationRole[]; agents: unknown[] } = JSON.parse(
      serializeOrganisation(organisation),
    ) as { version: number; roles: OrganisationRole[]; agents: unknown[] };

    expect(written.version).toBe(1);
    expect(written.roles.map((role: OrganisationRole): string => role.id)).toEqual([
      'principal-product-owner',
      'architect',
    ]);
    expect(written.agents).toEqual([{ id: 'ada', name: 'Ada', roleId: 'architect' }]);
  });

  it('roundTrips', () => {
    const organisation: Organisation = parseOrganisation({
      roles: [ARCHITECT],
      agents: [{ id: 'ada', name: 'Ada', roleId: 'architect' }],
    });

    expect(parseOrganisation(JSON.parse(serializeOrganisation(organisation)))).toEqual(
      organisation,
    );
  });

  it('sanitisesWhatItIsGiven', () => {
    // The renderer is untrusted: whatever it sends is parsed before it is written.
    const hostile: Organisation = {
      roles: [],
      agents: [{ id: '../../etc', name: 'X', roleId: 'engineer' }],
    };

    expect(JSON.parse(serializeOrganisation(hostile))).toEqual({
      version: 1,
      roles: [],
      agents: [],
    });
  });
});

describe('parseOrganisationUser', () => {
  it('keepsOneWellFormedEntryPerAgent', () => {
    expect(
      parseOrganisationUser({
        agents: [
          { agentId: 'ada', workItem: 795, conversationId: '3f2b9c1e-6a7d-4e1f-9b2a-0c5d8e7f6a1b' },
          { agentId: 'ada', workItem: 1 },
          { agentId: 'grace', workItem: -3, conversationId: '../x' },
          { agentId: 'linus', workItem: 2.5 },
          { agentId: 'alan', conversationId: null, workItem: 12 },
          { agentId: 'Bad', workItem: 1 },
        ],
      }),
    ).toEqual({
      agents: [
        {
          agentId: 'ada',
          workItem: 795,
          conversationId: '3f2b9c1e-6a7d-4e1f-9b2a-0c5d8e7f6a1b',
        },
        { agentId: 'alan', workItem: 12, conversationId: null },
      ],
    });
  });

  it('defaultsToNothing', () => {
    expect(parseOrganisationUser(undefined)).toEqual({ agents: [] });
  });

  it('roundTrips', () => {
    const user: ReturnType<typeof parseOrganisationUser> = parseOrganisationUser({
      agents: [{ agentId: 'ada', workItem: 3, conversationId: null }],
    });

    expect(parseOrganisationUser(JSON.parse(serializeOrganisationUser(user)))).toEqual(user);
  });
});
