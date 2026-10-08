import type { Skill } from '@shared/api/skill-channels';
import { projectBrief, projectMessage, ProjectMessageInput } from './project-message';

/**
 * Gathers nothing at all: every step skipped.
 */
const NOTHING: ProjectMessageInput = {
  goal: null,
  made: null,
  name: null,
  summary: '',
  technologies: [],
  options: [],
  skills: [],
  documents: [],
};

describe('projectMessage', () => {
  it('everyStepSkipped_stillAsksToPlanSomethingNew', () => {
    expect(projectMessage(NOTHING)).toBe(
      'I want to build something new.\n\nHelp me plan it before we build anything.',
    );
  });

  it('aTemplate_sayWhatIsBeingBuilt', () => {
    expect(
      projectMessage({
        ...NOTHING,
        goal: { kind: 'template', text: 'a desktop application' },
      }).startsWith('I want to build a desktop application.'),
    ).toBe(true);
  });

  it('theUsersOwnWords_areQuoted_asTheyWroteThem', () => {
    expect(
      projectMessage({
        ...NOTHING,
        goal: { kind: 'idea', text: '  A tool that tidies my photos.  ' },
      }).startsWith('I want to build this: A tool that tidies my photos.'),
    ).toBe(true);
  });

  it('aProjectMade_saysWhereAndItsRepository', () => {
    expect(
      projectMessage({
        ...NOTHING,
        goal: { kind: 'template', text: 'a game' },
        made: { name: 'quest', path: '/p/quest', repository: 'a local repository' },
      }).split('\n\n')[0],
    ).toBe(
      'I want to build a game. I\'ve created a project for it called "quest", at /p/quest, with a local repository.',
    );
  });

  it('aNameWithoutAPlace_isOfferedAsWhatToCallIt', () => {
    expect(projectMessage({ ...NOTHING, name: 'quest' }).split('\n\n')[0]).toBe(
      'I want to build something new. I\'d like to call it "quest".',
    );
  });

  it('everythingGathered_isSetOutInSections_inOrder', () => {
    const message: string = projectMessage({
      goal: { kind: 'template', text: 'a web application' },
      made: null,
      name: null,
      summary: 'A recipe box.\n\nFor my family.',
      technologies: [
        { category: 'Languages', names: ['TypeScript'] },
        { category: 'Frontend', names: ['Angular', 'Tailwind CSS'] },
      ],
      options: [{ label: 'Licence', phrase: 'MIT' }],
      skills: ['house-style'],
      documents: ['notes.md', 'sketch.png'],
    });

    expect(message).toBe(
      [
        'I want to build a web application.',
        '**About it**\n\nA recipe box.\n\nFor my family.',
        '**Technology**\n\n- Languages: TypeScript\n- Frontend: Angular, Tailwind CSS',
        '**Preferences**\n\n- Licence: MIT\n- Skills to follow: house-style',
        '**Supporting documents** (attached)\n\n- notes.md\n- sketch.png',
        'Help me plan it before we build anything.',
      ].join('\n\n'),
    );
  });
});

describe('projectBrief', () => {
  it('withoutAFolder_tellsTheAgentNotToCreateFiles', () => {
    expect(projectBrief(false, [])).toContain('nowhere to create files');
  });

  it('inAWorkspace_saysTheWorkspaceIsTheProject', () => {
    const brief: string = projectBrief(true, []);
    expect(brief).toContain('in its new workspace');
    expect(brief).not.toContain('nowhere to create files');
  });

  it('carriesEachSkillsBody_inOrder', () => {
    const skills: Skill[] = [
      { name: 'new-cli-tool', body: 'Ask about packaging.' } as Skill,
      { name: 'house-style', body: 'Use British English.' } as Skill,
    ];

    const brief: string = projectBrief(true, skills);

    expect(brief).toContain('Follow the "new-cli-tool" skill:\n\nAsk about packaging.');
    expect(brief.indexOf('new-cli-tool')).toBeLessThan(brief.indexOf('house-style'));
  });
});
